import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, InvalidJobTransitionError } from '../jobStatus';

describe('canTransition', () => {
  it('allows the normal forward path', () => {
    expect(canTransition('waiting', 'washing')).toBe(true);
    expect(canTransition('washing', 'ready')).toBe(true);
    expect(canTransition('ready', 'paid')).toBe(true);
  });

  it('allows voiding from any active state', () => {
    expect(canTransition('waiting', 'void')).toBe(true);
    expect(canTransition('washing', 'void')).toBe(true);
    expect(canTransition('ready', 'void')).toBe(true);
  });

  it('rejects skipping a state', () => {
    expect(canTransition('waiting', 'paid')).toBe(false);
    expect(canTransition('waiting', 'ready')).toBe(false);
  });

  it('rejects any transition out of a terminal state', () => {
    expect(canTransition('paid', 'waiting')).toBe(false);
    expect(canTransition('void', 'waiting')).toBe(false);
  });
});

describe('assertTransition', () => {
  it('does not throw for a valid transition', () => {
    expect(() => assertTransition('waiting', 'washing')).not.toThrow();
  });

  it('throws InvalidJobTransitionError for an invalid one', () => {
    expect(() => assertTransition('waiting', 'paid')).toThrow(InvalidJobTransitionError);
  });
});
