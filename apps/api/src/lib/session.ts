import type { userRepo } from '@mana/db';
import { isSeniorRole, SENIOR_PIN_DIGITS, toUserRole } from '@mana/domain';
import { createSessionToken } from './jwt';
import type { Env } from '../types';

export type DbUser = NonNullable<Awaited<ReturnType<typeof userRepo.findById>>>;

export function publicUser(user: DbUser) {
  const role = toUserRole(user.role);
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    role,
    hasPin: user.pinHash != null,
    /** Owners and managers on a PIN shorter than 6 digits must choose a new one before anything else. */
    pinUpgradeRequired: isSeniorRole(role) && user.pinHash != null && (user.pinDigits ?? 0) < SENIOR_PIN_DIGITS,
    shopId: user.shopId,
  };
}

/** `device`: the hash of the phone's key, tying the session to that phone (see SessionClaims.dv). */
export async function issueSession(user: DbUser, env: Env, device: string) {
  const token = await createSessionToken(
    {
      sub: user.id,
      shopId: user.shopId,
      role: publicUser(user).role,
      phone: user.phone,
      sv: user.sessionVersion,
      dv: device,
    },
    env.JWT_SECRET,
  );
  return { token, user: publicUser(user) };
}
