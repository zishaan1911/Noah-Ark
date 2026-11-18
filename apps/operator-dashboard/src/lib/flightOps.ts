import type { DroneCommand, DroneEvent, Mission } from '@contracts';
import type { DroneApi } from '../hooks/useDrone';
import { buildCommand } from './commands';
import { haversineKm } from './geo';
import type { Point } from './types';
import { validateCommand } from './validate';

export type StepId = 'position' | 'upload' | 'start';
export type StepStatus = 'pending' | 'active' | 'done' | 'failed';

const NEAR_M = 50;
const POSITION_TIMEOUT_MS = 120_000;
const ACK_TIMEOUT_MS = 20_000;

const nearStart = (start: Point, p: Point) => haversineKm(start, p) * 1000 <= NEAR_M;

/** Validate a command against its schema, publish it (QoS 1) and wait for the drone's command_ack. */
export async function sendCommand(drone: DroneApi, cmd: DroneCommand): Promise<DroneEvent> {
  const v = validateCommand(cmd);
  if (!v.ok) throw new Error(`Refusing to send an invalid command: ${v.errors.join('; ')}`);
  await drone.publish(`ark/${cmd.droneId}/cmd`, cmd, 1);
  const ack = await drone
    .waitFor((s) => s.events.find((e) => e.type === 'command_ack' && e.commandId === cmd.id), ACK_TIMEOUT_MS)
    .catch(() => {
      throw new Error(`No acknowledgement from ${cmd.droneId} within ${ACK_TIMEOUT_MS / 1000} s`);
    });
  if (!ack.accepted) throw new Error(ack.message ?? `${cmd.droneId} refused ${cmd.type}`);
  return ack;
}

/**
 * The send flow: put the simulated drone at the start if needed, upload the mission, then start it.
 * `onStep` reports progress; the first failure throws after marking its step failed.
 */
export async function sendMission(
  drone: DroneApi,
  droneId: string,
  mission: Mission,
  onStep: (step: StepId, status: StepStatus, detail?: string) => void,
): Promise<void> {
  const start: Point = mission.origin;
  let current: StepId = 'position';
  try {
    onStep('position', 'active');
    // Fail fast: no point waiting two minutes for a sim that is not there.
    if (drone.conn !== 'connected') throw new Error('Broker not connected.');
    const snap = drone.snapshot();
    if (!snap.sim)
      throw new Error('Simulation not running. Start it with `docker compose up` at the repo root.');
    if (snap.sim.state === 'error') throw new Error(snap.sim.detail ?? 'The simulation reported an error');
    // Where the drone really is decides, not where the sim last spawned it: after a delivery it sits elsewhere.
    const placed =
      snap.sim?.state === 'ready' && snap.telemetry !== null && nearStart(start, snap.telemetry.position);
    if (!placed) {
      await drone.publish(`sim/${droneId}/spawn`, { lat: start.lat, lon: start.lon }, 1);
      await drone.waitFor((s) => {
        if (s.sim?.state === 'error') throw new Error(s.sim.detail ?? 'The simulation reported an error');
        const ready = s.sim?.state === 'ready' && nearStart(start, s.sim);
        return ready && s.telemetry && nearStart(start, s.telemetry.position) ? true : undefined;
      }, POSITION_TIMEOUT_MS);
    }
    onStep('position', 'done');

    current = 'upload';
    onStep('upload', 'active');
    await sendCommand(drone, buildCommand('upload_mission', droneId, mission));
    onStep('upload', 'done');

    current = 'start';
    onStep('start', 'active');
    await sendCommand(drone, buildCommand('start', droneId));
    onStep('start', 'done');
  } catch (err) {
    onStep(current, 'failed', err instanceof Error ? err.message : String(err));
    throw err;
  }
}
