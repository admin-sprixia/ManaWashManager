import { createPlatformDb, createShopDb, menuRepo, shopRepo, userRepo } from '@mana/db';
import { branchCode } from '@mana/domain';
import type { Env } from '../types';

/** The next branch code in a town: KVR-01 for the first Kovur branch, then KVR-02. */
async function nextBranchCode(env: Env, townCode: string): Promise<string> {
  const taken = await createPlatformDb(env.DB).shop.findMany({
    where: { code: { startsWith: `${townCode}-` } },
    select: { code: true },
  });
  const highest = taken.reduce((max, s) => Math.max(max, Number(s.code.slice(townCode.length + 1)) || 0), 0);
  return branchCode(townCode, highest + 1);
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
    /** The branch's name: its town. */
    town: string;
    /** The town's 3-letter code (KVR), from which the branch code is made (KVR-01). */
    townCode: string;
    ownerName: string;
    phone: string;
    pin: { hash: string | null; digits: number | null; setAt: Date | null };
    businessId: string;
  },
) {
  const platform = createPlatformDb(env.DB);
  // Two branches opened in the same town at the same moment would want the same number: the
  // code is unique, so the second try takes the next one.
  let shop;
  for (let attempt = 0; ; attempt++) {
    try {
      shop = await shopRepo.create(platform, {
        code: await nextBranchCode(env, data.townCode),
        name: data.town,
        city: data.town,
        businessId: data.businessId,
      });
      break;
    } catch (e) {
      if (attempt >= 2) throw e;
    }
  }
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
