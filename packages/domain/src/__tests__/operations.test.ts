import { describe, expect, it } from 'vitest';
import { cashDifference, cashHeld, closeNeedsNote, expectedCash, handoverDifference } from '../cash';
import { canMarkAttendance, daysWorked, jobCommission, noAbsences, splitCommission } from '../commission';
import { checkReferral } from '../referrals';

describe('cash close', () => {
  it('expects float + shop cash + doorstep cash handed in − cash paid out', () => {
    expect(expectedCash({ openingFloat: 50000, cashIn: 120000, handedIn: 0, cashExpenses: 30000 })).toBe(140000);
    expect(expectedCash({ openingFloat: 50000, cashIn: 120000, handedIn: 48000, cashExpenses: 30000 })).toBe(188000);
  });

  it('holds doorstep cash until a handover settles it, never below nothing', () => {
    expect(cashHeld(96000, 0)).toBe(96000);
    expect(cashHeld(96000, 48000)).toBe(48000);
    expect(cashHeld(96000, 96000)).toBe(0);
    // A doorstep payment moved from cash to UPI after it was handed over.
    expect(cashHeld(48000, 96000)).toBe(0);
  });

  it('signs a handover as received − due', () => {
    expect(handoverDifference(48000, 48000)).toBe(0);
    expect(handoverDifference(48000, 40000)).toBe(-8000);
    expect(handoverDifference(48000, 50000)).toBe(2000);
  });

  it('signs the difference as counted − expected and only asks for a note on a mismatch', () => {
    expect(cashDifference(140000, 140000)).toBe(0);
    expect(cashDifference(140000, 135000)).toBe(-5000);
    expect(cashDifference(140000, 141000)).toBe(1000);
    expect(closeNeedsNote(0)).toBe(false);
    expect(closeNeedsNote(-5000)).toBe(true);
    expect(closeNeedsNote(1)).toBe(true);
  });
});

describe('commission', () => {
  it('sums per-unit rates by quantity', () => {
    expect(
      jobCommission([
        { commissionAtTime: 4000, quantity: 1 },
        { commissionAtTime: 500, quantity: 2 },
      ]),
    ).toBe(5000);
  });

  it('splits equally and hands leftover paise out deterministically', () => {
    const shares = splitCommission(1000, ['c', 'a', 'b']);
    expect([...shares.entries()]).toEqual([
      ['a', 334],
      ['b', 333],
      ['c', 333],
    ]);
    expect([...shares.values()].reduce((s, v) => s + v, 0)).toBe(1000);
  });

  it('ignores duplicate people and empty input', () => {
    expect([...splitCommission(900, ['a', 'a', 'b']).values()]).toEqual([450, 450]);
    expect(splitCommission(900, []).size).toBe(0);
    expect(splitCommission(0, ['a']).size).toBe(0);
  });

  it('counts half days as half', () => {
    expect(daysWorked(['present', 'half', 'absent', 'present'])).toBe(2.5);
  });
});

describe('attendance', () => {
  it('lets the owner mark everyone and a manager mark staff, never themselves', () => {
    expect(canMarkAttendance('owner', 'manager', false)).toBe(true);
    expect(canMarkAttendance('owner', 'owner', false)).toBe(true);
    expect(canMarkAttendance('owner', 'owner', true)).toBe(false);
    expect(canMarkAttendance('manager', 'staff', false)).toBe(true);
    expect(canMarkAttendance('manager', 'manager', false)).toBe(false);
    expect(canMarkAttendance('manager', 'owner', false)).toBe(false);
    expect(canMarkAttendance('manager', 'manager', true)).toBe(false);
    expect(canMarkAttendance('staff', 'staff', false)).toBe(false);
  });

  it('spots a month with no absences or half days', () => {
    expect(noAbsences(['present', 'present'])).toBe(true);
    expect(noAbsences(['present', 'half'])).toBe(false);
    expect(noAbsences(['present', 'absent'])).toBe(false);
    expect(noAbsences([])).toBe(false);
  });
});

describe('checkReferral', () => {
  const ok = {
    referrerPhone: '9800000001',
    newPhone: '9800000002',
    referrerExists: true,
    referrerPaidVisits: 1,
    newPhoneKnown: false,
    newVehicleKnown: false,
  };

  it('accepts a genuinely new customer referred by a paying one', () => {
    expect(checkReferral(ok)).toBeNull();
  });

  it('rejects self-referral, returning customers and unknown or unpaid referrers', () => {
    expect(checkReferral({ ...ok, newPhone: ok.referrerPhone })).toBe('self');
    expect(checkReferral({ ...ok, newPhoneKnown: true })).toBe('phone_known');
    expect(checkReferral({ ...ok, newVehicleKnown: true })).toBe('vehicle_known');
    expect(checkReferral({ ...ok, referrerExists: false, referrerPaidVisits: 0 })).toBe('referrer_unknown');
    expect(checkReferral({ ...ok, referrerPaidVisits: 0 })).toBe('referrer_no_paid_visit');
  });
});
