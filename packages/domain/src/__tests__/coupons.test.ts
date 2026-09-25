import { describe, expect, it } from 'vitest';
import {
  COUPON_CODE_PATTERN,
  couponDiscount,
  daysBetween,
  generateCouponCode,
  isCouponExpired,
  normalizeCouponCode,
  pickCouponPercent,
  reminderBucket,
} from '../coupons';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('reminderBucket', () => {
  it('is quiet before 10 days, due from 10, comeback from 30', () => {
    expect(reminderBucket(0)).toBeNull();
    expect(reminderBucket(9)).toBeNull();
    expect(reminderBucket(10)).toBe('due');
    expect(reminderBucket(29)).toBe('due');
    expect(reminderBucket(30)).toBe('comeback');
    expect(reminderBucket(120)).toBe('comeback');
  });
});

describe('daysBetween', () => {
  it('floors partial days', () => {
    const from = new Date('2026-09-01T10:00:00Z');
    expect(daysBetween(from, new Date('2026-09-11T09:59:59Z'))).toBe(9);
    expect(daysBetween(from, new Date('2026-09-11T10:00:00Z'))).toBe(10);
  });
});

describe('generateCouponCode', () => {
  it('uses the plate digits and an unambiguous random suffix', () => {
    const code = generateCouponCode('KA01AB1234', bytes(0, 1, 2, 3, 30, 31));
    expect(code).toBe('MANA-1234-ABCD89');
    expect(code).toMatch(COUPON_CODE_PATTERN);
  });

  it('never emits look-alike characters', () => {
    for (let b = 0; b < 256; b++) {
      const code = generateCouponCode('TS07GH9561', new Uint8Array(6).fill(b));
      expect(code.slice(10)).not.toMatch(/[01IO]/);
      expect(code).toMatch(COUPON_CODE_PATTERN);
    }
  });

  it('pads short plates and rejects too little randomness', () => {
    expect(generateCouponCode('AB12', bytes(0, 0, 0, 0, 0, 0))).toBe('MANA-AB12-AAAAAA');
    expect(() => generateCouponCode('KA01AB1234', bytes(1, 2))).toThrow();
  });
});

describe('pickCouponPercent', () => {
  it('maps bytes onto 5–10 inclusive', () => {
    expect(pickCouponPercent(bytes(0))).toBe(5);
    expect(pickCouponPercent(bytes(5))).toBe(10);
    expect(pickCouponPercent(bytes(6))).toBe(5);
    expect(pickCouponPercent(bytes(251))).toBe(10);
  });

  it('rejects biased bytes and moves on', () => {
    expect(pickCouponPercent(bytes(252, 255, 2))).toBe(7);
    expect(pickCouponPercent(bytes(252, 253))).toBeNull();
  });

  it('covers every value evenly', () => {
    const counts = new Map<number, number>();
    for (let b = 0; b < 252; b++) {
      const p = pickCouponPercent(bytes(b))!;
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    expect([...counts.keys()].sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(new Set(counts.values())).toEqual(new Set([42]));
  });
});

describe('couponDiscount', () => {
  it('rounds down to whole rupees', () => {
    expect(couponDiscount(55000, 8)).toBe(4400);
    expect(couponDiscount(35000, 7)).toBe(2400); // ₹24.50 → ₹24
    expect(couponDiscount(12000, 5)).toBe(600);
    expect(couponDiscount(0, 10)).toBe(0);
  });
});

describe('codes and expiry', () => {
  it('normalizes typed codes', () => {
    expect(normalizeCouponCode(' mana-1234-abcd89 ')).toBe('MANA-1234-ABCD89');
  });

  it('treats the expiry instant itself as expired', () => {
    const at = new Date('2026-10-09T00:00:00Z');
    expect(isCouponExpired(at, new Date('2026-10-08T23:59:59Z'))).toBe(false);
    expect(isCouponExpired(at, at)).toBe(true);
  });
});
