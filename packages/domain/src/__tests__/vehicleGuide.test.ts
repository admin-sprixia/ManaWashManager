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

  it('prices luxury marques’ cars as luxury, and well-known models where you’d expect', () => {
    const find = (make: string, model: string) => rows.find((r) => r.make === make && r.model === model);
    expect(find('Maruti Suzuki', 'Swift')?.bodyKey).toBe('hatch');
    expect(find('Hyundai', 'Creta')?.bodyKey).toBe('suvLarge');
    const sizeOf = (key: string | undefined) => BODY_TYPES.find((b) => b.key === key)?.size;
    // A BMW M3 is a sports car; both sports and luxury cars are priced XL.
    expect(sizeOf(rows.find((r) => r.make === 'BMW' && r.category === 'car' && r.model === 'M3')?.bodyKey)).toBe('XL');
    expect(rows.find((r) => r.make.startsWith('Mercedes') && r.model.includes('C-Class'))?.bodyKey).toBe('luxury');
  });

  it('is sorted by company, then model', () => {
    const cmp = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
    const sorted = [...rows].sort((a, b) => cmp(a.make, b.make) || cmp(a.model, b.model));
    expect(rows).toEqual(sorted);
  });
});
