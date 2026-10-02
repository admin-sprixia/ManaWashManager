import { describe, expect, it } from 'vitest';
import { formatStock, stockKey, stockLevel, stockUnitOf, toStockQuantity } from '../stock';

describe('stock units', () => {
  it('maps entered units onto the unit stock is kept in', () => {
    expect(stockUnitOf('ml')).toBe('l');
    expect(stockUnitOf('g')).toBe('kg');
    expect(stockUnitOf('pcs')).toBe('pcs');
    expect(stockUnitOf('kwh')).toBeNull();
  });

  it('converts ml / g and refuses a mismatched unit', () => {
    expect(toStockQuantity(500, 'ml', 'l')).toBe(0.5);
    expect(toStockQuantity(2, 'l', 'l')).toBe(2);
    expect(toStockQuantity(250, 'g', 'kg')).toBe(0.25);
    expect(toStockQuantity(1, 'kg', 'l')).toBeNull();
  });

  it('shows small amounts in ml / g and negatives with a minus', () => {
    expect(formatStock(2.5, 'l')).toBe('2.5 L');
    expect(formatStock(0.45, 'l')).toBe('450 ml');
    expect(formatStock(0.3, 'kg')).toBe('300 g');
    expect(formatStock(12, 'pcs')).toBe('12 pcs');
    expect(formatStock(-0.2, 'l')).toBe('−200 ml');
    expect(formatStock(0, 'l')).toBe('0 L');
  });
});

describe('stock level', () => {
  it('is out at zero, low at or under the alert, otherwise ok', () => {
    expect(stockLevel(0, 1)).toBe('out');
    expect(stockLevel(-1, null)).toBe('out');
    expect(stockLevel(1, 1)).toBe('low');
    expect(stockLevel(1.5, 1)).toBe('ok');
    expect(stockLevel(0.2, null)).toBe('ok');
  });

  it('matches names regardless of case and spacing', () => {
    expect(stockKey('  Foam   Shampoo ')).toBe(stockKey('foam shampoo'));
  });
});
