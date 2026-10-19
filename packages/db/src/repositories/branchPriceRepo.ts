import { overrideRange, type DoorstepVisitRules, type PricingPolicy } from '@mana/domain';
import { createPlatformDb, createShopDb, type D1Database } from '../client';
import { awayPricingRepo } from './awayPricingRepo';
import { CatalogError, catalogRepo, type CatalogData } from './catalogRepo';
import { menuRepo } from './menuRepo';
import { serviceRepo } from './serviceRepo';
import { runStatements } from '../sql';

/** One size's price at the branch: the same for every vehicle of the size, unless `mixed`. */
export interface BranchSizePrice {
  price: number;
  /** HQ's price (from the branch's price book) for this size. */
  list: number;
  /** The branch charges its own price, not HQ's. */
  own: boolean;
  /** Its vehicles have different prices (set one by one before): saving one price evens them. */
  mixed: boolean;
}

export interface BranchPriceCell {
  classKey: string;
  sizeKey: string;
  hub: BranchSizePrice | null;
  community: BranchSizePrice | null;
  /** Staff commission for this size, when every vehicle of it has the same. */
  commission: number | null;
  commissionMixed: boolean;
}

export interface BranchPriceSheet {
  bookName: string;
  bookId: string | null;
  books: { id: string; name: string; isDefault: boolean }[];
  policy: Pick<PricingPolicy, 'branchOverrides' | 'branchCanHideServices' | 'branchPicksBook' | 'maxIncreasePct' | 'maxDecreasePct' | 'roundToPaise'>;
  /** The community rule for each group (or all of them, `classKey` null). */
  communityRules: { classKey: string | null; percentBp: number; fixedPaise: number; minExtraPaise: number }[];
  doorstep: DoorstepVisitRules;
  groups: { key: string; name: string; sizes: { key: string; name: string; vehicles: { id: string; name: string }[] }[] }[];
  services: { id: string; name: string; description: string | null; popular: boolean; cells: BranchPriceCell[] }[];
}

/** Where each of the branch's vehicle types sits: its group and size, from its HQ body type. */
function vehicleSizes(data: CatalogData, types: { id: string; bodyTypeId: string | null }[]) {
  const classOf = new Map(data.classes.map((c) => [c.id, c]));
  const sizeOf = new Map(data.classes.flatMap((c) => c.sizes.map((z) => [z.id, { classKey: c.key, sizeKey: z.key }] as const)));
  const bodies = new Map(data.bodyTypes.map((b) => [b.id, b]));
  const out = new Map<string, { classKey: string; sizeKey: string }>();
  for (const vt of types) {
    const body = vt.bodyTypeId ? bodies.get(vt.bodyTypeId) : undefined;
    const size = body ? sizeOf.get(body.sizeId) : undefined;
    if (body && size && classOf.has(body.classId)) out.set(vt.id, size);
  }
  return out;
}

async function load(d1: D1Database, shopId: string) {
  const pdb = createPlatformDb(d1);
  const shop = await catalogRepo.branchOf(pdb, shopId);
  if (!shop?.businessId) throw new CatalogError('not_found', 'This branch isn’t part of the business.');
  const db = createShopDb(d1, shopId);
  await menuRepo.publishIfStale(d1, shopId);
  const [data, types, services, prices] = await Promise.all([
    catalogRepo.load(d1, shop.businessId),
    db.vehicleType.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, bodyTypeId: true } }),
    db.service.findMany({
      where: { active: true, catalogServiceId: { not: null } },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, description: true, popular: true },
    }),
    db.servicePrice.findMany({
      where: { listPrice: { not: null }, service: { catalogServiceId: { not: null } } },
      select: { serviceId: true, vehicleTypeId: true, mode: true, price: true, listPrice: true, source: true },
    }),
  ]);
  if (!data) throw new CatalogError('not_found', 'Business not found.');
  return { db, shop, data, types, services, prices, sizes: vehicleSizes(data, types) };
}

/** The branch's vehicle types of one group and size. */
function typesIn(sizes: Map<string, { classKey: string; sizeKey: string }>, classKey: string, sizeKey?: string) {
  return [...sizes].filter(([, z]) => z.classKey === classKey && (sizeKey == null || z.sizeKey === sizeKey)).map(([id]) => id);
}

