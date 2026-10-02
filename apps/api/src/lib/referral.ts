import { jwtVerify, SignJWT } from 'jose';
import { couponRepo, referralRepo, type DbClient } from '@mana/db';
import {
  addDays,
  checkReferral,
  COUPON_VALID_DAYS,
  generateCouponCode,
  REFERRAL_QUOTE_MINUTES,
  type ReferralProblem,
} from '@mana/domain';
import { drawPercent, randomBytes } from './random';

/**
 * The New Wash screen shows the referral discount before the wash is saved, so the percentage
 * is drawn once, server-side, and handed to the phone inside a short-lived signed quote. The
 * wash request sends the quote back; the server trusts only the signature, never a number the
 * phone typed, and re-checks every rule at that moment.
 */
export interface ReferralQuote {
  /** Every shop's quotes share one signing key, so a quote is only honoured in its own shop. */
  shopId: string;
  referrerCustomerId: string;
  referrerName: string | null;
  referrerPhone: string;
  phone: string;
  registrationNumber: string;
  percent: number;
}

const AUDIENCE = 'mana:referral-quote';
/**
 * An expired quote can still be renewed (same percent, rules re-checked) for this long, so a
 * New Wash screen left open doesn't redraw the discount the customer was already told.
 */
export const REFERRAL_RENEW_WINDOW_SECONDS = 12 * 60 * 60;

export async function signReferralQuote(quote: ReferralQuote, secret: string) {
  const expiresAt = new Date(Date.now() + REFERRAL_QUOTE_MINUTES * 60 * 1000);
  const token = await new SignJWT({ ...quote })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(new TextEncoder().encode(secret));
  return { token, expiresAt };
}

export async function verifyReferralQuote(
  token: string,
  secret: string,
  { allowExpiredSeconds = 0 }: { allowExpiredSeconds?: number } = {},
): Promise<ReferralQuote | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      audience: AUDIENCE,
      clockTolerance: allowExpiredSeconds,
    });
    const p = payload as Partial<ReferralQuote>;
    if (
      typeof p.shopId !== 'string' ||
      typeof p.referrerCustomerId !== 'string' ||
      typeof p.referrerPhone !== 'string' ||
      typeof p.phone !== 'string' ||
      typeof p.registrationNumber !== 'string' ||
      typeof p.percent !== 'number'
    ) {
      return null;
    }
    return {
      shopId: p.shopId,
      referrerCustomerId: p.referrerCustomerId,
      referrerName: typeof p.referrerName === 'string' ? p.referrerName : null,
      referrerPhone: p.referrerPhone,
      phone: p.phone,
      registrationNumber: p.registrationNumber,
      percent: p.percent,
    };
  } catch {
    return null;
  }
}

/** Looks up everything `checkReferral` needs, as the database stands right now. */
export async function evaluateReferral(
  db: DbClient,
  input: { referrerPhone: string; phone: string; registrationNumber: string },
): Promise<
  | { problem: ReferralProblem }
  | { problem: null; referrer: { id: string; name: string | null; phone: string } }
> {
  const [referrer, newCustomer, newVehicle] = await Promise.all([
    db.customer.findFirst({
      where: { phone: input.referrerPhone },
      select: { id: true, name: true, phone: true },
    }),
    db.customer.findFirst({ where: { phone: input.phone }, select: { id: true } }),
    db.vehicle.findFirst({
      where: { registrationNumber: input.registrationNumber },
      select: { id: true },
    }),
  ]);
  const paidVisits = referrer ? await referralRepo.paidVisits(db, referrer.id) : 0;
  const problem = checkReferral({
    referrerPhone: input.referrerPhone,
    newPhone: input.phone,
    referrerExists: Boolean(referrer),
    referrerPaidVisits: paidVisits,
    newPhoneKnown: Boolean(newCustomer),
    newVehicleKnown: Boolean(newVehicle),
  });
  if (problem || !referrer) return { problem: problem ?? 'referrer_unknown' };
  return { problem: null, referrer };
}

/**
 * The referred wash was paid: reward the referrer with their own coupon, unless they already
 * hold a live referral coupon (then the referral is only counted). Safe to call more than
 * once — only the first call moves a pending referral on.
 */
export async function settleReferralForPaidJob(db: DbClient, jobId: string, userId: string) {
  const referral = await referralRepo.findByJob(db, jobId);
  if (!referral || referral.status !== 'pending') return null;
  const now = new Date();

  const vehicle = await referralRepo.latestVehicleOf(db, referral.referrerCustomerId);
  if (!vehicle || (await couponRepo.hasLiveReferralCoupon(db, referral.referrerCustomerId, now))) {
    await referralRepo.settle(db, referral.id, { status: 'counted', now });
    return null;
  }

  const percent = drawPercent();
  const expiresAt = addDays(now, COUPON_VALID_DAYS);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const coupon = await couponRepo.issue(db, {
        kind: 'referral',
        vehicleId: vehicle.id,
        customerId: referral.referrerCustomerId,
        code: generateCouponCode(vehicle.registrationNumber, randomBytes(6)),
        percent,
        expiresAt,
        issuedByUserId: userId,
        now,
      });
      const settled = await referralRepo.settle(db, referral.id, {
        status: 'rewarded',
        rewardCouponId: coupon.id,
        now,
      });
      // Lost a race with another settle: take this duplicate coupon back.
      if (!settled) await couponRepo.cancelIfUnused(db, coupon.id, 'replaced', now);
      return settled ? coupon : null;
    } catch (e) {
      if (attempt === 3) throw e;
    }
  }
  return null;
}

/** The referred wash was voided: cancel the referral and take back the reward if it's unused. */
export async function cancelReferralForVoidedJob(db: DbClient, jobId: string) {
  const referral = await referralRepo.findByJob(db, jobId);
  if (!referral || referral.status === 'cancelled') return;
  const now = new Date();
  if (referral.rewardCouponId) {
    await couponRepo.cancelIfUnused(db, referral.rewardCouponId, 'referral_voided', now);
  }
  await referralRepo.cancel(db, referral.id, now);
}
