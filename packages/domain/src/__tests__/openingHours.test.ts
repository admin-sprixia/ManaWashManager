import { describe, expect, it } from 'vitest';
import { formatClock, formatOffDays, hoursSummary, isValidClock, offDaysOf, parseOffDays } from '../openingHours';

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
  it('can be closed on several days', () => {
    const weekend = { opensAt: '08:00', closesAt: '20:00', weeklyOff: 0, weeklyOffDays: [6, 0] };
    expect(hoursSummary(weekend)).toBe('8 am – 8 pm · closed Sundays and Saturdays');
  });
  it('stores closed days as a sorted list', () => {
    expect(formatOffDays([6, 0, 6])).toBe('0,6');
    expect(formatOffDays([])).toBeNull();
    expect(parseOffDays('0,6')).toEqual([0, 6]);
    expect(parseOffDays('9,x')).toEqual([]);
    expect(offDaysOf({ weeklyOff: 2 })).toEqual([2]);
  });
});
