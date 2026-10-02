import { describe, expect, it } from 'vitest';
import {
  BRANCH_PRICE_PAISE,
  FOUNDER_PRICE_PAISE,
  FOUNDER_SLOTS,
  founderSlotsAhead,
  type FounderClaim,
  PAYMENT_GRACE_DAYS,
  PLAN_LIMITS,
  PRO_PRICE_PAISE,
  planStatus,
  priceKindFor,
  proPricePaise,
} from '../plans';

const now = new Date('2026-10-02T12:00:00Z');
const days = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

describe('planStatus', () => {
  it('is Pro on the trial, counting days left up', () => {
    const s = planStatus({ plan: 'trial', trialEndsAt: days(13.5), paidUntil: null }, now);
    expect(s.tier).toBe('pro');
    expect(s.state).toBe('trial');
    expect(s.daysLeft).toBe(14);
    expect(s.limits).toEqual(PLAN_LIMITS.pro);
  });

  it('drops to Free the moment the trial ends', () => {
    const s = planStatus({ plan: 'trial', trialEndsAt: now, paidUntil: null }, now);
    expect(s.tier).toBe('free');
    expect(s.state).toBe('free');
    expect(s.endsAt).toBeNull();
    expect(s.limits).toEqual(PLAN_LIMITS.free);
  });

  it('prefers a paid period over the trial', () => {
    const s = planStatus({ plan: 'active', trialEndsAt: days(5), paidUntil: days(30) }, now);
    expect(s.state).toBe('pro');
    expect(s.endsAt).toEqual(days(30));
  });

  it('keeps Pro during the payment grace while the subscription retries', () => {
    for (const plan of ['active', 'past_due']) {
      const s = planStatus({ plan, trialEndsAt: null, paidUntil: days(-1) }, now);
      expect(s.state).toBe('grace');
      expect(s.endsAt).toEqual(days(PAYMENT_GRACE_DAYS - 1));
    }
  });

  it('ends a cancelled subscription with its paid period — no grace', () => {
    const s = planStatus({ plan: 'cancelled', trialEndsAt: null, paidUntil: days(-1) }, now);
    expect(s.tier).toBe('free');
  });

  it('falls to Free after the grace runs out', () => {
    const s = planStatus(
      { plan: 'past_due', trialEndsAt: null, paidUntil: days(-PAYMENT_GRACE_DAYS) },
      now,
    );
    expect(s.tier).toBe('free');
  });

  it('is Free with no trial and nothing paid', () => {
    expect(planStatus({ plan: 'free', trialEndsAt: null, paidUntil: null }, now).tier).toBe('free');
  });
});

describe('prices', () => {
  it('gives two months free on yearly and a lower founder price', () => {
    expect(PRO_PRICE_PAISE.yearly).toBeLessThan(PRO_PRICE_PAISE.monthly * 11);
    expect(proPricePaise('monthly', 'founder')).toBe(FOUNDER_PRICE_PAISE.monthly);
    expect(proPricePaise('yearly', 'regular')).toBe(PRO_PRICE_PAISE.yearly);
    expect(proPricePaise('monthly', 'branch')).toBe(BRANCH_PRICE_PAISE.monthly);
    expect(FOUNDER_PRICE_PAISE.monthly).toBeLessThan(PRO_PRICE_PAISE.monthly);
    expect(BRANCH_PRICE_PAISE.yearly).toBeLessThan(PRO_PRICE_PAISE.yearly);
  });

  it('prices founders at ₹399 / ₹3,990 and branches at ₹349 / ₹3,490', () => {
    expect(FOUNDER_PRICE_PAISE).toEqual({ monthly: 39_900, yearly: 399_000 });
    expect(BRANCH_PRICE_PAISE).toEqual({ monthly: 34_900, yearly: 349_000 });
  });

  it('gives the cheapest price that applies, and shop 51 the regular price', () => {
    expect(priceKindFor({ founder: true, founderSlotsLeft: 0, branch: false })).toBe('founder');
    expect(priceKindFor({ founder: true, founderSlotsLeft: 0, branch: true })).toBe('branch');
    expect(priceKindFor({ founder: false, founderSlotsLeft: 10, branch: true })).toBe('branch');
    expect(priceKindFor({ founder: false, founderSlotsLeft: 1, branch: false })).toBe('founder');
    expect(priceKindFor({ founder: false, founderSlotsLeft: 0, branch: false })).toBe('regular');
  });

  describe('the last founder slot', () => {
    const t = (ms: number) => new Date(now.getTime() + ms);
    const founders: FounderClaim[] = Array.from({ length: FOUNDER_SLOTS - 1 }, (_, i) => ({
      id: `paid${i}`,
      founderAt: days(-10),
      holdUntil: null,
      holdAt: null,
    }));
    const hold = (id: string, at: Date): FounderClaim => ({ id, founderAt: null, holdUntil: days(2), holdAt: at });
    /** Each racer, after both have stamped their holds, counts the claims ahead of it. */
    const winners = (racers: FounderClaim[]) =>
      racers.filter((r) => founderSlotsAhead([...founders, ...racers], { id: r.id, holdAt: r.holdAt! }, now) < FOUNDER_SLOTS).map((r) => r.id);

    it('49 taken, two owners hold the 50th at once: the earlier claim wins, the other pays ₹499', () => {
      expect(winners([hold('shopA', t(0)), hold('shopB', t(3))])).toEqual(['shopA']);
      expect(winners([hold('shopA', t(5)), hold('shopB', t(3))])).toEqual(['shopB']);
    });

    it('same millisecond: exactly one wins (lower shop id), never both and never neither', () => {
      expect(winners([hold('shopB', t(0)), hold('shopA', t(0))])).toEqual(['shopA']);
    });

    it('a crowd of eight for the last slot: exactly one wins', () => {
      const crowd = Array.from({ length: 8 }, (_, i) => hold(`crowd${i}`, t(i % 3)));
      expect(winners(crowd)).toHaveLength(1);
    });

    it('lapsed holds don’t count; paid founders always do', () => {
      const lapsed: FounderClaim = { id: 'old', founderAt: null, holdUntil: days(-1), holdAt: days(-3) };
      expect(founderSlotsAhead([...founders, lapsed], { id: 'me', holdAt: now }, now)).toBe(FOUNDER_SLOTS - 1);
    });

    it('50 already paid: nobody new gets one', () => {
      const full = [...founders, { id: 'paid49', founderAt: days(-1), holdUntil: null, holdAt: null }];
      expect(founderSlotsAhead(full, { id: 'me', holdAt: now }, now)).toBe(FOUNDER_SLOTS);
    });
  });

  it('limits Free to 1 staff, 300 washes and 7 days of reports', () => {
    expect(PLAN_LIMITS.free).toEqual({ staff: 1, washesPerMonth: 300, reportDays: 7 });
    expect(PLAN_LIMITS.pro.washesPerMonth).toBeNull();
  });
});
