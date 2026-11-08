import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { db, now } from './db.ts';
import { audit, num, oneOf, rateLimit, requireAuth, str, ValidationError } from './security.ts';
import {
  AGENT_FOR, BACKUP_FOR, CAMPUS, DRONE_SPEED_MS, DRONES_FOR, FIRE_SIZES, FIRE_TYPES, GRID_DEG, HOTSPOT_MIN, RETURN_BATTERY,
  STATIONS, SUGGEST_FAR_M, SUGGEST_MIN, distanceM, insideCampus, nearestStation,
} from '../shared/campus.ts';
import type { Agent, CampusDrone, CampusReport, CampusState, DispatchPlan, FireSize, FireType, Hotspot, StationId } from '../shared/campus.ts';

/**
 * MTC campus fire response — simplified system.
 * All aircraft are SIMULATED. No hardware is contacted. Dispatch requires the pilot to press "launch".
 */

db.exec(`
CREATE TABLE IF NOT EXISTS campus_reports (
  id INTEGER PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL,
  size TEXT NOT NULL, type TEXT NOT NULL, details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL, resolved_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0
);
`);

type Row = Record<string, any>;
const toReport = (r: Row): CampusReport => ({
  id: r.id, ref: r.ref, lat: r.lat, lng: r.lng, size: r.size, type: r.type, details: r.details,
  status: r.status, createdAt: r.created_at, resolvedAt: r.resolved_at,
});
const refCode = () => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'MTC-' + Array.from(randomBytes(5), (x) => a[x % a.length]).join('');
};

