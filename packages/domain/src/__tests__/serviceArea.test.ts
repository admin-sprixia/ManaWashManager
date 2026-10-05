import { describe, expect, it } from 'vitest';
import {
  areaNameKey,
  branchFor,
  distanceKm,
  nearestBranch,
  type GeoPoint,
  type ServiceBranch,
} from '../serviceArea';
import { canMoveRequest, isOpenRequest, vehicleSummary } from '../serviceRequests';

const KOVUR: GeoPoint = { latitude: 14.4936, longitude: 79.9884 };
const NELLORE: GeoPoint = { latitude: 14.4426, longitude: 79.9865 };
const HYDERABAD: GeoPoint = { latitude: 17.385, longitude: 78.4867 };
const CHENNAI: GeoPoint = { latitude: 13.0827, longitude: 80.2707 };

/** A point `km` due north of `p` (1° of latitude ≈ 111.195 km on this Earth radius). */
const north = (p: GeoPoint, km: number): GeoPoint => ({
  latitude: p.latitude + km / 111.19508,
  longitude: p.longitude,
});

const kovurBranch: ServiceBranch = { shopId: 'b_kovur', hub: KOVUR, radiusKm: 8, areaIds: ['a_kovur'] };
const nelloreBranch: ServiceBranch = { shopId: 'b_nellore', hub: NELLORE, radiusKm: 8, areaIds: ['a_nellore'] };
const areasOnly: ServiceBranch = { shopId: 'b_areas', hub: null, radiusKm: null, areaIds: ['a_buchi'] };

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

describe('branchFor', () => {
  it('uses the radius at its edge', () => {
    expect(branchFor({ point: north(KOVUR, 7.99) }, [kovurBranch])).toMatchObject({ shopId: 'b_kovur', via: 'radius' });
    expect(branchFor({ point: north(KOVUR, 8.01) }, [kovurBranch])).toBeNull();
  });

  it('picks the nearest hub when radii overlap, whatever the list order', () => {
    const nearNellore = north(NELLORE, 1);
    expect(branchFor({ point: nearNellore }, [kovurBranch, nelloreBranch])?.shopId).toBe('b_nellore');
    expect(branchFor({ point: nearNellore }, [nelloreBranch, kovurBranch])?.shopId).toBe('b_nellore');
  });

  it('falls back to the picked area when there is no pin, or the pin is outside every radius', () => {
    expect(branchFor({ areaId: 'a_buchi' }, [kovurBranch, areasOnly])).toEqual({ shopId: 'b_areas', via: 'area' });
    expect(branchFor({ point: HYDERABAD, areaId: 'a_kovur' }, [kovurBranch])).toEqual({ shopId: 'b_kovur', via: 'area' });
  });

  it('is out of area when nothing matches', () => {
    expect(branchFor({ point: HYDERABAD }, [kovurBranch, nelloreBranch, areasOnly])).toBeNull();
    expect(branchFor({ areaId: 'a_unknown' }, [kovurBranch])).toBeNull();
    expect(branchFor({}, [kovurBranch])).toBeNull();
  });

  it('ignores an invalid point', () => {
    expect(branchFor({ point: { latitude: 200, longitude: 0 } }, [kovurBranch])).toBeNull();
  });
});

describe('nearestBranch', () => {
  it('sends out-of-area requests to the nearest hub, else the first branch', () => {
    expect(nearestBranch(HYDERABAD, [kovurBranch, nelloreBranch])).toBe('b_kovur');
    expect(nearestBranch(CHENNAI, [kovurBranch, nelloreBranch])).toBe('b_nellore');
    expect(nearestBranch(null, [nelloreBranch, kovurBranch])).toBe('b_kovur');
    expect(nearestBranch(HYDERABAD, [areasOnly])).toBe('b_areas');
    expect(nearestBranch(HYDERABAD, [])).toBeNull();
  });
});

describe('service requests', () => {
  it('normalises area names', () => {
    expect(areaNameKey('  Kovur   Town ')).toBe('kovur town');
  });

  it('only moves open requests', () => {
    expect(isOpenRequest('pending')).toBe(true);
    expect(isOpenRequest('out_of_area')).toBe(true);
    expect(canMoveRequest('pending', 'approved')).toBe(true);
    expect(canMoveRequest('out_of_area', 'rejected')).toBe(true);
    expect(canMoveRequest('approved', 'rejected')).toBe(false);
    expect(canMoveRequest('cancelled', 'approved')).toBe(false);
  });

  it('summarises vehicles', () => {
    expect(vehicleSummary(2, 1)).toBe('2 cars · 1 bike');
    expect(vehicleSummary(1, 0)).toBe('1 car');
    expect(vehicleSummary(0, 0)).toBe('No vehicles');
  });
});
