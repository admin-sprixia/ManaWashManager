import { describe, expect, it } from 'vitest';
import {
  CITY_CODES,
  areaChoices,
  branchCode,
  branchName,
  branchNumber,
  cityAt,
  cityNamed,
  codeCandidates,
  inIndia,
  isValidPincode,
  kmFromPincode,
  looksAlike,
  newTownCode,
  nextBranchNumber,
  normalizePincode,
  pincodePlace,
  placeName,
  titleCase,
  townChoices,
  townKey,
  type PostOffice,
} from '..';

const KOVUR_PIN = { latitude: 14.514614, longitude: 79.987589 };
const office = (name: string, kind: PostOffice['kind'], latitude: number | null, longitude: number | null, district = 'SPSR NELLORE', state = 'ANDHRA PRADESH'): PostOffice => ({
  name,
  kind,
  district,
  state,
  latitude,
  longitude,
});
/** 524137 as India Post lists it (a few of its offices). */
const KOVUR_OFFICES = [
  office('Pothireddypalem B.O', 'BO', 14.47767, 79.979416),
  office('Kovur S.O', 'PO', 14.5086111, 79.9839167),
  office('Kovur Cutchery S.O', 'PO', 14.5091944, 79.9856944),
  office('Patur B.O', 'BO', 14.513459, 79.941736),
  office('Gummalladibba B.O', 'BO', null, null),
  office('Inamadugu B.O', 'BO', 14.511563, 80.015064),
];

describe('pincodes and places', () => {
  it('reads pincodes as typed and rejects impossible ones', () => {
    expect(normalizePincode('524 137')).toBe('524137');
    expect(normalizePincode('5241378')).toBe('524137');
    expect(isValidPincode('524137')).toBe(true);
    expect(isValidPincode('024137')).toBe(false);
    expect(isValidPincode('52413')).toBe(false);
  });

  it('keeps pins inside India', () => {
    expect(inIndia(KOVUR_PIN)).toBe(true);
    expect(inIndia({ latitude: 0, longitude: 0 })).toBe(false);
    expect(inIndia({ latitude: 14.5, longitude: -79.9 })).toBe(false);
  });

  it('cleans post office names in every spelling India Post uses', () => {
    expect(placeName('Kovur S.O')).toBe('Kovur');
    expect(placeName('Kovur Cutchery S.O')).toBe('Kovur Cutchery');
    expect(placeName('KUKATPALLY SO')).toBe('Kukatpally');
    expect(placeName('Patur B.O.')).toBe('Patur');
    expect(placeName('Aundh (Pune) H.O')).toBe('Aundh');
    expect(placeName('Hyderabad G.P.O.')).toBe('Hyderabad');
    expect(placeName('Ramnagar HO')).toBe('Ramnagar');
    expect(placeName('Vengalarao Nagar TSO')).toBe('Vengalarao Nagar');
    expect(placeName('Thygarayanagar South NDS.O')).toBe('Thygarayanagar South');
    expect(placeName('DR. Ambedkar Veedhi S.O')).toBe('Dr. Ambedkar Veedhi');
    expect(placeName('Kavali R.S. B.O')).toBe('Kavali R.S');
  });

  it('title-cases districts and states, keeping short abbreviations', () => {
    expect(titleCase('SPSR NELLORE')).toBe('SPSR Nellore');
    expect(titleCase('ANDHRA PRADESH')).toBe('Andhra Pradesh');
    expect(titleCase('THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU')).toBe('The Dadra and Nagar Haveli and Daman and Diu');
    expect(titleCase('MEDCHAL-MALKAJGIRI')).toBe('Medchal-Malkajgiri');
  });

  it('takes the district and state most of a pincode’s offices give', () => {
    const offices = [...KOVUR_OFFICES, office('Odd B.O', 'BO', null, null, 'NELLORE', 'ANDHRA PRADESH')];
    expect(pincodePlace(offices)).toEqual({ district: 'SPSR Nellore', state: 'Andhra Pradesh' });
    expect(pincodePlace([])).toBeNull();
  });
});

