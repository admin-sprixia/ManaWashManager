import { describe, expect, it } from 'vitest';
import { BODY_TYPES, PRICE_SIZES, priceSizeOfBody, vehicleTypeKeysFor, type PriceSizeKey } from '../index';

/** The models each size names to customers, as listed: they must really be that size. */
const EXAMPLES: Record<PriceSizeKey, [string, string][]> = {
  small: [['Maruti Suzuki', 'Swift'], ['Hyundai', 'i20'], ['Maruti Suzuki', 'Baleno'], ['Renault', 'Kwid'], ['Mini', 'Cooper']],
  mid: [['Maruti Suzuki', 'Dzire'], ['Honda', 'City'], ['Tata', 'Nexon'], ['Maruti Suzuki', 'Brezza'], ['BMW', '3 Series']],
  large: [['Hyundai', 'Creta'], ['Mahindra', 'XUV700'], ['Toyota', 'Innova'], ['Toyota', 'Fortuner'], ['BMW', 'X5']],
  scooter: [['Honda', 'Activa'], ['TVS', 'Jupiter'], ['Ather', '450X']],
  bike: [['Hero', 'Splendor'], ['Bajaj', 'Pulsar 150'], ['Honda', 'Shine'], ['Royal Enfield', 'Classic 350']],
  bigBike: [['Harley-Davidson', 'Fat Boy'], ['Suzuki', 'Hayabusa']],
};

describe('price sizes', () => {
  it('every example model is the size it is shown under', () => {
    for (const size of PRICE_SIZES) {
      for (const [make, model] of EXAMPLES[size.key]) {
        const key = vehicleTypeKeysFor(make, model)?.[0];
        expect(`${make} ${model}: ${priceSizeOfBody(key)?.key}`).toBe(`${make} ${model}: ${size.key}`);
      }
    }
  });

  it('a size’s body types all share one catalog size, so one price stands for them', () => {
    for (const size of PRICE_SIZES) {
      const sizes = new Set(size.bodyKeys.map((k) => BODY_TYPES.find((b) => b.key === k)?.size));
      // Bikes: the menu prices scooters, bikes, sports bikes and cruisers the same (Regular).
      if (size.category === 'car') expect([size.key, [...sizes]]).toEqual([size.key, [sizes.values().next().value]]);
      expect(size.bodyKeys.every((k) => BODY_TYPES.some((b) => b.key === k))).toBe(true);
    }
  });

  it('no body type is in two sizes', () => {
    const all = PRICE_SIZES.flatMap((s) => s.bodyKeys);
    expect(new Set(all).size).toBe(all.length);
  });
});
