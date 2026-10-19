import type { PostOffice, PostOfficeKind } from '@mana/domain';
import type { D1Database, DbClient } from '../client';
import { newId } from '../ids';
import { runStatements } from '../sql';

/**
 * Towns and pincodes for opening branches: India Post's offices (reference data, loaded by
 * scripts/import-post-offices.mjs), the towns a business has branches in with their codes for
 * good, and what its branches already use. Platform client: none of this is shop-scoped.
 */

export interface BranchTownRow {
  id: string;
  code: string;
  name: string;
  nameKey: string;
  district: string;
  state: string;
}

export interface BusinessBranchRow {
  id: string;
  code: string;
  name: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  townId: string | null;
}

const KINDS = new Set<PostOfficeKind>(['HO', 'PO', 'BO']);

export const branchTownRepo = {
  /** Every office of a pincode; none for a pincode India Post doesn't have. */
  async postOffices(pdb: DbClient, pincode: string): Promise<PostOffice[]> {
    const rows = await pdb.postOffice.findMany({ where: { pincode }, orderBy: { name: 'asc' } });
    return rows.map((r) => ({
      name: r.name,
      kind: KINDS.has(r.kind as PostOfficeKind) ? (r.kind as PostOfficeKind) : 'BO',
      district: r.district,
      state: r.state,
      latitude: r.latitude,
      longitude: r.longitude,
    }));
  },

  /** Whether the office list has been loaded at all (an empty table means the import never ran). */
  async hasPostOffices(pdb: DbClient): Promise<boolean> {
    return (await pdb.postOffice.findFirst({ select: { pincode: true } })) != null;
  },

  async towns(pdb: DbClient, businessId: string): Promise<BranchTownRow[]> {
    return pdb.branchTown.findMany({
      where: { businessId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, code: true, name: true, nameKey: true, district: true, state: true },
    });
  },

  async branches(pdb: DbClient, businessId: string): Promise<BusinessBranchRow[]> {
    return pdb.shop.findMany({
      where: { businessId, kind: 'branch' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, code: true, name: true, city: true, latitude: true, longitude: true, status: true, townId: true },
    });
  },

  /** Branch codes anywhere on the platform that start with a town code (codes are unique platform-wide). */
  async codesStartingWith(pdb: DbClient, townCode: string): Promise<string[]> {
    const rows = await pdb.shop.findMany({ where: { code: { startsWith: `${townCode}-` } }, select: { code: true } });
    return rows.map((r) => r.code);
  },

  /**
   * The town, made if it's new. Two requests making the same town at once end with one row; a
   * clash on the code (another town took it a moment ago) gives null, and the caller plans again.
   */
  async ensureTown(
    d1: D1Database,
    pdb: DbClient,
    businessId: string,
    town: { code: string; name: string; nameKey: string; district: string; state: string },
  ): Promise<BranchTownRow | null> {
    await runStatements(d1, [
      {
        sql: `INSERT OR IGNORE INTO branch_towns (id, business_id, code, name, name_key, district, state) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        params: [newId(), businessId, town.code, town.name, town.nameKey, town.district, town.state],
      },
    ]);
    const row = await pdb.branchTown.findFirst({
      where: { businessId, state: town.state, district: town.district, nameKey: town.nameKey },
      select: { id: true, code: true, name: true, nameKey: true, district: true, state: true },
    });
    return row && row.code === town.code ? row : null;
  },

  /** Ties a branch opened before towns existed to its town (its code already starts with the town's). */
  async linkBranch(d1: D1Database, shopId: string, townId: string, pincode: string | null) {
    await runStatements(d1, [
      {
        sql: 'UPDATE shops SET town_id = ?, pincode = COALESCE(pincode, ?) WHERE id = ? AND town_id IS NULL',
        params: [townId, pincode, shopId],
      },
    ]);
  },
};
