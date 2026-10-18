import { describe, expect, it } from 'vitest';
import {
  cleanInspection,
  describeSlot,
  formatInspection,
  formatSlots,
  formatTeam,
  inspectionWarnings,
  missingForReview,
  parseInspection,
  parseSlots,
  parseTeam,
} from '../communities';

describe('inspection', () => {
  it('keeps known answers and drops the rest', () => {
    expect(cleanInspection({ water: 'yes', power: 'maybe', cars: 12, bikes: -1, extra: 1 })).toEqual({ water: 'yes', cars: 12 });
    expect(parseInspection('not json')).toEqual({});
    expect(parseInspection(null)).toEqual({});
    expect(parseInspection(formatInspection({ parking: 'basement', permission: 'pending' }) ?? '')).toEqual({
      parking: 'basement',
      permission: 'pending',
    });
    expect(formatInspection({})).toBeNull();
  });

  it('warns about answers the owner should look at', () => {
    expect(inspectionWarnings({ permission: 'no', water: 'no', space: 'tight' })).toEqual([
      'The society said no',
      'No water there — the team must bring it',
      'Tight space to wash',
    ]);
    expect(inspectionWarnings({ permission: 'yes', water: 'yes', space: 'good' })).toEqual([]);
  });
});

describe('proposed slots', () => {
  it('cleans, sorts days Monday first, and keeps at most five', () => {
    const slots = parseSlots(
      JSON.stringify([
        { days: [0, 3, 5, 9], time: '06:30' },
        { days: [], time: '07:00' },
        { days: [2], time: '25:00' },
        { days: [2, 4], time: '06:00' },
        { days: [1], time: '05:30' },
        { days: [6], time: '08:00' },
        { days: [0], time: '09:00' },
        { days: [3], time: '17:00' },
      ]),
    );
    expect(slots).toEqual([
      { days: [3, 5, 0], time: '06:30' },
      { days: [2, 4], time: '06:00' },
      { days: [1], time: '05:30' },
      { days: [6], time: '08:00' },
      { days: [0], time: '09:00' },
    ]);
    expect(formatSlots([])).toBeNull();
    expect(describeSlot({ days: [0, 3, 5], time: '06:30' })).toBe('Wed, Fri, Sun · 6:30 am');
  });
});

describe('team', () => {
  it('dedupes ids', () => {
    expect(parseTeam('a, b,a,,c')).toEqual(['a', 'b', 'c']);
    expect(formatTeam([])).toBeNull();
    expect(formatTeam(['x', 'x', 'y'])).toBe('x,y');
  });
});

describe('ready for review', () => {
  it('lists what is missing', () => {
    expect(missingForReview({ photos: 0, inspection: {}, slots: [], contactPhone: null })).toHaveLength(7);
    expect(
      missingForReview({
        photos: 2,
        inspection: { permission: 'yes', water: 'bring', parking: 'open', bikes: 4 },
        slots: [{ days: [3], time: '06:30' }],
        contactPhone: '9440011001',
      }),
    ).toEqual([]);
  });
});
