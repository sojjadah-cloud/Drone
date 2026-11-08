// Military Technological College (MTC), Muscat — campus model shared by server and client.
// Boundary: OpenStreetMap way 688730411 (ODbL). Station positions are proposals; adjust STATIONS to the real
// fire-prone areas (workshops, fuel/vehicle areas, labs, dry vegetation).

export type LngLat = [number, number];

export const CAMPUS = {
  name: 'Military Technological College',
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

/** Which extinguishing agent each fire type gets (rule-based, never water on electrical). */
export const AGENT_FOR: Record<FireType, Agent> = {
  vegetation: 'water',
  building: 'water',
  vehicle: 'foam', // fuel fires
  electrical: 'powder', // non-conductive
  other: 'powder', // multipurpose ABC powder
};

/** Agents acceptable as backup when the primary agent has no ready drone. */
export const BACKUP_FOR: Record<FireType, Agent[]> = {
  vegetation: ['foam', 'powder'],
  building: ['powder', 'foam'],
  vehicle: ['powder'],
  electrical: [],
  other: ['foam'],
};

/** Number of drones dispatched per fire size. */
export const DRONES_FOR: Record<FireSize, number> = { small: 1, medium: 2, large: 3 };

export const STATIONS = [
  { id: 'N', name: { ar: 'محطة الشمال', en: 'North station' }, lng: 58.2765, lat: 23.5735 },
  { id: 'W', name: { ar: 'محطة الغرب', en: 'West station' }, lng: 58.2762, lat: 23.5672 },
  { id: 'E', name: { ar: 'محطة الشرق', en: 'East station' }, lng: 58.2814, lat: 23.5668 },
  { id: 'S', name: { ar: 'محطة الجنوب', en: 'South station' }, lng: 58.2803, lat: 23.5641 },
] as const;
export type StationId = (typeof STATIONS)[number]['id'];

export const DRONE_SPEED_MS = 15; // cruise ground speed (54 km/h)
export const RETURN_BATTERY = 20; // % — below this the drone returns to the nearest station
export const GRID_DEG = 0.001; // hotspot grid cell (~110 m × 100 m)
export const HOTSPOT_MIN = 2; // reports in a cell to mark it red
export const SUGGEST_MIN = 3; // reports in a cell to suggest a station…
export const SUGGEST_FAR_M = 350; // …when the nearest station is farther than this

export type DroneState = 'ready' | 'charging' | 'enroute' | 'onscene' | 'returning';
export type ReturnReason = 'battery' | 'empty' | 'done' | null;

export interface CampusDrone {
  id: string;
  name: string;
  agent: Agent;
  station: StationId; // current home (changes when it lands at another station)
  state: DroneState;
  lat: number;
  lng: number;
  altitude: number; // m
  battery: number; // %
  payload: number; // % liquid / powder remaining
  reportId: number | null;
  target: { lat: number; lng: number } | null;
  distanceM: number | null; // to current target
  etaS: number | null;
  returnReason: ReturnReason;
}

export interface CampusReport {
  id: number;
  ref: string;
  lat: number;
  lng: number;
  size: FireSize;
  type: FireType;
  details: string;
  status: 'new' | 'dispatched' | 'resolved';
  createdAt: string;
  resolvedAt: string | null;
}

export interface DispatchPlan {
  agent: Agent;
  required: number;
  drones: { id: string; name: string; agent: Agent; station: StationId; distanceM: number; etaS: number }[];
  shortage: number;
}

export interface Hotspot {
  lat: number; // cell south-west corner
  lng: number;
  count: number;
  nearestStationM: number;
  suggest: boolean;
}

export interface CampusState {
  serverTime: string;
  simulated: true;
  drones: CampusDrone[];
  active: (CampusReport & { plan: DispatchPlan; assigned: string[] })[];
  hotspots: Hotspot[];
  resolvedToday: number;
}

// ---------------------------------------------------------------------------------------------
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000;
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

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

export function nearestStation(lat: number, lng: number) {
  let best = STATIONS[0] as (typeof STATIONS)[number];
  let bestD = Infinity;
  for (const s of STATIONS) {
    const d = distanceM(lat, lng, s.lat, s.lng);
    if (d < bestD) (best = s), (bestD = d);
  }
  return { station: best, distanceM: bestD };
}
