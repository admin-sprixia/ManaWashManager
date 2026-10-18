import { describe, expect, it } from 'vitest';
import {
  durationParts,
  formatDuration,
  splitChecklist,
  parseChecklist,
  parseServiceKind,
  parseTeamPlaces,
  placesToModes,
  servicePlaces,
  servicePlacesLabel,
  type ServicePlaces,
} from '../serviceNetwork';

const all: ServicePlaces = { shop: true, community: true, doorstep: true };

describe('where a service is done', () => {
  it('reads every stored combination back as ticks', () => {
    expect(servicePlaces('both', 'both')).toEqual(all);
    expect(servicePlaces('hub', 'both')).toEqual({ shop: true, community: false, doorstep: false });
    expect(servicePlaces('doorstep', 'both')).toEqual({ shop: false, community: true, doorstep: true });
    expect(servicePlaces('both', 'community')).toEqual({ shop: true, community: true, doorstep: false });
    expect(servicePlaces('doorstep', 'doorstep')).toEqual({ shop: false, community: false, doorstep: true });
  });

  it('stores every set of ticks and reads it back the same', () => {
    for (const shop of [true, false]) {
      for (const community of [true, false]) {
        for (const doorstep of [true, false]) {
          const ticks = { shop, community, doorstep };
          const stored = placesToModes(ticks);
          if (!shop && !community && !doorstep) {
            expect(stored).toBeNull();
            continue;
          }
          expect(servicePlaces(stored!.modes, stored!.teamAt)).toEqual(ticks);
        }
      }
    }
  });

  it('says "only" beside a single place and lists the rest in order', () => {
    expect(servicePlacesLabel({ shop: true, community: false, doorstep: false })).toBe('Shop only');
    expect(servicePlacesLabel({ shop: false, community: false, doorstep: true })).toBe('Doorstep only');
    expect(servicePlacesLabel({ shop: true, community: true, doorstep: false })).toBe('Shop & community');
    expect(servicePlacesLabel({ shop: false, community: true, doorstep: true })).toBe('Community & doorstep');
    expect(servicePlacesLabel(all)).toBe('Shop, community & doorstep');
  });

  it('treats unknown stored values as the safe defaults', () => {
    expect(parseTeamPlaces('anything')).toBe('both');
    expect(parseServiceKind(null)).toBe('wash');
    expect(parseServiceKind('protection')).toBe('protection');
  });
});

describe('service details', () => {
  it('reads a checklist and ignores anything broken', () => {
    expect(parseChecklist('["Foam wash","Vacuum"]')).toEqual(['Foam wash', 'Vacuum']);
    expect(parseChecklist('["", 3, "Tyre shine"]')).toEqual(['Tyre shine']);
    expect(parseChecklist('not json')).toEqual([]);
    expect(parseChecklist(null)).toEqual([]);
  });

  it('writes durations the way people say them', () => {
    expect(formatDuration(25)).toBe('25 min');
    expect(formatDuration(60)).toBe('1 hr');
    expect(formatDuration(85)).toBe('1 hr 25 min');
    expect(formatDuration(1440)).toBe('1 day');
    expect(formatDuration(2880)).toBe('2 days');
    expect(formatDuration(1800)).toBe('1 day 6 hr');
  });

  it('shows a stored time in its biggest whole unit', () => {
    expect(durationParts(45)).toEqual({ amount: 45, unit: 'min' });
    expect(durationParts(120)).toEqual({ amount: 2, unit: 'hr' });
    expect(durationParts(90)).toEqual({ amount: 90, unit: 'min' });
    expect(durationParts(4320)).toEqual({ amount: 3, unit: 'day' });
  });

  it('turns comma-separated text into checklist lines', () => {
    expect(splitChecklist('Foam wash, Vacuum ,, tyre shine')).toEqual(['Foam wash', 'Vacuum', 'tyre shine']);
    expect(splitChecklist('Vacuum, vacuum')).toEqual(['Vacuum']);
    expect(splitChecklist('  ')).toEqual([]);
  });
});
