import { describe, expect, it } from 'vitest';
import {
  addDaysTo,
  clusterPoints,
  compareUnits,
  dayDiff,
  describeWashDays,
  formatDay,
  isDay,
  isDueOn,
  isPlaceCode,
  isSlotDay,
  istDay,
  istInstant,
  joinDecision,
  nextWashDays,
  parseMemberChecks,
  parseUnitList,
  parseWashDays,
  placeCodeFrom,
  predictedLastWash,
  unitLabel,
  unitTitle,
  upcomingWashes,
  weekdayOf,
  type ScheduleInput,
} from '../places';

// 6 Oct 2026 is a Tuesday.
const TUE = '2026-10-06';

describe('IST days', () => {
  it('turns over at IST midnight, not UTC', () => {
    expect(istDay(new Date('2026-10-06T18:29:59Z'))).toBe('2026-10-06');
    expect(istDay(new Date('2026-10-06T18:30:00Z'))).toBe('2026-10-07');
  });

  it('adds and counts days across months and years', () => {
    expect(addDaysTo('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDaysTo('2026-03-01', -1)).toBe('2026-02-28');
    expect(dayDiff('2026-12-30', '2027-01-02')).toBe(3);
    expect(dayDiff('2027-01-02', '2026-12-30')).toBe(-3);
  });

  it('knows weekdays and IST clock times', () => {
    expect(weekdayOf(TUE)).toBe(2);
    expect(istInstant(TUE, '20:00').toISOString()).toBe('2026-10-06T14:30:00.000Z');
    expect(formatDay(TUE)).toBe('Tue 6 Oct');
  });

  it('validates days', () => {
    expect(isDay('2026-02-28')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('6-10-2026')).toBe(false);
  });
});

describe('wash days', () => {
  it('parses, de-duplicates and sorts Monday first', () => {
    expect(parseWashDays('5,2,2,x,9,0')).toEqual([2, 5, 0]);
    expect(parseWashDays('')).toEqual([]);
    expect(parseWashDays(null)).toEqual([]);
  });

  it('describes them in plain words', () => {
    expect(describeWashDays([2])).toBe('Tuesdays');
    expect(describeWashDays([5, 2])).toBe('Tuesdays and Fridays');
    expect(describeWashDays([1, 3, 5])).toBe('Mon, Wed and Fri');
  });

  it('gives a weekly plan the first wash day of each week', () => {
    expect(isSlotDay([2, 5], 1, TUE)).toBe(true);
    expect(isSlotDay([2, 5], 1, '2026-10-09')).toBe(false);
    expect(isSlotDay([2, 5], 2, '2026-10-09')).toBe(true);
    expect(isSlotDay([2, 5], 1, '2026-10-07')).toBe(false);
  });

  it('lists the next wash days', () => {
    expect(nextWashDays([2, 5], TUE, 3)).toEqual(['2026-10-06', '2026-10-09', '2026-10-13']);
    expect(nextWashDays([], TUE, 3)).toEqual([]);
  });
});

describe('a vehicle’s schedule', () => {
  const base: ScheduleInput = { washDays: [2], perWeek: 1, startsOn: '2026-10-13', remaining: 4 };

  it('starts on the first wash and gives the washes left', () => {
    expect(upcomingWashes(base, TUE, 10)).toEqual(['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03']);
    expect(predictedLastWash(base, TUE)).toBe('2026-11-03');
  });

  it('moves past skipped days and pauses, so nothing is lost', () => {
    const input: ScheduleInput = {
      ...base,
      taken: new Set(['2026-10-20']),
      pauses: [{ fromOn: '2026-10-25', toOn: '2026-11-05' }],
    };
    expect(upcomingWashes(input, TUE, 10)).toEqual(['2026-10-13', '2026-11-10', '2026-11-17', '2026-11-24']);
    expect(isDueOn(input, '2026-10-20')).toBe(false);
    expect(isDueOn(input, '2026-11-10')).toBe(true);
  });

  it('has nothing to give when no washes are left', () => {
    expect(upcomingWashes({ ...base, remaining: 0 }, TUE, 5)).toEqual([]);
    expect(predictedLastWash({ ...base, remaining: 0 }, TUE)).toBeNull();
  });

  it('a one-time wash takes the very next wash day of any weekday', () => {
    const single: ScheduleInput = { washDays: [2, 5], perWeek: 7, startsOn: '2026-10-07', remaining: 1 };
    expect(upcomingWashes(single, '2026-10-07', 5)).toEqual(['2026-10-09']);
  });
});

describe('joining', () => {
  const rule = { atPlaceMeters: 200, needsApproval: false, unitTaken: false, byStaff: false };

  it('lets people at the place in at once', () => {
    expect(joinDecision({ ...rule, distanceM: 40 })).toEqual({ status: 'active', checks: [] });
  });

  it('asks the team to confirm people far away or without a location', () => {
    expect(joinDecision({ ...rule, distanceM: 2500 })).toEqual({ status: 'pending', checks: ['far_away'] });
    expect(joinDecision({ ...rule, distanceM: null })).toEqual({ status: 'pending', checks: ['far_away'] });
  });

  it('waits for society approval even at the place', () => {
    expect(joinDecision({ ...rule, distanceM: 10, needsApproval: true }).status).toBe('pending');
  });

  it('never stops a join for a flat already used, only flags it', () => {
    expect(joinDecision({ ...rule, distanceM: 10, unitTaken: true })).toEqual({ status: 'active', checks: ['unit_taken'] });
  });

  it('trusts the team at the place', () => {
    expect(joinDecision({ ...rule, distanceM: null, byStaff: true }).status).toBe('active');
  });

  it('counts a member the team adds as confirmed, even where the society must approve', () => {
    expect(joinDecision({ ...rule, distanceM: null, needsApproval: true, byStaff: true })).toEqual({ status: 'active', checks: ['needs_approval'] });
  });

  it('reads stored checks, ignoring unknown ones', () => {
    expect(parseMemberChecks('far_away,bogus,unit_taken')).toEqual(['far_away', 'unit_taken']);
  });
});

describe('flats and houses', () => {
  it('expands ranges and keeps their width', () => {
    expect(parseUnitList('101-103, g1\n001-003')).toEqual(['101', '102', '103', 'G1', '001', '002', '003']);
  });

  it('refuses what it can’t read and huge lists', () => {
    expect(parseUnitList('5-1')).toBeNull();
    expect(parseUnitList('a@b')).toBeNull();
    expect(parseUnitList('1-5000')).toBeNull();
  });

  it('sorts naturally and labels with the block', () => {
    expect(['10', '2', 'G2', 'G1'].sort(compareUnits)).toEqual(['2', '10', 'G1', 'G2']);
    expect(unitLabel('B', '204')).toBe('B · 204');
    expect(unitLabel(null, '204')).toBe('204');
  });

  it('titles a unit without doubling the word', () => {
    expect(unitTitle('House', '14-2')).toBe('House 14-2');
    expect(unitTitle('House', 'H.NO 14-2')).toBe('H.NO 14-2');
    expect(unitTitle('Flat', 'flat 204 ')).toBe('flat 204');
    expect(unitTitle('House', 'Hno 5')).toBe('Hno 5');
  });
});

describe('interest clusters', () => {
  it('groups nearby requests, biggest group first', () => {
    const a = { latitude: 17.385, longitude: 78.4867, id: 'a' };
    const b = { latitude: 17.3851, longitude: 78.4868, id: 'b' }; // ~15 m from a
    const far = { latitude: 17.4, longitude: 78.5, id: 'far' };
    const c = { latitude: 17.3852, longitude: 78.4866, id: 'c' };
    const groups = clusterPoints([far, a, b, c], 250);
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([['a', 'b', 'c'], ['far']]);
    expect(groups[0]!.center).toEqual({ latitude: 17.385, longitude: 78.4867 });
  });
});

describe('place codes', () => {
  it('are made only of unambiguous characters', () => {
    const code = placeCodeFrom([0, 1, 2, 30, 31, 200, 255]);
    expect(code).toHaveLength(7);
    expect(isPlaceCode(code)).toBe(true);
    expect(isPlaceCode('ABCD0O1')).toBe(false);
  });
});
