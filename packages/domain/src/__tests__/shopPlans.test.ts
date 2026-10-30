import { describe, expect, it } from 'vitest';
import { buildPlan, builtPlanTitle, packWashProblem, parsePlanSoldAt, planLastDay, planPack, planUseBy, shopPlanProblem, soldAtCommunities, soldAtShop } from '../washPlans';

describe('plans at the shop', () => {
  it('knows where a plan is sold', () => {
    expect(parsePlanSoldAt(null)).toBe('community');
    expect(parsePlanSoldAt('both')).toBe('both');
    expect(soldAtShop('both') && soldAtCommunities('both')).toBe(true);
    expect(soldAtShop('community')).toBe(false);
    expect(soldAtCommunities('shop')).toBe(false);
  });

  it('runs for its months, less a day', () => {
    expect(planLastDay('2026-10-18', 1)).toBe('2026-11-17');
    expect(planLastDay('2026-10-18', 3)).toBe('2027-01-17');
    expect(planLastDay('2026-01-01', 12)).toBe('2026-12-31');
    // Sold on 31 Jan for a month: until the end of February.
    expect(planLastDay('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('pays for one wash a day, until it ends or runs out', () => {
    const plan = { status: 'active', washesUsed: 1, washesTotal: 4, endsOn: '2026-11-17' };
    expect(shopPlanProblem(plan, '2026-10-20', false)).toBeNull();
    expect(shopPlanProblem(plan, '2026-10-20', true)).toMatch(/one wash a day/);
    // A week's grace after its last day for any wash still left.
    expect(planUseBy('2026-11-17')).toBe('2026-11-24');
    expect(shopPlanProblem(plan, '2026-11-18', false)).toBeNull();
    expect(shopPlanProblem(plan, '2026-11-24', false)).toBeNull();
    expect(shopPlanProblem(plan, '2026-11-25', false)).toMatch(/ended/);
    expect(shopPlanProblem({ ...plan, washesUsed: 4 }, '2026-10-20', false)).toMatch(/used/);
    expect(shopPlanProblem({ ...plan, status: 'void' }, '2026-10-20', false)).toMatch(/cancelled/);
  });

  it('is a pack: everyday and better washes, each counted on its own', () => {
    // Express + Premium: 3 Express + 1 Premium; the Premium used first.
    const pack = planPack({ washesTotal: 4, washesUsed: 1, upgradesTotal: 1, upgradesUsed: 1 });
    expect(pack).toEqual({ everydayLeft: 3, betterLeft: 0, left: 3 });
    const names = { base: 'Express Wash', upgrade: 'Premium Wash' };
    expect(packWashProblem(pack, 'base', names)).toBeNull();
    expect(packWashProblem(pack, 'upgrade', names)).toBe('No Premium Wash left on this plan.');
    const onlyBetter = planPack({ washesTotal: 4, washesUsed: 3, upgradesTotal: 1, upgradesUsed: 0 });
    expect(packWashProblem(onlyBetter, 'base', names)).toBe('No Express Wash left on this plan: use its Premium Wash.');
    expect(packWashProblem(onlyBetter, 'upgrade', { base: 'Express Wash', upgrade: null })).toBe('This plan has no better wash.');
  });
});

describe('build your own plan', () => {
  // SUV / 7-seater: Express ₹419, Basic ₹799, Premium ₹1,399.
  const E = { id: 'ex', price: 41900 };
  const B = { id: 'ba', price: 79900 };
  const P = { id: 'pr', price: 139900 };

  it('a month: the 4 washes added up, less 8%, ending in 9', () => {
    expect(buildPlan([E, E, E, P], 1)).toEqual({
      washes: [{ id: 'ex', count: 3 }, { id: 'pr', count: 1 }],
      washesTotal: 4,
      months: 1,
      price: 243900,
      listPrice: 265600,
    });
    // 2 Express + 1 Basic + 1 Premium: ₹3,036 one by one.
    expect(buildPlan([B, E, E, P], 1).price).toBe(278900);
  });

  it('3 months: 3 months’ price and the cheapest wash once more, free', () => {
    const p = buildPlan([E, E, E, P], 3);
    expect(p.washes).toEqual([{ id: 'ex', count: 10 }, { id: 'pr', count: 3 }]);
    expect([p.washesTotal, p.months, p.price]).toEqual([13, 3, 731700]);
  });

  it('12 months: 12 months’ price for 13 months of washes', () => {
    const p = buildPlan([E, B, B, P], 12);
    expect([p.washesTotal, p.months]).toEqual([52, 13]);
    expect(p.washes).toEqual([{ id: 'ex', count: 13 }, { id: 'ba', count: 26 }, { id: 'pr', count: 13 }]);
  });

  it('needs exactly 4 washes', () => {
    expect(() => buildPlan([E, E, P], 1)).toThrow(/4 washes/);
  });
  it('names a built plan by its month', () => {
    const month = [{ name: 'Express Wash', count: 2 }, { name: 'Basic Wash', count: 1 }, { name: 'Bike Premium Wash', count: 1 }];
    expect(builtPlanTitle(month, 1)).toBe('Custom plan · 2 Express + 1 Basic + 1 Premium');
    expect(builtPlanTitle(month, 3)).toBe('Custom plan · 2 Express + 1 Basic + 1 Premium · 3 months');
  });
});
