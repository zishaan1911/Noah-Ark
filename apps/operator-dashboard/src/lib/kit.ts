import type { PayloadItem, SosTriage } from '@contracts';

const MAX_KG = 2;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** A 2 kg relief kit from the triage. The rules follow the PartyRock kit prompt (partyrock/noah-ark-dispatch.md). */
export function kitFor(triage: SosTriage): PayloadItem[] {
  const needs = new Set<string>(triage.needs);
  const conditions = triage.medicalConditions ?? [];
  const hasMedical = needs.has('medicine') || conditions.length > 0;
  const insulin = needs.has('medicine') && conditions.some((c) => /insulin|diabet/i.test(c));
  const lines: [boolean, string, number, number][] = [
    [insulin, 'Insulin in a cold pack', 1, 0.4],
    [needs.has('water'), 'Drinking water 500 ml', 2, 1.04],
    [hasMedical, 'First-aid kit with paracetamol and ORS', 1, 0.3],
    [needs.has('baby_supplies'), 'Baby formula', 1, 0.4],
    [needs.has('food'), 'Ready-to-eat rations', 1, 0.5],
    [needs.has('shelter'), 'Thermal blankets', 2, 0.2],
    [needs.has('rescue'), 'Rescue whistle and light', 1, 0.15],
  ];

  const kit: PayloadItem[] = [];
  let total = 0;
  for (const [wanted, item, qty, weightKg] of lines) {
    if (!wanted || total + weightKg > MAX_KG + 1e-9) continue;
    kit.push({ item, qty, weightKg: round3(weightKg) });
    total += weightKg;
  }
  if (kit.length === 0) kit.push({ item: 'First-aid kit with paracetamol and ORS', qty: 1, weightKg: 0.3 });
  return kit;
}