describe('town names', () => {
  it('treats spellings of one town as one', () => {
    expect(townKey('Kovur')).toBe(townKey('Kovuru'));
    expect(townKey('Nellore')).toBe(townKey('Nelore'));
    expect(townKey('Kovur')).not.toBe(townKey('Kavali'));
  });

  it('spots look-alike towns but not different ones or the same one', () => {
    expect(looksAlike('Kovur', 'Kavur')).toBe(true);
    expect(looksAlike('Nellur', 'Nellore')).toBe(true);
    expect(looksAlike('Kovur', 'Kovuru')).toBe(false);
    expect(looksAlike('Kovur', 'Kavali')).toBe(false);
    expect(looksAlike('Ap', 'Ab')).toBe(false);
  });
});

describe('town codes', () => {
  it('makes codes from the first letter and the consonants after it', () => {
    expect(codeCandidates('Kovur')[0]).toBe('KVR');
    expect(codeCandidates('Kavali')[0]).toBe('KVL');
    expect(codeCandidates('Gudur')[0]).toBe('GDR');
    expect(codeCandidates('Ongole')[0]).toBe('ONG');
    expect(codeCandidates('Sri City')[0]).toBe('SRC');
    expect(codeCandidates('')).toEqual([]);
  });

  it('gives big cities the codes people know, by any of their names', () => {
    expect(newTownCode('Hyderabad', new Set())).toBe('HYD');
    expect(newTownCode('Bangalore', new Set())).toBe('BLR');
    expect(newTownCode('Madras', new Set())).toBe('MAA');
    expect(cityNamed('Vizag')?.code).toBe('VTZ');
  });

  it('never gives a town a code another town of the business has', () => {
    expect(newTownCode('Kavur', new Set(['KVR']))).toBe('KVU');
    expect(newTownCode('Kovur', new Set(['KVR', 'KVU']))).not.toMatch(/^(KVR|KVU)$/);
  });

  it('never gives a small town a big city’s code', () => {
    // Hayderpur's natural code is HYD, which belongs to Hyderabad.
    expect(codeCandidates('Hayderpur')[0]).toBe('HYD');
    expect(newTownCode('Hayderpur', new Set())).toBe('HYR');
    const cityCodes = new Set(CITY_CODES.map((c) => c.code));
    for (const name of ['Nandyal', 'Gudivada', 'Machilipatnam', 'Bhimavaram', 'Tenali', 'Ongole']) {
      expect(cityCodes.has(newTownCode(name, new Set())!)).toBe(false);
    }
  });

  it('gives no code once every code for that letter is taken', () => {
    const taken = new Set<string>();
    for (const a of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') for (const b of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') taken.add(`K${a}${b}`);
    expect(newTownCode('Kovur', taken)).toBeNull();
    expect(newTownCode('!!!', new Set())).toBeNull();
  });

  it('every candidate is 3 capital letters, unique', () => {
    const list = codeCandidates('Visakhapatnam');
    expect(list.every((c) => /^[A-Z]{3}$/.test(c))).toBe(true);
    expect(new Set(list).size).toBe(list.length);
  });
});

describe('branch numbers', () => {
  it('numbers branches in three digits', () => {
    expect(branchCode('KVR', 1)).toBe('KVR-001');
    expect(branchCode('HYD', 12)).toBe('HYD-012');
  });

  it('counts after every branch of the town, including older two-digit codes', () => {
    expect(nextBranchNumber([], 'KVR')).toBe(1);
    expect(nextBranchNumber(['KVR-001'], 'KVR')).toBe(2);
    expect(nextBranchNumber(['KVR-001', 'KVR-01', 'KVR-007', 'KVRX-009', 'KVL-020', '900003'], 'KVR')).toBe(8);
    expect(branchNumber('KVR-012', 'KVR')).toBe(12);
    expect(branchNumber('KVL-012', 'KVR')).toBeNull();
  });
});

