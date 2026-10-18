import { branchTownRepo, catalogRepo, createPlatformDb, createShopDb, isUniqueClash, menuRepo, shopRepo, userRepo } from '@mana/db';
import { townKey, type BranchServices } from '@mana/domain';
import type { Env } from '../types';
import { isPlanError, planBranch, type BranchPlan, type BranchRequest, type PlanError } from './branchPlan';

export interface NewOwner {
  name: string;
  phone: string;
  pin: { hash: string | null; digits: number | null; setAt: Date | null };
}

/**
 * Opens a planned branch with its owner. The plan is made again here, so what's opened is what
 * the server decides now: if another branch took the number (or another town the code) a moment
 * ago, the next plan has the next one. The town is made first (once, even when two branches open
 * in it at the same moment); if the owner can't be created the empty shop is deleted again.
 * Callers hold the business's branch lock and the owner's phone lock.
 */
export async function openBranch(
  env: Env,
  businessId: string,
  req: BranchRequest,
  owner: NewOwner,
  services: BranchServices,
  /** Head-office services it sells from the start (already checked). */
  menu: string[],
  /** The kinds of vehicle it washes (already checked). */
  vehicles: string[],
  accept: (plan: BranchPlan) => PlanError | null,
): Promise<{ plan: BranchPlan; shopId: string } | PlanError> {
  const platform = createPlatformDb(env.DB);
  for (let attempt = 0; ; attempt++) {
    const plan = await planBranch(env, businessId, req, platform);
    if (isPlanError(plan)) return plan;
    const refused = accept(plan);
    if (refused) return refused;

    const town = await branchTownRepo.ensureTown(env.DB, platform, businessId, plan.town);
    if (!town) {
      if (attempt >= 3) throw new Error('Couldn’t give the town a code');
      continue;
    }
    let shop;
    try {
      shop = await shopRepo.create(platform, {
        code: plan.code,
        name: plan.name,
        city: plan.town.name,
        businessId,
        townId: town.id,
        pincode: plan.pincode,
        latitude: req.latitude,
        longitude: req.longitude,
        // The agreement's services, all switched on to start with.
        allowHub: services.hub,
        allowCommunity: services.community,
        allowDoorstep: services.doorstep,
        offerHub: services.hub,
        offerCommunity: services.community,
        offerDoorstep: services.doorstep,
      });
    } catch (e) {
      if (isUniqueClash(e) && attempt < 3) continue;
      throw e;
    }
    // Branches opened before towns existed (their code already has the town's letters) join it.
    const legacy = (await branchTownRepo.branches(platform, businessId)).filter(
      (b) => b.id !== shop.id && !b.townId && b.code.startsWith(`${town.code}-`) && b.city && townKey(b.city) === town.nameKey,
    );
    for (const b of legacy) await branchTownRepo.linkBranch(env.DB, b.id, town.id, null);

    try {
      await userRepo.createWithPin(createShopDb(env.DB, shop.id), { name: owner.name, phone: owner.phone, role: 'owner', pin: owner.pin });
    } catch (e) {
      await shopRepo.deleteEmpty(platform, shop.id);
      throw e;
    }
    await catalogRepo.saveBranchMenu(env.DB, shop.id, menu);
    await catalogRepo.saveBranchVehicles(env.DB, businessId, shop.id, vehicles);
    // A failed first build is retried by the branch's first menu read or the nightly run.
    await menuRepo.publish(env.DB, shop.id).catch((e) => console.error(e));
    return { plan, shopId: shop.id };
  }
}
