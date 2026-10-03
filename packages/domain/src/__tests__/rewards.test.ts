import { describe, expect, it } from 'vitest';
import {
  addMonths,
  daysUntilReset,
  isRewardEligiblePlate,
  isRewardExpiringSoon,
  isValidStampEvery,
  stampCard,
  stampsToGo,
  type StampVisit,
} from '../rewards';

const at = (iso: string) => new Date(iso);
const paid = (iso: string): StampVisit => ({ at: at(iso), free: false });
const free = (iso: string): StampVisit => ({ at: at(iso), free: true });

/** `n` paid visits a week apart, starting `start`. */
function weekly(start: string, n: number): StampVisit[] {
  return Array.from({ length: n }, (_, i) => ({
    at: new Date(at(start).getTime() + i * 7 * 86_400_000),
    free: false,
  }));
}

describe('addMonths', () => {
  it('adds calendar months in UTC', () => {
    expect(addMonths(at('2026-01-15T10:00:00Z'), 6).toISOString()).toBe('2026-07-15T10:00:00.000Z');
    expect(addMonths(at('2026-09-03T00:00:00Z'), 6).toISOString()).toBe('2027-03-03T00:00:00.000Z');
  });

  it('clamps to the last day of a shorter month', () => {
    expect(addMonths(at('2026-08-31T12:00:00Z'), 6).toISOString()).toBe('2027-02-28T12:00:00.000Z');
    expect(addMonths(at('2027-08-31T12:00:00Z'), 6).toISOString()).toBe('2028-02-29T12:00:00.000Z');
  });
});

describe('stampCard', () => {
  const now = at('2026-10-03T12:00:00Z');

  it('is empty for a car that never had the service', () => {
    expect(stampCard(10, [], now)).toEqual({ stamps: 0, free: 0, lastVisitAt: null, expiresAt: null });
  });

  it('counts one stamp per paid visit', () => {
    const card = stampCard(10, weekly('2026-08-01T10:00:00Z', 7), now);
    expect(card.stamps).toBe(7);
    expect(card.free).toBe(0);
    expect(stampsToGo(10, card)).toBe(3);
  });

  it('turns a full card into one free wash and starts again', () => {
    const card = stampCard(10, weekly('2026-06-01T10:00:00Z', 10), now);
    expect(card).toMatchObject({ stamps: 0, free: 1 });
    expect(card.expiresAt).not.toBeNull();
    const more = stampCard(10, weekly('2026-06-01T10:00:00Z', 13), now);
    expect(more).toMatchObject({ stamps: 3, free: 1 });
  });

  it('lets free washes pile up while the customer keeps them', () => {
    const card = stampCard(3, weekly('2026-08-01T10:00:00Z', 7), now);
    expect(card).toMatchObject({ stamps: 1, free: 2 });
  });

  it('uses a free wash without adding a stamp', () => {
    const visits = [...weekly('2026-07-01T10:00:00Z', 3), free('2026-09-01T10:00:00Z')];
    expect(stampCard(3, visits, now)).toMatchObject({ stamps: 0, free: 0 });
    const after = [...visits, paid('2026-09-10T10:00:00Z')];
    expect(stampCard(3, after, now)).toMatchObject({ stamps: 1, free: 0 });
  });

  it('never goes below zero free washes', () => {
    expect(stampCard(5, [free('2026-09-01T10:00:00Z')], now)).toMatchObject({ stamps: 0, free: 0 });
  });

  it('orders visits by time, whatever order they arrive in', () => {
    const visits = [paid('2026-09-20T10:00:00Z'), free('2026-09-10T10:00:00Z'), paid('2026-09-01T10:00:00Z'), paid('2026-09-05T10:00:00Z')];
    // 2 paid → free, used on the 10th, then one more stamp.
    expect(stampCard(2, visits, now)).toMatchObject({ stamps: 1, free: 0 });
  });

  it('resets when the car skips the service for six months', () => {
    const visits = [...weekly('2025-12-01T10:00:00Z', 4), paid('2026-06-22T10:00:00Z')];
    // Last of the four is 22 Dec 2025; 22 Jun 2026 is six months later to the minute.
    expect(stampCard(10, visits, now)).toMatchObject({ stamps: 1, free: 0 });
  });

  it('keeps the card when the gap is just under six months', () => {
    const visits = [paid('2026-01-10T10:00:00Z'), paid('2026-07-10T09:59:59Z')];
    expect(stampCard(10, visits, now)).toMatchObject({ stamps: 2 });
  });

  it('clears the card, saved free washes included, six months after the last visit', () => {
    const visits = weekly('2026-01-01T10:00:00Z', 10);
    const last = visits[9]!.at;
    const card = stampCard(10, visits, addMonths(last, 6));
    expect(card).toMatchObject({ stamps: 0, free: 0, expiresAt: null });
    expect(card.lastVisitAt).toEqual(last);
    const dayBefore = new Date(addMonths(last, 6).getTime() - 86_400_000);
    expect(stampCard(10, visits, dayBefore)).toMatchObject({ stamps: 0, free: 1 });
  });

  it('reports when the card resets', () => {
    const card = stampCard(10, [paid('2026-09-01T10:00:00Z')], now);
    expect(card.expiresAt?.toISOString()).toBe('2027-03-01T10:00:00.000Z');
  });

  it('has nothing to expire right after a free wash empties the card', () => {
    const visits = [paid('2026-09-01T10:00:00Z'), paid('2026-09-02T10:00:00Z'), free('2026-09-03T10:00:00Z')];
    expect(stampCard(2, visits, now)).toMatchObject({ stamps: 0, free: 0, expiresAt: null });
  });

  it('treats a broken rule as no card', () => {
    expect(stampCard(0, weekly('2026-09-01T10:00:00Z', 3), now)).toMatchObject({ stamps: 0, free: 0 });
  });
});

describe('expiry warnings', () => {
  const expiresAt = at('2026-10-13T12:00:00Z');

  it('rounds the days left up', () => {
    expect(daysUntilReset({ expiresAt }, at('2026-10-03T12:00:00Z'))).toBe(10);
    expect(daysUntilReset({ expiresAt }, at('2026-10-03T12:00:01Z'))).toBe(10);
    expect(daysUntilReset({ expiresAt }, at('2026-10-13T11:00:00Z'))).toBe(1);
    expect(daysUntilReset({ expiresAt: null }, at('2026-10-03T12:00:00Z'))).toBeNull();
  });

  it('warns in the last ten days only', () => {
    expect(isRewardExpiringSoon({ expiresAt }, at('2026-10-02T12:00:00Z'))).toBe(false);
    expect(isRewardExpiringSoon({ expiresAt }, at('2026-10-03T12:00:00Z'))).toBe(true);
    expect(isRewardExpiringSoon({ expiresAt: null }, at('2026-10-03T12:00:00Z'))).toBe(false);
  });
});

describe('rules', () => {
  it('accepts 2 to 100 visits', () => {
    expect(isValidStampEvery(1)).toBe(false);
    expect(isValidStampEvery(2)).toBe(true);
    expect(isValidStampEvery(10)).toBe(true);
    expect(isValidStampEvery(100)).toBe(true);
    expect(isValidStampEvery(101)).toBe(false);
    expect(isValidStampEvery(2.5)).toBe(false);
  });

  it('leaves walk-in plates out', () => {
    expect(isRewardEligiblePlate('KA01AB1234')).toBe(true);
    expect(isRewardEligiblePlate('WALK-IN-1727950000000')).toBe(false);
  });
});
