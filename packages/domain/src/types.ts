export type VehicleTypeId = string;
export type ServiceId = string;

export interface VehicleType {
  id: VehicleTypeId;
  name: string;
  sortOrder: number;
}

export interface Service {
  id: ServiceId;
  name: string;
  description: string | null;
  active: boolean;
  sortOrder: number;
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
