import { db, getMission, now, toAssessment, toDrone } from './db.ts';
import { bearingDeg, distanceM, offset } from './geo.ts';
import { broadcast, notify } from './realtime.ts';
import { audit } from './security.ts';
import type { CommandResult } from './adapters.ts';
import type { DroneCommand, FlightMode, MissionStatus, SimulatorState, TelemetryDTO, WaypointDTO } from '../shared/domain.ts';

const CRUISE_MS = 14; // m/s
const CLIMB_MS = 4;
const CRUISE_ALT = 80; // m AGL
const SIM_MODEL = 'fg-sim-detector-0.1 (simulated, unvalidated)';

interface SimDrone {
  id: number;
  lat: number;
  lng: number;
  alt: number;
  speed: number;
  heading: number;
  battery: number;
  mode: FlightMode;
  armed: boolean;
  wp: number;
  laps: number;
  payload: number;
  lastSeenLink: number;
  lastPersist: number;
  lastDetection: number;
  jitter: number;
}

export class Simulator {
  state: SimulatorState = { running: true, speed: 1, faults: { gpsDegraded: false, linkLoss: false, lowBattery: false } };
  private drones = new Map<number, SimDrone>();
  private latest = new Map<number, TelemetryDTO>();
  private timer: NodeJS.Timeout | null = null;

