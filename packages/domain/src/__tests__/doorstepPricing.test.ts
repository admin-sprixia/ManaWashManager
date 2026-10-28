import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOORSTEP_RULES,
  communityJoin,
  communityPrice,
  doorstepRulesProblem,
  joinDiscountProblem,
  joinWords,
  parseJoinDiscountBp,
  lessDiscount,
  parseDoorstepRules,
  roadKm,
  roundUpTo9,
  visitCharge,
} from '../doorstepPricing';
import { listPrice } from '../serviceNetwork';

// A ₹49 visit fee keeps the sums below easy; the default is ₹99. 3 km free, ₹10/km, up to 15 km, ends in 9.
const r = { ...DEFAULT_DOORSTEP_RULES, visitFeePaise: 4900 };
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
    expect(parseDoorstepRules('{"visitFeePaise": -1}')).toEqual(DEFAULT_DOORSTEP_RULES);
    expect(parseDoorstepRules('not json')).toEqual(DEFAULT_DOORSTEP_RULES);
    expect(parseDoorstepRules(JSON.stringify({ ...r, perKmPaise: 1500 })).perKmPaise).toBe(1500);
  });
});

describe('doorstep default', () => {
  it('charges ₹99 a visit, so one car at home costs more than at a community', () => {
    expect(DEFAULT_DOORSTEP_RULES.visitFeePaise).toBe(9900);
    expect(visitCharge(2, DEFAULT_DOORSTEP_RULES, wed10).total).toBe(9900);
  });
});

const rule = (percentBp: number, fixedPaise = 0, minExtraPaise = 0) => [
  { mode: 'doorstep' as const, classKey: null, percentBp, fixedPaise, minExtraPaise },
];
const community = (base: number, adjustments: ReturnType<typeof rule>, zonePercentBp = 0) =>
  listPrice({ base, mode: 'doorstep', classKey: 'car', adjustments, zonePercentBp, roundToPaise: 100 }).price;

describe('community price', () => {
  it('is the hub price plus the markup, ending in 9', () => {
    expect(community(49900, rule(1000))).toBe(54900); // ₹548.90 → ₹549
    expect(community(29900, rule(1000))).toBe(32900); // ₹328.90 → ₹329
    expect(community(79900, rule(1000))).toBe(87900); // ₹878.90 → ₹879
    expect(community(50000, rule(1000))).toBe(55900); // ₹550 → ₹559
  });

  it('is the hub price with no rule, and never less than it under an old discount rule', () => {
    expect(community(49900, [])).toBe(49900);
    expect(community(49900, rule(-1000))).toBe(49900);
    expect(community(49900, rule(0, -5000))).toBe(49900);
  });
});

describe('neighbours discount', () => {
  it('takes 1% off for every tenth of the flats that joins, up to 10%', () => {
    expect(communityJoin(0, 10, 1000)).toMatchObject({ discountBp: 0, next: { flats: 1, discountBp: 100 } });
    expect(communityJoin(1, 10, 1000).discountBp).toBe(100);
    expect(communityJoin(5, 10, 1000).discountBp).toBe(500);
    expect(communityJoin(7, 10, 1000)).toMatchObject({ discountBp: 700, next: { flats: 1, discountBp: 800 } });
    expect(communityJoin(10, 10, 1000)).toMatchObject({ discountBp: 1000, next: null });
  });

  it('counts the share of flats, so small and big communities are treated alike', () => {
    expect(communityJoin(50, 100, 1000).discountBp).toBe(500);
    expect(communityJoin(59, 100, 1000).discountBp).toBe(500);
    expect(communityJoin(60, 100, 1000).discountBp).toBe(600);
    // 7 flats: each one is 14%, so the first flat gives 1% and the next needs one more flat.
    expect(communityJoin(1, 7, 1000)).toMatchObject({ discountBp: 100, next: { flats: 1, discountBp: 200 } });
    expect(communityJoin(7, 7, 1000).discountBp).toBe(1000);
    // 4 flats: one flat is 25%, two steps at once.
    expect(communityJoin(0, 4, 1000).next).toEqual({ flats: 1, discountBp: 200 });
  });

  it('gives nothing without flats on the list, and never counts more flats than there are', () => {
    expect(communityJoin(3, 0, 1000)).toMatchObject({ discountBp: 0, next: null });
    expect(communityJoin(15, 10, 1000)).toMatchObject({ joined: 10, discountBp: 1000 });
    expect(communityJoin(5, 10, 0)).toMatchObject({ discountBp: 0, next: null });
    expect(communityJoin(5, 10, 2000).discountBp).toBe(1000);
  });

  it('never takes the price below the hub price', () => {
    // Hub ₹499, community ₹549.
    expect(communityPrice(54900, 49900, 0)).toBe(54900);
    expect(communityPrice(54900, 49900, 500)).toBe(52200);
    expect(communityPrice(54900, 49900, 800)).toBe(50500);
    expect(communityPrice(54900, 49900, 900)).toBe(50000);
    expect(communityPrice(54900, 49900, 1000)).toBe(49900); // ₹494 → held at the hub price
    expect(communityPrice(54900, 49900, 2000)).toBe(49900);
    // Not sold at the shop: nothing to hold it to.
    expect(communityPrice(54900, null, 1000)).toBe(49400);
    expect(lessDiscount(199900, 1000)).toBe(179900);
  });

  it('checks and reads the setting', () => {
    expect(joinDiscountProblem(1000)).toBeNull();
    expect(joinDiscountProblem(0)).toBeNull();
    expect(joinDiscountProblem(2500)).toMatch(/20%/);
    expect(joinDiscountProblem(150)).toMatch(/whole/);
    expect(parseJoinDiscountBp(null)).toBe(1000);
    expect(parseJoinDiscountBp('500')).toBe(500);
    expect(parseJoinDiscountBp('nonsense')).toBe(1000);
  });
});

describe('neighbours discount in words', () => {
  it('says how many flats wash with us and what the next flats bring', () => {
    expect(joinWords(communityJoin(7, 10, 1000))).toEqual({
      now: '7 of 10 flats wash with us: 7% off every price here.',
      next: '1 more flat → 8% off for everyone.',
    });
    expect(joinWords(communityJoin(10, 10, 1000))).toEqual({ now: '10 of 10 flats wash with us: 10% off every price here.', next: null });
    expect(joinWords(communityJoin(0, 20, 1000))?.now).toMatch(/Be the first of 20 flats/);
    expect(joinWords(communityJoin(0, 0, 1000))).toBeNull();
    expect(joinWords(null)).toBeNull();
  });
});
