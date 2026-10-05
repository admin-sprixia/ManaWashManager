/**
 * Where MANA washes cars. Each branch has a hub (a map point) with a radius, and a list of named
 * areas as the backup for customers who don't share their location.
 */

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface ServiceBranch {
  shopId: string;
  /** The hub; null until the owner sets it. */
  hub: GeoPoint | null;
  /** Null = no radius, only the area list. */
  radiusKm: number | null;
  /** Active service areas of this branch. */
  areaIds: string[];
}

export type BranchMatch =
  | { shopId: string; via: 'radius'; distanceKm: number }
  | { shopId: string; via: 'area' };

export const SERVICE_RADIUS_MIN_KM = 0.5;
export const SERVICE_RADIUS_MAX_KM = 50;
export const SERVICE_AREA_NAME_MAX = 60;

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance (haversine), in km. */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidPoint(p: GeoPoint): boolean {
  return (
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180
  );
}

/**
 * The branch that serves a place:
 * 1. with a map point, the nearest branch whose radius contains it;
 * 2. otherwise (or when no radius contains it), the branch listing the picked area;
 * 3. otherwise none — out of area.
 * Ties on distance go to the lower shop id, so the answer never depends on list order.
 */
export function branchFor(
  place: { point?: GeoPoint | null; areaId?: string | null },
  branches: ServiceBranch[],
): BranchMatch | null {
  if (place.point && isValidPoint(place.point)) {
    let best: { shopId: string; distanceKm: number } | null = null;
    for (const b of branches) {
      if (!b.hub || b.radiusKm == null) continue;
      const d = distanceKm(place.point, b.hub);
      if (d > b.radiusKm) continue;
      if (!best || d < best.distanceKm || (d === best.distanceKm && b.shopId < best.shopId)) {
        best = { shopId: b.shopId, distanceKm: d };
      }
    }
    if (best) return { shopId: best.shopId, via: 'radius', distanceKm: best.distanceKm };
  }
  if (place.areaId) {
    const owner = branches
      .filter((b) => b.areaIds.includes(place.areaId!))
      .sort((x, y) => (x.shopId < y.shopId ? -1 : 1))[0];
    if (owner) return { shopId: owner.shopId, via: 'area' };
  }
  return null;
}

/**
 * Who hears about a request from outside every area: the branch with the nearest hub, else
 * the first branch. Null only when no branch serves through the app at all.
 */
export function nearestBranch(point: GeoPoint | null | undefined, branches: ServiceBranch[]): string | null {
  const sorted = [...branches].sort((x, y) => (x.shopId < y.shopId ? -1 : 1));
  if (point && isValidPoint(point)) {
    let best: { shopId: string; d: number } | null = null;
    for (const b of sorted) {
      if (!b.hub) continue;
      const d = distanceKm(point, b.hub);
      if (!best || d < best.d) best = { shopId: b.shopId, d };
    }
    if (best) return best.shopId;
  }
  return sorted[0]?.shopId ?? null;
}

/** Lower-cased, single-spaced: "  Kovur  Town" and "kovur town" are the same area. */
export function areaNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
