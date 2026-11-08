import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { createReadStream, existsSync, openSync, readSync, closeSync, unlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  db, now, tx, UPLOAD_DIR, INCIDENT_SELECT, getIncident, getMission, toAudit, toAttachment, toAssessment, toDrone,
  toIncident, toMission, toNotification, toReport, toSuppression, toUser, attachmentsFor, parseJson,
} from './db.ts';
import {
  audit, hashIp, hashPassword, login, logout, num, oneOf, rateLimit, requireAny, requireAuth, sessionCookie, str, ValidationError,
} from './security.ts';
import { broadcast, notify } from './realtime.ts';
import { addWaypoints, randomChars } from './seed.ts';
import type { Simulator } from './simulator.ts';
import type { DroneAdapter } from './adapters.ts';
import {
  ASSESSMENT_REVIEW, COMMAND_ALLOWED_IN, computePriority, DRONE_COMMANDS, DRONE_STATUSES, FIRE_SIZES, FIRE_TYPES,
  INCIDENT_STATUSES, INCIDENT_TRANSITIONS, MISSION_OUTCOMES, PAYLOAD_TYPES, PEOPLE_RISK, PREFLIGHT_CHECKS, ROLE_PERMISSIONS,
  ROLES, SMOKE_LEVELS, TELEMETRY_STALE_MS, ADAPTER_KINDS,
} from '../shared/domain.ts';
import type { AdapterKind, DroneDTO, IncidentStatus, TrackingStage } from '../shared/domain.ts';

type Row = Record<string, any>;
const id = (req: Request, key = 'id') => num(req.params[key], key, 1, Number.MAX_SAFE_INTEGER);
const actor = (req: Request) => req.user!.username;

