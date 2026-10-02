/**
 * Referrals: an existing customer sends a genuinely new one. The new customer gets a random
 * 5–10% off their first wash; once it's paid, the referrer gets their own random 5–10% coupon
 * (same rules as comeback coupons). Percentages are drawn with `pickCouponPercent`.
 */

/** How long a referral quote shown at the counter stays valid before it must be re-checked. */
export const REFERRAL_QUOTE_MINUTES = 30;

export type ReferralStatus = 'pending' | 'rewarded' | 'counted' | 'cancelled';

export type ReferralProblem =
  | 'self'
  | 'referrer_unknown'
  | 'referrer_no_paid_visit'
  | 'phone_known'
  | 'vehicle_known';

export function referralProblemMessage(problem: ReferralProblem): string {
  switch (problem) {
    case 'self':
      return 'A customer can’t refer themselves.';
    case 'referrer_unknown':
      return 'No customer with that number yet — the person referring must have visited before.';
    case 'referrer_no_paid_visit':
      return 'The person referring needs at least one paid wash first.';
    case 'phone_known':
      return 'Referral offers are only for new customers — this number has visited before.';
    case 'vehicle_known':
      return 'Referral offers are only for new customers — this vehicle has visited before.';
  }
}

/** Every rule a referral must pass, as pure checks over what the database says. */
export function checkReferral(input: {
  referrerPhone: string;
  newPhone: string;
  referrerExists: boolean;
  referrerPaidVisits: number;
  newPhoneKnown: boolean;
  newVehicleKnown: boolean;
}): ReferralProblem | null {
  if (input.referrerPhone === input.newPhone) return 'self';
  if (input.newPhoneKnown) return 'phone_known';
  if (input.newVehicleKnown) return 'vehicle_known';
  if (!input.referrerExists) return 'referrer_unknown';
  if (input.referrerPaidVisits < 1) return 'referrer_no_paid_visit';
  return null;
}
