import { describe, expect, it } from 'vitest';
import { packWashProblem, parsePlanSoldAt, planLastDay, planPack, planUseBy, shopPlanProblem, soldAtCommunities, soldAtShop } from '../washPlans';

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
