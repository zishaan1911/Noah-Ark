import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

// Every schema file, registered by its file name so refs like `common.schema.json#/$defs/geo` resolve.
const files = import.meta.glob<Record<string, unknown>>('@schemas/*.schema.json', {
  eager: true,
  import: 'default',
});

// strict off: the shared schemas use if/then/else without a `type` next to it.
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const [path, schema] of Object.entries(files)) {
  const name = path.split('/').pop() ?? path;
  ajv.addSchema({ ...schema, $id: name });
}

function validator(name: string) {
  return (value: unknown): ValidationResult => {
    const fn = ajv.getSchema(name);
    if (!fn) return { ok: false, errors: [`Schema ${name} is not loaded`] };
    if (fn(value)) return { ok: true, errors: [] };
    const errors = (fn.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`);
    return { ok: false, errors };
  };
}

export const validateCommand = validator('drone-command.schema.json');
export const validateTelemetry = validator('telemetry.schema.json');
export const validateEvent = validator('drone-event.schema.json');
export const validateManual = validator('manual-control.schema.json');
export const validateWeather = validator('weather.schema.json');
const validateMissionSchema = validator('mission.schema.json');

/** Schema check plus the rule the schema cannot state: payloadKg equals the sum of the payload lines. */
export function validateMission(value: unknown): ValidationResult {
  const result = validateMissionSchema(value);
  if (!result.ok) return result;
  const m = value as { payload: { weightKg: number }[]; payloadKg: number };
  const sum = m.payload.reduce((s, p) => s + p.weightKg, 0);
  if (Math.abs(sum - m.payloadKg) > 0.01) {
    return {
      ok: false,
      errors: [`/payloadKg ${m.payloadKg} does not equal the payload sum ${sum.toFixed(3)}`],
    };
  }
  return result;
}
