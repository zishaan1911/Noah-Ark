import type { Mission, SosRequest } from '@contracts';
import { newId } from './ids';
import { validateMission, validateSosRequest } from './validate';

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** The JSON object in copied text: a bare object or one inside a ```json block. */
function objectFromText(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** LLMs often get the id and the clock wrong; fix those before validating. */
function repairIdentity(obj: Record<string, unknown>, prefix: 'msn' | 'sos'): void {
  if (typeof obj.id !== 'string' || !new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`).test(obj.id)) {
    obj.id = newId(prefix);
  }
  if (typeof obj.createdAt !== 'string' || Number.isNaN(Date.parse(obj.createdAt))) {
    obj.createdAt = new Date().toISOString();
  }
}

/**
 * The mission JSON from the PartyRock dispatch app (partyrock/noah-ark-dispatch.md, widget 13), found in copied
 * text: a bare object or one inside a ```json block. Returns null for text that holds no valid mission.
 */
export function missionFromText(text: string): Mission | null {
  const obj = objectFromText(text);
  if (!obj) return null;
  repairIdentity(obj, 'msn');
  const lines: unknown = obj.payload;
  if (
    Array.isArray(lines) &&
    lines.every((p) => typeof (p as { weightKg?: unknown })?.weightKg === 'number')
  ) {
    const sum = round3((lines as { weightKg: number }[]).reduce((s, p) => s + p.weightKg, 0));
    if (typeof obj.payloadKg !== 'number' || Math.abs(sum - obj.payloadKg) > 0.01) obj.payloadKg = sum;
  }
  return validateMission(obj).ok ? (obj as unknown as Mission) : null;
}

/** The SOS request JSON from the PartyRock SOS app; only a triaged one is useful to dispatch. */
export function sosFromText(text: string): SosRequest | null {
  const obj = objectFromText(text);
  if (!obj) return null;
  repairIdentity(obj, 'sos');
  if (!validateSosRequest(obj).ok) return null;
  const sos = obj as unknown as SosRequest;
  return sos.triage ? sos : null;
}
