import { describe, expect, it } from 'vitest';
import { isValidRegistration, normalizeRegistration } from '../registration';

describe('registration numbers', () => {
  it('normalises the way New Wash stores them', () => {
    expect(normalizeRegistration(' ap 39 ab 1234 ')).toBe('AP39AB1234');
  });
  it('accepts plates and refuses junk', () => {
    expect(isValidRegistration('AP39AB1234')).toBe(true);
    expect(isValidRegistration('22BH1234AA')).toBe(true);
    expect(isValidRegistration('AB')).toBe(false);
    expect(isValidRegistration('AP39/AB')).toBe(false);
  });
});
