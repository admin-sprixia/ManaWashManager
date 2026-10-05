import { createPlatformDb, signupCodeRepo, type SignupPurpose } from '@mana/db';
import {
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_RESEND_SECONDS,
  LOGIN_CODE_TTL_MINUTES,
  LOGIN_CODES_PER_HOUR,
} from '@mana/domain';
import {
  bypassWhatsAppOtp,
  generateLoginCode,
  hashLoginCode,
  loginCodeExpiry,
  sendLoginCodeOnWhatsApp,
  whatsappConfigured,
} from './loginCode';
import { devCode, sameHex } from './recovery';
import type { Env } from '../types';

/**
 * WhatsApp codes for numbers that aren't (yet) an account's sign-in: a new shop, joining one,
 * moving an account to a new number, and the MANA Car Wash app. Same rules everywhere: a resend
 * wait, a cap per hour (and optionally per network address), 10 minutes to use it, 5 guesses.
 */

const HOUR_MS = 60 * 60 * 1000;

interface CodeRequest {
  env: Env;
  requestUrl: string;
  ip: string | null;
  phone: string;
  purpose: SignupPurpose;
  /** Who the code is for, mixed into its hash (see hashLoginCode). */
  subject: string;
  /** Codes one network address may ask for per hour, across numbers. */
  perIpPerHour?: number;
}

const tooMany = (retryAfter: number) => ({
  ok: false as const,
  status: 429 as const,
  body: {
    error: 'too_many' as const,
    retryAfter,
    message: `Too many codes asked for. Try again in ${Math.ceil(retryAfter / 60)} min.`,
  },
});

export async function sendPhoneCode(req: CodeRequest) {
  const platform = createPlatformDb(req.env.DB);
  const now = new Date();
  const recent = await signupCodeRepo.listForPhoneSince(platform, req.phone, new Date(now.getTime() - HOUR_MS));
  const latest = recent[0];
  if (latest) {
    const wait = Math.ceil(LOGIN_CODE_RESEND_SECONDS - (now.getTime() - latest.createdAt.getTime()) / 1000);
    if (wait > 0) {
      return { ok: false as const, status: 429 as const, body: { error: 'too_soon' as const, retryAfter: wait } };
    }
  }
  if (recent.length >= LOGIN_CODES_PER_HOUR) {
    const oldest = recent[recent.length - 1]!;
    return tooMany(Math.ceil((oldest.createdAt.getTime() + HOUR_MS - now.getTime()) / 1000));
  }
  if (
    req.perIpPerHour != null &&
    req.ip &&
    (await signupCodeRepo.countForIpSince(platform, req.ip, new Date(now.getTime() - HOUR_MS))) >= req.perIpPerHour
  ) {
    return tooMany(60 * 60);
  }

  const bypass = bypassWhatsAppOtp(req.env, req.requestUrl);
  if (!bypass && !whatsappConfigured(req.env)) {
    return {
      ok: false as const,
      status: 503 as const,
      body: { error: 'code_not_configured' as const, message: 'WhatsApp codes aren’t set up on the server yet.' },
    };
  }
  const code = bypass ? devCode(req.env) : generateLoginCode();
  const row = await signupCodeRepo.create(platform, {
    phone: req.phone,
    purpose: req.purpose,
    codeHash: await hashLoginCode(code, req.subject, req.env.JWT_SECRET),
    ip: req.ip,
    expiresAt: loginCodeExpiry(now),
  });
  await signupCodeRepo.retireOthers(platform, req.phone, row.id, now);
  if (!bypass && !(await sendLoginCodeOnWhatsApp(req.env, req.phone, code))) {
    await signupCodeRepo.consume(platform, row.id, now);
    return {
      ok: false as const,
      status: 502 as const,
      body: { error: 'send_failed' as const, message: 'Couldn’t send the WhatsApp message. Try again in a minute.' },
    };
  }
  return {
    ok: true as const,
    body: { sent: true as const, expiresInMinutes: LOGIN_CODE_TTL_MINUTES, resendAfter: LOGIN_CODE_RESEND_SECONDS },
  };
}

const codeExpired = {
  error: 'code_expired' as const,
  message: 'This code has expired or was replaced. Tap “Send a new code”.',
};
const tooManyGuesses = { ...codeExpired, message: 'Too many wrong tries. Tap “Send a new code”.' };

/** One guess is taken before comparing, and a right code is used up, so it works once. */
export async function checkPhoneCode(req: {
  env: Env;
  phone: string;
  purpose: SignupPurpose;
  subject: string;
  code: string;
}) {
  const platform = createPlatformDb(req.env.DB);
  const now = new Date();
  const expired = { ok: false as const, status: 410 as const, body: codeExpired };
  const live = await signupCodeRepo.findLive(platform, req.phone, req.purpose, now, LOGIN_CODE_MAX_ATTEMPTS);
  if (!live) return expired;
  const attemptsLeft = await signupCodeRepo.reserveGuess(platform, live.id, LOGIN_CODE_MAX_ATTEMPTS);
  if (attemptsLeft == null) return { ...expired, body: tooManyGuesses };
  const expected = await hashLoginCode(req.code, req.subject, req.env.JWT_SECRET);
  if (!sameHex(expected, live.codeHash)) {
    if (attemptsLeft <= 0) return { ...expired, body: tooManyGuesses };
    return {
      ok: false as const,
      status: 401 as const,
      body: { error: 'invalid_code' as const, message: 'That code isn’t right.', attemptsLeft },
    };
  }
  if (!(await signupCodeRepo.consume(platform, live.id, now))) return expired;
  return { ok: true as const };
}
