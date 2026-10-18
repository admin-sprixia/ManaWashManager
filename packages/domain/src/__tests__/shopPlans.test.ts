import { describe, expect, it } from 'vitest';
import { parsePlanSoldAt, planLastDay, shopPlanProblem, soldAtCommunities, soldAtShop } from '../washPlans';

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
    expect(shopPlanProblem(plan, '2026-11-18', false)).toMatch(/ended/);
    expect(shopPlanProblem({ ...plan, washesUsed: 4 }, '2026-10-20', false)).toMatch(/used/);
    expect(shopPlanProblem({ ...plan, status: 'void' }, '2026-10-20', false)).toMatch(/cancelled/);
  });
});