/** Historical demo reports clustered around likely fire-prone spots so the hotspot analysis has data. */
function seedHistory() {
  const c = db.prepare('SELECT COUNT(*) c FROM campus_reports').get() as { c: number };
  if (c.c > 0) return;
  const clusters: { lat: number; lng: number; n: number; type: FireType }[] = [
    { lat: 23.5705, lng: 58.2806, n: 5, type: 'electrical' }, // far from stations → suggestion
    { lat: 23.5652, lng: 58.2788, n: 3, type: 'vehicle' }, // near south station
    { lat: 23.5722, lng: 58.2770, n: 2, type: 'vegetation' },
    { lat: 23.5682, lng: 58.2750, n: 1, type: 'building' },
  ];
  const ins = db.prepare(`INSERT INTO campus_reports (ref, lat, lng, size, type, details, status, created_at, resolved_at, is_demo)
    VALUES (?,?,?,?,?,'', 'resolved', ?, ?, 1)`);
  let k = 0;
  for (const cl of clusters) {
    for (let i = 0; i < cl.n; i++) {
      const at = new Date(Date.now() - (3 + k++ * 4) * 864e5);
      ins.run(refCode(), cl.lat + (i % 3) * 0.00018, cl.lng + Math.floor(i / 3) * 0.0002, FIRE_SIZES[i % 3], cl.type, at.toISOString(), new Date(at.getTime() + 20 * 6e4).toISOString());
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Simulated fleet: 4 stations × (water, foam, powder)
// ---------------------------------------------------------------------------------------------
const AGENT_LETTER: Record<Agent, string> = { water: 'W', foam: 'F', powder: 'P' };
// A drone can take a mission from 40 % charge (short campus distances); it still returns at 20 %.
const READY_BATTERY = 40;
const START_BATTERY = [100, 92, 64, 100, 48, 88, 95, 36, 100, 70, 100, 55]; // varied so low-battery returns can be seen

export class CampusFleet {
  drones: CampusDrone[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    seedHistory();
    let i = 0;
    for (const s of STATIONS) {
      for (const agent of ['water', 'foam', 'powder'] as Agent[]) {
        this.drones.push({
          id: `${s.id}-${AGENT_LETTER[agent]}`, name: `${s.id}-${AGENT_LETTER[agent]}`, agent, station: s.id, state: 'ready',
          lat: s.lat, lng: s.lng, altitude: 0, battery: START_BATTERY[i++ % START_BATTERY.length], payload: 100,
          reportId: null, target: null, distanceM: null, etaS: null, returnReason: null,
        });
      }
    }
    for (const d of this.drones) if (d.battery < READY_BATTERY) d.state = 'charging';
    this.timer = setInterval(() => this.tick(1), 1000);
    this.timer.unref();
  }

  private station(id: StationId) {
    return STATIONS.find((s) => s.id === id)!;
  }

  plan(r: CampusReport): DispatchPlan {
    const agent = AGENT_FOR[r.type];
    const assigned = this.drones.filter((d) => d.reportId === r.id && (d.state === 'enroute' || d.state === 'onscene')).length;
    const required = Math.max(0, DRONES_FOR[r.size] - assigned);
    const rank = (a: Agent) =>
      this.drones
        .filter((d) => d.state === 'ready' && d.agent === a)
        .map((d) => ({ d, dist: distanceM(d.lat, d.lng, r.lat, r.lng) }))
        .sort((x, y) => x.dist - y.dist);
    const picked: { d: CampusDrone; dist: number }[] = [];
    for (const a of [agent, ...BACKUP_FOR[r.type]]) {
      for (const x of rank(a)) if (picked.length < required) picked.push(x);
    }
    return {
      agent,
      required,
      drones: picked.map(({ d, dist }) => ({ id: d.id, name: d.name, agent: d.agent, station: d.station, distanceM: Math.round(dist), etaS: Math.round(dist / DRONE_SPEED_MS) + 8 })),
      shortage: required - picked.length,
    };
  }

  launch(r: CampusReport) {
    const plan = this.plan(r);
    for (const p of plan.drones) {
      const d = this.drones.find((x) => x.id === p.id)!;
      d.state = 'enroute';
      d.reportId = r.id;
      d.target = { lat: r.lat, lng: r.lng };
      d.returnReason = null;
    }
    return plan;
  }

  recall(reportId: number) {
    for (const d of this.drones) if (d.reportId === reportId && (d.state === 'enroute' || d.state === 'onscene')) this.sendHome(d, 'done');
  }

  private sendHome(d: CampusDrone, reason: CampusDrone['returnReason']) {
    const { station } = nearestStation(d.lat, d.lng);
    d.state = 'returning';
    d.returnReason = reason;
    d.station = station.id;
    d.target = { lat: station.lat, lng: station.lng };
  }

  private moveToward(d: CampusDrone, dt: number) {
    const t = d.target!;
    const dist = distanceM(d.lat, d.lng, t.lat, t.lng);
    const step = DRONE_SPEED_MS * dt;
    if (dist <= step) {
      d.lat = t.lat;
      d.lng = t.lng;
      return true;
    }
    const f = step / dist;
    d.lat += (t.lat - d.lat) * f;
    d.lng += (t.lng - d.lng) * f;
    return false;
  }

  tick(dt: number) {
    for (const d of this.drones) {
      const flying = d.state === 'enroute' || d.state === 'onscene' || d.state === 'returning';
      if (flying) d.battery = Math.max(0, d.battery - (d.state === 'onscene' ? 0.45 : 0.3) * dt);
      // Fail-safe: low battery → nearest station, whatever the drone was doing.
      if ((d.state === 'enroute' || d.state === 'onscene') && d.battery < RETURN_BATTERY) this.sendHome(d, 'battery');

      switch (d.state) {
        case 'enroute':
          d.altitude = Math.min(40, d.altitude + 5 * dt);
          if (this.moveToward(d, dt)) d.state = 'onscene';
          break;
        case 'onscene':
          d.altitude = Math.max(15, d.altitude - 3 * dt);
          d.payload = Math.max(0, d.payload - 2.5 * dt);
          if (d.payload <= 0) this.sendHome(d, 'empty');
          break;
        case 'returning':
          d.altitude = Math.min(40, d.altitude + 5 * dt);
          if (this.moveToward(d, dt)) {
            d.state = 'charging';
            d.altitude = 0;
            d.reportId = null;
            d.target = null;
          }
          break;
        case 'charging':
          d.battery = Math.min(100, d.battery + 0.5 * dt);
          d.payload = Math.min(100, d.payload + 6 * dt);
          if (d.battery >= READY_BATTERY && d.payload >= 100) {
            d.state = 'ready';
            d.returnReason = null;
          }
          break;
        case 'ready':
          d.battery = Math.min(100, d.battery + 0.05 * dt); // trickle charge on the dock
          break;
      }
      if (d.target) {
        d.distanceM = Math.round(distanceM(d.lat, d.lng, d.target.lat, d.target.lng));
        d.etaS = Math.round(d.distanceM / DRONE_SPEED_MS);
      } else {
        d.distanceM = null;
        d.etaS = null;
      }
      if (d.state === 'ready' || d.state === 'charging') {
        const s = this.station(d.station);
        d.lat = s.lat;
        d.lng = s.lng;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Hotspots: reports per grid cell → red squares; dense cells far from any station → new-station suggestion
// ---------------------------------------------------------------------------------------------
function hotspots(): Hotspot[] {
  const rows = db.prepare('SELECT lat, lng FROM campus_reports').all() as { lat: number; lng: number }[];
  const cells = new Map<string, { lat: number; lng: number; count: number }>();
  for (const r of rows) {
    const lat = Math.floor(r.lat / GRID_DEG) * GRID_DEG;
    const lng = Math.floor(r.lng / GRID_DEG) * GRID_DEG;
    const k = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const c = cells.get(k) ?? { lat, lng, count: 0 };
    c.count++;
    cells.set(k, c);
  }
  return [...cells.values()]
    .filter((c) => c.count >= HOTSPOT_MIN)
    .map((c) => {
      const near = nearestStation(c.lat + GRID_DEG / 2, c.lng + GRID_DEG / 2).distanceM;
      return { ...c, nearestStationM: Math.round(near), suggest: c.count >= SUGGEST_MIN && near > SUGGEST_FAR_M };
    })
    .sort((a, b) => b.count - a.count);
}

export function buildCampusRouter(fleet: CampusFleet) {
  const r = Router();
  const getReport = (id: number) => {
    const row = db.prepare('SELECT * FROM campus_reports WHERE id = ?').get(id) as Row | undefined;
    return row ? toReport(row) : null;
  };

  r.get('/config', (_req, res) => res.json({ campus: CAMPUS, stations: STATIONS }));

  // Public: submit a report (location must be on campus).
  r.post('/reports', rateLimit('campus-report', 8, 10 * 60 * 1000), (req, res) => {
    const lat = num(req.body?.lat, 'lat', 23.55, 23.59);
    const lng = num(req.body?.lng, 'lng', 58.26, 58.30);
    if (!insideCampus(lat, lng)) throw new ValidationError('location', 'outside_campus');
    const size = oneOf(req.body?.size, FIRE_SIZES, 'size') as FireSize;
    const type = oneOf(req.body?.type, FIRE_TYPES, 'type') as FireType;
    const details = str(req.body?.details, 'details', { max: 500 });
    const ref = refCode();
    const row = db
      .prepare('INSERT INTO campus_reports (ref, lat, lng, size, type, details, created_at) VALUES (?,?,?,?,?,?,?) RETURNING *')
      .get(ref, lat, lng, size, type, details, now()) as Row;
    audit(req, 'campus.report', 'campus_report', row.id, { size, type }, { name: 'public', role: null });
    res.status(201).json({ ref, createdAt: row.created_at });
  });

  // Pilot only from here on.
  r.get('/state', requireAuth('aircraft.control'), (_req, res) => {
    const active = (db.prepare("SELECT * FROM campus_reports WHERE status != 'resolved' ORDER BY created_at DESC").all() as Row[]).map(toReport);
    const today = new Date(Date.now() - 864e5).toISOString();
    const state: CampusState = {
      serverTime: now(),
      simulated: true,
      drones: fleet.drones,
      active: active.map((x) => ({ ...x, plan: fleet.plan(x), assigned: fleet.drones.filter((d) => d.reportId === x.id).map((d) => d.id) })),
      hotspots: hotspots(),
      resolvedToday: (db.prepare("SELECT COUNT(*) c FROM campus_reports WHERE status = 'resolved' AND resolved_at >= ?").get(today) as { c: number }).c,
    };
    res.json(state);
  });

  r.post('/reports/:id/dispatch', requireAuth('aircraft.control'), (req, res) => {
    const rep = getReport(num(req.params.id, 'id', 1, Number.MAX_SAFE_INTEGER));
    if (!rep || rep.status === 'resolved') return res.status(404).json({ error: 'not_found' });
    const plan = fleet.launch(rep);
    if (!plan.drones.length) return res.status(409).json({ error: 'no_drones_available' });
    db.prepare("UPDATE campus_reports SET status = 'dispatched' WHERE id = ?").run(rep.id);
    audit(req, 'campus.dispatch', 'campus_report', rep.id, { drones: plan.drones.map((d) => d.id), simulated: true });
    res.json(plan);
  });

  r.post('/reports/:id/resolve', requireAuth('aircraft.control'), (req, res) => {
    const rep = getReport(num(req.params.id, 'id', 1, Number.MAX_SAFE_INTEGER));
    if (!rep || rep.status === 'resolved') return res.status(404).json({ error: 'not_found' });
    fleet.recall(rep.id);
    db.prepare("UPDATE campus_reports SET status = 'resolved', resolved_at = ? WHERE id = ?").run(now(), rep.id);
    audit(req, 'campus.resolve', 'campus_report', rep.id);
    res.json({ ok: true });
  });

  return r;
}
