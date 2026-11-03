/** Vehicle registration numbers and makes, as New Wash stores them. */

/** "ap 39 ab 1234" → "AP39AB1234", the shape New Wash stores. */
export function normalizeRegistration(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidRegistration(registration: string): boolean {
  return /^[A-Z0-9-]{4,15}$/.test(registration);
}

export const VEHICLE_MAKE_MAX = 40;
