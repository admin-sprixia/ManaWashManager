/** Where MANA washes cars: each branch has a hub (a map point) with a radius. */

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export const SERVICE_RADIUS_MIN_KM = 0.5;
export const SERVICE_RADIUS_MAX_KM = 50;

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
