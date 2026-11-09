// ResQAir — Military Technological College (MTC), Muscat.
// Pure, deterministic engine shared by the serverless API and the browser.
// The server stores each drone's current flight *phase* (start time, from, to, battery, payload);
// anyone can compute the exact live position for any moment with `droneAt()`. This keeps the
// backend stateless between requests and lets the map animate smoothly at 60 fps.
//
// Campus boundary: OpenStreetMap way 688730411 (ODbL). All drones are SIMULATED.

export type LatLng = { lat: number; lng: number };
export type LngLat = [number, number];

export const CAMPUS = {
  center: [58.2785, 23.5695] as LngLat,
  bounds: [[58.2725, 23.5605], [58.2860, 23.5790]] as [LngLat, LngLat],
  boundary: [
    [58.27472, 23.56579], [58.27527, 23.56488], [58.27589, 23.5644], [58.27618, 23.56426], [58.27786, 23.56387], [58.28237, 23.56341],
    [58.28328, 23.5631], [58.28322, 23.56286], [58.28406, 23.56192], [58.28418, 23.56204], [58.28281, 23.56669], [58.28276, 23.56821],
    [58.28204, 23.56879], [58.28163, 23.57007], [58.28162, 23.57182], [58.28197, 23.57282], [58.28118, 23.57314], [58.28034, 23.57327],
    [58.27941, 23.57361], [58.27942, 23.57337], [58.27814, 23.57338], [58.27814, 23.57441], [58.27767, 23.57487], [58.27574, 23.57745],
    [58.27494, 23.57373], [58.27507, 23.57362], [58.27505, 23.57353], [58.27481, 23.57352], [58.27476, 23.57335], [58.27472, 23.56579],
  ] as LngLat[],
};

export const FIRE_SIZES = ['small', 'medium', 'large'] as const;
export type FireSize = (typeof FIRE_SIZES)[number];
export const FIRE_TYPES = ['vegetation', 'building', 'vehicle', 'electrical', 'other'] as const;
export type FireType = (typeof FIRE_TYPES)[number];
export const AGENTS = ['water', 'foam', 'powder'] as const;
export type Agent = (typeof AGENTS)[number];

/** Extinguishing agent per fire type — never water on electrical fires. */
export const AGENT_FOR: Record<FireType, Agent> = { vegetation: 'water', building: 'water', vehicle: 'foam', electrical: 'powder', other: 'powder' };
/** Acceptable substitutes when no drone with the primary agent is ready. */
export const BACKUP_FOR: Record<FireType, Agent[]> = { vegetation: ['foam', 'powder'], building: ['powder', 'foam'], vehicle: ['powder'], electrical: [], other: ['foam'] };
/** Drones dispatched per fire size. */
export const DRONES_FOR: Record<FireSize, number> = { small: 1, medium: 2, large: 3 };

/** Station positions are proposals — move them to the real fire-prone areas. */
export const STATIONS = [
  { id: 'N', name: { ar: 'محطة الشمال', en: 'North' }, lat: 23.5735, lng: 58.2765 },
  { id: 'W', name: { ar: 'محطة الغرب', en: 'West' }, lat: 23.5672, lng: 58.2762 },
  { id: 'E', name: { ar: 'محطة الشرق', en: 'East' }, lat: 23.5668, lng: 58.2814 },
  { id: 'S', name: { ar: 'محطة الجنوب', en: 'South' }, lat: 23.5641, lng: 58.2803 },
] as const;
export type StationId = (typeof STATIONS)[number]['id'];

// Flight model
export const SPEED = 15; // m/s cruise (54 km/h)
export const CRUISE_ALT = 40; // m
export const SCENE_ALT = 15; // m while discharging
export const RETURN_BATTERY = 20; // % → return to nearest station
export const READY_BATTERY = 40; // % → can take a new mission
const DRAIN_FLY = 0.3; // %/s
const DRAIN_SCENE = 0.45; // %/s
const DISCHARGE = 2.5; // payload %/s
const CHARGE = 0.5; // %/s
const REFILL = 6; // payload %/s
const SPOOL_UP = 8; // s take-off before cruise

