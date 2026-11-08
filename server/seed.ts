import { randomBytes } from 'node:crypto';
import { db, tx } from './db.ts';
import { hashPassword } from './security.ts';
import { orbit } from './geo.ts';
import { computePriority, FIRE_SIZES, FIRE_TYPES, SMOKE_LEVELS } from '../shared/domain.ts';
import type { FireSize, FireType, PeopleRisk, Role, SmokeLevel } from '../shared/domain.ts';

/**
 * Demonstration dataset. Every record created here is flagged is_demo = 1 and is labelled
 * "Demo" throughout the UI. None of it represents real incidents or operational results.
 *
 * Demo staff accounts (local development only):
 *   admin, supervisor, dispatcher, pilot, safety, analyst
 * Password for all: value of FIREGUARD_DEMO_PASSWORD, default "FireGuard#Demo2026"
 */
export const DEMO_PASSWORD = process.env.FIREGUARD_DEMO_PASSWORD ?? 'FireGuard#Demo2026';

// Deterministic PRNG so the demo dataset is stable between resets
let s = 20261107;
const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];

const AREAS = [
  { name: 'Al Amerat', lat: 23.522, lng: 58.495 },
  { name: 'Bawshar', lat: 23.565, lng: 58.399 },
  { name: 'Al Mawaleh', lat: 23.635, lng: 58.245 },
  { name: 'Al Khoudh', lat: 23.598, lng: 58.168 },
  { name: 'Barka', lat: 23.665, lng: 57.885 },
  { name: 'Rusayl Industrial', lat: 23.553, lng: 58.207 },
  { name: 'Al Khuwair', lat: 23.592, lng: 58.425 },
  { name: 'Ruwi', lat: 23.588, lng: 58.545 },
  { name: 'Misfah', lat: 23.463, lng: 58.412 },
  { name: 'Al Hail', lat: 23.645, lng: 58.205 },
];

const BASES = [
  { name: 'Al Khuwair Base', lat: 23.5957, lng: 58.4139 },
  { name: 'Seeb Base', lat: 23.6703, lng: 58.189 },
  { name: 'Barka Base', lat: 23.6786, lng: 57.886 },
  { name: 'Amerat Base', lat: 23.531, lng: 58.482 },
];

export function seedIfEmpty() {
  const c = db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number };
  if (c.c > 0) return false;
  tx(seed);
  return true;
}

