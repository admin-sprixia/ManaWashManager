import { describe, expect, it } from 'vitest';
import { distanceKm, type GeoPoint } from '../serviceArea';

const KOVUR: GeoPoint = { latitude: 14.4936, longitude: 79.9884 };
const NELLORE: GeoPoint = { latitude: 14.4426, longitude: 79.9865 };
const HYDERABAD: GeoPoint = { latitude: 17.385, longitude: 78.4867 };

describe('distanceKm', () => {
  it('is zero for the same point and symmetric', () => {
    expect(distanceKm(KOVUR, KOVUR)).toBe(0);
    expect(distanceKm(KOVUR, NELLORE)).toBeCloseTo(distanceKm(NELLORE, KOVUR), 9);
  });

  it('matches known distances', () => {
    expect(distanceKm(KOVUR, NELLORE)).toBeGreaterThan(5.5);
    expect(distanceKm(KOVUR, NELLORE)).toBeLessThan(6);
    expect(distanceKm(NELLORE, HYDERABAD)).toBeGreaterThan(350);
  });
});
