import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOORSTEP_RULES,
  communityTierFor,
  communityTiersProblem,
  doorstepRulesProblem,
  lessDiscount,
  parseDoorstepRules,
  roadKm,
  roundUpTo9,
  visitCharge,
} from '../doorstepPricing';
import { listPrice } from '../serviceNetwork';

const r = DEFAULT_DOORSTEP_RULES; // ₹49 visit, 3 km free, ₹10/km, up to 15 km, ends in 9
// A Wednesday at 10:00 IST.
const wed10 = new Date('2026-10-14T04:30:00Z');

describe('doorstep visit charge', () => {
  it('is the visit fee within the free distance', () => {
    expect(visitCharge(2, r, wed10).total).toBe(4900);
    expect(visitCharge(3, r, wed10).total).toBe(4900);
  });

  it('adds a charge for each km (or part of one) beyond it, ending in 9', () => {
    // 8 km: ₹49 + 5 × ₹10 = ₹99.
    expect(visitCharge(8, r, wed10).total).toBe(9900);
    // 3.2 km: one started km → ₹59.
    expect(visitCharge(3.2, r, wed10).total).toBe(5900);
    // 12 km: ₹49 + ₹90 = ₹139.
    expect(visitCharge(12, r, wed10).total).toBe(13900);
  });

  it('isn’t offered beyond the furthest distance', () => {
    const far = visitCharge(20, r, wed10);
    expect(far.tooFar).toBe(true);
    expect(far.total).toBe(0);
    expect(visitCharge(15, r, wed10).tooFar).toBe(false);
  });

  it('adds busy-time extras only on their days and hours', () => {
    const rules = { ...r, busy: [{ days: [0], from: '07:00', to: '11:00', extraPaise: 3000 }] };
    const sun9 = new Date('2026-10-18T03:30:00Z'); // Sunday 09:00 IST
    const sun12 = new Date('2026-10-18T06:30:00Z'); // Sunday 12:00 IST
    expect(visitCharge(2, rules, sun9).total).toBe(7900); // ₹49 + ₹30
    expect(visitCharge(2, rules, sun12).total).toBe(4900);
    expect(visitCharge(2, rules, wed10).total).toBe(4900);
  });

  it('can leave the total unrounded', () => {
    expect(visitCharge(5, { ...r, visitFeePaise: 5000, roundTo9: false }, wed10).total).toBe(7000);
  });

  it('rounds up to a price ending in 9', () => {
    expect(roundUpTo9(4800)).toBe(4900);
    expect(roundUpTo9(5000)).toBe(5900);
    expect(roundUpTo9(9900)).toBe(9900);
    expect(roundUpTo9(0)).toBe(0);
  });

  it('turns a straight line into a road distance', () => {
    expect(roadKm(5)).toBe(6.5);
  });

  it('checks the rules and falls back to the defaults when stored ones are broken', () => {
    expect(doorstepRulesProblem(r)).toBeNull();
    expect(doorstepRulesProblem({ ...r, maxKm: 2 })).toMatch(/free distance/);
    expect(doorstepRulesProblem({ ...r, busy: [{ days: [1], from: '11:00', to: '09:00', extraPaise: 100 }] })).toMatch(/end after/);
    expect(parseDoorstepRules('{"visitFeePaise": -1}')).toEqual(r);
    expect(parseDoorstepRules('not json')).toEqual(r);
    expect(parseDoorstepRules(JSON.stringify({ ...r, perKmPaise: 1500 })).perKmPaise).toBe(1500);
  });
});

describe('community pricing', () => {
  it('can be the hub price less a percentage', () => {
    const p = listPrice({
      base: 49900,
      mode: 'doorstep',
      classKey: 'car',
      adjustments: [{ mode: 'doorstep', classKey: null, percentBp: -1000, fixedPaise: 0, minExtraPaise: 0 }],
      zonePercentBp: 0,
      roundToPaise: 100,
    });
    expect(p.price).toBe(44900);
  });

  it('gives bigger communities a bigger discount', () => {
    const tiers = [
      { minCars: 5, discountBp: 500 },
      { minCars: 10, discountBp: 1000 },
    ];
    expect(communityTierFor(tiers, 4)).toBeNull();
    expect(communityTierFor(tiers, 7)?.discountBp).toBe(500);
    expect(communityTierFor(tiers, 25)?.discountBp).toBe(1000);
    expect(lessDiscount(199900, 1000)).toBe(179900);
  });

  it('checks the steps', () => {
    expect(communityTiersProblem([{ minCars: 5, discountBp: 500 }])).toBeNull();
    expect(communityTiersProblem([{ minCars: 1, discountBp: 500 }])).toMatch(/2 cars/);
    expect(communityTiersProblem([{ minCars: 25, discountBp: 1000 }])).toBeNull();
    expect(communityTiersProblem([{ minCars: 50, discountBp: 1500 }])).toMatch(/10%/);
    expect(
      communityTiersProblem([
        { minCars: 5, discountBp: 1000 },
        { minCars: 10, discountBp: 500 },
      ]),
    ).toMatch(/bigger discount/);
  });
});