function seed() {
  const users: [string, string, Role][] = [
    ['admin', 'System Administrator (Demo)', 'admin'],
    ['supervisor', 'Operations Supervisor (Demo)', 'supervisor'],
    ['dispatcher', 'Incident Dispatcher (Demo)', 'dispatcher'],
    ['pilot', 'Drone Pilot (Demo)', 'pilot'],
    ['safety', 'Safety Officer (Demo)', 'safety_officer'],
    ['analyst', 'Analyst (Demo)', 'analyst'],
  ];
  const pw = hashPassword(DEMO_PASSWORD);
  const insUser = db.prepare('INSERT INTO users (username, full_name, role, password_hash) VALUES (?,?,?,?)');
  for (const [u, n, r] of users) insUser.run(u, n, r, pw);

  // ---- Fleet --------------------------------------------------------------------------------
  const insDrone = db.prepare(`INSERT INTO drones (callsign, model, manufacturer, serial, status, adapter, payload_type, payload_capacity,
    payload_unit, has_thermal, home_lat, home_lng, base_name, last_maintenance, flight_hours, is_demo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`);
  const daysAgo = (d: number, h = 0) => new Date(Date.now() - d * 864e5 - h * 36e5).toISOString();
  const fleet = [
    ['FG-01', 'Recon Q4 (generic)', 'Demo airframe', 'SIM-Q4-0001', 'available', 'simulator', 'camera_only', 0, 'n/a', 1, 0, 12, 412],
    ['FG-02', 'Recon Q4 (generic)', 'Demo airframe', 'SIM-Q4-0002', 'available', 'simulator', 'camera_only', 0, 'n/a', 1, 1, 30, 388],
    ['FG-03', 'Heavy Lift H8 (generic)', 'Demo airframe', 'SIM-H8-0003', 'available', 'simulator', 'water', 40, 'L', 1, 1, 21, 205],
    ['FG-04', 'Heavy Lift H8 (generic)', 'Demo airframe', 'SIM-H8-0004', 'charging', 'simulator', 'foam', 30, 'L', 1, 2, 9, 167],
    ['FG-05', 'Recon Q4 (generic)', 'Demo airframe', 'SIM-Q4-0005', 'available', 'simulator', 'camera_only', 0, 'n/a', 1, 3, 44, 530],
    ['FG-06', 'Heavy Lift H8 (generic)', 'Demo airframe', 'SIM-H8-0006', 'maintenance', 'simulator', 'dry_chemical', 25, 'kg', 1, 0, 2, 611],
    ['FG-07', 'Survey Wing V2 (generic)', 'Demo airframe', 'HW-PENDING-0007', 'offline', 'mavlink', 'camera_only', 0, 'n/a', 1, 2, 60, 0],
  ] as const;
  for (const f of fleet) {
    const b = BASES[f[10]];
    insDrone.run(f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7], f[8], f[9], b.lat, b.lng, b.name, daysAgo(f[11]), f[12]);
  }
  const insMaint = db.prepare('INSERT INTO maintenance_records (drone_id, at, kind, notes, technician) VALUES (?,?,?,?,?)');
  for (let id = 1; id <= 6; id++) {
    insMaint.run(id, daysAgo(40 + id * 3), 'scheduled', 'Motor and propeller inspection; firmware unchanged.', 'Tech (Demo)');
    insMaint.run(id, daysAgo(fleet[id - 1][11]), 'battery', 'Battery pack health check, cycles logged.', 'Tech (Demo)');
  }
  insMaint.run(6, daysAgo(0, 5), 'corrective', 'Pump assembly replacement in progress. Aircraft grounded.', 'Tech (Demo)');

  // ---- Historical incidents (last 45 days) -----------------------------------------------------
  const insInc = db.prepare(`INSERT INTO incidents (code, source, status, lat, lng, location_description, fire_type, fire_size, smoke,
    people_at_risk, priority, priority_score, assigned_team, assigned_drone_id, resolution, created_at, updated_at, verified_at, resolved_at, is_demo)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1) RETURNING id`);
  const insEv = db.prepare('INSERT INTO incident_events (incident_id, at, kind, actor, detail) VALUES (?,?,?,?,?)');
  const insMission = db.prepare(`INSERT INTO missions (code, incident_id, drone_id, objective, status, outcome, created_by, authorized_by, pilot,
    preflight, created_at, started_at, ended_at, progress, is_demo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1) RETURNING id`);
  const insReport = db.prepare(`INSERT INTO reports (reference, tracking_secret, status, incident_id, lat, lng, location_accuracy, location_method,
    location_description, fire_type, fire_size, smoke, people_at_risk, notes, created_at, updated_at, is_demo)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1) RETURNING id`);
  const allChecks = JSON.stringify({ airspace_clear: true, battery_ok: true, gps_fix: true, link_ok: true, payload_secured: true, weather_ok: true, ground_crew_briefed: true });

  let missionSeq = 100;
  let incSeq = 1000;
  const ref = () => `FG-${randomChars(4)}-${randomChars(4)}`;
  const mkIncident = (opts: {
    ageH: number;
    status: 'verified' | 'response_assigned' | 'in_progress' | 'resolved' | 'closed';
    type?: FireType; size?: FireSize; smoke?: SmokeLevel; people?: PeopleRisk; area?: (typeof AREAS)[number];
    drone?: number | null; withMission?: boolean;
  }) => {
    const area = opts.area ?? pick(AREAS);
    const type = opts.type ?? pick(FIRE_TYPES);
    const size = opts.size ?? pick(FIRE_SIZES.filter((x) => x !== 'unknown'));
    const smoke = opts.smoke ?? pick(SMOKE_LEVELS);
    const people = opts.people ?? (rnd() < 0.15 ? 'yes' : rnd() < 0.6 ? 'no' : 'unknown');
    const pr = computePriority({ fireType: type, fireSize: size, smoke, peopleAtRisk: people });
    const created = new Date(Date.now() - opts.ageH * 36e5);
    const verifyMin = 3 + Math.floor(rnd() * 14);
    const verified = new Date(created.getTime() + verifyMin * 6e4);
    const resolved = ['resolved', 'closed'].includes(opts.status) ? new Date(verified.getTime() + (40 + rnd() * 200) * 6e4) : null;
    const lat = area.lat + (rnd() - 0.5) * 0.02;
    const lng = area.lng + (rnd() - 0.5) * 0.02;
    const drone = opts.drone ?? (rnd() < 0.75 ? 1 + Math.floor(rnd() * 5) : null);
    const code = `INC-${created.getUTCFullYear()}-${incSeq++}`;
    const id = (insInc.get(
      code, rnd() < 0.8 ? 'public_report' : 'operator', opts.status, lat, lng, `${area.name}`, type, size, smoke, people,
      pr.priority, pr.score, opts.status === 'verified' ? null : pick(['Station 1 – Muscat', 'Station 4 – Seeb', 'Station 7 – Barka']),
      opts.status === 'verified' ? null : drone,
      resolved ? pick(['Extinguished by ground crew; area cooled.', 'Contained; no spread beyond perimeter.', 'Controlled burn confirmed; no action required.']) : null,
      created.toISOString(), (resolved ?? verified).toISOString(), verified.toISOString(), resolved?.toISOString() ?? null,
    ) as { id: number }).id;
    const rid = (insReport.get(ref(), randomChars(16), 'verified', id, lat + 0.0004, lng - 0.0003, 12 + rnd() * 30, 'gps', area.name, type, size, smoke, people, '',
      created.toISOString(), verified.toISOString()) as { id: number }).id;
    insEv.run(id, created.toISOString(), 'report.received', null, JSON.stringify({ reportId: rid }));
    insEv.run(id, verified.toISOString(), 'incident.verified', 'dispatcher', JSON.stringify({ priority: pr.priority }));
    if (drone && opts.status !== 'verified' && opts.withMission !== false) {
      const mStart = new Date(verified.getTime() + (2 + rnd() * 6) * 6e4);
      const done = !!resolved;
      const outcome = done ? pick(['objective_met', 'objective_met', 'objective_met', 'partial', 'not_met', 'aborted_safety']) : null;
      const mid = (insMission.get(`MSN-${missionSeq++}`, id, drone, pick(['reconnaissance', 'thermal_survey', 'perimeter_watch']),
        done ? (outcome === 'aborted_safety' ? 'aborted' : 'completed') : 'planned', outcome, 'dispatcher', 'supervisor', 'pilot', allChecks,
        verified.toISOString(), mStart.toISOString(), done ? new Date(mStart.getTime() + (12 + rnd() * 25) * 6e4).toISOString() : null, done ? 1 : 0) as { id: number }).id;
      addWaypoints(mid, drone, lat, lng);
      insEv.run(id, mStart.toISOString(), 'mission.started', 'pilot', JSON.stringify({ missionId: mid }));
    }
    if (resolved) insEv.run(id, resolved.toISOString(), 'incident.resolved', 'supervisor', '{}');
    return id;
  };

  for (let i = 0; i < 46; i++) mkIncident({ ageH: 24 + rnd() * 45 * 24, status: rnd() < 0.7 ? 'closed' : 'resolved' });

  // ---- Current operational picture ------------------------------------------------------------
  mkIncident({ ageH: 1.4, status: 'response_assigned', type: 'vegetation', size: 'large', smoke: 'heavy', people: 'unknown', area: AREAS[0], drone: 2, withMission: true });
  mkIncident({ ageH: 0.6, status: 'verified', type: 'industrial', size: 'medium', smoke: 'heavy', people: 'yes', area: AREAS[5], drone: null });
  mkIncident({ ageH: 3.2, status: 'response_assigned', type: 'vehicle', size: 'small', smoke: 'moderate', people: 'no', area: AREAS[6], drone: null, withMission: false });

  // Pending public reports awaiting review
  const pending: [number, FireType, FireSize, SmokeLevel, PeopleRisk, string, number][] = [
    [2, 'vegetation', 'medium', 'moderate', 'unknown', 'Palm farm near the main road, smoke visible from highway', 0.3],
    [8, 'building', 'small', 'light', 'yes', 'Ground floor of residential building', 0.15],
    [0, 'vegetation', 'large', 'heavy', 'unknown', 'Hillside east of the quarry road', 0.25],
  ];
  for (const [ai, type, size, smoke, people, desc, ageH] of pending) {
    const a = AREAS[ai];
    const t = new Date(Date.now() - ageH * 36e5).toISOString();
    insReport.get(ref(), randomChars(16), 'submitted', null, a.lat + 0.004, a.lng + 0.003, 18, 'gps_adjusted', desc, type, size, smoke, people, '', t, t);
  }

  db.prepare("INSERT INTO notifications (at, level, kind, params, link) VALUES (?,?,?,?,?)").run(
    new Date(Date.now() - 6e5).toISOString(), 'warning', 'drone.maintenance', JSON.stringify({ callsign: 'FG-06' }), '/ops/fleet',
  );
}

export function addWaypoints(missionId: number, droneId: number, lat: number, lng: number) {
  const home = db.prepare('SELECT home_lat, home_lng FROM drones WHERE id = ?').get(droneId) as { home_lat: number; home_lng: number };
  const ins = db.prepare('INSERT INTO waypoints (mission_id, seq, lat, lng, altitude, action) VALUES (?,?,?,?,?,?)');
  const ring = orbit(lat, lng, 180, 8);
  ins.run(missionId, 0, ring[0].lat, ring[0].lng, 80, 'transit');
  ring.forEach((p, i) => ins.run(missionId, i + 1, p.lat, p.lng, 80, 'orbit'));
  void home;
}

function randomChars(n: number) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(n);
  return Array.from(b, (x) => alphabet[x % alphabet.length]).join('');
}
export { randomChars };