// Hotspot analysis
export const GRID_DEG = 0.001; // ~110 m × 100 m cells
export const HOTSPOT_MIN = 2;
export const SUGGEST_MIN = 3;
export const SUGGEST_FAR_M = 350;

export type Phase = 'ready' | 'charging' | 'enroute' | 'onscene' | 'returning';
export type Reason = 'battery' | 'empty' | 'done' | null;

/** Persisted drone record: state at the start of its current phase. */
export interface DroneRec {
  id: string;
  agent: Agent;
  home: StationId;
  phase: Phase;
  t0: number; // ms epoch when the phase started
  from: LatLng;
  to: LatLng | null;
  b0: number; // battery % at t0
  p0: number; // payload % at t0
  reportId: number | null;
  reason: Reason;
}

/** Derived, display-ready drone at a given instant. */
export interface DroneView extends DroneRec {
  pos: LatLng;
  battery: number;
  payload: number;
  altitude: number;
  heading: number;
  distanceM: number | null;
  etaS: number | null;
}

export interface Report {
  id: number;
  ref: string;
  lat: number;
  lng: number;
  size: FireSize;
  type: FireType;
  details: string;
  status: 'new' | 'dispatched' | 'resolved';
  createdAt: number;
  resolvedAt: number | null;
  demo?: boolean;
}

export interface State {
  v: 2;
  seq: number;
  reports: Report[];
  drones: DroneRec[];
  secret: string;
  rl: Record<string, number[]>; // rate limit: ip hash → recent submit times
}

export interface Plan {
  agent: Agent;
  required: number;
  drones: { id: string; agent: Agent; home: StationId; distanceM: number; etaS: number }[];
  shortage: number;
}

