import { describe, expect, it } from 'vitest';
import {
  canCorrectPayment,
  canVoidJob,
  checkPin,
  isValidPhone,
  MAX_OFFLINE_BACKDATE_MS,
  normalizePhone,
  resolveOccurredAt,
} from '../team';

describe('checkPin', () => {
  it('accepts 4–6 digit non-trivial PINs', () => {
    expect(checkPin('4821')).toBeNull();
    expect(checkPin('190273')).toBeNull();
  });

  it('rejects wrong length or non-digits', () => {
    expect(checkPin('123')).toBe('format');
    expect(checkPin('1234567')).toBe('format');
    expect(checkPin('12a4')).toBe('format');
  });

  it('rejects repeated digits', () => {
    expect(checkPin('0000')).toBe('repeated');
    expect(checkPin('777777')).toBe('repeated');
  });

  it('rejects ascending and descending sequences, including wrap-around', () => {
    expect(checkPin('1234')).toBe('sequence');
    expect(checkPin('6543')).toBe('sequence');
    expect(checkPin('7890')).toBe('sequence');
  });
});

describe('normalizePhone', () => {
  it('strips formatting, +91, and leading zeros', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
    expect(normalizePhone('919876543210')).toBe('9876543210');
    expect(normalizePhone('09876543210')).toBe('9876543210');
    expect(normalizePhone('98765-43210')).toBe('9876543210');
  });

  it('validates Indian mobile numbers', () => {
    expect(isValidPhone('9876543210')).toBe(true);
    expect(isValidPhone('1234567890')).toBe(false);
    expect(isValidPhone('98765')).toBe(false);
  });
});

describe('canVoidJob', () => {
  it('lets anyone void an unpaid job', () => {
    expect(canVoidJob('waiting', 'staff')).toBe(true);
    expect(canVoidJob('ready', 'staff')).toBe(true);
  });

  it('only lets the owner void a paid job', () => {
    expect(canVoidJob('paid', 'staff')).toBe(false);
    expect(canVoidJob('paid', 'owner')).toBe(true);
  });

  it('never voids twice', () => {
    expect(canVoidJob('void', 'owner')).toBe(false);
  });
});

describe('canCorrectPayment', () => {
  it('is owner-only and paid-only', () => {
    expect(canCorrectPayment('paid', 'owner')).toBe(true);
    expect(canCorrectPayment('paid', 'staff')).toBe(false);
    expect(canCorrectPayment('ready', 'owner')).toBe(false);
  });
});

describe('resolveOccurredAt', () => {
  const now = new Date('2026-09-25T10:00:00.000Z');

  it('uses the queued timestamp when it is recent', () => {
    const t = '2026-09-25T09:30:00.000Z';
    expect(resolveOccurredAt(t, now).toISOString()).toBe(t);
  });

  it('falls back to now for missing, invalid, future, or stale timestamps', () => {
    expect(resolveOccurredAt(undefined, now)).toBe(now);
    expect(resolveOccurredAt('garbage', now)).toBe(now);
    expect(resolveOccurredAt('2026-09-25T11:00:00.000Z', now)).toBe(now);
    const stale = new Date(now.getTime() - MAX_OFFLINE_BACKDATE_MS - 1000).toISOString();
    expect(resolveOccurredAt(stale, now)).toBe(now);
  });
});
