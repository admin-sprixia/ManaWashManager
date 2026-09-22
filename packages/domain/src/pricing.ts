import type { SelectedService, ServicePrice, VehicleTypeId } from './types';

export interface PriceLineItem {
  serviceId: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface PriceBreakdown {
  lineItems: PriceLineItem[];
  subtotal: number;
}

export class PriceNotFoundError extends Error {
  constructor(serviceId: string, vehicleTypeId: string) {
    super(`No price configured for service "${serviceId}" and vehicle type "${vehicleTypeId}"`);
    this.name = 'PriceNotFoundError';
  }
}

/**
 * Calculates the price for a set of selected services against one vehicle type.
 * Throws PriceNotFoundError if the owner has not set a price for a service/vehicle-type pair —
 * a job must never start at a silently-assumed price of 0.
 */
export function calculatePrice(
  selected: SelectedService[],
  vehicleTypeId: VehicleTypeId,
  prices: ServicePrice[],
): PriceBreakdown {
  const priceIndex = new Map<string, number>();
  for (const p of prices) {
    priceIndex.set(`${p.serviceId}:${p.vehicleTypeId}`, p.price);
  }

  const lineItems: PriceLineItem[] = selected.map((item) => {
    const unitPrice = priceIndex.get(`${item.serviceId}:${vehicleTypeId}`);
    if (unitPrice === undefined) {
      throw new PriceNotFoundError(item.serviceId, vehicleTypeId);
    }
    return {
      serviceId: item.serviceId,
      quantity: item.quantity,
      unitPrice,
      lineTotal: unitPrice * item.quantity,
    };
  });

  const subtotal = lineItems.reduce((sum, li) => sum + li.lineTotal, 0);

  return { lineItems, subtotal };
}

export function applyDiscount(subtotal: number, discount: number): number {
  if (discount < 0) throw new Error('Discount cannot be negative');
  if (discount > subtotal) throw new Error('Discount cannot exceed subtotal');
  return subtotal - discount;
}
