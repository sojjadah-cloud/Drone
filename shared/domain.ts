// FIREGUARD shared domain model — imported by both the API server and the web client.
// Keep this file free of runtime dependencies and non-erasable TS syntax (Node type stripping).

export const FIRE_TYPES = ['vegetation', 'building', 'vehicle', 'industrial', 'other'] as const;
export type FireType = (typeof FIRE_TYPES)[number];

export const FIRE_SIZES = ['small', 'medium', 'large', 'unknown'] as const;
export type FireSize = (typeof FIRE_SIZES)[number];

export const SMOKE_LEVELS = ['none', 'light', 'moderate', 'heavy'] as const;
export type SmokeLevel = (typeof SMOKE_LEVELS)[number];

export const PEOPLE_RISK = ['yes', 'no', 'unknown'] as const;
export type PeopleRisk = (typeof PEOPLE_RISK)[number];

// ---------------------------------------------------------------------------
// Public report lifecycle
// ---------------------------------------------------------------------------
export const REPORT_STATUSES = [
  'submitted',
  'under_review',
  'verified',
  'rejected',
  'duplicate',
  'cancelled',
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  submitted: ['under_review', 'cancelled', 'rejected', 'duplicate', 'verified'],
  under_review: ['verified', 'rejected', 'duplicate'],
  verified: [],
  rejected: [],
  duplicate: [],
  cancelled: [],
};

// ---------------------------------------------------------------------------
// Incident lifecycle
// ---------------------------------------------------------------------------
export const INCIDENT_STATUSES = [
  'verified',
  'response_assigned',
  'in_progress',
  'resolved',
  'closed',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  verified: ['response_assigned', 'resolved', 'closed'],
  response_assigned: ['in_progress', 'verified', 'resolved'],
  in_progress: ['resolved'],
  resolved: ['closed', 'in_progress'],
  closed: [],
};

/** Public tracking stages shown to reporters (union of report + incident lifecycle). */
export const TRACKING_STAGES = [
  'submitted',
  'under_review',
  'verified',
  'response_assigned',
  'in_progress',
  'resolved',
  'closed',
] as const;
export type TrackingStage = (typeof TRACKING_STAGES)[number];

// ---------------------------------------------------------------------------
// Priority — deterministic, rule-based. Never derived from AI output.
// ---------------------------------------------------------------------------
export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface PriorityInput {
  fireType: FireType;
  fireSize: FireSize;
  smoke: SmokeLevel;
  peopleAtRisk: PeopleRisk;
}

export interface PriorityResult {
  priority: Priority;
  score: number;
  factors: { key: string; points: number }[];
}

export const PRIORITY_RULES = {
  peopleAtRisk: { yes: 4, unknown: 1, no: 0 },
  fireSize: { large: 3, medium: 2, small: 1, unknown: 1 },
  smoke: { heavy: 2, moderate: 1, light: 0, none: 0 },
  fireType: { building: 2, industrial: 2, vehicle: 1, vegetation: 1, other: 0 },
  // score >= threshold → priority
  thresholds: [
    { min: 8, priority: 'P1' },
    { min: 5, priority: 'P2' },
    { min: 3, priority: 'P3' },
    { min: 0, priority: 'P4' },
  ],
} as const;

export function computePriority(input: PriorityInput): PriorityResult {
  const factors = [
    { key: `people.${input.peopleAtRisk}`, points: PRIORITY_RULES.peopleAtRisk[input.peopleAtRisk] },
    { key: `size.${input.fireSize}`, points: PRIORITY_RULES.fireSize[input.fireSize] },
    { key: `smoke.${input.smoke}`, points: PRIORITY_RULES.smoke[input.smoke] },
    { key: `type.${input.fireType}`, points: PRIORITY_RULES.fireType[input.fireType] },
  ];
  const score = factors.reduce((s, f) => s + f.points, 0);
  const priority = (PRIORITY_RULES.thresholds.find((t) => score >= t.min)?.priority ?? 'P4') as Priority;
  return { priority, score, factors };
}

// ---------------------------------------------------------------------------
// Drones & missions
// ---------------------------------------------------------------------------
export const DRONE_STATUSES = ['available', 'in_mission', 'charging', 'maintenance', 'offline', 'restricted'] as const;
export type DroneStatus = (typeof DRONE_STATUSES)[number];

export const ADAPTER_KINDS = ['simulator', 'mavlink', 'px4', 'ardupilot', 'vendor_sdk'] as const;
export type AdapterKind = (typeof ADAPTER_KINDS)[number];

export const PAYLOAD_TYPES = ['camera_only', 'water', 'foam', 'dry_chemical', 'fire_ball'] as const;
export type PayloadType = (typeof PAYLOAD_TYPES)[number];

