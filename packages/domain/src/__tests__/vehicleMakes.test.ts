import { describe, expect, it } from 'vitest';
import {
  VEHICLE_MAKES,
  VEHICLE_MAKE_MAX,
  vehicleMakeNames,
  vehicleModelNames,
  listedModel,
  vehicleGuideRows,
  vehicleTypeKeysFor,
  type VehicleModelEdit,
} from '../index';

describe('vehicle makes', () => {
  it('lists makes per category, A to Z, without repeats', () => {
    const cars = vehicleMakeNames('car');
    expect(cars).toContain('Maruti Suzuki');
    expect(cars).not.toContain('Royal Enfield');
    expect(cars).toEqual(
      [...cars].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
    );
    const all = vehicleMakeNames();
    expect(new Set(all).size).toBe(all.length);
    expect(all.filter((n) => n === 'Honda')).toHaveLength(1);
  });

  it("gives a make's models for the category", () => {
    expect(vehicleModelNames('Honda', 'car')).toContain('City');
    expect(vehicleModelNames('Honda', 'car')).not.toContain('Activa');
    expect(vehicleModelNames('honda', 'bike')).toContain('Activa');
    expect(vehicleModelNames('Honda')).toEqual(expect.arrayContaining(['City', 'Activa']));
    expect(vehicleModelNames('Unknown Motors', 'car')).toEqual([]);
  });

  it('fits every name in the make and model fields, with no empty or repeated models', () => {
    for (const make of VEHICLE_MAKES) {
      expect(make.name.length).toBeLessThanOrEqual(VEHICLE_MAKE_MAX);
      expect(make.models.length).toBeGreaterThan(0);
      expect(new Set(make.models).size).toBe(make.models.length);
      for (const model of make.models) expect(model.length).toBeLessThanOrEqual(VEHICLE_MAKE_MAX);
    }
  });

  it('suggests the vehicle type from the make and model, best fit first', () => {
    expect(vehicleTypeKeysFor('Maruti Suzuki', 'Swift')?.[0]).toBe('hatch');
    expect(vehicleTypeKeysFor('maruti suzuki', ' dzire ')?.[0]).toBe('sedan');
    expect(vehicleTypeKeysFor('Tata', 'Nexon')?.slice(0, 2)).toEqual(['suvMini', 'suvLarge']);
    expect(vehicleTypeKeysFor('Toyota', 'Innova Crysta')).toEqual(['muv', 'suvLarge', 'suvMini']);
    expect(vehicleTypeKeysFor('Honda', 'Activa')?.[0]).toBe('scooter');
    expect(vehicleTypeKeysFor('Honda', 'City')?.[0]).toBe('sedan');
    expect(vehicleTypeKeysFor('Royal Enfield', 'Classic 350')?.[0]).toBe('cruiser');
    expect(vehicleTypeKeysFor('BMW', '3 Series')?.slice(0, 2)).toEqual(['luxury', 'sedan']);
    expect(vehicleTypeKeysFor('Harley-Davidson', 'Fat Boy')?.[0]).toBe('premiumBike');
    expect(vehicleTypeKeysFor('Suzuki', 'Hayabusa')?.[0]).toBe('premiumBike');
    expect(vehicleTypeKeysFor('Harley-Davidson', 'X440')?.[0]).toBe('cruiser');
    expect(vehicleTypeKeysFor('BMW', 'G 310 R')?.[0]).toBe('bike');
    expect(vehicleTypeKeysFor('Tata', 'Sumo Victoria')).toBeNull();
    expect(vehicleTypeKeysFor('Unknown Motors', 'X')).toBeNull();
  });

  it('puts every model under exactly one body style', () => {
    for (const make of VEHICLE_MAKES) {
      const fromBodies = Object.values(make.bodies).flat();
      expect(fromBodies).toHaveLength(make.models.length);
    }
  });
});

describe('head office’s changes to the model list', () => {
  const edits: VehicleModelEdit[] = [
    // A new launch, added.
    { make: 'Maruti Suzuki', model: 'eVX', category: 'car', bodyKey: 'suvMini' },
    // Moved: a Swift washed like a sedan.
    { make: 'maruti suzuki', model: 'swift ', category: 'car', bodyKey: 'sedan' },
    // Removed.
    { make: 'Maruti Suzuki', model: 'Alto 800', category: 'car', bodyKey: null },
  ];

  it('adds, moves and removes models in the guide', () => {
    const rows = vehicleGuideRows(edits);
    const find = (model: string) => rows.find((r) => r.make === 'Maruti Suzuki' && r.model === model);
    expect(find('eVX')).toMatchObject({ bodyKey: 'suvMini', change: 'added' });
    expect(find('Swift')).toMatchObject({ bodyKey: 'sedan', change: 'moved' });
    expect(find('Alto 800')).toBeUndefined();
    expect(rows.length).toBe(vehicleGuideRows().length);
  });

  it('feeds the company and model pickers and the type suggestion', () => {
    expect(vehicleModelNames('Maruti Suzuki', 'car', edits)).toContain('eVX');
    expect(vehicleModelNames('Maruti Suzuki', 'car', edits)).not.toContain('Alto 800');
    expect(vehicleMakeNames('car', [{ make: 'Kovur Motors', model: 'K1', category: 'car', bodyKey: 'suvMini' }])).toContain('Kovur Motors');
    expect(vehicleTypeKeysFor('Maruti Suzuki', 'eVX', edits)?.[0]).toBe('suvMini');
    expect(vehicleTypeKeysFor('Maruti Suzuki', 'Swift', edits)?.[0]).toBe('sedan');
    expect(vehicleTypeKeysFor('Maruti Suzuki', 'Alto 800', edits)).toBeNull();
  });

  it('leaves the built-in list untouched', () => {
    vehicleGuideRows(edits);
    expect(listedModel('Maruti Suzuki', 'Swift')?.bodyKey).toBe('hatch');
    expect(listedModel('Maruti Suzuki', 'eVX')).toBeNull();
    expect(vehicleGuideRows().find((r) => r.model === 'Swift' && r.make === 'Maruti Suzuki')?.change).toBeUndefined();
  });
});
