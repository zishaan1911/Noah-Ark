import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildCommand, buildMission } from './commands';
import { destinationPoint } from './geo';
import { planRoute } from './planRoute';
import type { Point } from './types';
import { validateCommand, validateMission, validateTelemetry, validateWeather } from './validate';

const examples = (dir: string) =>
  fileURLToPath(new URL(`../../../../shared/examples/${dir}/`, import.meta.url));

function checkExamples(dir: string, validate: (v: unknown) => { ok: boolean; errors: string[] }) {
  describe(`shared/examples/${dir}`, () => {
    for (const file of readdirSync(examples(dir)).filter((f) => f.endsWith('.json'))) {
      const shouldPass = file.startsWith('valid-');
      it(`${file} ${shouldPass ? 'passes' : 'fails'}`, () => {
        const json: unknown = JSON.parse(readFileSync(examples(dir) + file, 'utf8'));
        expect(validate(json).ok).toBe(shouldPass);
      });
    }
  });
}

checkExamples('drone-command', validateCommand);
checkExamples('telemetry', validateTelemetry);
checkExamples('weather', validateWeather);

describe('a planned GDEX mission', () => {
  const start: Point = { lat: 5.7346, lon: 115.9302 };
  const dest = destinationPoint(start, 60, 6500);

  it('passes validateMission, and its upload command passes validateCommand', async () => {
    const res = await planRoute({ start, dest, payloadKg: 1.2, elevationAt: async () => 50 });
    if (!res.ok) throw new Error(res.reason);
    const payload = [{ id: 1, item: 'GDEX parcel', qty: 1, kgEach: 1.2 }];
    const mission = buildMission({ droneId: 'ARK-006', start, dest, plan: res.plan, payload });
    expect(validateMission(mission)).toEqual({ ok: true, errors: [] });

    const upload = buildCommand('upload_mission', 'ARK-006', mission);
    expect(validateCommand(upload).ok).toBe(true);
    expect(validateCommand(buildCommand('start', 'ARK-006')).ok).toBe(true);
    expect(validateCommand({ ...buildCommand('hold', 'ARK-006'), mission }).ok).toBe(false);
  });

  it('rejects a mission whose payloadKg is not the sum of its lines', async () => {
    const res = await planRoute({ start, dest, payloadKg: 1.2, elevationAt: async () => 50 });
    if (!res.ok) throw new Error(res.reason);
    const payload = [{ id: 1, item: 'GDEX parcel', qty: 1, kgEach: 1.2 }];
    const mission = buildMission({ droneId: 'ARK-006', start, dest, plan: res.plan, payload });
    expect(validateMission({ ...mission, payloadKg: 0.5 }).ok).toBe(false);
  });
});
