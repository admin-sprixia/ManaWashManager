import {
  addDaysTo,
  doorstepRulesProblem,
  istDay,
  istInstant,
  joinDiscountProblem,
  parseDoorstepRules,
  parseJoinDiscountBp,
  type DoorstepVisitRules,
  type GeoPoint,
} from '@mana/domain';
import { createPlatformDb, type D1Database, type DbClient } from '../client';
import { insertRows, runStatements, SQL_NOW } from '../sql';

const DOORSTEP_KEY = 'doorstep.rules';
const JOIN_KEY = 'community.joinDiscountBp';

/** How head office prices washes away from the shop (beyond the per-size prices). */
export interface AwayPricing {
  /** What a home visit costs on top of the hub price. */
  doorstep: DoorstepVisitRules;
  /**
   * The neighbours discount when every flat of a community washes with us (basis points); it
   * grows a tenth at a time with the share of flats that join, never below the hub price.
   */
  joinDiscountBp: number;
}

/** A branch with no head office charges nothing extra for a visit. */
const NO_VISIT_CHARGE: DoorstepVisitRules = { visitFeePaise: 0, freeKm: 0, perKmPaise: 0, maxKm: 100, roundTo9: false, busy: [] };

/** The hidden line a doorstep visit charge goes on: one per branch, never on the menu. */
export const VISIT_CHARGE_NAME = 'Visit charge';
const visitServiceId = (shopId: string) => `visit-charge-${shopId}`;

async function save(d1: D1Database, businessId: string, key: string, value: string, phone: string | null) {
  await runStatements(
    d1,
    insertRows('business_settings', ['business_id', 'key', 'value', 'updated_by_phone'], [[businessId, key, value, phone]], {
      onConflict: `ON CONFLICT (business_id, key) DO UPDATE SET value = excluded.value,
        updated_by_phone = excluded.updated_by_phone, updated_at = ${SQL_NOW}`,
    }),
  );
}

export const awayPricingRepo = {
  /** A business's rules, from D1 or a platform client. */
  async get(from: D1Database | DbClient, businessId: string): Promise<AwayPricing> {
    const pdb = 'prepare' in from ? createPlatformDb(from) : from;
    return (await awayPricingRepo.many(pdb, [businessId])).get(businessId)!;
  },

  /** Each business's rules, from a platform client. */
  async many(platform: DbClient, businessIds: string[]): Promise<Map<string, AwayPricing>> {
    const rows = businessIds.length
      ? await platform.businessSetting.findMany({
          where: { businessId: { in: businessIds }, key: { in: [DOORSTEP_KEY, JOIN_KEY] } },
          select: { businessId: true, key: true, value: true },
        })
      : [];
    const value = (businessId: string, key: string) => rows.find((r) => r.businessId === businessId && r.key === key)?.value;
    return new Map(
      businessIds.map((id) => [
        id,
        { doorstep: parseDoorstepRules(value(id, DOORSTEP_KEY)), joinDiscountBp: parseJoinDiscountBp(value(id, JOIN_KEY)) },
      ]),
    );
  },

  /** The rules a branch prices by: its head office's, or no extras for a branch on its own. */
  async forShop(d1: D1Database, shopId: string): Promise<AwayPricing> {
    const shop = await createPlatformDb(d1).shop.findUnique({ where: { id: shopId }, select: { businessId: true } });
    if (!shop?.businessId) return { doorstep: NO_VISIT_CHARGE, joinDiscountBp: 0 };
    return awayPricingRepo.get(d1, shop.businessId);
  },

  async setDoorstep(d1: D1Database, businessId: string, rules: DoorstepVisitRules, phone: string | null) {
    const problem = doorstepRulesProblem(rules);
    if (problem) return { ok: false as const, message: problem };
    const clean: DoorstepVisitRules = {
      ...rules,
      busy: rules.busy.map((b) => ({ ...b, days: [...new Set(b.days)].sort() })),
    };
    await save(d1, businessId, DOORSTEP_KEY, JSON.stringify(clean), phone);
    return { ok: true as const, rules: clean };
  },

  async setJoinDiscount(d1: D1Database, businessId: string, discountBp: number, phone: string | null) {
    const problem = joinDiscountProblem(discountBp);
    if (problem) return { ok: false as const, message: problem };
    await save(d1, businessId, JOIN_KEY, String(discountBp), phone);
    return { ok: true as const, joinDiscountBp: discountBp };
  },

  /** The branch's "Visit charge" service, made the first time it's needed. */
  async visitService(db: DbClient, shopId: string): Promise<string> {
    const id = visitServiceId(shopId);
    await db.service.upsert({
      where: { id },
      create: {
        id,
        name: VISIT_CHARGE_NAME,
        description: 'Charged once per doorstep visit: the visit fee and distance.',
        active: false,
        appliesTo: 'both',
        modes: 'doorstep',
        kind: 'addon',
        showInApp: false,
        sortOrder: 10_000,
      },
      update: {},
    });
    return id;
  },

  /** Where the branch is: home visits are measured from its map pin. */
  async branchPoint(d1: D1Database, shopId: string): Promise<GeoPoint | null> {
    const shop = await createPlatformDb(d1).shop.findUnique({ where: { id: shopId }, select: { latitude: true, longitude: true } });
    return shop?.latitude != null && shop.longitude != null ? { latitude: shop.latitude, longitude: shop.longitude } : null;
  },

  /**
   * Where a customer lives, for a visit started without the phone's location: their home from
   * their last doorstep wash, else where they asked for a wash in the Mana Wash app.
   */
  async savedHome(db: DbClient, who: { phone: string } | { customerId: string }): Promise<GeoPoint | null> {
    const customer = await db.customer.findFirst({
      where: 'phone' in who ? { phone: who.phone } : { id: who.customerId },
      select: { phone: true, homeLatitude: true, homeLongitude: true },
    });
    if (customer?.homeLatitude != null && customer.homeLongitude != null) {
      return { latitude: customer.homeLatitude, longitude: customer.homeLongitude };
    }
    const phone = 'phone' in who ? who.phone : customer?.phone;
    if (!phone) return null;
    const asked = await db.serviceRequest.findFirst({
      where: { phone, latitude: { not: null }, longitude: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { latitude: true, longitude: true },
    });
    return asked?.latitude != null && asked.longitude != null ? { latitude: asked.latitude, longitude: asked.longitude } : null;
  },

  /** The home measured on this visit is where they live now. */
  async rememberHome(db: DbClient, customerId: string, point: GeoPoint) {
    await db.customer.update({ where: { id: customerId }, data: { homeLatitude: point.latitude, homeLongitude: point.longitude } });
  },

  /**
   * Whether this customer already had a doorstep wash on this IST day: a second car at the same
   * home is the same visit, so it pays no second visit charge.
   */
  async sameVisit(
    db: DbClient,
    who: { phone: string } | { customerId: string },
    at: Date,
    exceptJobId?: string,
  ): Promise<boolean> {
    const day = istDay(at);
    const found = await db.job.findFirst({
      where: {
        deliveryMode: 'doorstep',
        status: { not: 'void' },
        createdAt: { gte: istInstant(day, '00:00'), lt: istInstant(addDaysTo(day, 1), '00:00') },
        ...('phone' in who ? { customer: { phone: who.phone } } : { customerId: who.customerId }),
        ...(exceptJobId ? { id: { not: exceptJobId } } : {}),
      },
      select: { id: true },
    });
    return Boolean(found);
  },
};
