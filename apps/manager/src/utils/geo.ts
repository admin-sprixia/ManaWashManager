/** "14.4936, 79.9884" (as Google Maps copies it) → a point; null when it isn't one. */
export function parsePoint(text: string): { latitude: number; longitude: number } | null {
  const m = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/** A point as it's typed and shown: "14.49360, 79.98840". */
export const pointText = (p: { latitude: number; longitude: number }) => `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`;

export const mapsLink = (p: { latitude: number; longitude: number }) =>
  `https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`;
