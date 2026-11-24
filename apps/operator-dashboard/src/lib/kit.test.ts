import type { SosTriage } from '@contracts';
import { describe, expect, it } from 'vitest';
import { kitFor } from './kit';

const total = (t: SosTriage) => kitFor(t).reduce((s, p) => s + p.weightKg, 0);

describe('kitFor', () => {
  it('puts insulin first and stays within 2 kg', () => {
    const triage: SosTriage = {
      urgency: 5,
      needs: ['medicine', 'water'],
      medicalConditions: ['diabetes, insulin finished'],
      summary: 'x',
    };
    expect(kitFor(triage).map((p) => p.item)).toEqual([
      'Insulin in a cold pack',
      'Drinking water 500 ml',
      'First-aid kit with paracetamol and ORS',
    ]);
    expect(total(triage)).toBeLessThanOrEqual(2);
  });

  it('drops lower-priority lines that would overflow', () => {
    const triage: SosTriage = {
      urgency: 3,
      needs: ['water', 'baby_supplies', 'food', 'shelter', 'rescue'],
      summary: 'x',
    };
    const items = kitFor(triage).map((p) => p.item);
    // 1.04 + 0.40 + 0.50 = 1.94 kg; blankets (0.20) and the whistle (0.15) would pass 2 kg.
    expect(items).toEqual(['Drinking water 500 ml', 'Baby formula', 'Ready-to-eat rations']);
    expect(total(triage)).toBeLessThanOrEqual(2);
  });

  it('falls back to the first-aid kit', () => {
    expect(kitFor({ urgency: 1, needs: ['other'], summary: 'x' })).toEqual([
      { item: 'First-aid kit with paracetamol and ORS', qty: 1, weightKg: 0.3 },
    ]);
  });
});