const sizePrice = (rows: { price: number; listPrice: number | null; source: string }[]): BranchSizePrice | null => {
  if (!rows.length) return null;
  const first = rows[0]!;
  return {
    price: first.price,
    list: first.listPrice ?? first.price,
    own: rows.some((r) => r.source === 'override'),
    mixed: rows.some((r) => r.price !== first.price),
  };
};

/**
 * The owner's price sheet: HQ's services the branch sells, priced by group and size like Base
 * prices, from the branch's price book, with its own shop prices and staff commission per size.
 * Community prices follow the shop price by the rule; doorstep is the shop price plus the visit
 * charge. Sizes are what the vehicle size guide says, so the owner never types a price per car.
 */
export const branchPriceRepo = {
  async sheet(d1: D1Database, shopId: string): Promise<BranchPriceSheet> {
    const { db, shop, data, types, services, prices, sizes } = await load(d1, shopId);
    const [away, commissions] = await Promise.all([awayPricingRepo.forShop(d1, shopId), serviceRepo.listCommissionRates(db)]);
    const book = data.priceBooks.find((b) => b.id === shop.priceBookId) ?? data.priceBooks.find((b) => b.isDefault);
    const classKeyOf = new Map(data.classes.map((c) => [c.id, c.key]));
    const nameOf = new Map(types.map((t) => [t.id, t.name]));

    const groups = data.classes
      .map((c) => ({
        key: c.key,
        name: c.name,
        sizes: c.sizes
          .map((z) => ({ key: z.key, name: z.name, vehicles: typesIn(sizes, c.key, z.key).map((id) => ({ id, name: nameOf.get(id) ?? '' })) }))
          .filter((z) => z.vehicles.length > 0),
      }))
      .filter((g) => g.sizes.length > 0);

    const commissionOf = new Map(commissions.map((r) => [`${r.serviceId}|${r.vehicleTypeId}`, r.amount]));
    const sheetServices = services
      .map((s) => {
        const mine = prices.filter((p) => p.serviceId === s.id);
        const cells: BranchPriceCell[] = [];
        for (const g of groups) {
          for (const z of g.sizes) {
            const ids = new Set(z.vehicles.map((v) => v.id));
            const at = (mode: string) => mine.filter((p) => p.mode === mode && ids.has(p.vehicleTypeId));
            const hub = sizePrice(at('hub'));
            const community = sizePrice(at('doorstep'));
            if (!hub && !community) continue;
            const rates = [...ids].map((id) => commissionOf.get(`${s.id}|${id}`) ?? null);
            cells.push({
              classKey: g.key,
              sizeKey: z.key,
              hub,
              community,
              commission: rates[0] ?? null,
              commissionMixed: rates.some((r) => r !== rates[0]),
            });
          }
        }
        return { id: s.id, name: s.name, description: s.description, popular: s.popular, cells };
      })
      .filter((s) => s.cells.length > 0);

    return {
      bookName: book?.name ?? 'Standard',
      bookId: book?.id ?? null,
      /** HQ's price books, so the owner sees which one the branch is on (and may pick one, if HQ allows). */
      books: data.priceBooks.map((b) => ({ id: b.id, name: b.name, isDefault: b.isDefault })),
      policy: {
        branchOverrides: data.policy.branchOverrides,
        branchCanHideServices: data.policy.branchCanHideServices,
        branchPicksBook: data.policy.branchPicksBook,
        maxIncreasePct: data.policy.maxIncreasePct,
        maxDecreasePct: data.policy.maxDecreasePct,
        roundToPaise: data.policy.roundToPaise,
      },
      communityRules: data.adjustments
        .filter((a) => a.mode === 'doorstep')
        .map((a) => ({
          classKey: a.classId ? (classKeyOf.get(a.classId) ?? null) : null,
          percentBp: a.percentBp,
          fixedPaise: a.fixedPaise,
          minExtraPaise: a.minExtraPaise,
        })),
      doorstep: away.doorstep,
      groups,
      services: sheetServices,
    };
  },

  /**
   * One shop price for a service at one size: every vehicle of the size gets it (`null` = HQ's
   * price again). Commission, when sent, is set for each of them too.
   */
  async setSize(
    d1: D1Database,
    shopId: string,
    userId: string,
    input: { serviceId: string; classKey: string; sizeKey: string; price?: number | null; commission?: number | null },
  ) {
    const { db, prices, sizes } = await load(d1, shopId);
    const ids = new Set(typesIn(sizes, input.classKey, input.sizeKey));
    const rows = prices.filter((p) => p.serviceId === input.serviceId && p.mode === 'hub' && ids.has(p.vehicleTypeId));
    if (!rows.length) throw new CatalogError('not_found', 'This branch doesn’t sell that service for this size.');
    if (input.price !== undefined) {
      await menuRepo.setOverrides(
        d1,
        shopId,
        userId,
        rows.map((r) => ({ serviceId: input.serviceId, vehicleTypeId: r.vehicleTypeId, price: input.price === null ? null : input.price! })),
      );
    }
    if (input.commission !== undefined) {
      for (const r of rows) {
        await serviceRepo.setCommissionRate(db, { serviceId: input.serviceId, vehicleTypeId: r.vehicleTypeId, amount: input.commission });
      }
    }
    return { vehicles: rows.length };
  },

  /**
   * Every shop price of a group moved by `percent` from HQ's price (rounded to ₹1 and kept inside
   * what HQ allows), or all back to HQ's prices with `null`.
   */
  async shift(d1: D1Database, shopId: string, userId: string, input: { classKey: string; percent: number | null }) {
    const { data, prices, sizes } = await load(d1, shopId);
    const ids = new Set(typesIn(sizes, input.classKey));
    const rows = prices.filter((p) => p.mode === 'hub' && ids.has(p.vehicleTypeId));
    if (!rows.length) return { prices: 0 };
    if (input.percent != null) {
      if (!data.policy.branchOverrides) throw new CatalogError('invalid', 'Branch prices are switched off by the business.');
      if (input.percent > data.policy.maxIncreasePct || -input.percent > data.policy.maxDecreasePct) {
        throw new CatalogError('invalid', 'That’s more than the business allows.');
      }
    }
    const items = rows.map((r) => {
      const list = r.listPrice!;
      if (input.percent == null || input.percent === 0) return { serviceId: r.serviceId, vehicleTypeId: r.vehicleTypeId, price: null };
      const { min, max } = overrideRange(list, data.policy);
      const moved = Math.round((list * (100 + input.percent)) / 100 / 100) * 100;
      return { serviceId: r.serviceId, vehicleTypeId: r.vehicleTypeId, price: Math.min(max, Math.max(min, moved)) };
    });
    await menuRepo.setOverrides(d1, shopId, userId, items);
    return { prices: items.length };
  },

  /**
   * The owner moves the branch to another of HQ's price books, when HQ allows it. The branch then
   * starts from that book's prices: every shop price the owner set is cleared.
   */
  async setBook(d1: D1Database, shopId: string, bookId: string) {
    const { db, shop, data } = await load(d1, shopId);
    if (!data.policy.branchPicksBook) throw new CatalogError('invalid', 'Mana Wash HQ picks the price book for this branch.');
    const book = data.priceBooks.find((b) => b.id === bookId);
    if (!book) throw new CatalogError('not_found', 'Price book not found.');
    const current = data.priceBooks.find((b) => b.id === shop.priceBookId) ?? data.priceBooks.find((b) => b.isDefault);
    if (current?.id === book.id) return { bookName: book.name, cleared: 0 };
    const cleared = await db.branchPriceOverride.count({ where: { shopId } });
    await runStatements(d1, [
      { sql: 'DELETE FROM branch_price_overrides WHERE shop_id = ?', params: [shopId] },
      { sql: 'UPDATE shops SET price_book_id = ?, menu_version = 0 WHERE id = ?', params: [book.id, shopId] },
    ]);
    await menuRepo.publish(d1, shopId);
    return { bookName: book.name, cleared };
  },
};
