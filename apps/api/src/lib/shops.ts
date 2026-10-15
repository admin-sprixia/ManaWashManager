import { createPlatformDb, createShopDb, menuRepo, shopRepo, userRepo } from '@mana/db';
import { SHOP_CODE_LENGTH } from '@mana/domain';
import { randomDigits } from './random';
import type { Env } from '../types';

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
 * A new branch with its owner, made together: if the owner can't be created the empty shop is
 * deleted again. Only HQ opens branches (routes/business.ts), so every branch belongs to a
 * business and gets its menu straight away. An owner who already works at another branch keeps
 * their PIN (`pin`); anyone else signs in with a WhatsApp code and picks one.
 */
export async function createShopWithOwner(
  env: Env,
  data: {
    shopName: string;
    city: string | null;
    ownerName: string;
    phone: string;
    pin: { hash: string | null; digits: number | null; setAt: Date | null };
    businessId: string;
  },
) {
  const platform = createPlatformDb(env.DB);
  const shop = await shopRepo.create(platform, {
    code: await newShopCode(env),
    name: data.shopName,
    city: data.city,
    businessId: data.businessId,
  });
  let owner;
  try {
    owner = await userRepo.createWithPin(createShopDb(env.DB, shop.id), {
      name: data.ownerName,
      phone: data.phone,
      role: 'owner',
      pin: data.pin,
    });
  } catch (e) {
    await shopRepo.deleteEmpty(platform, shop.id);
    throw e;
  }
  // A failed first build is retried by the branch's first menu read or the nightly run.
  await menuRepo.publish(env.DB, shop.id).catch((e) => console.error(e));
  return { shop, owner };
}
