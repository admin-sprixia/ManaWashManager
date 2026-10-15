import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { normalizePhone, referralProblemMessage } from '@mana/domain';
import { drawPercent } from '../lib/random';
import {
  evaluateReferral,
  REFERRAL_RENEW_WINDOW_SECONDS,
  signReferralQuote,
  verifyReferralQuote,
} from '../lib/referral';
import { requireAuth } from '../middleware/auth';
import type { Env } from '../types';

const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .refine((p) => /^[6-9]\d{9}$/.test(p), 'Enter a valid 10-digit mobile number');

const quoteSchema = z.object({
  referrerPhone: phoneSchema,
  phone: phoneSchema,
  registrationNumber: z
    .string()
    .transform((r) => r.trim().toUpperCase().replace(/\s+/g, ''))
    .refine((r) => r.length >= 4 && r.length <= 15, 'Enter a valid registration number'),
  /** The quote being renewed: its percent is kept if it's for exactly this referral. */
  previousToken: z.string().max(2000).optional(),
});

// Online only, like coupons: the rules depend on the database as it stands right now.
export const referralRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  // Checks a referral at the counter and draws the new customer's discount. The phone shows it
  // and sends the signed quote back with the wash.
  .post('/quote', zValidator('json', quoteSchema), async (c) => {
    const body = c.req.valid('json');
    if (body.registrationNumber.startsWith('WALK-IN')) {
      return c.json(
        { error: 'referral_invalid' as const, message: 'Referral offers need the vehicle number.' },
        409,
      );
    }
    const db = c.get('db');
    const result = await evaluateReferral(db, body);
    if (result.problem) {
      return c.json(
        { error: 'referral_invalid' as const, message: referralProblemMessage(result.problem) },
        409,
      );
    }
    const shopId = c.get('session').shopId;
    const previous = body.previousToken
      ? await verifyReferralQuote(body.previousToken, c.env.JWT_SECRET, {
          allowExpiredSeconds: REFERRAL_RENEW_WINDOW_SECONDS,
        })
      : null;
    const renewing =
      previous != null &&
      previous.shopId === shopId &&
      previous.referrerCustomerId === result.referrer.id &&
      previous.phone === body.phone &&
      previous.registrationNumber === body.registrationNumber;
    const quote = {
      shopId,
      referrerCustomerId: result.referrer.id,
      referrerName: result.referrer.name,
      referrerPhone: result.referrer.phone,
      phone: body.phone,
      registrationNumber: body.registrationNumber,
      percent: renewing ? previous.percent : drawPercent(),
    };
    const { token, expiresAt } = await signReferralQuote(quote, c.env.JWT_SECRET);
    return c.json({
      token,
      percent: quote.percent,
      referrer: { name: quote.referrerName, phone: quote.referrerPhone },
      expiresAt: expiresAt.toISOString(),
    });
  });
