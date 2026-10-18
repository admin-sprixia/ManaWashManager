import { BRANCH_SERVICES_SELECT, branchServicesOf, type BranchServices } from '@mana/domain';
import type { D1Database, DbClient } from '../client';
import { runStatements } from '../sql';

/**
 * What a branch offers (packages/domain branchServices.ts): head office's allowed services, the
 * owner's switches, and what runs. Writes mark the branch's menu out of date, so its next build
 * makes, brings back or pauses its hub and community team to match. Platform client.
 */

const LIVE_ORDER = ['waitlist', 'awaiting_payment', 'active'];

export const branchServiceRepo = {
  async get(pdb: DbClient, shopId: string) {
    const shop = await pdb.shop.findUnique({ where: { id: shopId }, select: BRANCH_SERVICES_SELECT });
    return shop ? branchServicesOf(shop) : null;
  },

  /** Community plans still running (or waiting for payment or a place) at the branch. */
  async runningPlans(pdb: DbClient, shopId: string): Promise<number> {
    return pdb.placeOrder.count({ where: { shopId, status: { in: LIVE_ORDER } } });
  },

  async setOffered(d1: D1Database, shopId: string, offered: BranchServices) {
    await runStatements(d1, [
      {
        sql: 'UPDATE shops SET offer_hub = ?, offer_community = ?, offer_doorstep = ?, menu_version = 0 WHERE id = ?',
        params: [offered.hub, offered.community, offered.doorstep, shopId],
      },
    ]);
  },

  async setAllowed(d1: D1Database, shopId: string, allowed: BranchServices, offered: BranchServices) {
    await runStatements(d1, [
      {
        sql: `UPDATE shops SET allow_hub = ?, allow_community = ?, allow_doorstep = ?,
                offer_hub = ?, offer_community = ?, offer_doorstep = ?, menu_version = 0 WHERE id = ?`,
        params: [allowed.hub, allowed.community, allowed.doorstep, offered.hub, offered.community, offered.doorstep, shopId],
      },
    ]);
  },
};