describe('branch names', () => {
  const base = { district: 'SPSR Nellore', taken: [] as string[], townHasBranches: false };

  it('is the town for its first branch', () => {
    expect(branchName({ ...base, town: 'Kovur', area: null })).toBe('Kovur');
    expect(branchName({ ...base, town: 'Kovur', area: 'Kovur' })).toBe('Kovur');
  });

  it('adds the area in a city, or for another branch in the town', () => {
    expect(branchName({ ...base, town: 'Hyderabad', area: 'Kukatpally' })).toBe('Hyderabad Kukatpally');
    expect(branchName({ ...base, town: 'Kovur', area: 'Cutchery', taken: ['Kovur'], townHasBranches: true })).toBe('Kovur Cutchery');
    expect(branchName({ ...base, town: 'Kovur', area: 'Kovur Cutchery', taken: ['Kovur'], townHasBranches: true })).toBe('Kovur Cutchery');
  });

  it('numbers a second branch with no area, and names a same-named town elsewhere by its district', () => {
    expect(branchName({ ...base, town: 'Kovur', area: null, taken: ['Kovur', 'Kovur 2'], townHasBranches: true })).toBe('Kovur 3');
    expect(branchName({ town: 'Kovur', area: null, district: 'Tiruvallur', taken: ['kovur'], townHasBranches: false })).toBe('Kovur (Tiruvallur)');
  });
});

describe('town and area choices', () => {
  it('suggests the town of the nearest main post office first, not one of its areas', () => {
    // Kovur Cutchery's office is nearer the pin, but it's an area of Kovur.
    const towns = townChoices(KOVUR_OFFICES, KOVUR_PIN);
    expect(towns).toEqual([{ name: 'Kovur', from: 'post_office' }]);
    expect(towns.some((t) => t.name === 'Patur')).toBe(false);
  });

  it('keeps an office’s full name when the town’s own office isn’t listed', () => {
    const only = [office('Kovur Cutchery S.O', 'PO', 14.5091944, 79.9856944)];
    expect(townChoices(only, KOVUR_PIN)[0]?.name).toBe('Kovur Cutchery');
  });

  it('suggests the city first inside a big city, its areas as areas', () => {
    const pin = { latitude: 17.4928, longitude: 78.3966 };
    const offices = [office('Kukatpally S.O', 'PO', 17.4928, 78.3966, 'MEDCHAL MALKAJGIRI', 'TELANGANA')];
    expect(townChoices(offices, pin)[0]).toEqual({ name: 'Hyderabad', from: 'city' });
    expect(areaChoices(offices, pin, 'Hyderabad')).toEqual(['Kukatpally']);
  });

  it('keeps a town just outside a city as its own town', () => {
    expect(cityAt(KOVUR_PIN)).toBeNull();
    expect(cityAt({ latitude: 14.4426, longitude: 79.9865 })?.name).toBe('Nellore');
  });

  it('falls back to village offices when a pincode has no main office', () => {
    const villages = [office('Patur B.O', 'BO', 14.513459, 79.941736)];
    expect(townChoices(villages, KOVUR_PIN)[0]?.name).toBe('Patur');
  });

  it('lists areas nearest first without the town, at most five', () => {
    const areas = areaChoices(KOVUR_OFFICES, KOVUR_PIN, 'Kovur');
    expect(areas[0]).toBe('Kovur Cutchery');
    expect(areas).not.toContain('Kovur');
    expect(areas.length).toBeLessThanOrEqual(5);
  });

  it('measures the pin against the pincode only where offices have points', () => {
    expect(kmFromPincode(KOVUR_OFFICES, KOVUR_PIN)).toBeLessThan(1);
    expect(kmFromPincode([office('Gummalladibba B.O', 'BO', null, null)], KOVUR_PIN)).toBeNull();
  });
});