export function buildRouter(sim: Simulator, adapters: Record<AdapterKind, DroneAdapter>) {
  const r = Router();

  const droneDTO = (row: Row): DroneDTO => ({ ...toDrone(row), telemetry: sim.telemetry(row.id) });
  const getDrone = (did: number) => {
    const row = db.prepare('SELECT * FROM drones WHERE id = ?').get(did) as Row | undefined;
    return row ? droneDTO(row) : null;
  };
  const event = (incidentId: number, kind: string, by: string | null, detail: Record<string, unknown> = {}) => {
    db.prepare('INSERT INTO incident_events (incident_id, at, kind, actor, detail) VALUES (?,?,?,?,?)').run(incidentId, now(), kind, by, JSON.stringify(detail));
    db.prepare('UPDATE incidents SET updated_at = ? WHERE id = ?').run(now(), incidentId);
    const inc = getIncident(incidentId);
    if (inc) broadcast({ type: 'incident', data: inc });
  };
  const pushMission = (mid: number) => {
    const m = getMission(mid);
    if (m) broadcast({ type: 'mission', data: m });
    return m;
  };
  const pushDrone = (did: number) => {
    const d = getDrone(did);
    if (d) broadcast({ type: 'drone', data: d });
  };

  // ---------------------------------------------------------------------------------------------
  // Health & capability disclosure
  // ---------------------------------------------------------------------------------------------
  r.get('/health', (_req, res) => {
    res.json({
      ok: true,
      time: now(),
      emergencyIntegration: { configured: false, note: 'No authority dispatch integration. Reports are stored in FIREGUARD only.' },
      adapters: Object.values(adapters).map((a) => ({ kind: a.kind, configured: a.configured, note: a.note })),
      simulator: sim.state,
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Public reporting (no account)
  // ---------------------------------------------------------------------------------------------
  const reportLimiter = rateLimit('report', 6, 10 * 60 * 1000);
  r.post('/public/reports', reportLimiter, (req, res) => {
    const b = req.body ?? {};
    const lat = num(b.lat, 'lat', 16, 27); // Oman bounding latitudes (approx.)
    const lng = num(b.lng, 'lng', 51, 60.5);
    const data = {
      fireType: oneOf(b.fireType, FIRE_TYPES, 'fireType'),
      fireSize: oneOf(b.fireSize, FIRE_SIZES, 'fireSize'),
      smoke: oneOf(b.smoke, SMOKE_LEVELS, 'smoke'),
      peopleAtRisk: oneOf(b.peopleAtRisk, PEOPLE_RISK, 'peopleAtRisk'),
      locationMethod: oneOf(b.locationMethod, ['gps', 'manual', 'gps_adjusted'] as const, 'locationMethod'),
      accuracy: b.locationAccuracy == null ? null : num(b.locationAccuracy, 'locationAccuracy', 0, 100000),
      description: str(b.locationDescription, 'locationDescription', { max: 300 }),
      notes: str(b.notes, 'notes', { max: 1000 }),
      contactName: str(b.contactName, 'contactName', { max: 80 }) || null,
      contactPhone: str(b.contactPhone, 'contactPhone', { max: 20 }) || null,
    };
    if (data.contactPhone && !/^\+?[0-9 ]{7,16}$/.test(data.contactPhone)) throw new ValidationError('contactPhone', 'invalid');
    const reference = `FG-${randomChars(4)}-${randomChars(4)}`;
    const token = randomBytes(18).toString('base64url');
    const t = now();
    const row = db
      .prepare(`INSERT INTO reports (reference, tracking_secret, status, lat, lng, location_accuracy, location_method, location_description,
        fire_type, fire_size, smoke, people_at_risk, notes, contact_name, contact_phone, created_at, updated_at, ip_hash)
        VALUES (?,?,'submitted',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`)
      .get(reference, token, lat, lng, data.accuracy, data.locationMethod, data.description, data.fireType, data.fireSize, data.smoke,
        data.peopleAtRisk, data.notes, data.contactName, data.contactPhone, t, t, hashIp(req.ip)) as Row;
    const pr = computePriority({ fireType: data.fireType, fireSize: data.fireSize, smoke: data.smoke, peopleAtRisk: data.peopleAtRisk });
    audit(req, 'report.submitted', 'report', row.id, { reference, priority: pr.priority }, { name: 'public', role: null });
    notify(pr.priority === 'P1' ? 'critical' : 'warning', 'report.new', { reference, priority: pr.priority }, `/ops/incidents?report=${row.id}`);
    broadcast({ type: 'report', data: { id: row.id, reference } });
    res.status(201).json({ reference, token, status: 'submitted', createdAt: t, lat, lng, delivery: { authorityNotified: false } });
  });

  // Secure uploads: random storage names, allow-listed MIME + magic-byte check, size & count limits.
  const upload = multer({
    storage: multer.diskStorage({
      destination: UPLOAD_DIR,
      filename: (_q, _f, cb) => cb(null, `tmp-${randomBytes(16).toString('hex')}`),
    }),
    limits: { fileSize: 25 * 1024 * 1024, files: 4 },
    fileFilter: (_q, f, cb) => cb(null, /^(image\/(jpeg|png|webp)|video\/(mp4|webm|quicktime))$/.test(f.mimetype)),
  });
  const MAGIC: [RegExp, (b: Buffer) => boolean][] = [
    [/^image\/jpeg$/, (b) => b[0] === 0xff && b[1] === 0xd8],
    [/^image\/png$/, (b) => b.subarray(0, 4).toString('hex') === '89504e47'],
    [/^image\/webp$/, (b) => b.subarray(8, 12).toString() === 'WEBP'],
    [/^video\/(mp4|quicktime)$/, (b) => b.subarray(4, 8).toString() === 'ftyp'],
    [/^video\/webm$/, (b) => b.subarray(0, 4).toString('hex') === '1a45dfa3'],
  ];
  const persistUploads = (files: Express.Multer.File[], target: { reportId?: number; incidentId?: number }, source: string) => {
    const saved = [];
    for (const f of files) {
      const buf = Buffer.alloc(16);
      const fd = openSync(f.path, 'r');
      readSync(fd, buf, 0, 16, 0);
      closeSync(fd);
      const check = MAGIC.find(([re]) => re.test(f.mimetype));
      if (!check || !check[1](buf)) {
        unlinkSync(f.path);
        continue;
      }
      const key = randomBytes(16).toString('hex');
      renameSync(f.path, join(UPLOAD_DIR, key));
      const row = db
        .prepare('INSERT INTO attachments (report_id, incident_id, kind, mime, size, storage_key, source, created_at) VALUES (?,?,?,?,?,?,?,?) RETURNING *')
        .get(target.reportId ?? null, target.incidentId ?? null, f.mimetype.startsWith('video') ? 'video' : 'image', f.mimetype, f.size, key, source, now()) as Row;
      saved.push(toAttachment(row));
    }
    return saved;
  };

  r.post('/public/reports/:ref/attachments', rateLimit('upload', 10, 10 * 60 * 1000), upload.array('files', 4), (req, res) => {
    const files = (req.files as Express.Multer.File[]) ?? [];
    const rep = db.prepare('SELECT id, tracking_secret, created_at FROM reports WHERE reference = ?').get(String(req.params.ref)) as Row | undefined;
    const ok = rep && rep.tracking_secret === req.get('x-report-token') && Date.now() - new Date(rep.created_at).getTime() < 60 * 60 * 1000;
    if (!ok) {
      files.forEach((f) => existsSync(f.path) && unlinkSync(f.path));
      return res.status(403).json({ error: 'forbidden' });
    }
    const saved = persistUploads(files, { reportId: rep.id }, 'public');
    res.json({ accepted: saved.length, rejected: files.length - saved.length });
  });

  r.get('/public/track/:ref', rateLimit('track', 60, 60 * 1000), (req, res) => {
    const ref = String(req.params.ref).toUpperCase().trim();
    const rep = db.prepare('SELECT * FROM reports WHERE reference = ?').get(ref) as Row | undefined;
    if (!rep) return res.status(404).json({ error: 'not_found' });
    // Only status information is exposed publicly — no personal data or operational detail.
    const stages: { stage: TrackingStage; at: string }[] = [{ stage: 'submitted', at: rep.created_at }];
    let current: TrackingStage | 'rejected' | 'duplicate' | 'cancelled' = rep.status === 'under_review' ? 'under_review' : 'submitted';
    if (rep.status !== 'submitted') stages.push({ stage: 'under_review', at: rep.updated_at });
    if (['rejected', 'cancelled'].includes(rep.status)) current = rep.status;
    if (rep.incident_id) {
      const inc = getIncident(rep.incident_id)!;
      const evs = db.prepare('SELECT kind, at FROM incident_events WHERE incident_id = ? ORDER BY at').all(inc.id) as Row[];
      const at = (k: string) => evs.find((e) => e.kind === k)?.at;
      if (inc.verifiedAt) stages.push({ stage: 'verified', at: inc.verifiedAt });
      const order = INCIDENT_STATUSES.indexOf(inc.status);
      if (order >= 1) stages.push({ stage: 'response_assigned', at: at('incident.status.response_assigned') ?? at('incident.assigned') ?? inc.updatedAt });
      if (order >= 2) stages.push({ stage: 'in_progress', at: at('incident.status.in_progress') ?? at('mission.started') ?? inc.updatedAt });
      if (order >= 3) stages.push({ stage: 'resolved', at: inc.resolvedAt ?? inc.updatedAt });
      if (order >= 4) stages.push({ stage: 'closed', at: inc.updatedAt });
      current = rep.status === 'duplicate' ? 'duplicate' : inc.status;
    }
    res.json({ reference: rep.reference, current, duplicate: rep.status === 'duplicate', stages, createdAt: rep.created_at, updatedAt: rep.updated_at, isDemo: !!rep.is_demo });
  });

  // Aggregate counts only; flags whether any demo records are included so the UI can label them.
  r.get('/public/stats', rateLimit('stats', 60, 60 * 1000), (_req, res) => {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const s = db
      .prepare(`SELECT (SELECT COUNT(*) FROM reports WHERE created_at >= ?) reports,
        (SELECT COUNT(*) FROM incidents WHERE verified_at >= ?) verified,
        (SELECT COUNT(*) FROM missions WHERE created_at >= ?) missions,
        (SELECT AVG((julianday(verified_at) - julianday(created_at)) * 1440) FROM incidents WHERE verified_at >= ?) avgVerifyMin,
        (SELECT COUNT(*) FROM incidents WHERE is_demo = 1) demo`)
      .get(since, since, since, since) as Row;
    res.json({ reports: s.reports, verified: s.verified, missions: s.missions, avgVerifyMin: s.avgVerifyMin, isDemo: s.demo > 0 });
  });

  r.post('/public/reports/:ref/cancel', rateLimit('cancel', 10, 10 * 60 * 1000), (req, res) => {
    const rep = db.prepare('SELECT * FROM reports WHERE reference = ?').get(String(req.params.ref)) as Row | undefined;
    if (!rep || rep.tracking_secret !== req.get('x-report-token')) return res.status(403).json({ error: 'forbidden' });
    if (rep.status !== 'submitted') return res.status(409).json({ error: 'not_cancellable' });
    db.prepare("UPDATE reports SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now(), rep.id);
    audit(req, 'report.cancelled', 'report', rep.id, {}, { name: 'public', role: null });
    broadcast({ type: 'report', data: { id: rep.id, reference: rep.reference } });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------------------------
  r.post('/auth/login', rateLimit('login', 10, 5 * 60 * 1000), (req, res) => {
    const username = str(req.body?.username, 'username', { min: 1, max: 64 });
    const password = str(req.body?.password, 'password', { min: 1, max: 256 });
    const result = login(username.toLowerCase(), password, req.ip);
    if (!result.ok) {
      audit(req, 'auth.login_failed', 'user', null, { username, reason: result.reason }, { name: username, role: null });
      return res.status(result.reason === 'locked' ? 423 : 401).json({ error: result.reason });
    }
    audit(req, 'auth.login', 'user', result.user.id, {}, { name: result.user.username, role: result.user.role });
    res.setHeader('Set-Cookie', sessionCookie(result.token));
    res.json({ user: result.user, csrf: result.csrf, permissions: ROLE_PERMISSIONS[result.user.role] });
  });
  r.post('/auth/logout', (req, res) => {
    if (req.user) audit(req, 'auth.logout', 'user', req.user.id);
    logout(req);
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    res.json({ ok: true });
  });
  r.get('/auth/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    res.json({ user: req.user, csrf: req.csrf, permissions: ROLE_PERMISSIONS[req.user.role] });
  });

  // ---------------------------------------------------------------------------------------------
  // Reports intake (staff)
  // ---------------------------------------------------------------------------------------------
  r.get('/reports', requireAuth('incidents.view'), (req, res) => {
    const status = req.query.status ? String(req.query.status).split(',') : ['submitted', 'under_review'];
    const rows = db
      .prepare(`SELECT * FROM reports WHERE status IN (${status.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT 200`)
      .all(...status) as Row[];
    res.json(rows.map(toReport));
  });

  r.post('/reports/:id/review', requireAuth('incidents.manage'), (req, res) => {
    const rid = id(req);
    const action = oneOf(req.body?.action, ['start_review', 'verify', 'reject', 'duplicate'] as const, 'action');
    const rep = db.prepare('SELECT * FROM reports WHERE id = ?').get(rid) as Row | undefined;
    if (!rep) return res.status(404).json({ error: 'not_found' });
    if (!['submitted', 'under_review'].includes(rep.status)) return res.status(409).json({ error: 'invalid_transition' });
    const t = now();
    const out = tx(() => {
      if (action === 'start_review') {
        db.prepare("UPDATE reports SET status = 'under_review', updated_at = ? WHERE id = ?").run(t, rid);
        return { reportId: rid };
      }
      if (action === 'reject') {
        str(req.body?.reason, 'reason', { min: 3, max: 300 });
        db.prepare("UPDATE reports SET status = 'rejected', updated_at = ? WHERE id = ?").run(t, rid);
        return { reportId: rid };
      }
      if (action === 'duplicate') {
        const target = num(req.body?.incidentId, 'incidentId', 1, Number.MAX_SAFE_INTEGER);
        const inc = getIncident(target);
        if (!inc || inc.status === 'closed') throw new ValidationError('incidentId', 'invalid');
        db.prepare("UPDATE reports SET status = 'duplicate', incident_id = ?, updated_at = ? WHERE id = ?").run(target, t, rid);
        event(target, 'report.linked_duplicate', actor(req), { reportId: rid, reference: rep.reference });
        return { reportId: rid, incidentId: target };
      }
      // verify → new incident (copy reporter fields; operators can amend afterwards)
      const pr = computePriority({ fireType: rep.fire_type, fireSize: rep.fire_size, smoke: rep.smoke, peopleAtRisk: rep.people_at_risk });
      const seq = (db.prepare('SELECT COALESCE(MAX(id),0)+1001 n FROM incidents').get() as { n: number }).n;
      const inc = db
        .prepare(`INSERT INTO incidents (code, source, status, lat, lng, location_description, fire_type, fire_size, smoke, people_at_risk,
          priority, priority_score, created_at, updated_at, verified_at, is_demo) VALUES (?, 'public_report', 'verified', ?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`)
        .get(`INC-${new Date().getUTCFullYear()}-${seq}`, rep.lat, rep.lng, rep.location_description, rep.fire_type, rep.fire_size, rep.smoke,
          rep.people_at_risk, pr.priority, pr.score, rep.created_at, t, t, rep.is_demo) as { id: number };
      db.prepare("UPDATE reports SET status = 'verified', incident_id = ?, updated_at = ? WHERE id = ?").run(inc.id, t, rid);
      db.prepare('UPDATE attachments SET incident_id = ? WHERE report_id = ?').run(inc.id, rid);
      db.prepare('INSERT INTO incident_events (incident_id, at, kind, actor, detail) VALUES (?,?,?,?,?)').run(inc.id, rep.created_at, 'report.received', null, JSON.stringify({ reportId: rid, reference: rep.reference }));
      event(inc.id, 'incident.verified', actor(req), { priority: pr.priority, score: pr.score });
      notify(pr.priority === 'P1' ? 'critical' : 'info', 'incident.verified', { priority: pr.priority }, `/ops/incidents/${inc.id}`);
      return { reportId: rid, incidentId: inc.id };
    });
    audit(req, `report.${action}`, 'report', rid, { ...out, reason: req.body?.reason });
    broadcast({ type: 'report', data: { id: rid, reference: rep.reference } });
    res.json(out);
  });

  // ---------------------------------------------------------------------------------------------
  // Incidents
  // ---------------------------------------------------------------------------------------------
  r.get('/incidents', requireAuth('incidents.view'), (req, res) => {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (req.query.status) {
      const st = String(req.query.status).split(',');
      where.push(`i.status IN (${st.map(() => '?').join(',')})`);
      args.push(...st);
    }
    if (req.query.priority) {
      const p = String(req.query.priority).split(',');
      where.push(`i.priority IN (${p.map(() => '?').join(',')})`);
      args.push(...p);
    }
    if (req.query.type) {
      where.push('i.fire_type = ?');
      args.push(String(req.query.type));
    }
    if (req.query.q) {
      where.push('(i.code LIKE ? OR i.location_description LIKE ?)');
      args.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }
    const sorts: Record<string, string> = {
      priority: 'i.priority ASC, i.created_at DESC',
      newest: 'i.created_at DESC',
      oldest: 'i.created_at ASC',
      updated: 'i.updated_at DESC',
    };
    const order = sorts[String(req.query.sort ?? 'priority')] ?? sorts.priority;
    const rows = db.prepare(`${INCIDENT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT 500`).all(...args) as Row[];
    res.json(rows.map(toIncident));
  });

  r.post('/incidents', requireAuth('incidents.manage'), (req, res) => {
    const b = req.body ?? {};
    const lat = num(b.lat, 'lat', 16, 27);
    const lng = num(b.lng, 'lng', 51, 60.5);
    const f = {
      fireType: oneOf(b.fireType, FIRE_TYPES, 'fireType'),
      fireSize: oneOf(b.fireSize, FIRE_SIZES, 'fireSize'),
      smoke: oneOf(b.smoke, SMOKE_LEVELS, 'smoke'),
      peopleAtRisk: oneOf(b.peopleAtRisk, PEOPLE_RISK, 'peopleAtRisk'),
    };
    const desc = str(b.locationDescription, 'locationDescription', { min: 2, max: 300 });
    const pr = computePriority(f);
    const t = now();
    const seq = (db.prepare('SELECT COALESCE(MAX(id),0)+1001 n FROM incidents').get() as { n: number }).n;
    const row = db
      .prepare(`INSERT INTO incidents (code, source, status, lat, lng, location_description, fire_type, fire_size, smoke, people_at_risk,
        priority, priority_score, created_at, updated_at, verified_at) VALUES (?, 'operator', 'verified', ?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`)
      .get(`INC-${new Date().getUTCFullYear()}-${seq}`, lat, lng, desc, f.fireType, f.fireSize, f.smoke, f.peopleAtRisk, pr.priority, pr.score, t, t, t) as { id: number };
    event(row.id, 'incident.created', actor(req), { priority: pr.priority });
    audit(req, 'incident.created', 'incident', row.id, { priority: pr.priority });
    res.status(201).json(getIncident(row.id));
  });

  r.get('/incidents/:id', requireAuth('incidents.view'), (req, res) => {
    const iid = id(req);
    const inc = getIncident(iid);
    if (!inc) return res.status(404).json({ error: 'not_found' });
    const reports = (db.prepare('SELECT * FROM reports WHERE incident_id = ? ORDER BY created_at').all(iid) as Row[]).map(toReport);
    const timeline = (db.prepare('SELECT * FROM incident_events WHERE incident_id = ? ORDER BY at, id').all(iid) as Row[]).map((e) => ({
      id: e.id, at: e.at, kind: e.kind, actor: e.actor, detail: parseJson(e.detail, {}),
    }));
    const notes = (db.prepare('SELECT * FROM incident_notes WHERE incident_id = ? ORDER BY at DESC').all(iid) as Row[]).map((n) => ({
      id: n.id, at: n.at, author: n.author, body: n.body,
    }));
    const missions = (db.prepare('SELECT * FROM missions WHERE incident_id = ? ORDER BY id DESC').all(iid) as Row[]).map(toMission);
    const assessments = (db.prepare('SELECT * FROM assessments WHERE incident_id = ? ORDER BY id DESC LIMIT 50').all(iid) as Row[]).map(toAssessment);
    res.json({ ...inc, reports, timeline, notes, missions, assessments, attachments: attachmentsFor('incident_id', iid) });
  });

  r.patch('/incidents/:id/status', requireAuth('incidents.manage'), (req, res) => {
    const iid = id(req);
    const inc = getIncident(iid);
    if (!inc) return res.status(404).json({ error: 'not_found' });
    const next = oneOf(req.body?.status, INCIDENT_STATUSES, 'status') as IncidentStatus;
    if (!INCIDENT_TRANSITIONS[inc.status].includes(next)) return res.status(409).json({ error: 'invalid_transition', from: inc.status, to: next });
    let resolution: string | null = inc.resolution;
    if (next === 'resolved' || next === 'closed') resolution = str(req.body?.resolution, 'resolution', { min: 3, max: 500 }) || inc.resolution;
    if ((next === 'resolved' || next === 'closed') && !resolution) throw new ValidationError('resolution', 'required');
    db.prepare('UPDATE incidents SET status = ?, resolution = ?, resolved_at = CASE WHEN ? = \'resolved\' THEN ? ELSE resolved_at END WHERE id = ?').run(next, resolution, next, now(), iid);
    event(iid, `incident.status.${next}`, actor(req), { from: inc.status, to: next, resolution });
    audit(req, 'incident.status', 'incident', iid, { from: inc.status, to: next });
    res.json(getIncident(iid));
  });

  r.patch('/incidents/:id/assign', requireAuth('missions.assign'), (req, res) => {
    const iid = id(req);
    const inc = getIncident(iid);
    if (!inc) return res.status(404).json({ error: 'not_found' });
    if (inc.status === 'closed') return res.status(409).json({ error: 'closed' });
    const team = str(req.body?.team, 'team', { max: 80 }) || null;
    db.prepare('UPDATE incidents SET assigned_team = ? WHERE id = ?').run(team, iid);
    if (inc.status === 'verified' && team) db.prepare("UPDATE incidents SET status = 'response_assigned' WHERE id = ?").run(iid);
    event(iid, 'incident.assigned', actor(req), { team });
    audit(req, 'incident.assigned', 'incident', iid, { team });
    res.json(getIncident(iid));
  });

  r.post('/incidents/:id/notes', requireAuth('incidents.view'), (req, res) => {
    const iid = id(req);
    if (!getIncident(iid)) return res.status(404).json({ error: 'not_found' });
    const body = str(req.body?.body, 'body', { min: 1, max: 2000 });
    db.prepare('INSERT INTO incident_notes (incident_id, at, author, body) VALUES (?,?,?,?)').run(iid, now(), actor(req), body);
    event(iid, 'note.added', actor(req), {});
    audit(req, 'incident.note', 'incident', iid);
    res.status(201).json({ ok: true });
  });

  r.post('/incidents/:id/merge', requireAuth('incidents.manage'), (req, res) => {
    const src = id(req);
    const target = num(req.body?.targetId, 'targetId', 1, Number.MAX_SAFE_INTEGER);
    const a = getIncident(src);
    const b = getIncident(target);
    if (!a || !b || src === target) return res.status(400).json({ error: 'invalid' });
    if (a.status === 'closed' || b.status === 'closed') return res.status(409).json({ error: 'closed' });
    tx(() => {
      db.prepare("UPDATE reports SET incident_id = ?, status = CASE WHEN status = 'verified' THEN 'duplicate' ELSE status END WHERE incident_id = ?").run(target, src);
      db.prepare('UPDATE attachments SET incident_id = ? WHERE incident_id = ?').run(target, src);
      db.prepare("UPDATE incidents SET status = 'closed', resolution = ? WHERE id = ?").run(`Merged into ${b.code}`, src);
      event(src, 'incident.merged_into', actor(req), { targetId: target, code: b.code });
      event(target, 'incident.merged_from', actor(req), { sourceId: src, code: a.code });
    });
    audit(req, 'incident.merge', 'incident', src, { targetId: target });
    res.json(getIncident(target));
  });

  r.post('/incidents/:id/attachments', requireAuth('incidents.manage'), upload.array('files', 4), (req, res) => {
    const iid = id(req);
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (!getIncident(iid)) {
      files.forEach((f) => unlinkSync(f.path));
      return res.status(404).json({ error: 'not_found' });
    }
    const saved = persistUploads(files, { incidentId: iid }, 'operator');
    event(iid, 'attachment.added', actor(req), { count: saved.length });
    res.json({ accepted: saved.length, rejected: files.length - saved.length });
  });

  r.get('/attachments/:id', requireAuth('incidents.view'), (req, res) => {
    const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id(req)) as Row | undefined;
    if (!row) return res.status(404).end();
    const path = join(UPLOAD_DIR, row.storage_key);
    if (!existsSync(path)) return res.status(404).end();
    res.setHeader('Content-Type', row.mime);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=300');
    createReadStream(path).pipe(res);
  });

  r.get('/events', requireAuth('incidents.view'), (_req, res) => {
    const rows = db
      .prepare('SELECT e.*, i.code FROM incident_events e JOIN incidents i ON i.id = e.incident_id ORDER BY e.at DESC, e.id DESC LIMIT 40')
      .all() as Row[];
    res.json(rows.map((e) => ({ id: e.id, at: e.at, kind: e.kind, actor: e.actor, incidentId: e.incident_id, code: e.code })));
  });

  r.get('/audit', requireAuth('audit.view'), (req, res) => {
    const args: string[] = [];
    let where = '';
    if (req.query.entity) {
      where = 'WHERE entity = ?';
      args.push(String(req.query.entity));
      if (req.query.entityId) {
        where += ' AND entity_id = ?';
        args.push(String(req.query.entityId));
      }
    }
    res.json((db.prepare(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT 300`).all(...args) as Row[]).map(toAudit));
  });

  // ---------------------------------------------------------------------------------------------
  // Fleet
  // ---------------------------------------------------------------------------------------------
  r.get('/drones', requireAuth('incidents.view'), (_req, res) => {
    res.json((db.prepare('SELECT * FROM drones ORDER BY callsign').all() as Row[]).map(droneDTO));
  });
  r.get('/drones/:id', requireAuth('incidents.view'), (req, res) => {
    const d = getDrone(id(req));
    if (!d) return res.status(404).json({ error: 'not_found' });
    const maintenance = (db.prepare('SELECT * FROM maintenance_records WHERE drone_id = ? ORDER BY at DESC').all(d.id) as Row[]).map((m) => ({
      id: m.id, droneId: m.drone_id, at: m.at, kind: m.kind, notes: m.notes, technician: m.technician,
    }));
    const missions = (db.prepare('SELECT * FROM missions WHERE drone_id = ? ORDER BY id DESC LIMIT 20').all(d.id) as Row[]).map(toMission);
    const adapter = adapters[d.adapter];
    res.json({ ...d, maintenance, missions, adapterInfo: { configured: adapter.configured, note: adapter.note } });
  });
  const droneFields = (b: Row, partial: boolean) => {
    const out: Row = {};
    const opt = (k: string, f: () => unknown) => {
      if (b[k] !== undefined) out[k] = f();
      else if (!partial) throw new ValidationError(k, 'required');
    };
    opt('callsign', () => {
      const v = str(b.callsign, 'callsign', { min: 2, max: 16 }).toUpperCase();
      if (!/^[A-Z0-9-]+$/.test(v)) throw new ValidationError('callsign', 'invalid');
      return v;
    });
    opt('model', () => str(b.model, 'model', { min: 2, max: 60 }));
    opt('manufacturer', () => str(b.manufacturer, 'manufacturer', { min: 2, max: 60 }));
    opt('serial', () => str(b.serial, 'serial', { min: 2, max: 40 }));
    opt('status', () => oneOf(b.status, DRONE_STATUSES, 'status'));
    opt('adapter', () => oneOf(b.adapter, ADAPTER_KINDS, 'adapter'));
    opt('payloadType', () => oneOf(b.payloadType, PAYLOAD_TYPES, 'payloadType'));
    opt('payloadCapacity', () => num(b.payloadCapacity, 'payloadCapacity', 0, 500));
    opt('baseName', () => str(b.baseName, 'baseName', { min: 2, max: 60 }));
    opt('homeLat', () => num(b.homeLat, 'homeLat', 16, 27));
    opt('homeLng', () => num(b.homeLng, 'homeLng', 51, 60.5));
    return out;
  };
  const colMap: Record<string, string> = {
    callsign: 'callsign', model: 'model', manufacturer: 'manufacturer', serial: 'serial', status: 'status', adapter: 'adapter',
    payloadType: 'payload_type', payloadCapacity: 'payload_capacity', baseName: 'base_name', homeLat: 'home_lat', homeLng: 'home_lng',
  };
  r.post('/drones', requireAuth('fleet.manage'), (req, res) => {
    const f = droneFields(req.body ?? {}, false);
    const unit = f.payloadType === 'camera_only' ? 'n/a' : f.payloadType === 'dry_chemical' || f.payloadType === 'fire_ball' ? 'kg' : 'L';
    const row = db
      .prepare(`INSERT INTO drones (callsign, model, manufacturer, serial, status, adapter, payload_type, payload_capacity, payload_unit,
        home_lat, home_lng, base_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`)
      .get(f.callsign, f.model, f.manufacturer, f.serial, f.status, f.adapter, f.payloadType, f.payloadCapacity, unit, f.homeLat, f.homeLng, f.baseName) as { id: number };
    sim.syncFleet();
    audit(req, 'drone.created', 'drone', row.id, f);
    pushDrone(row.id);
    res.status(201).json(getDrone(row.id));
  });
  r.patch('/drones/:id', requireAuth('fleet.manage'), (req, res) => {
    const did = id(req);
    const d = getDrone(did);
    if (!d) return res.status(404).json({ error: 'not_found' });
    const f = droneFields(req.body ?? {}, true);
    if (d.status === 'in_mission' && (f.status || f.adapter)) return res.status(409).json({ error: 'in_mission' });
    if (f.status === 'in_mission') return res.status(400).json({ error: 'status_set_by_mission' });
    const keys = Object.keys(f);
    if (keys.length) db.prepare(`UPDATE drones SET ${keys.map((k) => `${colMap[k]} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => f[k]), did);
    sim.syncFleet();
    audit(req, 'drone.updated', 'drone', did, f);
    pushDrone(did);
    res.json(getDrone(did));
  });
  r.post('/drones/:id/maintenance', requireAuth('fleet.manage'), (req, res) => {
    const did = id(req);
    if (!getDrone(did)) return res.status(404).json({ error: 'not_found' });
    const kind = oneOf(req.body?.kind, ['scheduled', 'corrective', 'battery', 'inspection'] as const, 'kind');
    const notes = str(req.body?.notes, 'notes', { min: 3, max: 500 });
    const t = now();
    db.prepare('INSERT INTO maintenance_records (drone_id, at, kind, notes, technician) VALUES (?,?,?,?,?)').run(did, t, kind, notes, req.user!.fullName);
    db.prepare('UPDATE drones SET last_maintenance = ? WHERE id = ?').run(t, did);
    audit(req, 'drone.maintenance', 'drone', did, { kind });
    res.status(201).json({ ok: true });
  });
  r.get('/drones/:id/telemetry', requireAuth('incidents.view'), (req, res) => {
    const rows = db.prepare('SELECT data FROM telemetry WHERE drone_id = ? ORDER BY id DESC LIMIT 120').all(id(req)) as Row[];
    res.json(rows.map((x) => parseJson(x.data, null)).reverse());
  });

  // ---------------------------------------------------------------------------------------------
  // Missions: planning (dispatcher) → authorization (supervisor) → preflight & command (pilot)
  // ---------------------------------------------------------------------------------------------
  r.get('/missions', requireAuth('incidents.view'), (req, res) => {
    const active = req.query.active === '1';
    const rows = db
      .prepare(`SELECT * FROM missions ${active ? "WHERE ended_at IS NULL AND status NOT IN ('completed','aborted')" : ''} ORDER BY id DESC LIMIT 200`)
      .all() as Row[];
    res.json(rows.map(toMission));
  });

  r.post('/missions', requireAuth('missions.assign'), (req, res) => {
    const incidentId = num(req.body?.incidentId, 'incidentId', 1, Number.MAX_SAFE_INTEGER);
    const droneId = num(req.body?.droneId, 'droneId', 1, Number.MAX_SAFE_INTEGER);
    const objective = oneOf(req.body?.objective, ['reconnaissance', 'thermal_survey', 'suppression_support', 'perimeter_watch'] as const, 'objective');
    const inc = getIncident(incidentId);
    const drone = getDrone(droneId);
    if (!inc || !drone) return res.status(404).json({ error: 'not_found' });
    if (['resolved', 'closed'].includes(inc.status)) return res.status(409).json({ error: 'incident_closed' });
    if (drone.status !== 'available') return res.status(409).json({ error: 'drone_unavailable', status: drone.status });
    const open = db.prepare("SELECT id FROM missions WHERE drone_id = ? AND ended_at IS NULL AND status NOT IN ('completed','aborted')").get(droneId);
    if (open) return res.status(409).json({ error: 'drone_has_open_mission' });
    if (objective === 'suppression_support' && drone.payloadType === 'camera_only') return res.status(409).json({ error: 'no_payload' });
    const seq = (db.prepare('SELECT COALESCE(MAX(id),0)+100 n FROM missions').get() as { n: number }).n;
    const row = db
      .prepare('INSERT INTO missions (code, incident_id, drone_id, objective, status, created_by, created_at) VALUES (?,?,?,?,?,?,?) RETURNING id')
      .get(`MSN-${seq}`, incidentId, droneId, objective, 'planned', actor(req), now()) as { id: number };
    addWaypoints(row.id, droneId, inc.lat, inc.lng);
    db.prepare('UPDATE incidents SET assigned_drone_id = ? WHERE id = ?').run(droneId, incidentId);
    if (inc.status === 'verified') db.prepare("UPDATE incidents SET status = 'response_assigned' WHERE id = ?").run(incidentId);
    event(incidentId, 'mission.planned', actor(req), { missionId: row.id, drone: drone.callsign, objective });
    audit(req, 'mission.planned', 'mission', row.id, { incidentId, droneId, objective });
    res.status(201).json(pushMission(row.id));
  });

  r.post('/missions/:id/authorize', requireAuth('flight.approve'), (req, res) => {
    const m = getMission(id(req));
    if (!m) return res.status(404).json({ error: 'not_found' });
    if (m.status !== 'planned') return res.status(409).json({ error: 'invalid_transition' });
    const drone = getDrone(m.droneId)!;
    if (drone.status !== 'available') return res.status(409).json({ error: 'drone_unavailable', status: drone.status });
    if (req.body?.confirm !== true) throw new ValidationError('confirm', 'required');
    db.prepare("UPDATE missions SET status = 'authorized', authorized_by = ? WHERE id = ?").run(actor(req), m.id);
    db.prepare("UPDATE drones SET status = 'in_mission', current_mission_id = ? WHERE id = ?").run(m.id, m.droneId);
    if (m.incidentId) event(m.incidentId, 'mission.authorized', actor(req), { missionId: m.id });
    audit(req, 'mission.authorized', 'mission', m.id);
    pushDrone(m.droneId);
    res.json(pushMission(m.id));
  });

  r.post('/missions/:id/preflight', requireAuth('aircraft.control'), (req, res) => {
    const m = getMission(id(req));
    if (!m) return res.status(404).json({ error: 'not_found' });
    if (!['authorized', 'preflight'].includes(m.status)) return res.status(409).json({ error: 'invalid_transition' });
    const checks: Row = {};
    for (const c of PREFLIGHT_CHECKS) checks[c] = req.body?.checks?.[c] === true;
    const all = PREFLIGHT_CHECKS.every((c) => checks[c]);
    db.prepare('UPDATE missions SET preflight = ?, status = ?, pilot = ? WHERE id = ?').run(JSON.stringify(checks), all ? 'preflight' : 'authorized', actor(req), m.id);
    audit(req, 'mission.preflight', 'mission', m.id, { complete: all, checks });
    if (all && m.incidentId) event(m.incidentId, 'mission.preflight_complete', actor(req), { missionId: m.id });
    res.json(pushMission(m.id));
  });

  r.post('/missions/:id/command', requireAuth('aircraft.control'), rateLimit('command', 30, 60 * 1000), (req, res) => {
    const m = getMission(id(req));
    if (!m) return res.status(404).json({ error: 'not_found' });
    const cmd = oneOf(req.body?.command, DRONE_COMMANDS, 'command');
    if (req.body?.confirm !== true) throw new ValidationError('confirm', 'required');
    const record = (result: string, detail: Row = {}) => {
      db.prepare('INSERT INTO operator_actions (at, actor, drone_id, mission_id, command, result, adapter, detail) VALUES (?,?,?,?,?,?,?,?)').run(
        now(), actor(req), m.droneId, m.id, cmd, result, drone.adapter, JSON.stringify(detail),
      );
      audit(req, `command.${cmd}`, 'mission', m.id, { result, ...detail });
    };
    const drone = getDrone(m.droneId)!;
    if (!COMMAND_ALLOWED_IN[cmd].includes(m.status)) {
      record('rejected', { reason: 'invalid_state', status: m.status });
      return res.status(409).json({ error: 'invalid_state', status: m.status });
    }
    if (cmd === 'takeoff' && !PREFLIGHT_CHECKS.every((c) => m.preflight[c])) {
      record('rejected', { reason: 'preflight_incomplete' });
      return res.status(409).json({ error: 'preflight_incomplete' });
    }
    // Abort before the aircraft is airborne is a ground action; no adapter call needed.
    if (cmd === 'abort' && ['authorized', 'preflight'].includes(m.status)) {
      db.prepare("UPDATE missions SET status = 'aborted', outcome = 'aborted_operator', ended_at = ? WHERE id = ?").run(now(), m.id);
      db.prepare("UPDATE drones SET status = 'available', current_mission_id = NULL WHERE id = ?").run(m.droneId);
      record('accepted', { ground: true });
      if (m.incidentId) event(m.incidentId, 'mission.aborted', actor(req), { missionId: m.id });
      pushDrone(m.droneId);
      return res.json(pushMission(m.id));
    }
    const t = drone.telemetry;
    const stale = !t || Date.now() - new Date(t.at).getTime() > TELEMETRY_STALE_MS;
    if (stale && !['rtl', 'abort', 'land'].includes(cmd)) {
      record('rejected', { reason: 'telemetry_stale' });
      return res.status(409).json({ error: 'telemetry_stale' });
    }
    const result = adapters[drone.adapter].command(drone.id, cmd);
    if (!result.ok) {
      record('rejected', { reason: result.reason });
      return res.status(409).json({ error: result.reason });
    }
    const nextStatus: Partial<Record<typeof cmd, string>> = { pause: 'paused', resume: 'active', rtl: 'returning', abort: 'aborted' };
    if (nextStatus[cmd]) db.prepare('UPDATE missions SET status = ? WHERE id = ?').run(nextStatus[cmd], m.id);
    if (cmd === 'abort') db.prepare("UPDATE missions SET outcome = 'aborted_operator' WHERE id = ?").run(m.id);
    if (cmd === 'takeoff' && m.incidentId) {
      const inc = getIncident(m.incidentId);
      if (inc?.status === 'response_assigned') db.prepare("UPDATE incidents SET status = 'in_progress' WHERE id = ?").run(m.incidentId);
      event(m.incidentId, 'mission.started', actor(req), { missionId: m.id });
    } else if (m.incidentId) event(m.incidentId, `mission.command.${cmd}`, actor(req), { missionId: m.id });
    record('accepted');
    res.json(pushMission(m.id));
  });

  r.post('/missions/:id/outcome', requireAny('missions.assign', 'flight.approve'), requireAuth(), (req, res) => {
    const m = getMission(id(req));
    if (!m) return res.status(404).json({ error: 'not_found' });
    if (!['completed', 'aborted'].includes(m.status)) return res.status(409).json({ error: 'mission_open' });
    const outcome = oneOf(req.body?.outcome, MISSION_OUTCOMES, 'outcome');
    db.prepare('UPDATE missions SET outcome = ? WHERE id = ?').run(outcome, m.id);
    audit(req, 'mission.outcome', 'mission', m.id, { outcome });
    if (m.incidentId) event(m.incidentId, 'mission.outcome', actor(req), { missionId: m.id, outcome });
    res.json(pushMission(m.id));
  });

  r.get('/operator-actions', requireAuth('incidents.view'), (req, res) => {
    const mid = req.query.missionId ? Number(req.query.missionId) : null;
    const rows = db
      .prepare(`SELECT * FROM operator_actions ${mid ? 'WHERE mission_id = ?' : ''} ORDER BY id DESC LIMIT 100`)
      .all(...(mid ? [mid] : [])) as Row[];
    res.json(rows.map((a) => ({ ...a, detail: parseJson(a.detail, {}) })));
  });

  // ---------------------------------------------------------------------------------------------
  // AI assessments (simulated detector) — suggestions only, operator review required
  // ---------------------------------------------------------------------------------------------
  r.get('/assessments', requireAuth('incidents.view'), (req, res) => {
    const conds: string[] = [];
    const args: number[] = [];
    if (req.query.missionId) (conds.push('mission_id = ?'), args.push(Number(req.query.missionId)));
    if (req.query.incidentId) (conds.push('incident_id = ?'), args.push(Number(req.query.incidentId)));
    if (req.query.droneId) (conds.push('drone_id = ?'), args.push(Number(req.query.droneId)));
    const rows = db.prepare(`SELECT * FROM assessments ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''} ORDER BY id DESC LIMIT 100`).all(...args) as Row[];
    res.json(rows.map(toAssessment));
  });
  r.post('/assessments/:id/review', requireAny('aircraft.control', 'incidents.manage', 'suppression.authorize'), requireAuth(), (req, res) => {
    const aid = id(req);
    const review = oneOf(req.body?.review, ASSESSMENT_REVIEW.filter((x) => x !== 'pending'), 'review');
    const a = db.prepare('SELECT * FROM assessments WHERE id = ?').get(aid) as Row | undefined;
    if (!a) return res.status(404).json({ error: 'not_found' });
    const row = db.prepare('UPDATE assessments SET review = ?, reviewed_by = ? WHERE id = ? RETURNING *').get(review, actor(req), aid) as Row;
    audit(req, `assessment.${review}`, 'assessment', aid, { kind: a.kind, confidence: a.confidence });
    if (a.incident_id && review === 'confirmed') event(a.incident_id, 'assessment.confirmed', actor(req), { kind: a.kind, assessmentId: aid });
    const dto = toAssessment(row);
    broadcast({ type: 'assessment', data: dto });
    res.json(dto);
  });

  // ---------------------------------------------------------------------------------------------
  // Suppression — human-in-the-loop, two-person rule, simulated release only
  // ---------------------------------------------------------------------------------------------
  const getSupp = (sid: number) => {
    const row = db.prepare('SELECT * FROM suppressions WHERE id = ?').get(sid) as Row | undefined;
    return row ? toSuppression(row) : null;
  };
  const pushSupp = (sid: number) => {
    const s = getSupp(sid)!;
    broadcast({ type: 'suppression', data: s });
    return s;
  };
  const readiness = (droneId: number, missionId: number) => {
    const d = getDrone(droneId)!;
    const m = getMission(missionId)!;
    const t = d.telemetry;
    const fresh = !!t && Date.now() - new Date(t.at).getTime() < TELEMETRY_STALE_MS;
    return {
      mission_active: m.status === 'active' || m.status === 'paused',
      telemetry_fresh: fresh,
      payload_equipped: d.payloadType !== 'camera_only',
      payload_available: !!t && t.payloadRemaining > 0,
      altitude_window: !!t && t.altitude >= 20 && t.altitude <= 100,
      hovering: !!t && t.groundSpeed < 2,
      battery_reserve: !!t && t.battery >= 30,
      gps_3d: !!t && (t.gpsFix === '3d' || t.gpsFix === 'rtk'),
      link_quality: !!t && t.linkQuality >= 50,
      adapter_supports_release: d.adapter === 'simulator',
    };
  };

  r.get('/suppressions', requireAuth('incidents.view'), (req, res) => {
    const mid = req.query.missionId ? Number(req.query.missionId) : null;
    const rows = db.prepare(`SELECT * FROM suppressions ${mid ? 'WHERE mission_id = ?' : ''} ORDER BY id DESC LIMIT 50`).all(...(mid ? [mid] : [])) as Row[];
    res.json(rows.map(toSuppression));
  });

  r.post('/suppressions', requireAuth('aircraft.control'), (req, res) => {
    const m = getMission(num(req.body?.missionId, 'missionId', 1, Number.MAX_SAFE_INTEGER));
    if (!m) return res.status(404).json({ error: 'not_found' });
    if (!['active', 'paused'].includes(m.status)) return res.status(409).json({ error: 'mission_not_active' });
    const d = getDrone(m.droneId)!;
    if (d.payloadType === 'camera_only') return res.status(409).json({ error: 'no_payload' });
    const open = db.prepare("SELECT id FROM suppressions WHERE mission_id = ? AND step NOT IN ('outcome_recorded','cancelled')").get(m.id);
    if (open) return res.status(409).json({ error: 'request_open' });
    let target = { lat: d.telemetry?.lat ?? 0, lng: d.telemetry?.lng ?? 0 };
    let assessmentId: number | null = null;
    if (req.body?.assessmentId) {
      const a = db.prepare('SELECT * FROM assessments WHERE id = ?').get(Number(req.body.assessmentId)) as Row | undefined;
      if (!a || a.review !== 'confirmed') return res.status(409).json({ error: 'assessment_not_confirmed' });
      target = { lat: a.lat, lng: a.lng };
      assessmentId = a.id;
    }
    const quantity = num(req.body?.quantity, 'quantity', 5, 100);
    const t = now();
    const row = db
      .prepare(`INSERT INTO suppressions (mission_id, incident_id, drone_id, assessment_id, step, target_lat, target_lng, quantity, requested_by, created_at, updated_at, simulated)
        VALUES (?,?,?,?,'requested',?,?,?,?,?,?,?) RETURNING id`)
      .get(m.id, m.incidentId, m.droneId, assessmentId, target.lat, target.lng, quantity, actor(req), t, t, d.adapter === 'simulator' ? 1 : 0) as { id: number };
    audit(req, 'suppression.requested', 'suppression', row.id, { missionId: m.id, quantity });
    if (m.incidentId) event(m.incidentId, 'suppression.requested', actor(req), { suppressionId: row.id });
    notify('warning', 'suppression.requested', { mission: m.code }, `/ops/analysis?mission=${m.id}`);
    res.status(201).json(pushSupp(row.id));
  });

  const advance = (step: string, perm: Parameters<typeof requireAuth>[0], from: string[], apply: (req: Request, res: Response, s: NonNullable<ReturnType<typeof getSupp>>) => Row | Response | void) =>
    r.post(`/suppressions/:id/${step}`, requireAuth(perm), (req, res) => {
      const s = getSupp(id(req));
      if (!s) return res.status(404).json({ error: 'not_found' });
      if (!from.includes(s.step)) return res.status(409).json({ error: 'invalid_step', step: s.step });
      const out = apply(req, res, s);
      if (out && (out as Response).headersSent) return;
      const patch = (out ?? {}) as Row;
      const keys = Object.keys(patch);
      db.prepare(`UPDATE suppressions SET ${[...keys.map((k) => `${k} = ?`), 'updated_at = ?'].join(', ')} WHERE id = ?`).run(...keys.map((k) => patch[k]), now(), s.id);
      audit(req, `suppression.${step}`, 'suppression', s.id, patch);
      if (s.incidentId && patch.step) event(s.incidentId, `suppression.${patch.step}`, actor(req), { suppressionId: s.id });
      res.json(pushSupp(s.id));
    });

  advance('confirm-target', 'aircraft.control', ['requested'], (req) => {
    if (req.body?.confirm !== true) throw new ValidationError('confirm', 'required');
    return { step: 'target_confirmed', target_confirmed_by: actor(req) };
  });
  advance('readiness', 'aircraft.control', ['target_confirmed', 'readiness_verified'], (_req, res, s) => {
    const r0 = readiness(s.droneId, s.missionId);
    const all = Object.values(r0).every(Boolean);
    return all ? { step: 'readiness_verified', readiness: JSON.stringify(r0) } : (res.status(409).json({ error: 'not_ready', readiness: r0 }), res);
  });
  advance('safety-approve', 'suppression.authorize', ['readiness_verified'], (req, res, s) => {
    if (s.requestedBy === actor(req) || s.targetConfirmedBy === actor(req)) return (res.status(409).json({ error: 'two_person_rule' }), res);
    if (req.body?.confirm !== true) throw new ValidationError('confirm', 'required');
    return { step: 'safety_approved', safety_approved_by: actor(req) };
  });
  advance('release', 'suppression.release', ['safety_approved'], (req, res, s) => {
    if (req.body?.confirmText !== 'RELEASE') throw new ValidationError('confirmText', 'mismatch');
    const r0 = readiness(s.droneId, s.missionId);
    if (!Object.values(r0).every(Boolean)) return (res.status(409).json({ error: 'not_ready', readiness: r0 }), res);
    if (!s.simulated) return (res.status(409).json({ error: 'hardware_release_not_integrated' }), res);
    sim.simulateRelease(s.droneId, s.quantity);
    return { step: 'released', released_by: actor(req), readiness: JSON.stringify(r0) };
  });
  advance('outcome', 'aircraft.control', ['released'], (req) => ({
    step: 'outcome_recorded',
    outcome: oneOf(req.body?.outcome, ['effective', 'partially_effective', 'not_effective', 'not_observed'] as const, 'outcome'),
  }));
  advance('cancel', 'incidents.view', ['requested', 'target_confirmed', 'readiness_verified', 'safety_approved'], () => ({ step: 'cancelled' }));

  // ---------------------------------------------------------------------------------------------
  // Analytics (computed from stored records only)
  // ---------------------------------------------------------------------------------------------
  r.get('/analytics', requireAuth('analytics.view'), (req, res) => {
    const from = req.query.from ? String(req.query.from) : new Date(Date.now() - 30 * 864e5).toISOString();
    const to = req.query.to ? String(req.query.to) : now();
    const demo = req.query.includeDemo === '0' ? 'AND is_demo = 0' : '';
    const q = <T>(sql: string, ...a: (string | number)[]) => db.prepare(sql).all(from, to, ...a) as T[];
    const one = <T>(sql: string) => db.prepare(sql).get(from, to) as T;
    const range = `created_at BETWEEN ? AND ? ${demo}`;
    const reports = one<{ c: number }>(`SELECT COUNT(*) c FROM reports WHERE ${range}`).c;
    const incidents = one<{ c: number; verified: number; active: number; avgVerifyMin: number | null; demo: number }>(
      `SELECT COUNT(*) c, SUM(verified_at IS NOT NULL) verified, SUM(status NOT IN ('resolved','closed')) active,
       AVG((julianday(verified_at) - julianday(created_at)) * 1440) avgVerifyMin, SUM(is_demo) demo FROM incidents WHERE ${range}`,
    );
    const missions = one<{ c: number; completed: number; avgResponseMin: number | null }>(
      `SELECT COUNT(*) c, SUM(m.status = 'completed') completed,
       AVG((julianday(m.started_at) - julianday(i.verified_at)) * 1440) avgResponseMin
       FROM missions m LEFT JOIN incidents i ON i.id = m.incident_id WHERE m.${range.replace('is_demo', 'm.is_demo')}`,
    );
    const outcomes = q<{ outcome: string; c: number }>(`SELECT COALESCE(outcome,'unrecorded') outcome, COUNT(*) c FROM missions WHERE ${range} AND status IN ('completed','aborted') GROUP BY 1`);
    const byType = q<{ type: string; c: number }>(`SELECT fire_type type, COUNT(*) c FROM incidents WHERE ${range} GROUP BY 1 ORDER BY 2 DESC`);
    const byPriority = q<{ priority: string; c: number }>(`SELECT priority, COUNT(*) c FROM incidents WHERE ${range} GROUP BY 1 ORDER BY 1`);
    const daily = q<{ day: string; reports: number }>(`SELECT substr(created_at,1,10) day, COUNT(*) reports FROM incidents WHERE ${range} GROUP BY 1 ORDER BY 1`);
    const points = q<{ lat: number; lng: number; priority: string; type: string }>(`SELECT lat, lng, priority, fire_type type FROM incidents WHERE ${range}`);
    const fleet = db.prepare(`SELECT status, COUNT(*) c FROM drones GROUP BY 1`).all() as { status: string; c: number }[];
    res.json({
      from, to, includesDemo: !demo && (incidents.demo ?? 0) > 0,
      totals: {
        reports, incidents: incidents.c, verified: incidents.verified ?? 0, active: incidents.active ?? 0,
        avgVerifyMin: incidents.avgVerifyMin, avgResponseMin: missions.avgResponseMin, missions: missions.c, completedMissions: missions.completed ?? 0,
      },
      outcomes, byType, byPriority, daily, points, fleet,
    });
  });

  r.get('/export/incidents.csv', requireAuth('data.export'), (req, res) => {
    const rows = db.prepare(`${INCIDENT_SELECT} ORDER BY i.created_at DESC`).all() as Row[];
    const head = ['code', 'status', 'priority', 'fire_type', 'fire_size', 'lat', 'lng', 'location', 'created_at', 'verified_at', 'resolved_at', 'is_demo'];
    const esc = (v: unknown) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@]/.test(s)) s = `'${s}`; // CSV formula-injection guard
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const body = rows.map((x) => [x.code, x.status, x.priority, x.fire_type, x.fire_size, x.lat, x.lng, x.location_description, x.created_at, x.verified_at, x.resolved_at, x.is_demo].map(esc).join(','));
    audit(req, 'export.incidents', 'export', null, { rows: rows.length });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="fireguard-incidents-${now().slice(0, 10)}.csv"`);
    res.send('﻿' + [head.join(','), ...body].join('\n'));
  });

  // ---------------------------------------------------------------------------------------------
  // Notifications, users, simulator
  // ---------------------------------------------------------------------------------------------
  r.get('/notifications', requireAuth(), (_req, res) => {
    res.json((db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 50').all() as Row[]).map(toNotification));
  });
  r.post('/notifications/read-all', requireAuth(), (_req, res) => {
    db.prepare('UPDATE notifications SET read = 1').run();
    res.json({ ok: true });
  });

  r.get('/users', requireAuth('users.manage'), (_req, res) => {
    res.json((db.prepare('SELECT * FROM users ORDER BY id').all() as Row[]).map(toUser));
  });
  r.post('/users', requireAuth('users.manage'), (req, res) => {
    const username = str(req.body?.username, 'username', { min: 3, max: 32 }).toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(username)) throw new ValidationError('username', 'invalid');
    const fullName = str(req.body?.fullName, 'fullName', { min: 2, max: 80 });
    const role = oneOf(req.body?.role, ROLES, 'role');
    const password = str(req.body?.password, 'password', { min: 12, max: 128 });
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) throw new ValidationError('password', 'weak');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new ValidationError('username', 'taken');
    const row = db.prepare('INSERT INTO users (username, full_name, role, password_hash) VALUES (?,?,?,?) RETURNING *').get(username, fullName, role, hashPassword(password)) as Row;
    audit(req, 'user.created', 'user', row.id, { username, role });
    res.status(201).json(toUser(row));
  });
  r.patch('/users/:id', requireAuth('users.manage'), (req, res) => {
    const uid = id(req);
    if (uid === req.user!.id && (req.body?.active === false || req.body?.role)) return res.status(409).json({ error: 'self_change' });
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid) as Row | undefined;
    if (!u) return res.status(404).json({ error: 'not_found' });
    const role = req.body?.role ? oneOf(req.body.role, ROLES, 'role') : u.role;
    const active = typeof req.body?.active === 'boolean' ? (req.body.active ? 1 : 0) : u.active;
    db.prepare('UPDATE users SET role = ?, active = ? WHERE id = ?').run(role, active, uid);
    if (!active || role !== u.role) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid); // force re-auth
    audit(req, 'user.updated', 'user', uid, { role, active: !!active });
    res.json(toUser({ ...u, role, active }));
  });

  r.get('/simulator', requireAuth(), (_req, res) => res.json(sim.state));
  r.post('/simulator', requireAuth('simulator.control'), (req, res) => {
    if (typeof req.body?.running === 'boolean') sim.state.running = req.body.running;
    if (req.body?.speed !== undefined) sim.state.speed = num(req.body.speed, 'speed', 1, 10);
    if (req.body?.faults) sim.setFaults({
      gpsDegraded: !!req.body.faults.gpsDegraded,
      linkLoss: !!req.body.faults.linkLoss,
      lowBattery: !!req.body.faults.lowBattery,
    });
    audit(req, 'simulator.updated', 'simulator', null, { ...sim.state });
    res.json(sim.state);
  });

  return r;
}
