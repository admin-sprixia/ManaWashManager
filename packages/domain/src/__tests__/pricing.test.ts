import { describe, expect, it } from 'vitest';
import { applyDiscount, calculatePrice, PriceNotFoundError } from '../pricing';
import type { ServicePrice } from '../types';

const prices: ServicePrice[] = [
  { serviceId: 'svc_complete_wash', vehicleTypeId: 'vt_hatchback', price: 40000 },
  { serviceId: 'svc_complete_wash', vehicleTypeId: 'vt_sedan', price: 50000 },
  { serviceId: 'svc_tyre_dressing', vehicleTypeId: 'vt_hatchback', price: 5000 },
];

describe('calculatePrice', () => {
  it('calculates a single-service total for a vehicle type', () => {
    const result = calculatePrice(
      [{ serviceId: 'svc_complete_wash', quantity: 1 }],
      'vt_hatchback',
      prices,
    );
    expect(result.subtotal).toBe(40000);
    expect(result.lineItems).toHaveLength(1);
  });

  it('sums multiple services and respects quantity', () => {
    const result = calculatePrice(
      [
        { serviceId: 'svc_complete_wash', quantity: 1 },
        { serviceId: 'svc_tyre_dressing', quantity: 2 },
      ],
      'vt_hatchback',
      prices,
    );
    expect(result.subtotal).toBe(40000 + 5000 * 2);
  });

  it('uses the price for the given vehicle type, not another one', () => {
    const result = calculatePrice(
      [{ serviceId: 'svc_complete_wash', quantity: 1 }],
      'vt_sedan',
      prices,
    );
    expect(result.subtotal).toBe(50000);
  });

  it('throws PriceNotFoundError instead of assuming a price of 0', () => {
    expect(() =>
      calculatePrice([{ serviceId: 'svc_unknown', quantity: 1 }], 'vt_hatchback', prices),
    ).toThrow(PriceNotFoundError);
  });
});

describe('applyDiscount', () => {
  it('subtracts the discount from the subtotal', () => {
    expect(applyDiscount(40000, 5000)).toBe(35000);
  });

  it('rejects a negative discount', () => {
    expect(() => applyDiscount(40000, -1)).toThrow();
  });

  it('rejects a discount larger than the subtotal', () => {
    expect(() => applyDiscount(40000, 40001)).toThrow();
  });
});
