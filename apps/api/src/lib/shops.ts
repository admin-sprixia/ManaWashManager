import { createPlatformDb, createShopDb, platformSettingsRepo, shopRepo, userRepo } from '@mana/db';
import { SHOP_CODE_LENGTH, SHOP_TRIAL_DAYS } from '@mana/domain';
import { randomDigits } from './random';
import { isDevMode } from './recovery';
import type { Env } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

export const SIGNUP_OPEN_SETTING = 'signup.open';

/**
 * Whether a new number may start its own shop. MANA runs its own branches only, so this is off
 * on staging and production unless the platform setting says `true`; local dev (and CI) default
 * to on so the sign-up code stays tested. Joining an existing shop with its shop ID is unaffected.
 */
export async function signupOpen(env: Env, requestUrl: string): Promise<boolean> {
  const value = await platformSettingsRepo.get(createPlatformDb(env.DB), SIGNUP_OPEN_SETTING);
  if (value != null) return value === 'true';
  return isDevMode(env, requestUrl);
}

export const signupClosed = {
  error: 'signup_closed' as const,
  message: 'New shops can’t be started here. Ask your owner to add you to the team.',
};

/** A shop ID nobody has yet. Never starts with 0, so it reads as a normal number. */
async function newShopCode(env: Env): Promise<string> {
  const platform = createPlatformDb(env.DB);
  for (let i = 0; i < 10; i++) {
    const code = randomDigits(SHOP_CODE_LENGTH);
    if (code.startsWith('0')) continue;
    if (!(await shopRepo.findByCode(platform, code))) return code;
  }
  throw new Error('Could not find a free shop code');
}

/**
 * A new shop with its owner, made together: if the owner can't be created the empty shop is
 * deleted again. Sign-up starts on the free trial; an owner's extra branch starts on Free.
 */
export async function createShopWithOwner(
  env: Env,
  data: {
    shopName: string;
    city: string | null;
    ownerName: string;
    phone: string;
    pinHash: string;
    trial: boolean;
  },
) {
  const platform = createPlatformDb(env.DB);
  const shop = await shopRepo.create(platform, {
    code: await newShopCode(env),
    name: data.shopName,
    city: data.city,
    ...(data.trial
      ? { plan: 'trial', trialEndsAt: new Date(Date.now() + SHOP_TRIAL_DAYS * DAY_MS) }
      : { plan: 'free', trialEndsAt: null }),
  });
  try {
    return await userRepo.createWithPin(createShopDb(env.DB, shop.id), {
      name: data.ownerName,
      phone: data.phone,
      role: 'owner',
      pinHash: data.pinHash,
    });
  } catch (e) {
    await shopRepo.deleteEmpty(platform, shop.id);
    throw e;
  }
}