export const FLIGHT_MODES = ['landed', 'takeoff', 'mission', 'hold', 'rtl', 'landing'] as const;
export type FlightMode = (typeof FLIGHT_MODES)[number];

export const MISSION_STATUSES = [
  'planned',
  'authorized',
  'preflight',
  'active',
  'paused',
  'returning',
  'completed',
  'aborted',
] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const MISSION_OUTCOMES = ['objective_met', 'partial', 'not_met', 'aborted_safety', 'aborted_operator'] as const;
export type MissionOutcome = (typeof MISSION_OUTCOMES)[number];

export const DRONE_COMMANDS = ['takeoff', 'pause', 'resume', 'rtl', 'land', 'abort'] as const;
export type DroneCommand = (typeof DRONE_COMMANDS)[number];

/** Which mission states a live command is valid in. Server enforces; client uses for disabled states. */
export const COMMAND_ALLOWED_IN: Record<DroneCommand, MissionStatus[]> = {
  takeoff: ['preflight'],
  pause: ['active'],
  resume: ['paused'],
  rtl: ['active', 'paused'],
  land: ['active', 'paused', 'returning'],
  abort: ['authorized', 'preflight', 'active', 'paused', 'returning'],
};

export const PREFLIGHT_CHECKS = [
  'airspace_clear',
  'battery_ok',
  'gps_fix',
  'link_ok',
  'payload_secured',
  'weather_ok',
  'ground_crew_briefed',
] as const;
export type PreflightCheck = (typeof PREFLIGHT_CHECKS)[number];

// Suppression: strict human-in-the-loop sequence.
export const SUPPRESSION_STEPS = [
  'requested',
  'target_confirmed',
  'readiness_verified',
  'safety_approved',
  'released',
  'outcome_recorded',
  'cancelled',
] as const;
export type SuppressionStep = (typeof SUPPRESSION_STEPS)[number];

export const ASSESSMENT_KINDS = ['flame', 'smoke', 'hotspot'] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];
export const ASSESSMENT_REVIEW = ['pending', 'confirmed', 'rejected'] as const;
export type AssessmentReview = (typeof ASSESSMENT_REVIEW)[number];

// ---------------------------------------------------------------------------
// Roles & permissions (server is the source of truth; client mirrors for UX only)
// ---------------------------------------------------------------------------
export const ROLES = [
  'admin',
  'supervisor',
  'dispatcher',
  'pilot',
  'safety_officer',
  'analyst',
] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'incidents.view',
  'incidents.manage',
  'missions.assign',
  'flight.approve',
  'aircraft.control',
  'suppression.authorize',
  'suppression.release',
  'fleet.manage',
  'users.manage',
  'data.export',
  'analytics.view',
  'audit.view',
  'simulator.control',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ['incidents.view', 'fleet.manage', 'users.manage', 'data.export', 'analytics.view', 'audit.view', 'simulator.control'],
  supervisor: [
    'incidents.view',
    'incidents.manage',
    'missions.assign',
    'flight.approve',
    'data.export',
    'analytics.view',
    'audit.view',
  ],
  dispatcher: ['incidents.view', 'incidents.manage', 'missions.assign'],
  pilot: ['incidents.view', 'aircraft.control', 'suppression.release'],
  safety_officer: ['incidents.view', 'suppression.authorize', 'audit.view'],
  analyst: ['incidents.view', 'analytics.view', 'data.export'],
};

