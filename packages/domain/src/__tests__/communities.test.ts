import { describe, expect, it } from 'vitest';
import {
  cleanInspection,
  describeSlot,
  formatInspection,
  formatSlots,
  formatTeam,
  inspectionWarnings,
  missingForReview,
  requiredPhotoKinds,
  parseInspection,
  parseSlots,
  parseTeam, parseBestTime, bestTimeLabel } from '../communities';

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
  const threeChoices = [3, 5, 0].map((d) => ({ days: [d], time: '06:30' }));
  const allAnswers = { permission: 'yes', water: 'yes', power: 'yes', parking: 'open', space: 'good', cars: 4 } as const;
  const allPhotos = ['gate', 'parking', 'space'] as const;
  const ready = { name: 'Lakshmi Towers', photos: allPhotos, inspection: allAnswers, slots: threeChoices, contactName: 'Ramesh', contactPhone: '9440011001' };

  it('lists what is missing', () => {
    // Name, 3 photos, society, water, power, parking, space, vehicles, contact's name and number, choices.
    expect(missingForReview({ name: null, photos: [], inspection: {}, slots: [], contactName: null, contactPhone: null })).toHaveLength(13);
    expect(missingForReview(ready)).toEqual([]);
  });

  it('needs the name and every answer: society, water, power point, parking and space', () => {
    expect(missingForReview({ ...ready, name: '  ' })).toEqual(['Name']);
    expect(missingForReview({ ...ready, inspection: { ...allAnswers, power: undefined, space: undefined } })).toEqual([
      'Power point',
      'Space to wash',
    ]);
  });

  it('needs the gate, parking and wash space photos', () => {
    expect(missingForReview({ ...ready, photos: ['gate', 'building'] })).toEqual(['Parking photo', 'Wash space photo']);
  });

  it('leaves the water point and power point photos optional', () => {
    expect(requiredPhotoKinds({ water: 'yes', power: 'yes' })).toEqual(['gate', 'parking', 'space']);
    expect(missingForReview({ ...ready, photos: ['gate', 'parking', 'space'] })).toEqual([]);
  });

  it('needs the name and number of who to call', () => {
    expect(missingForReview({ ...ready, contactName: ' ', contactPhone: null })).toEqual(['Who to call: their name', 'Who to call: their number']);
  });

  it('needs at least three choices of days and time', () => {
    expect(missingForReview({ ...ready, slots: threeChoices.slice(0, 2) })).toEqual(['3 days-and-time choices residents want (2 so far)']);
  });
});

describe('best time to wash', () => {
  it('keeps a clock time and reads old answers as one', () => {
    expect(parseBestTime('06:30')).toBe('06:30');
    expect(parseBestTime('early')).toBe('06:00');
    expect(parseBestTime('evening')).toBe('17:00');
    expect(parseBestTime('25:00')).toBeUndefined();
    expect(cleanInspection({ bestTime: 'morning' }).bestTime).toBe('08:00');
  });

  it('reads as a time of day', () => {
    expect(bestTimeLabel('06:30')).toBe('6:30 AM');
    expect(bestTimeLabel('17:00')).toBe('5:00 PM');
    expect(bestTimeLabel('00:15')).toBe('12:15 AM');
  });
});
