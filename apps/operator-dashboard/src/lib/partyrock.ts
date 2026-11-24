import type { Mission } from '@contracts';
import { validateMission } from './validate';

/**
 * The mission JSON from the PartyRock dispatch app (partyrock/noah-ark-dispatch.md, widget 13), found in copied
 * text: a bare object or one inside a ```json block. Returns null for text that holds no valid mission.
 */
export function missionFromText(text: string): Mission | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  return validateMission(value).ok ? (value as Mission) : null;
}