export function can(role: Role | undefined | null, perm: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------
export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface UserDTO {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
}

export interface AttachmentDTO {
  id: number;
  kind: 'image' | 'video';
  mime: string;
  size: number;
  url: string;
  createdAt: string;
  source: 'public' | 'operator' | 'drone';
}

export interface ReportDTO {
  id: number;
  reference: string;
  status: ReportStatus;
  incidentId: number | null;
  lat: number;
  lng: number;
  locationAccuracy: number | null;
  locationMethod: 'gps' | 'manual' | 'gps_adjusted';
  locationDescription: string;
  fireType: FireType;
  fireSize: FireSize;
  smoke: SmokeLevel;
  peopleAtRisk: PeopleRisk;
  notes: string;
  contactName: string | null;
  contactPhone: string | null;
  createdAt: string;
  updatedAt: string;
  isDemo: boolean;
  attachments: AttachmentDTO[];
  priority: PriorityResult;
}

export interface TimelineEntry {
  id: number;
  at: string;
  kind: string;
  actor: string | null;
  detail: Record<string, unknown>;
}

export interface IncidentDTO {
  id: number;
  code: string;
  source: 'public_report' | 'operator' | 'drone_detection';
  status: IncidentStatus;
  lat: number;
  lng: number;
  locationDescription: string;
  fireType: FireType;
  fireSize: FireSize;
  smoke: SmokeLevel;
  peopleAtRisk: PeopleRisk;
  priority: Priority;
  priorityScore: number;
  assignedTeam: string | null;
  assignedDroneId: number | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  verifiedAt: string | null;
  resolvedAt: string | null;
  isDemo: boolean;
  reportCount: number;
}

export interface IncidentDetailDTO extends IncidentDTO {
  reports: ReportDTO[];
  timeline: TimelineEntry[];
  notes: { id: number; at: string; author: string; body: string }[];
  attachments: AttachmentDTO[];
  missions: MissionDTO[];
  assessments: AssessmentDTO[];
}

export interface TelemetryDTO {
  droneId: number;
  at: string;
  simulated: boolean;
  lat: number;
  lng: number;
  altitude: number; // m AGL
  groundSpeed: number; // m/s
  heading: number; // deg true
  battery: number; // %
  satellites: number;
  gpsFix: 'none' | '2d' | '3d' | 'rtk';
  linkQuality: number; // 0-100
  flightMode: FlightMode;
  distanceHome: number; // m
  payloadRemaining: number; // % of capacity
  armed: boolean;
}

export interface DroneDTO {
  id: number;
  callsign: string;
  model: string;
  manufacturer: string;
  serial: string;
  status: DroneStatus;
  adapter: AdapterKind;
  payloadType: PayloadType;
  payloadCapacity: number; // kg or L
  payloadUnit: 'kg' | 'L' | 'n/a';
  hasThermal: boolean;
  homeLat: number;
  homeLng: number;
  baseName: string;
  lastMaintenance: string | null;
  flightHours: number;
  currentMissionId: number | null;
  isDemo: boolean;
  telemetry: TelemetryDTO | null;
}

export interface WaypointDTO {
  seq: number;
  lat: number;
  lng: number;
  altitude: number;
  action: 'transit' | 'orbit' | 'survey' | 'home';
}

export interface MissionDTO {
  id: number;
  code: string;
  incidentId: number | null;
  droneId: number;
  objective: 'reconnaissance' | 'thermal_survey' | 'suppression_support' | 'perimeter_watch';
  status: MissionStatus;
  outcome: MissionOutcome | null;
  createdBy: string;
  authorizedBy: string | null;
  pilot: string | null;
  preflight: Partial<Record<PreflightCheck, boolean>>;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  waypoints: WaypointDTO[];
  progress: number; // 0..1 simulated
  isDemo: boolean;
}

export interface AssessmentDTO {
  id: number;
  incidentId: number | null;
  missionId: number | null;
  droneId: number | null;
  kind: AssessmentKind;
  confidence: number; // 0..1, model-reported, NOT validated accuracy
  lat: number;
  lng: number;
  frameX: number; // 0..1 position in frame
  frameY: number;
  radius: number; // 0..1
  maxTempC: number | null;
  review: AssessmentReview;
  reviewedBy: string | null;
  model: string;
  createdAt: string;
}

export interface SuppressionDTO {
  id: number;
  missionId: number;
  incidentId: number | null;
  droneId: number;
  assessmentId: number | null;
  step: SuppressionStep;
  targetLat: number;
  targetLng: number;
  quantity: number;
  requestedBy: string;
  targetConfirmedBy: string | null;
  readiness: Record<string, boolean>;
  safetyApprovedBy: string | null;
  releasedBy: string | null;
  outcome: string | null;
  simulated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDTO {
  id: number;
  at: string;
  level: 'critical' | 'warning' | 'info' | 'success';
  kind: string;
  params: Record<string, string | number>;
  link: string | null;
  read: boolean;
}

export interface AuditDTO {
  id: number;
  at: string;
  actor: string | null;
  role: Role | null;
  action: string;
  entity: string;
  entityId: string | null;
  detail: Record<string, unknown>;
  ip: string | null;
}

export interface MaintenanceDTO {
  id: number;
  droneId: number;
  at: string;
  kind: string;
  notes: string;
  technician: string;
}

/** WebSocket server → client messages */
export type WsMessage =
  | { type: 'telemetry'; data: TelemetryDTO[] }
  | { type: 'incident'; data: IncidentDTO }
  | { type: 'report'; data: { id: number; reference: string } }
  | { type: 'mission'; data: MissionDTO }
  | { type: 'drone'; data: DroneDTO }
  | { type: 'notification'; data: NotificationDTO }
  | { type: 'assessment'; data: AssessmentDTO }
  | { type: 'suppression'; data: SuppressionDTO }
  | { type: 'hello'; data: { serverTime: string; simulator: SimulatorState } };

export interface SimulatorState {
  running: boolean;
  speed: number;
  faults: { gpsDegraded: boolean; linkLoss: boolean; lowBattery: boolean };
}

export const TELEMETRY_STALE_MS = 4000;
