export type VehicleTypeId = string;
export type ServiceId = string;

/** Top-level vehicle family — cars and bikes keep separate service menus. */
export type VehicleCategory = 'car' | 'bike';

/** Which vehicle families a catalog service is offered for. */
export type ServiceAppliesTo = VehicleCategory | 'both';

export function parseVehicleCategory(value: string | null | undefined): VehicleCategory {
  return value === 'bike' ? 'bike' : 'car';
}

export function parseServiceAppliesTo(value: string | null | undefined): ServiceAppliesTo {
  if (value === 'bike' || value === 'both') return value;
  return 'car';
}

export interface VehicleType {
  id: VehicleTypeId;
  name: string;
  category: VehicleCategory;
  sortOrder: number;
}

export interface Service {
  id: ServiceId;
  name: string;
  description: string | null;
  active: boolean;
  appliesTo: ServiceAppliesTo;
  sortOrder: number;
}

/** True when a service should appear for the given vehicle category. */
export function serviceAppliesToCategory(
  appliesTo: ServiceAppliesTo,
  category: VehicleCategory,
): boolean {
  return appliesTo === 'both' || appliesTo === category;
}

/** Prices are stored in paise (1 rupee = 100 paise) everywhere in the system, to avoid float rounding on money. */
export interface ServicePrice {
  serviceId: ServiceId;
  vehicleTypeId: VehicleTypeId;
  price: number;
}

export type JobStatus = 'waiting' | 'washing' | 'ready' | 'paid' | 'void';

export type PaymentMethod = 'cash' | 'upi' | 'other';

export interface SelectedService {
  serviceId: ServiceId;
  quantity: number;
}