export interface Hotspot { lat: number; lng: number; count: number; nearestM: number; suggest: boolean }

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------
export function dist(a: LatLng, b: LatLng) {
  const R = 6371000;
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function bearing(a: LatLng, b: LatLng) {
  const r = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(r(b.lng - a.lng)) * Math.cos(r(b.lat));
  const x = Math.cos(r(a.lat)) * Math.sin(r(b.lat)) - Math.sin(r(a.lat)) * Math.cos(r(b.lat)) * Math.cos(r(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
const lerp = (a: LatLng, b: LatLng, f: number): LatLng => ({ lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f });

export function insideCampus(lat: number, lng: number) {
  const poly = CAMPUS.boundary;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function nearestStation(p: LatLng) {
  let best: (typeof STATIONS)[number] = STATIONS[0];
  let bestD = Infinity;
  for (const s of STATIONS) {
    const d = dist(p, s);
    if (d < bestD) (best = s), (bestD = d);
  }
  return { station: best, distanceM: bestD };
}
export const stationById = (id: StationId) => STATIONS.find((s) => s.id === id)!;

/** Each station has 3 pads; drones parked there sit on fixed, non-overlapping slots. */
export function padPosition(home: StationId, agent: Agent): LatLng {
  const s = stationById(home);
  const i = AGENTS.indexOf(agent);
  return { lat: s.lat - 0.00009, lng: s.lng + (i - 1) * 0.00016 };
}

// ---------------------------------------------------------------------------------------------
// Phase advancement (pure)
// ---------------------------------------------------------------------------------------------
const flightTime = (a: LatLng, b: LatLng) => dist(a, b) / SPEED;

function goHome(d: DroneRec, at: number, pos: LatLng, battery: number, payload: number, reason: Reason): DroneRec {
  const { station } = nearestStation(pos);
  return { ...d, phase: 'returning', t0: at, from: pos, to: padPosition(station.id, d.agent), home: station.id, b0: battery, p0: payload, reason };
}

/** Roll a drone record forward through any phase transitions that happened before `now`. */
export function advance(rec: DroneRec, now: number): DroneRec {
  let d = rec;
  for (let guard = 0; guard < 8; guard++) {
    const el = (now - d.t0) / 1000;
    if (d.phase === 'enroute') {
      const T = SPOOL_UP + flightTime(d.from, d.to!);
      const tLow = (d.b0 - RETURN_BATTERY) / DRAIN_FLY;
      if (tLow < T && el >= tLow) {
        const f = Math.max(0, tLow - SPOOL_UP) / (T - SPOOL_UP);
        d = goHome(d, d.t0 + tLow * 1000, lerp(d.from, d.to!, f), RETURN_BATTERY, d.p0, 'battery');
      } else if (tLow >= T && el >= T) {
        d = { ...d, phase: 'onscene', t0: d.t0 + T * 1000, from: d.to!, b0: d.b0 - DRAIN_FLY * T };
      } else break;
    } else if (d.phase === 'onscene') {
      const tEmpty = d.p0 / DISCHARGE;
      const tLow = (d.b0 - RETURN_BATTERY) / DRAIN_SCENE;
      const tEnd = Math.min(tEmpty, tLow);
      if (el < tEnd) break;
      d = goHome(d, d.t0 + tEnd * 1000, d.from, d.b0 - DRAIN_SCENE * tEnd, Math.max(0, d.p0 - DISCHARGE * tEnd), tLow < tEmpty ? 'battery' : 'empty');
    } else if (d.phase === 'returning') {
      const T = flightTime(d.from, d.to!);
      if (el < T) break;
      d = { ...d, phase: 'charging', t0: d.t0 + T * 1000, from: d.to!, to: null, b0: d.b0 - DRAIN_FLY * T, reportId: null };
    } else if (d.phase === 'charging') {
      const T = Math.max(0, (READY_BATTERY - d.b0) / CHARGE, (100 - d.p0) / REFILL);
      if (el < T) break;
      d = { ...d, phase: 'ready', t0: d.t0 + T * 1000, b0: Math.min(100, d.b0 + CHARGE * T), p0: 100, reason: null };
    } else break;
  }
  return d;
}

/** Exact instantaneous view of a drone (call every animation frame). */
export function droneAt(rec: DroneRec, now: number): DroneView {
  const d = advance(rec, now);
  const el = Math.max(0, (now - d.t0) / 1000);
  let pos = d.from;
  let battery = d.b0;
  let payload = d.p0;
  let altitude = 0;
  let heading = 0;
  let distanceM: number | null = null;
  let etaS: number | null = null;
  if (d.phase === 'enroute') {
    const fly = Math.max(0, el - SPOOL_UP);
    const T = flightTime(d.from, d.to!);
    pos = lerp(d.from, d.to!, Math.min(1, fly / T));
    battery = d.b0 - DRAIN_FLY * el;
    altitude = Math.min(CRUISE_ALT, (el / SPOOL_UP) * CRUISE_ALT);
    heading = bearing(d.from, d.to!);
    distanceM = dist(pos, d.to!);
    etaS = Math.ceil(Math.max(0, SPOOL_UP - el) + distanceM / SPEED);
  } else if (d.phase === 'onscene') {
    battery = d.b0 - DRAIN_SCENE * el;
    payload = Math.max(0, d.p0 - DISCHARGE * el);
    altitude = Math.max(SCENE_ALT, CRUISE_ALT - 5 * el);
    heading = (el * 20) % 360; // slow orbit over the fire
    distanceM = 0;
    etaS = 0;
  } else if (d.phase === 'returning') {
    const T = flightTime(d.from, d.to!);
    const f = Math.min(1, el / T);
    pos = lerp(d.from, d.to!, f);
    battery = d.b0 - DRAIN_FLY * el;
    altitude = T - el < 6 ? Math.max(0, (T - el) * 6) : CRUISE_ALT;
    heading = bearing(d.from, d.to!);
    distanceM = dist(pos, d.to!);
    etaS = Math.ceil(distanceM / SPEED);
  } else if (d.phase === 'charging') {
    battery = Math.min(100, d.b0 + CHARGE * el);
    payload = Math.min(100, d.p0 + REFILL * el);
  } else {
    battery = Math.min(100, d.b0 + 0.05 * el);
  }
  return { ...d, pos, battery: Math.max(0, battery), payload, altitude, heading, distanceM: distanceM == null ? null : Math.round(distanceM), etaS };
}

// ---------------------------------------------------------------------------------------------
// Dispatch & analysis
// ---------------------------------------------------------------------------------------------
export function planFor(r: Report, drones: DroneRec[], now: number): Plan {
  const views = drones.map((d) => droneAt(d, now));
  const agent = AGENT_FOR[r.type];
  const active = views.filter((d) => d.reportId === r.id && (d.phase === 'enroute' || d.phase === 'onscene')).length;
  const required = Math.max(0, DRONES_FOR[r.size] - active);
  const picked: DroneView[] = [];
  for (const a of [agent, ...BACKUP_FOR[r.type]]) {
    const ready = views.filter((d) => d.phase === 'ready' && d.agent === a && !picked.includes(d)).sort((x, y) => dist(x.pos, r) - dist(y.pos, r));
    for (const d of ready) if (picked.length < required) picked.push(d);
  }
  return {
    agent,
    required,
    drones: picked.map((d) => {
      const m = Math.round(dist(d.pos, r));
      return { id: d.id, agent: d.agent, home: d.home, distanceM: m, etaS: Math.ceil(SPOOL_UP + m / SPEED) };
    }),
    shortage: required - picked.length,
  };
}

export function launch(s: State, reportId: number, now: number): Plan {
  const r = s.reports.find((x) => x.id === reportId)!;
  s.drones = s.drones.map((d) => advance(d, now));
  const plan = planFor(r, s.drones, now);
  for (const p of plan.drones) {
    const i = s.drones.findIndex((d) => d.id === p.id);
    const v = droneAt(s.drones[i], now);
    s.drones[i] = { ...s.drones[i], phase: 'enroute', t0: now, from: v.pos, to: { lat: r.lat, lng: r.lng }, b0: v.battery, p0: v.payload, reportId: r.id, reason: null };
  }
  if (plan.drones.length) r.status = 'dispatched';
  return plan;
}

export function resolve(s: State, reportId: number, now: number) {
  const r = s.reports.find((x) => x.id === reportId)!;
  r.status = 'resolved';
  r.resolvedAt = now;
  s.drones = s.drones.map((rec) => {
    const d = droneAt(rec, now);
    if (d.reportId !== reportId || (d.phase !== 'enroute' && d.phase !== 'onscene')) return advance(rec, now);
    return goHome(advance(rec, now), now, d.pos, d.battery, d.payload, 'done');
  });
}

export function hotspots(reports: Report[]): Hotspot[] {
  const cells = new Map<string, { lat: number; lng: number; count: number }>();
  for (const r of reports) {
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
      const near = nearestStation({ lat: c.lat + GRID_DEG / 2, lng: c.lng + GRID_DEG / 2 }).distanceM;
      return { ...c, nearestM: Math.round(near), suggest: c.count >= SUGGEST_MIN && near > SUGGEST_FAR_M };
    })
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------------------------
export function initialState(now: number, secret: string): State {
  const start = [100, 92, 64, 100, 48, 88, 95, 36, 100, 70, 100, 55];
  const drones: DroneRec[] = [];
  let i = 0;
  for (const s of STATIONS) {
    for (const agent of AGENTS) {
      const b0 = start[i++];
      drones.push({
        id: `${s.id}-${agent[0].toUpperCase()}`, agent, home: s.id, phase: b0 < READY_BATTERY ? 'charging' : 'ready', t0: now,
        from: padPosition(s.id, agent), to: null, b0, p0: 100, reportId: null, reason: null,
      });
    }
  }
  // Demo history so the hotspot analysis has data (marked demo).
  const clusters: { lat: number; lng: number; n: number; type: FireType }[] = [
    { lat: 23.5705, lng: 58.2806, n: 5, type: 'electrical' },
    { lat: 23.5652, lng: 58.2788, n: 3, type: 'vehicle' },
    { lat: 23.5722, lng: 58.277, n: 2, type: 'vegetation' },
  ];
  const reports: Report[] = [];
  let id = 1;
  for (const c of clusters)
    for (let k = 0; k < c.n; k++) {
      const at = now - (3 + id * 4) * 864e5;
      reports.push({
        id, ref: `RQ-DEMO${id}`, lat: c.lat + (k % 3) * 0.00018, lng: c.lng + Math.floor(k / 3) * 0.0002, size: FIRE_SIZES[k % 3], type: c.type,
        details: '', status: 'resolved', createdAt: at, resolvedAt: at + 20 * 6e4, demo: true,
      });
      id++;
    }
  return { v: 2, seq: id, reports, drones, secret, rl: {} };
}
