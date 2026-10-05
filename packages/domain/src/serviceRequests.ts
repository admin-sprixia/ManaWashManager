/**
 * "Request service" in the MANA Car Wash app: someone the car wash hasn't registered yet asks
 * for doorstep washing. The team calls them, agrees a price, and approves (which registers them
 * as a customer, so they can sign in) or declines.
 */

export const PLACE_KINDS = ['apartment', 'house', 'small_building', 'office', 'other'] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export const PLACE_KIND_LABELS: Record<PlaceKind, string> = {
  apartment: 'Apartment',
  house: 'Individual house',
  small_building: 'Small building (2–4 floors)',
  office: 'Office',
  other: 'Other',
};

export const PREFERRED_TIMES = ['early_morning', 'morning', 'evening', 'any'] as const;
export type PreferredTime = (typeof PREFERRED_TIMES)[number];

export const PREFERRED_TIME_LABELS: Record<PreferredTime, string> = {
  early_morning: 'Early morning (5–8 am)',
  morning: 'Morning (8–11 am)',
  evening: 'Evening (4–7 pm)',
  any: 'Any time',
};

export const SERVICE_REQUEST_STATUSES = [
  'pending',
  'out_of_area',
  'approved',
  'rejected',
  'cancelled',
] as const;
export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATUSES)[number];

/** Still waiting on the team: one of these per phone at a time. */
export const OPEN_REQUEST_STATUSES: readonly ServiceRequestStatus[] = ['pending', 'out_of_area'];

export const MAX_VEHICLES_PER_REQUEST = 20;
export const SERVICE_REQUEST_ADDRESS_MAX = 300;
export const SERVICE_REQUEST_NOTES_MAX = 300;

export function isOpenRequest(status: string): boolean {
  return (OPEN_REQUEST_STATUSES as readonly string[]).includes(status);
}

/** Which moves the team (or the customer, for cancel) may make. */
export function canMoveRequest(from: ServiceRequestStatus, to: ServiceRequestStatus): boolean {
  if (!isOpenRequest(from)) return false;
  return to === 'approved' || to === 'rejected' || to === 'cancelled';
}

export function vehicleSummary(cars: number, bikes: number): string {
  const parts: string[] = [];
  if (cars) parts.push(`${cars} car${cars === 1 ? '' : 's'}`);
  if (bikes) parts.push(`${bikes} bike${bikes === 1 ? '' : 's'}`);
  return parts.join(' · ') || 'No vehicles';
}
