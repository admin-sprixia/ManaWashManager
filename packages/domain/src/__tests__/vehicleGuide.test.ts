import { describe, expect, it } from 'vitest';
import { BODY_TYPES } from '../vehicleCatalog';
import { VEHICLE_MAKES, vehicleGuideRows } from '../vehicleMakes';

describe('vehicle size guide', () => {
  const rows = vehicleGuideRows();

  it('lists every model of every company', () => {
    const models = VEHICLE_MAKES.reduce((n, m) => n + m.models.length, 0);
    expect(rows.length).toBe(models);
  });

  it('gives every model a body type the catalog prices', () => {
    const keys = new Set(BODY_TYPES.map((b) => b.key));
    expect(rows.filter((r) => !keys.has(r.bodyKey))).toEqual([]);
  });

  it('prices every car by its body size (imported brands too), and well-known models where you’d expect', () => {
    const find = (make: string, model: string) => rows.find((r) => r.make === make && r.model === model);
    expect(find('Maruti Suzuki', 'Swift')?.bodyKey).toBe('hatch');
    expect(find('Hyundai', 'Creta')?.bodyKey).toBe('suvLarge');
    const sizeOf = (key: string | undefined) => BODY_TYPES.find((b) => b.key === key)?.size;
    expect(find('BMW', '3 Series')?.bodyKey).toBe('sedan');
    expect(find('BMW', 'X5')?.bodyKey).toBe('suvLarge');
    expect(sizeOf(find('BMW', '3 Series')?.bodyKey)).toBe('M');
    expect(sizeOf(find('BMW', 'X5')?.bodyKey)).toBe('L');
    expect(sizeOf(find('Mini', 'Cooper')?.bodyKey)).toBe('S');
    // Nothing is priced as a "Luxury car" or above the big-car size any more.
    const carClass = (key: string) => BODY_TYPES.find((b) => b.key === key)?.classKey === 'car';
    expect(rows.filter((r) => carClass(r.bodyKey) && (r.bodyKey === 'luxury' || sizeOf(r.bodyKey) === 'XL'))).toEqual([]);
  });

  it('is sorted by company, then model', () => {
    const cmp = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
    const sorted = [...rows].sort((a, b) => cmp(a.make, b.make) || cmp(a.model, b.model));
    expect(rows).toEqual(sorted);
  });
});
