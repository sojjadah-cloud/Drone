import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePriority } from '../shared/domain.ts';
import type {
  AssessmentDTO,
  AttachmentDTO,
  AuditDTO,
  DroneDTO,
  IncidentDTO,
  MissionDTO,
  NotificationDTO,
  ReportDTO,
  SuppressionDTO,
  UserDTO,
} from '../shared/domain.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.FIREGUARD_DATA_DIR ?? join(here, 'data');
export const UPLOAD_DIR = join(DATA_DIR, 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'fireguard.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// Spatial note: SQLite stores lat/lng as REAL. The production target is PostgreSQL + PostGIS
// (see docs/ARCHITECTURE.md); queries here are kept simple so the repository layer can be swapped.
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT
);
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL,
  location_description TEXT NOT NULL DEFAULT '',
  fire_type TEXT NOT NULL, fire_size TEXT NOT NULL, smoke TEXT NOT NULL, people_at_risk TEXT NOT NULL,
  priority TEXT NOT NULL, priority_score INTEGER NOT NULL,
  assigned_team TEXT, assigned_drone_id INTEGER REFERENCES drones(id),
  resolution TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  verified_at TEXT, resolved_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  reference TEXT UNIQUE NOT NULL,
  tracking_secret TEXT NOT NULL,
  status TEXT NOT NULL,
  incident_id INTEGER REFERENCES incidents(id),
  lat REAL NOT NULL, lng REAL NOT NULL,
  location_accuracy REAL, location_method TEXT NOT NULL,
  location_description TEXT NOT NULL DEFAULT '',
  fire_type TEXT NOT NULL, fire_size TEXT NOT NULL, smoke TEXT NOT NULL, people_at_risk TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  contact_name TEXT, contact_phone TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  ip_hash TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY,
  report_id INTEGER REFERENCES reports(id) ON DELETE CASCADE,
  incident_id INTEGER REFERENCES incidents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
  storage_key TEXT NOT NULL, source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS incident_events (
  id INTEGER PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  at TEXT NOT NULL, kind TEXT NOT NULL, actor TEXT, detail TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS incident_notes (
  id INTEGER PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  at TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS drones (
  id INTEGER PRIMARY KEY,
  callsign TEXT UNIQUE NOT NULL,
  model TEXT NOT NULL, manufacturer TEXT NOT NULL, serial TEXT NOT NULL,
  status TEXT NOT NULL, adapter TEXT NOT NULL,
  payload_type TEXT NOT NULL, payload_capacity REAL NOT NULL, payload_unit TEXT NOT NULL,
  has_thermal INTEGER NOT NULL DEFAULT 1,
  home_lat REAL NOT NULL, home_lng REAL NOT NULL, base_name TEXT NOT NULL,
  last_maintenance TEXT, flight_hours REAL NOT NULL DEFAULT 0,
  current_mission_id INTEGER,
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS telemetry (
  id INTEGER PRIMARY KEY,
  drone_id INTEGER NOT NULL REFERENCES drones(id) ON DELETE CASCADE,
  at TEXT NOT NULL, data TEXT NOT NULL, simulated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS telemetry_drone_at ON telemetry(drone_id, at);
CREATE TABLE IF NOT EXISTS missions (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  incident_id INTEGER REFERENCES incidents(id),
  drone_id INTEGER NOT NULL REFERENCES drones(id),
  objective TEXT NOT NULL, status TEXT NOT NULL, outcome TEXT,
  created_by TEXT NOT NULL, authorized_by TEXT, pilot TEXT,
  preflight TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, started_at TEXT, ended_at TEXT,
  progress REAL NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS waypoints (
  id INTEGER PRIMARY KEY,
  mission_id INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, altitude REAL NOT NULL, action TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS operator_actions (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL, actor TEXT NOT NULL, drone_id INTEGER, mission_id INTEGER,
  command TEXT NOT NULL, result TEXT NOT NULL, adapter TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY,
  incident_id INTEGER REFERENCES incidents(id), mission_id INTEGER, drone_id INTEGER,
  kind TEXT NOT NULL, confidence REAL NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL, frame_x REAL NOT NULL, frame_y REAL NOT NULL, radius REAL NOT NULL,
  max_temp_c REAL, review TEXT NOT NULL DEFAULT 'pending', reviewed_by TEXT,
  model TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS suppressions (
  id INTEGER PRIMARY KEY,
  mission_id INTEGER NOT NULL REFERENCES missions(id),
  incident_id INTEGER, drone_id INTEGER NOT NULL, assessment_id INTEGER,
  step TEXT NOT NULL, target_lat REAL NOT NULL, target_lng REAL NOT NULL, quantity REAL NOT NULL,
  requested_by TEXT NOT NULL, target_confirmed_by TEXT, readiness TEXT NOT NULL DEFAULT '{}',
  safety_approved_by TEXT, released_by TEXT, outcome TEXT,
  simulated INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL, level TEXT NOT NULL, kind TEXT NOT NULL, params TEXT NOT NULL DEFAULT '{}',
  link TEXT, read INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL, actor TEXT, role TEXT, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT,
  detail TEXT NOT NULL DEFAULT '{}', ip TEXT
);
CREATE TABLE IF NOT EXISTS maintenance_records (
  id INTEGER PRIMARY KEY,
  drone_id INTEGER NOT NULL REFERENCES drones(id) ON DELETE CASCADE,
  at TEXT NOT NULL, kind TEXT NOT NULL, notes TEXT NOT NULL, technician TEXT NOT NULL
);
`);

export const now = () => new Date().toISOString();
const json = <T>(s: unknown, fallback: T): T => {
  try {
    return s ? (JSON.parse(String(s)) as T) : fallback;
  } catch {
    return fallback;
  }
};

type Row = Record<string, any>;

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Row → DTO mappers
// ---------------------------------------------------------------------------
export const toUser = (r: Row): UserDTO => ({
  id: r.id,
  username: r.username,
  fullName: r.full_name,
  role: r.role,
  active: !!r.active,
  lastLoginAt: r.last_login_at,
});

export const toAttachment = (r: Row): AttachmentDTO => ({
  id: r.id,
  kind: r.kind,
  mime: r.mime,
  size: r.size,
  url: `/api/attachments/${r.id}`,
  createdAt: r.created_at,
  source: r.source,
});

export function attachmentsFor(col: 'report_id' | 'incident_id', id: number): AttachmentDTO[] {
  return (db.prepare(`SELECT * FROM attachments WHERE ${col} = ? ORDER BY id`).all(id) as Row[]).map(toAttachment);
}

export const toReport = (r: Row): ReportDTO => ({
  id: r.id,
  reference: r.reference,
  status: r.status,
  incidentId: r.incident_id,
  lat: r.lat,
  lng: r.lng,
  locationAccuracy: r.location_accuracy,
  locationMethod: r.location_method,
  locationDescription: r.location_description,
  fireType: r.fire_type,
  fireSize: r.fire_size,
  smoke: r.smoke,
  peopleAtRisk: r.people_at_risk,
  notes: r.notes,
  contactName: r.contact_name,
  contactPhone: r.contact_phone,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  isDemo: !!r.is_demo,
  attachments: attachmentsFor('report_id', r.id),
  priority: computePriority({
    fireType: r.fire_type,
    fireSize: r.fire_size,
    smoke: r.smoke,
    peopleAtRisk: r.people_at_risk,
  }),
});

export const toIncident = (r: Row): IncidentDTO => ({
  id: r.id,
  code: r.code,
  source: r.source,
  status: r.status,
  lat: r.lat,
  lng: r.lng,
  locationDescription: r.location_description,
  fireType: r.fire_type,
  fireSize: r.fire_size,
  smoke: r.smoke,
  peopleAtRisk: r.people_at_risk,
  priority: r.priority,
  priorityScore: r.priority_score,
  assignedTeam: r.assigned_team,
  assignedDroneId: r.assigned_drone_id,
  resolution: r.resolution,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  verifiedAt: r.verified_at,
  resolvedAt: r.resolved_at,
  isDemo: !!r.is_demo,
  reportCount: r.report_count ?? 0,
});

export const INCIDENT_SELECT = `SELECT i.*, (SELECT COUNT(*) FROM reports r WHERE r.incident_id = i.id) AS report_count FROM incidents i`;

export function getIncident(id: number): IncidentDTO | null {
  const r = db.prepare(`${INCIDENT_SELECT} WHERE i.id = ?`).get(id) as Row | undefined;
  return r ? toIncident(r) : null;
}

export const toDrone = (r: Row): Omit<DroneDTO, 'telemetry'> => ({
  id: r.id,
  callsign: r.callsign,
  model: r.model,
  manufacturer: r.manufacturer,
  serial: r.serial,
  status: r.status,
  adapter: r.adapter,
  payloadType: r.payload_type,
  payloadCapacity: r.payload_capacity,
  payloadUnit: r.payload_unit,
  hasThermal: !!r.has_thermal,
  homeLat: r.home_lat,
  homeLng: r.home_lng,
  baseName: r.base_name,
  lastMaintenance: r.last_maintenance,
  flightHours: r.flight_hours,
  currentMissionId: r.current_mission_id,
  isDemo: !!r.is_demo,
});

export function toMission(r: Row): MissionDTO {
  const wps = db.prepare('SELECT seq, lat, lng, altitude, action FROM waypoints WHERE mission_id = ? ORDER BY seq').all(r.id) as Row[];
  return {
    id: r.id,
    code: r.code,
    incidentId: r.incident_id,
    droneId: r.drone_id,
    objective: r.objective,
    status: r.status,
    outcome: r.outcome,
    createdBy: r.created_by,
    authorizedBy: r.authorized_by,
    pilot: r.pilot,
    preflight: json(r.preflight, {}),
    createdAt: r.created_at,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    waypoints: wps.map((w) => ({ seq: w.seq, lat: w.lat, lng: w.lng, altitude: w.altitude, action: w.action })),
    progress: r.progress,
    isDemo: !!r.is_demo,
  };
}

export function getMission(id: number): MissionDTO | null {
  const r = db.prepare('SELECT * FROM missions WHERE id = ?').get(id) as Row | undefined;
  return r ? toMission(r) : null;
}

export const toAssessment = (r: Row): AssessmentDTO => ({
  id: r.id,
  incidentId: r.incident_id,
  missionId: r.mission_id,
  droneId: r.drone_id,
  kind: r.kind,
  confidence: r.confidence,
  lat: r.lat,
  lng: r.lng,
  frameX: r.frame_x,
  frameY: r.frame_y,
  radius: r.radius,
  maxTempC: r.max_temp_c,
  review: r.review,
  reviewedBy: r.reviewed_by,
  model: r.model,
  createdAt: r.created_at,
});

export const toSuppression = (r: Row): SuppressionDTO => ({
  id: r.id,
  missionId: r.mission_id,
  incidentId: r.incident_id,
  droneId: r.drone_id,
  assessmentId: r.assessment_id,
  step: r.step,
  targetLat: r.target_lat,
  targetLng: r.target_lng,
  quantity: r.quantity,
  requestedBy: r.requested_by,
  targetConfirmedBy: r.target_confirmed_by,
  readiness: json(r.readiness, {}),
  safetyApprovedBy: r.safety_approved_by,
  releasedBy: r.released_by,
  outcome: r.outcome,
  simulated: !!r.simulated,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const toNotification = (r: Row): NotificationDTO => ({
  id: r.id,
  at: r.at,
  level: r.level,
  kind: r.kind,
  params: json(r.params, {}),
  link: r.link,
  read: !!r.read,
});

export const toAudit = (r: Row): AuditDTO => ({
  id: r.id,
  at: r.at,
  actor: r.actor,
  role: r.role,
  action: r.action,
  entity: r.entity,
  entityId: r.entity_id,
  detail: json(r.detail, {}),
  ip: r.ip,
});

export const parseJson = json;