  start() {
    this.syncFleet();
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Telemetry for simulated drones only. Real adapters without integration have none. */
  telemetry(id: number): TelemetryDTO | null {
    return this.latest.get(id) ?? null;
  }

  syncFleet() {
    const rows = db.prepare("SELECT * FROM drones WHERE adapter = 'simulator'").all() as Record<string, any>[];
    const ids = new Set<number>();
    for (const r of rows) {
      ids.add(r.id);
      if (this.drones.has(r.id)) continue;
      this.drones.set(r.id, {
        id: r.id,
        lat: r.home_lat,
        lng: r.home_lng,
        alt: 0,
        speed: 0,
        heading: 0,
        battery: r.status === 'charging' ? 46 + (r.id % 5) * 7 : 92 + (r.id % 3) * 3,
        mode: 'landed',
        armed: false,
        wp: 0,
        laps: 0,
        payload: 100,
        lastSeenLink: Date.now(),
        lastPersist: 0,
        lastDetection: Date.now(),
        jitter: 0,
      });
    }
    for (const id of this.drones.keys()) if (!ids.has(id)) this.drones.delete(id);
  }

  setFaults(f: Partial<SimulatorState['faults']>) {
    this.state.faults = { ...this.state.faults, ...f };
  }

  applyCommand(droneId: number, cmd: DroneCommand): CommandResult {
    const d = this.drones.get(droneId);
    if (!d) return { ok: false, reason: 'not_simulated' };
    if (this.state.faults.linkLoss) return { ok: false, reason: 'link_lost' };
    switch (cmd) {
      case 'takeoff':
        if (d.battery < 30) return { ok: false, reason: 'battery_low' };
        d.armed = true;
        d.mode = 'takeoff';
        d.wp = 0;
        d.laps = 0;
        return { ok: true };
      case 'pause':
        d.mode = 'hold';
        return { ok: true };
      case 'resume':
        d.mode = 'mission';
        return { ok: true };
      case 'rtl':
      case 'abort':
        d.mode = d.alt > 0 ? 'rtl' : 'landed';
        if (d.alt <= 0) d.armed = false;
        return { ok: true };
      case 'land':
        d.mode = 'landing';
        return { ok: true };
    }
  }

  private missionFor(droneId: number) {
    const r = db
      .prepare("SELECT id FROM missions WHERE drone_id = ? AND status IN ('preflight','active','paused','returning','aborted') AND ended_at IS NULL ORDER BY id DESC LIMIT 1")
      .get(droneId) as { id: number } | undefined;
    return r ? getMission(r.id) : null;
  }

  private setMission(id: number, patch: { status?: MissionStatus; progress?: number; ended?: boolean; started?: boolean }) {
    const m = getMission(id);
    if (!m) return;
    const status = patch.status ?? m.status;
    db.prepare(
      'UPDATE missions SET status = ?, progress = ?, started_at = COALESCE(started_at, ?), ended_at = ? WHERE id = ?',
    ).run(status, patch.progress ?? m.progress, patch.started ? now() : null, patch.ended ? now() : m.endedAt, id);
    if (patch.ended) {
      db.prepare("UPDATE drones SET current_mission_id = NULL, status = 'charging' WHERE id = ?").run(m.droneId);
      const dr = db.prepare('SELECT * FROM drones WHERE id = ?').get(m.droneId) as Record<string, any>;
      broadcast({ type: 'drone', data: { ...toDrone(dr), telemetry: this.telemetry(m.droneId) } });
    }
    const updated = getMission(id);
    if (updated && (patch.status || patch.ended)) broadcast({ type: 'mission', data: updated });
  }

  private tick() {
    if (!this.state.running) return;
    const dt = this.state.speed;
    const out: TelemetryDTO[] = [];
    const fleet = db.prepare("SELECT id, status, home_lat, home_lng, callsign FROM drones WHERE adapter = 'simulator'").all() as Record<string, any>[];
    for (const row of fleet) {
      const d = this.drones.get(row.id);
      if (!d) continue;
      if (row.status === 'offline') continue; // offline aircraft emit nothing
      const mission = this.missionFor(d.id);
      this.step(d, row, mission?.waypoints ?? [], dt, mission);
      const linkLost = this.state.faults.linkLoss && d.armed;
      if (linkLost) {
        // Fail-safe: autopilot-style RTL after 10 s without link
        if (Date.now() - d.lastSeenLink > 10000 && (d.mode === 'mission' || d.mode === 'hold')) {
          d.mode = 'rtl';
          notify('critical', 'drone.failsafe_rtl', { callsign: row.callsign }, `/ops/monitor/${d.id}`);
        }
        continue; // nothing reaches the ground station → client will mark telemetry stale
      }
      d.lastSeenLink = Date.now();
      const gpsBad = this.state.faults.gpsDegraded;
      const t: TelemetryDTO = {
        droneId: d.id,
        at: now(),
        simulated: true,
        lat: d.lat + (gpsBad ? (Math.random() - 0.5) * 0.0004 : 0),
        lng: d.lng + (gpsBad ? (Math.random() - 0.5) * 0.0004 : 0),
        altitude: Math.round(d.alt * 10) / 10,
        groundSpeed: Math.round(d.speed * 10) / 10,
        heading: Math.round(d.heading),
        battery: Math.round(d.battery * 10) / 10,
        satellites: gpsBad ? 5 : 17 + (d.id % 4),
        gpsFix: gpsBad ? '2d' : '3d',
        linkQuality: Math.max(35, Math.round(98 - distanceM(d.lat, d.lng, row.home_lat, row.home_lng) / 450)), // ~15 km nominal range
        flightMode: d.mode,
        distanceHome: Math.round(distanceM(d.lat, d.lng, row.home_lat, row.home_lng)),
        payloadRemaining: Math.round(d.payload),
        armed: d.armed,
      };
      this.latest.set(d.id, t);
      out.push(t);
      if (Date.now() - d.lastPersist > 5000 && d.armed) {
        d.lastPersist = Date.now();
        db.prepare('INSERT INTO telemetry (drone_id, at, data, simulated) VALUES (?,?,?,1)').run(d.id, t.at, JSON.stringify(t));
      }
      if (mission && (mission.status === 'active' || mission.status === 'paused') && (d.mode === 'mission' || d.mode === 'hold') && this.nearTarget(d, mission)) this.maybeDetect(d, mission);
    }
    if (out.length) broadcast({ type: 'telemetry', data: out });
  }

  private step(d: SimDrone, row: Record<string, any>, wps: WaypointDTO[], dt: number, mission: ReturnType<Simulator['missionFor']>) {
    const drain = (this.state.faults.lowBattery ? 0.9 : 0.045) * dt; // ~37 min nominal endurance
    if (d.armed) d.battery = Math.max(0, d.battery - drain);
    else if (row.status === 'charging' || d.battery < 100) {
      d.battery = Math.min(100, d.battery + 0.5 * dt);
      if (row.status === 'charging' && d.battery >= 95) {
        db.prepare("UPDATE drones SET status = 'available' WHERE id = ? AND status = 'charging'").run(d.id);
        const dr = db.prepare('SELECT * FROM drones WHERE id = ?').get(d.id) as Record<string, any>;
        broadcast({ type: 'drone', data: { ...toDrone(dr), telemetry: this.telemetry(d.id) } });
      }
    }

    // Battery failsafe
    if (d.armed && d.battery < 20 && (d.mode === 'mission' || d.mode === 'hold')) {
      d.mode = 'rtl';
      notify('critical', 'drone.battery_rtl', { callsign: row.callsign }, `/ops/monitor/${d.id}`);
      if (mission) this.setMission(mission.id, { status: 'returning' });
    }

    const moveTo = (lat: number, lng: number, alt: number) => {
      const dist = distanceM(d.lat, d.lng, lat, lng);
      const stepM = CRUISE_MS * dt;
      d.heading = dist > 1 ? bearingDeg(d.lat, d.lng, lat, lng) : d.heading;
      if (dist <= stepM) {
        d.lat = lat;
        d.lng = lng;
      } else {
        const p = offset(d.lat, d.lng, stepM, d.heading);
        d.lat = p.lat;
        d.lng = p.lng;
      }
      d.speed = Math.min(CRUISE_MS, dist / dt);
      d.alt += Math.sign(alt - d.alt) * Math.min(Math.abs(alt - d.alt), CLIMB_MS * dt);
      return dist <= stepM;
    };

    switch (d.mode) {
      case 'landed':
        d.speed = 0;
        d.alt = 0;
        break;
      case 'takeoff':
        d.speed = 0;
        d.alt = Math.min(CRUISE_ALT, d.alt + CLIMB_MS * dt);
        if (d.alt >= CRUISE_ALT - 0.5) {
          d.mode = 'mission';
          if (mission) this.setMission(mission.id, { status: 'active', started: true });
        }
        break;
      case 'mission': {
        if (!wps.length) {
          d.mode = 'hold';
          break;
        }
        const wp = wps[d.wp % wps.length];
        if (moveTo(wp.lat, wp.lng, wp.altitude)) {
          d.wp++;
          // first waypoint is transit; orbit loops over the rest
          if (d.wp >= wps.length) {
            d.wp = Math.min(1, wps.length - 1);
            d.laps++;
          }
        }
        if (mission) {
          const p = d.laps > 0 ? 1 : d.wp / wps.length;
          if (Math.abs(p - mission.progress) > 0.02) db.prepare('UPDATE missions SET progress = ? WHERE id = ?').run(p, mission.id);
        }
        break;
      }
      case 'hold':
        d.speed = 0;
        break;
      case 'rtl':
        if (mission && mission.status !== 'returning' && mission.status !== 'aborted') this.setMission(mission.id, { status: 'returning' });
        if (moveTo(row.home_lat, row.home_lng, Math.max(d.alt, 40))) d.mode = 'landing';
        break;
      case 'landing':
        d.speed = 0;
        d.alt = Math.max(0, d.alt - 3 * dt);
        if (d.alt <= 0) {
          d.mode = 'landed';
          d.armed = false;
          if (mission) {
            const final = mission.status === 'aborted' ? 'aborted' : 'completed';
            this.setMission(mission.id, { status: final, ended: true });
            audit(null, 'mission.landed', 'mission', mission.id, { status: final }, { name: 'simulator', role: null });
          }
        }
        break;
    }
  }

  private nearTarget(d: SimDrone, mission: NonNullable<ReturnType<Simulator['missionFor']>>) {
    if (d.laps > 0) return true;
    const inc = mission.incidentId ? (db.prepare('SELECT lat, lng FROM incidents WHERE id = ?').get(mission.incidentId) as { lat: number; lng: number } | undefined) : undefined;
    return !!inc && distanceM(d.lat, d.lng, inc.lat, inc.lng) < 350;
  }

  private maybeDetect(d: SimDrone, mission: NonNullable<ReturnType<Simulator['missionFor']>>) {
    if (Date.now() - d.lastDetection < 9000 / this.state.speed) return;
    d.lastDetection = Date.now();
    const pending = db.prepare("SELECT COUNT(*) c FROM assessments WHERE mission_id = ? AND review = 'pending'").get(mission.id) as { c: number };
    if (pending.c >= 4) return;
    const inc = mission.incidentId ? (db.prepare('SELECT lat, lng FROM incidents WHERE id = ?').get(mission.incidentId) as any) : null;
    const center = inc ?? { lat: d.lat, lng: d.lng };
    const kinds = ['hotspot', 'flame', 'smoke'] as const;
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const p = offset(center.lat, center.lng, Math.random() * 60, Math.random() * 360);
    const r = db
      .prepare(
        `INSERT INTO assessments (incident_id, mission_id, drone_id, kind, confidence, lat, lng, frame_x, frame_y, radius, max_temp_c, model, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
      )
      .get(
        mission.incidentId,
        mission.id,
        d.id,
        kind,
        Math.round((0.48 + Math.random() * 0.45) * 100) / 100,
        p.lat,
        p.lng,
        0.25 + Math.random() * 0.5,
        0.3 + Math.random() * 0.45,
        0.05 + Math.random() * 0.07,
        kind === 'smoke' ? null : Math.round(180 + Math.random() * 420),
        SIM_MODEL,
        now(),
      ) as Record<string, any>;
    broadcast({ type: 'assessment', data: toAssessment(r) });
  }

  /** Apply payload release in simulation only. */
  simulateRelease(droneId: number, quantityPct: number) {
    const d = this.drones.get(droneId);
    if (d) d.payload = Math.max(0, d.payload - quantityPct);
  }
}
