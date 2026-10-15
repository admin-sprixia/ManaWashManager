import { createPlatformDb, securityRepo, userRepo } from '@mana/db';
import { forgetShop } from '../middleware/auth';
import type { Env } from '../types';

/**
 * Clears someone's PIN on every branch they work at, signs out all their phones and stops
 * trusting them, and records who did it. Nobody is signed in by this: the person proves their
 * number with a WhatsApp code, picks a new PIN, and is told who reset it.
 */
export async function resetPin(
  env: Env,
  target: { phone: string; shopId: string },
  by: { phone: string; label: string },
  now = new Date(),
) {
  const platform = createPlatformDb(env.DB);
  const rows = await userRepo.listByPhone(platform, target.phone);
  await userRepo.setPinHashForPhone(platform, target.phone, null, now);
  await securityRepo.forgetAll(platform, target.phone);
  await securityRepo.logReset(platform, { phone: target.phone, shopId: target.shopId, byPhone: by.phone, byLabel: by.label }, now);
  for (const shopId of new Set(rows.map((r) => r.shopId))) forgetShop(shopId);
}

/** Whether this number also works at a branch other than `shopId`. */
export async function worksElsewhere(env: Env, phone: string, shopId: string) {
  const rows = await userRepo.listByPhone(createPlatformDb(env.DB), phone);
  return rows.some((r) => r.shopId !== shopId);
}
