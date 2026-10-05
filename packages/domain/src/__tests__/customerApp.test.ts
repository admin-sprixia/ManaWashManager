import { describe, expect, it } from 'vitest';
import {
  canRateWash,
  formatClock,
  hoursSummary,
  isValidClock,
  isValidRegistration,
  liveStatusText,
  normalizeRegistration,
  openState,
  referralShareMessage,
} from '../customerApp';

/** An instant at this IST wall-clock time. 2026-10-05 is a Monday. */
const ist = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);

describe('registration numbers', () => {
  it('normalises the way New Wash stores them', () => {
    expect(normalizeRegistration(' ap 39 ab 1234 ')).toBe('AP39AB1234');
  });
  it('accepts plates and refuses junk', () => {
    expect(isValidRegistration('AP39AB1234')).toBe(true);
    expect(isValidRegistration('22BH1234AA')).toBe(true);
    expect(isValidRegistration('AB')).toBe(false);
    expect(isValidRegistration('AP39/AB')).toBe(false);
  });
});

describe('rating window', () => {
  const paidAt = new Date('2026-10-01T10:00:00Z');
  it('allows paid washes for 14 days', () => {
    expect(canRateWash({ status: 'paid', paidAt, now: new Date('2026-10-15T09:00:00Z') })).toBe(true);
    expect(canRateWash({ status: 'paid', paidAt, now: new Date('2026-10-15T11:00:00Z') })).toBe(false);
  });
  it('refuses washes not paid yet', () => {
    expect(canRateWash({ status: 'ready', paidAt: null, now: paidAt })).toBe(false);
  });
});

describe('opening hours', () => {
  const hours = { opensAt: '08:00', closesAt: '20:30', weeklyOff: 2 };
  it('formats times', () => {
    expect(formatClock('08:00')).toBe('8 am');
    expect(formatClock('20:30')).toBe('8:30 pm');
    expect(formatClock('12:00')).toBe('12 pm');
    expect(formatClock('00:15')).toBe('12:15 am');
    expect(isValidClock('24:00')).toBe(false);
  });
  it('summarises the week', () => {
    expect(hoursSummary(hours)).toBe('8 am – 8:30 pm · closed Tuesdays');
    expect(hoursSummary({ ...hours, weeklyOff: null })).toBe('8 am – 8:30 pm · every day');
    expect(hoursSummary({ opensAt: null, closesAt: null, weeklyOff: null })).toBeNull();
  });
  it('knows when it is open, in IST', () => {
    expect(openState(hours, ist('2026-10-05', '10:00'))).toEqual({ kind: 'open', label: 'Open now · till 8:30 pm' });
    expect(openState(hours, ist('2026-10-05', '07:00'))).toEqual({ kind: 'closed', label: 'Closed · opens 8 am' });
  });
  it('mentions tomorrow’s day off after closing', () => {
    expect(openState(hours, ist('2026-10-05', '21:00'))).toEqual({ kind: 'closed', label: 'Closed · Tuesday off' });
    expect(openState(hours, ist('2026-10-07', '21:00'))).toEqual({
      kind: 'closed',
      label: 'Closed · opens 8 am tomorrow',
    });
  });
  it('is closed all day on the day off', () => {
    expect(openState(hours, ist('2026-10-06', '07:00'))).toEqual({
      kind: 'closed',
      label: 'Closed today (Tuesday off)',
    });
    expect(openState(hours, ist('2026-10-06', '12:00')).kind).toBe('closed');
  });
  it('is unknown without hours', () => {
    expect(openState({ opensAt: null, closesAt: null, weeklyOff: null }, new Date())).toEqual({ kind: 'unknown' });
  });
});

describe('live status', () => {
  it('counts vehicles ahead', () => {
    expect(liveStatusText('waiting', 0).body).toBe('Your vehicle is next.');
    expect(liveStatusText('waiting', 1).body).toBe('1 vehicle ahead of yours.');
    expect(liveStatusText('waiting', 3).body).toBe('3 vehicles ahead of yours.');
    expect(liveStatusText('ready', 0).title).toBe('Ready for pickup');
  });
});

describe('referral message', () => {
  it('names the branch and the number to give', () => {
    const text = referralShareMessage({ phone: '9876543210', city: 'Nellore' });
    expect(text).toContain('MANA Car Wash, Nellore');
    expect(text).toContain('9876543210');
  });
});
