import type { AdapterKind, DroneCommand } from '../shared/domain.ts';
import type { Simulator } from './simulator.ts';

export type CommandResult = { ok: true } | { ok: false; reason: string };

/**
 * Every aircraft is bound to exactly one adapter. The web UI never talks to an aircraft directly:
 * commands flow browser → authenticated API → permission + state checks → adapter.
 * Flight-control credentials (if any) live only in server-side configuration.
 */
export interface DroneAdapter {
  kind: AdapterKind;
  configured: boolean;
  note: string;
  command(droneId: number, cmd: DroneCommand): CommandResult;
}

export function simulatorAdapter(sim: Simulator): DroneAdapter {
  return {
    kind: 'simulator',
    configured: true,
    note: 'Built-in flight simulator. No hardware is ever contacted.',
    command: (droneId, cmd) => sim.applyCommand(droneId, cmd),
  };
}

/**
 * Placeholder for real autopilot integrations (MAVLink v2 / PX4 / ArduPilot / vendor SDK).
 * Deliberately refuses all commands. A real implementation must be developed against the
 * aircraft's approved SDK, bench-tested with SITL, and signed off before this is replaced.
 */
function hardwareAdapter(kind: AdapterKind, label: string): DroneAdapter {
  return {
    kind,
    configured: false,
    note: `${label} integration not configured. Commands are refused; fly via the approved ground controller.`,
    command: () => ({ ok: false, reason: 'adapter_not_configured' }),
  };
}

export function buildAdapters(sim: Simulator): Record<AdapterKind, DroneAdapter> {
  return {
    simulator: simulatorAdapter(sim),
    mavlink: hardwareAdapter('mavlink', 'MAVLink v2'),
    px4: hardwareAdapter('px4', 'PX4'),
    ardupilot: hardwareAdapter('ardupilot', 'ArduPilot'),
    vendor_sdk: hardwareAdapter('vendor_sdk', 'Manufacturer SDK'),
  };
}
