import { createPlatformDb, createShopDb, shopRepo, userRepo } from '@mana/db';
import { SHOP_CODE_LENGTH, SHOP_TRIAL_DAYS } from '@mana/domain';
import { randomDigits } from './random';
import type { Env } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

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
 * A new shop on its own free trial with its owner, made together: if the owner can't be created
 * the empty shop is deleted again. Used by sign-up and by an owner opening another branch.
 */
export async function createShopWithOwner(
  env: Env,
  data: {
    shopName: string;
    city: string | null;
    ownerName: string;
    phone: string;
    pinHash: string;
  },
) {
  const platform = createPlatformDb(env.DB);
  const shop = await shopRepo.create(platform, {
    code: await newShopCode(env),
    name: data.shopName,
    city: data.city,
    trialEndsAt: new Date(Date.now() + SHOP_TRIAL_DAYS * DAY_MS),
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
