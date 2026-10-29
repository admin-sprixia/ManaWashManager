import {
  BRANCH_SERVICES_SELECT,
  branchServicesOf,
  type BranchServices,
  BODY_TYPES,
  VEHICLE_CLASSES,
  SIZE_NAMES,
  catalogIds,
  categoryForClass,
  parseChecklist,
  parsePricingPolicy,
  parseServiceKind,
  parseServiceModes,
  parseTeamPlaces,
  servicePlaces,
  type BranchStatus,
  type ServiceKind,
  type ServicePlaces,
  type TeamPlaces,
  type DeliveryMode,
  type PricingPolicy,
  type ServiceModes,
  type VehicleCategory,
} from '@mana/domain';
import { createPlatformDb, createShopDb, type D1Database, type DbClient } from '../client';
import { awayPricingRepo, type AwayPricing } from './awayPricingRepo';
import { newId } from '../ids';
import { insertRows, queryRows, runStatements, SQL_NOW, type SqlStatement } from '../sql';

/**
 * The business catalog of the service network: vehicle classes, sizes and body types, services,
 * price books, pricing rules and policy. Every read and write is pinned to one business id.
 * Writes bump `businesses.catalog_version`, which marks every branch's menu as out of date;
 * menuRepo.publish rebuilds them.
 */

export type CatalogErrorCode =
  | 'needs_name'
  | 'not_found'
  | 'invalid'
  | 'nested_combo'
  | 'in_use'
  | 'last_admin'
  | 'not_on_team'
  | 'default_book';

export class CatalogError extends Error {
  constructor(
    readonly code: CatalogErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CatalogError';
  }
}

const fail = (code: CatalogErrorCode, message: string): never => {
  throw new CatalogError(code, message);
};

/** Where each pricing policy field is kept in business_settings. */
const POLICY_KEYS: Readonly<Record<keyof PricingPolicy, string>> = {
  roundToPaise: 'pricing.roundToPaise',
  branchOverrides: 'pricing.branchOverrides',
  maxIncreasePct: 'pricing.maxIncreasePct',
  maxDecreasePct: 'pricing.maxDecreasePct',
  branchCanHideServices: 'pricing.branchCanHideServices',
  branchPicksBook: 'pricing.branchPicksBook',
};

const SIZE_COUNT = VEHICLE_CLASSES.reduce((n, c) => n + c.sizes.length, 0);

const bump = (businessId: string): SqlStatement => ({
  sql: 'UPDATE businesses SET catalog_version = catalog_version + 1 WHERE id = ?',
  params: [businessId],
});

/** `col = ?, …` for the fields a patch actually sets; null when it sets none. */
function setClause(fields: readonly (readonly [string, unknown])[]): { sql: string; params: unknown[] } | null {
  const used = fields.filter(([, value]) => value !== undefined);
  if (!used.length) return null;
  return { sql: used.map(([column]) => `${column} = ?`).join(', '), params: used.map(([, value]) => value) };
}

const adjustmentId = (businessId: string, mode: DeliveryMode, classId: string | null) =>
  `ma_${businessId}_${mode}_${classId ?? 'all'}`;

export interface CatalogClassView {
  id: string;
  key: string;
  name: string;
  category: VehicleCategory;
  sortOrder: number;
  sizes: { id: string; key: string; name: string; sortOrder: number }[];
}

/** A service's details besides its name, places, vehicles and combo; left out = unchanged. */
export interface ServiceDetails {
  teamAt?: TeamPlaces;
  durationMin?: number | null;
  kind?: ServiceKind;
  popular?: boolean;
  showInApp?: boolean;
  /** Shown to customers as coming soon, without a price; no branch sells it yet. */
  comingSoon?: boolean;
  checklist?: string[];
}

export interface CatalogServiceView {
  id: string;
  name: string;
  description: string | null;
  modes: ServiceModes;
  /** Where the community team does it; with `modes`, the three places below. */
  teamAt: TeamPlaces;
  places: ServicePlaces;
  durationMin: number | null;
  kind: ServiceKind;
  popular: boolean;
  showInApp: boolean;
  /** Shown to customers as coming soon, without a price; no branch sells it yet. */
  comingSoon: boolean;
  /** What's included, one short line each. */
  checklist: string[];
  sortOrder: number;
  active: boolean;
  classIds: string[];
  /** The sizes of those vehicles it's for: prices and branch menus cover only these. */
  sizeIds: string[];
  /** Catalog ids of the services a combo bundles; empty for a plain service. */
  includes: string[];
}

export interface CatalogAdjustmentView {
  id: string;
  mode: DeliveryMode;
  classId: string | null;
  percentBp: number;
  fixedPaise: number;
  minExtraPaise: number;
}

/** Everything the catalog holds except price entries (which publish reads per price book). */
export interface CatalogData {
  business: { id: string; name: string; catalogVersion: number };
  policy: PricingPolicy;
  classes: CatalogClassView[];
  bodyTypes: { id: string; key: string; name: string; classId: string; sizeId: string; sortOrder: number; active: boolean }[];
  services: CatalogServiceView[];
  priceBooks: { id: string; name: string; isDefault: boolean }[];
  adjustments: CatalogAdjustmentView[];
  zones: { id: string; name: string; percentBp: number; active: boolean }[];
}

export interface CatalogView extends CatalogData {
  /** `doorstepPrice` null = base price + the doorstep rule. */
  prices: { priceBookId: string; serviceId: string; sizeId: string; price: number; doorstepPrice: number | null }[];
  branches: {
    id: string;
    /** The branch ID new staff type to ask to join. */
    code: string;
    name: string;
    city: string | null;
    priceBookId: string | null;
    priceZoneId: string | null;
    /** Set by HQ: active, paused or closed, with why. */
    status: BranchStatus;
    statusReason: string | null;
    upToDate: boolean;
    /** Head-office services switched on for this branch. */
    menu: string[];
    /** Head-office services the branch's owner stopped selling there. */
    stopped: string[];
    /** Shop prices (per vehicle) the branch set itself. */
    ownPrices: number;
    /** The kinds of vehicle it washes (body type ids). */
    vehicles: string[];
    /** What its agreement allows, what the owner switched on, and what runs. */
    services: { allowed: BranchServices; offered: BranchServices; live: BranchServices };
    owners: { id: string; name: string; phone: string; active: boolean; pinSet: boolean }[];
  }[];
  admins: string[];
  /** Admins who work at no branch: they sign in through the HQ home. */
  hqOnly: { phone: string; name: string; pinSet: boolean }[];
  /** Visit charges for home washes and the community volume discount. */
  away: AwayPricing;
}

async function readData(pdb: DbClient, businessId: string): Promise<CatalogData | null> {
  const [business, classes, sizes, bodyTypes, services, serviceClasses, comboItems, books, adjustments, zones, settings, serviceSizes] =
    await Promise.all([
      pdb.business.findUnique({ where: { id: businessId } }),
      pdb.vehicleClass.findMany({ where: { businessId }, orderBy: { sortOrder: 'asc' } }),
      pdb.vehicleSize.findMany({ where: { businessId }, orderBy: { sortOrder: 'asc' } }),
      pdb.bodyType.findMany({ where: { businessId }, orderBy: { sortOrder: 'asc' } }),
      pdb.catalogService.findMany({ where: { businessId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      pdb.catalogServiceClass.findMany({ where: { businessId } }),
      pdb.catalogComboItem.findMany({ where: { businessId } }),
      pdb.priceBook.findMany({ where: { businessId }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
      pdb.modeAdjustment.findMany({ where: { businessId } }),
      pdb.priceZone.findMany({ where: { businessId }, orderBy: { name: 'asc' } }),
      pdb.businessSetting.findMany({ where: { businessId, key: { startsWith: 'pricing.' } } }),
      pdb.catalogServiceSize.findMany({ where: { businessId } }),
    ]);
  if (!business) return null;
  const sizeIdsByService = new Map<string, string[]>();
  for (const row of serviceSizes) sizeIdsByService.set(row.serviceId, [...(sizeIdsByService.get(row.serviceId) ?? []), row.sizeId]);

  const setting = new Map(settings.map((s) => [s.key, s.value]));
  const policy = parsePricingPolicy(
    Object.fromEntries(Object.entries(POLICY_KEYS).map(([field, key]) => [field, setting.get(key)])),
  );
  const classIdsByService = new Map<string, string[]>();
  for (const row of serviceClasses) {
    classIdsByService.set(row.serviceId, [...(classIdsByService.get(row.serviceId) ?? []), row.classId]);
  }
  const includesByCombo = new Map<string, string[]>();
  for (const row of comboItems) {
    includesByCombo.set(row.comboId, [...(includesByCombo.get(row.comboId) ?? []), row.serviceId]);
  }

  return {
    business: { id: business.id, name: business.name, catalogVersion: business.catalogVersion },
    policy,
    classes: classes.map((c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      category: categoryForClass(c.key),
      sortOrder: c.sortOrder,
      sizes: sizes
        .filter((s) => s.classId === c.id)
        .map((s) => ({ id: s.id, key: s.key, name: s.name, sortOrder: s.sortOrder })),
    })),
    bodyTypes: bodyTypes.map((b) => ({
      id: b.id,
      key: b.key,
      name: b.name,
      classId: b.classId,
      sizeId: b.sizeId,
      sortOrder: b.sortOrder,
      active: b.active,
    })),
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      modes: parseServiceModes(s.modes),
      teamAt: parseTeamPlaces(s.teamAt),
      places: servicePlaces(parseServiceModes(s.modes), parseTeamPlaces(s.teamAt)),
      durationMin: s.durationMin,
      kind: parseServiceKind(s.kind),
      popular: s.popular,
      showInApp: s.showInApp,
      comingSoon: s.comingSoon,
      checklist: parseChecklist(s.checklist),
      sortOrder: s.sortOrder,
      active: s.active,
      classIds: classIdsByService.get(s.id) ?? [],
      // Its sizes; a service saved before sizes existed (or imported) is for every size of its vehicles.
      sizeIds:
        sizeIdsByService.get(s.id) ??
        sizes.filter((z) => (classIdsByService.get(s.id) ?? []).includes(z.classId)).map((z) => z.id),
      includes: includesByCombo.get(s.id) ?? [],
    })),
    priceBooks: books.map((b) => ({ id: b.id, name: b.name, isDefault: b.isDefault })),
    adjustments: adjustments.map((a) => ({
      id: a.id,
      mode: a.mode === 'doorstep' ? 'doorstep' : 'hub',
      classId: a.classId,
      percentBp: a.percentBp,
      fixedPaise: a.fixedPaise,
      minExtraPaise: a.minExtraPaise,
    })),
    zones: zones.map((z) => ({ id: z.id, name: z.name, percentBp: z.percentBp, active: z.active })),
  };
}

function isComplete(data: CatalogData): boolean {
  return (
    data.classes.length >= VEHICLE_CLASSES.length &&
    data.classes.reduce((n, c) => n + c.sizes.length, 0) >= SIZE_COUNT &&
    data.bodyTypes.length >= BODY_TYPES.length &&
    data.priceBooks.some((b) => b.isDefault)
  );
}

async function requireData(d1: D1Database, businessId: string): Promise<CatalogData> {
  return (await catalogRepo.load(d1, businessId)) ?? fail('not_found', 'Business not found.');
}

function requireService(data: CatalogData, id: string) {
  return data.services.find((s) => s.id === id) ?? fail('not_found', 'Service not found.');
}

/**
 * The sizes a service is for, within its vehicle classes. Given sizes must belong to those classes;
 * left out, it keeps the sizes it had there and takes every size of a class it didn't have. Every
 * class needs at least one size.
 */
function resolveSizes(data: CatalogData, classIds: string[], sizeIds: string[] | undefined, previous: string[] = []): string[] {
  const classes = data.classes.filter((c) => classIds.includes(c.id));
  const allowed = new Set(classes.flatMap((c) => c.sizes.map((z) => z.id)));
  let chosen: string[];
  if (sizeIds) {
    if (sizeIds.some((id) => !allowed.has(id))) fail('invalid', 'A size doesn’t belong to the vehicles picked.');
    chosen = [...new Set(sizeIds)];
  } else {
    chosen = previous.filter((id) => allowed.has(id));
    for (const c of classes) if (!c.sizes.some((z) => chosen.includes(z.id))) chosen.push(...c.sizes.map((z) => z.id));
  }
  for (const c of classes) {
    if (!c.sizes.some((z) => chosen.includes(z.id))) fail('invalid', `Pick at least one ${c.name.toLowerCase()} size.`);
  }
  return chosen;
}

/** Classes must be the business's own and at least one; combo items plain services of it. */
function checkServiceShape(data: CatalogData, serviceId: string | null, classIds: string[] | undefined, includes: string[] | undefined) {
  if (classIds) {
    if (!classIds.length) fail('invalid', 'Pick at least one vehicle class.');
    const known = new Set(data.classes.map((c) => c.id));
    if (classIds.some((id) => !known.has(id))) fail('invalid', 'Unknown vehicle class.');
  }
  if (includes?.length) {
    if (serviceId && data.services.some((s) => s.includes.includes(serviceId))) {
      fail('nested_combo', 'This service is part of a combo, so it can’t bundle others.');
    }
    for (const id of includes) {
      if (id === serviceId) fail('invalid', 'A combo can’t include itself.');
      const item = requireService(data, id);
      if (item.includes.length) fail('nested_combo', 'A combo can only bundle plain services.');
    }
  }
}

export const catalogRepo = {
  /** Which business a branch belongs to, and how it is priced. */
  async branchOf(pdb: DbClient, shopId: string) {
    return pdb.shop.findUnique({
      where: { id: shopId },
      select: { id: true, name: true, businessId: true, priceBookId: true, priceZoneId: true, menuVersion: true, kind: true },
    });
  },

  /** The branch's business. HQ opens every branch inside the Mana Wash business, so there is always one. */
  async businessForShop(d1: D1Database, shopId: string): Promise<string> {
    const shop = await createPlatformDb(d1).shop.findUnique({ where: { id: shopId }, select: { businessId: true } });
    if (!shop?.businessId) return fail('not_found', 'This branch isn’t part of the business.');
    return shop.businessId;
  },

  /**
   * The default classes, sizes, body types and price book, with fixed ids so running it twice
   * (or two requests at once) changes nothing. Body types added to the defaults later are
   * filled in for existing businesses the same way.
   */
  async ensureDefaults(d1: D1Database, businessId: string): Promise<void> {
    const classId = (key: string) => catalogIds.vehicleClass(businessId, key);
    await runStatements(d1, [
      ...insertRows(
        'vehicle_classes',
        ['id', 'business_id', 'key', 'name', 'sort_order'],
        VEHICLE_CLASSES.map((c, i) => [classId(c.key), businessId, c.key, c.name, i]),
        { orIgnore: true },
      ),
      ...insertRows(
        'vehicle_sizes',
        ['id', 'business_id', 'class_id', 'key', 'name', 'sort_order'],
        VEHICLE_CLASSES.flatMap((c) =>
          c.sizes.map((s, i) => [catalogIds.vehicleSize(businessId, c.key, s), businessId, classId(c.key), s, SIZE_NAMES[s], i]),
        ),
        { orIgnore: true },
      ),
      ...insertRows(
        'body_types',
        ['id', 'business_id', 'key', 'name', 'class_id', 'size_id', 'sort_order'],
        BODY_TYPES.map((b, i) => [
          catalogIds.bodyType(businessId, b.key),
          businessId,
          b.key,
          b.label,
          classId(b.classKey),
          catalogIds.vehicleSize(businessId, b.classKey, b.size),
          i,
        ]),
        { orIgnore: true },
      ),
      {
        sql: `INSERT OR IGNORE INTO price_books (id, business_id, name, is_default)
              SELECT ?, ?, 'Standard', 1
              WHERE NOT EXISTS (SELECT 1 FROM price_books WHERE business_id = ? AND is_default = 1)`,
        params: [catalogIds.defaultPriceBook(businessId), businessId, businessId],
      },
    ]);
  },

  /**
   * The coming-soon services on each branch's menu, with the vehicles they're for and the list
   * prices waiting for them (the branch's price book, else the default one), in menu order.
   * WhatsApp shows them without a price; printed posters, which outlive the launch, with it.
   */
  async comingSoon(
    d1: D1Database,
    businessId: string,
  ): Promise<
    {
      shopId: string;
      name: string;
      description: string | null;
      kind: ServiceKind;
      categories: VehicleCategory[];
      checklist: string[];
      durationMin: number | null;
      /** Paise, per vehicle class and size ("car" "L"). */
      prices: { classKey: string; sizeKey: string; price: number }[];
      /** The same prices per body type ("suvLarge"), for a branch's vehicle types. */
      bodyPrices: { bodyKey: string; price: number }[];
    }[]
  > {
    const rows = await queryRows<{
      shop_id: string;
      id: string;
      name: string;
      description: string | null;
      kind: string;
      checklist: string | null;
      duration_minutes: number | null;
      class_keys: string | null;
      prices: string | null;
      body_prices: string | null;
    }>(
      d1,
      `SELECT m.shop_id, c.id, c.name, c.description, c.kind, c.checklist, c.duration_minutes,
              (SELECT group_concat(v.key || ':' || z.key || ':' || e.price)
                 FROM price_book_entries e
                 JOIN vehicle_sizes z ON z.id = e.size_id
                 JOIN vehicle_classes v ON v.id = z.class_id
                WHERE e.service_id = c.id AND e.price > 0
                  AND e.price_book_id = COALESCE(
                        (SELECT s.price_book_id FROM shops s WHERE s.id = m.shop_id),
                        (SELECT b.id FROM price_books b WHERE b.business_id = c.business_id AND b.is_default = 1))) AS prices,
              (SELECT group_concat(bt.key || ':' || e.price)
                 FROM price_book_entries e
                 JOIN body_types bt ON bt.size_id = e.size_id AND bt.business_id = c.business_id AND bt.active = 1
                WHERE e.service_id = c.id AND e.price > 0
                  AND e.price_book_id = COALESCE(
                        (SELECT s.price_book_id FROM shops s WHERE s.id = m.shop_id),
                        (SELECT b.id FROM price_books b WHERE b.business_id = c.business_id AND b.is_default = 1))) AS body_prices,
              (SELECT group_concat(v.key) FROM catalog_service_classes sc JOIN vehicle_classes v ON v.id = sc.class_id
                WHERE sc.service_id = c.id) AS class_keys
         FROM catalog_services c
         JOIN branch_menu_services m ON m.catalog_service_id = c.id
        WHERE c.business_id = ? AND c.active = 1 AND c.coming_soon = 1
        ORDER BY c.sort_order, c.name`,
      [businessId],
    );
    return rows.map((r) => ({
      shopId: r.shop_id,
      name: r.name,
      description: r.description,
      kind: parseServiceKind(r.kind),
      categories: [...new Set((r.class_keys ?? '').split(',').filter(Boolean).map((k) => categoryForClass(k)))],
      checklist: parseChecklist(r.checklist),
      durationMin: r.duration_minutes,
      prices: (r.prices ?? '')
        .split(',')
        .filter(Boolean)
        .map((p) => {
          const [classKey = '', sizeKey = '', price = '0'] = p.split(':');
          return { classKey, sizeKey, price: Number(price) };
        }),
      bodyPrices: (r.body_prices ?? '')
        .split(',')
        .filter(Boolean)
        .map((p) => {
          const [bodyKey = '', price = '0'] = p.split(':');
          return { bodyKey, price: Number(price) };
        }),
    }));
  },

  /** The catalog, with its defaults filled in on first use. Null for an unknown business. */
  async load(d1: D1Database, businessId: string): Promise<CatalogData | null> {
    const pdb = createPlatformDb(d1);
    const data = await readData(pdb, businessId);
    if (!data || isComplete(data)) return data;
    await catalogRepo.ensureDefaults(d1, businessId);
    return readData(pdb, businessId);
  },

  /** The full catalog for the admin screens: every price book's prices, branches and admins. */
  async view(d1: D1Database, businessId: string): Promise<CatalogView | null> {
    const pdb = createPlatformDb(d1);
    const [data, prices, branches, admins, away] = await Promise.all([
      catalogRepo.load(d1, businessId),
      pdb.priceBookEntry.findMany({
        where: { businessId },
        select: { priceBookId: true, serviceId: true, sizeId: true, price: true, doorstepPrice: true },
      }),
      pdb.shop.findMany({
        where: { businessId, kind: 'branch' },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          city: true,
          priceBookId: true,
          priceZoneId: true,
          menuVersion: true,
          status: true,
          statusReason: true,
          ...BRANCH_SERVICES_SELECT,
        },
      }),
      pdb.businessAdmin.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' }, select: { phone: true } }),
      awayPricingRepo.get(d1, businessId),
    ]);
    if (!data) return null;
    const hqOnly = await catalogRepo.hqOnlyPeople(pdb, businessId);
    const vehicleRows = await pdb.$queryRaw<{ shop_id: string; body_type_id: string }[]>`
      SELECT v.shop_id, v.body_type_id FROM branch_body_types v JOIN shops s ON s.id = v.shop_id
       WHERE s.business_id = ${businessId}`;
    const allBodies = data.bodyTypes.map((b) => b.id);
    const vehiclesOf = (shopId: string) => {
      const mine = vehicleRows.filter((r) => r.shop_id === shopId).map((r) => r.body_type_id);
      return mine.length ? mine : allBodies;
    };
    const menus = await pdb.$queryRaw<{ shop_id: string; catalog_service_id: string }[]>`
      SELECT m.shop_id, m.catalog_service_id FROM branch_menu_services m JOIN shops s ON s.id = m.shop_id
       WHERE s.business_id = ${businessId}`;
    // What each branch's owner changed on their side: services they stopped selling, own prices.
    const stopped = await pdb.$queryRaw<{ shop_id: string; catalog_service_id: string }[]>`
      SELECT v.shop_id, v.catalog_service_id FROM services v JOIN shops s ON s.id = v.shop_id
       WHERE s.business_id = ${businessId} AND v.branch_hidden = 1 AND v.catalog_service_id IS NOT NULL`;
    const ownPrices = await pdb.$queryRaw<{ shop_id: string; n: number }[]>`
      SELECT o.shop_id, COUNT(*) AS n FROM branch_price_overrides o JOIN shops s ON s.id = o.shop_id
       WHERE s.business_id = ${businessId} AND o.mode = 'hub' GROUP BY o.shop_id`;
    const owners = await pdb.$queryRaw<
      { id: string; shop_id: string; name: string; phone: string; active: number; pin_set: number }[]
    >`
      SELECT u.id, u.shop_id, u.name, u.phone, u.active, u.pin_hash IS NOT NULL AS pin_set
        FROM users u JOIN shops s ON s.id = u.shop_id
       WHERE s.business_id = ${businessId} AND u.role = 'owner' AND u.removed_at IS NULL
       ORDER BY u.created_at`;
    return {
      ...data,
      prices,
      branches: branches.map(({ menuVersion, allowHub, allowCommunity, allowDoorstep, offerHub, offerCommunity, offerDoorstep, ...b }) => ({
        ...b,
        services: branchServicesOf({ allowHub, allowCommunity, allowDoorstep, offerHub, offerCommunity, offerDoorstep }),
        status: b.status as BranchStatus,
        upToDate: menuVersion >= data.business.catalogVersion,
        /** Head-office services switched on for this branch. */
        menu: menus.filter((m) => m.shop_id === b.id).map((m) => m.catalog_service_id),
        /** Head-office services the branch's owner stopped selling there (when HQ allows it). */
        stopped: stopped.filter((m) => m.shop_id === b.id).map((m) => m.catalog_service_id),
        /** Shop prices (per vehicle) the branch set itself, within HQ's pricing rules. */
        ownPrices: Number(ownPrices.find((o) => o.shop_id === b.id)?.n ?? 0),
        /** The kinds of vehicle this branch washes (body type ids). */
        vehicles: vehiclesOf(b.id),
        owners: owners
          .filter((o) => o.shop_id === b.id)
          .map((o) => ({ id: o.id, name: o.name, phone: o.phone, active: Number(o.active) === 1, pinSet: Number(o.pin_set) === 1 })),
      })),
      admins: admins.map((a) => a.phone),
      hqOnly,
      away,
    };
  },

  // ─── Branch menus ─────────────────────────────────────────────────────────

  /**
   * The services a branch would sell, checked: each must be the business's and live at HQ, and a
   * combo brings the services it bundles with it. Throws a CatalogError otherwise.
   */
  async checkBranchMenu(d1: D1Database, businessId: string, serviceIds: string[]): Promise<string[]> {
    const data = await requireData(d1, businessId);
    const byId = new Map(data.services.map((s) => [s.id, s]));
    const want = new Set<string>();
    for (const id of serviceIds) {
      const s = byId.get(id) ?? fail('not_found', 'Service not found.');
      if (!s.active) fail('invalid', `${s.name} is switched off at head office.`);
      want.add(id);
      for (const part of s.includes) want.add(part);
    }
    return [...want];
  },

  /** Replaces the services switched on for a branch (already checked). */
  async saveBranchMenu(d1: D1Database, shopId: string, serviceIds: string[]) {
    await runStatements(d1, [
      { sql: 'DELETE FROM branch_menu_services WHERE shop_id = ?', params: [shopId] },
      ...insertRows(
        'branch_menu_services',
        ['shop_id', 'catalog_service_id'],
        [...new Set(serviceIds)].map((id) => [shopId, id]),
      ),
    ]);
  },

  // ─── The vehicles a branch washes ─────────────────────────────────────────

  /** The kinds of vehicle (body type ids) a branch washes; null = every kind (no list yet). */
  async branchVehicles(pdb: DbClient, shopId: string): Promise<Set<string> | null> {
    const rows = await pdb.branchBodyType.findMany({ where: { shopId }, select: { bodyTypeId: true } });
    return rows.length ? new Set(rows.map((r) => r.bodyTypeId)) : null;
  },

  /** Checks a list of kinds for a branch: the business's own body types, at least one. */
  async checkBranchVehicles(d1: D1Database, businessId: string, bodyTypeIds: string[]): Promise<string[]> {
    const data = await requireData(d1, businessId);
    const known = new Set(data.bodyTypes.map((b) => b.id));
    const ids = [...new Set(bodyTypeIds)];
    if (!ids.length) fail('invalid', 'Pick at least one kind of vehicle the branch washes.');
    if (ids.some((id) => !known.has(id))) fail('not_found', 'Vehicle kind not found.');
    return ids;
  },

  /**
   * Replaces the kinds a branch washes (already checked). A vehicle group nobody at the branch
   * takes yet (tractors, and no team takes Farm) is given to its hub and community team, so the
   * kind gets prices; groups a hub or team already takes are left as the owner set them.
   */
  async saveBranchVehicles(d1: D1Database, businessId: string, shopId: string, bodyTypeIds: string[]) {
    const data = await requireData(d1, businessId);
    const points = await createPlatformDb(d1).servicePoint.findMany({
      where: { shopId, active: true },
      select: { id: true, classes: { select: { classId: true } } },
    });
    const taken = new Set(points.flatMap((p) => p.classes.map((c) => c.classId)));
    const classIds = [...new Set(data.bodyTypes.filter((b) => bodyTypeIds.includes(b.id)).map((b) => b.classId))].filter(
      (id) => !taken.has(id),
    );
    await runStatements(d1, [
      { sql: 'DELETE FROM branch_body_types WHERE shop_id = ?', params: [shopId] },
      ...insertRows('branch_body_types', ['shop_id', 'body_type_id'], bodyTypeIds.map((id) => [shopId, id])),
      ...points.flatMap((p) =>
        classIds.map((classId) => ({
          sql: 'INSERT OR IGNORE INTO service_point_classes (shop_id, point_id, class_id) VALUES (?, ?, ?)',
          params: [shopId, p.id, classId],
        })),
      ),
    ]);
  },

  /** The vehicle groups (class ids) a branch washes: those with a kind on its list. */
  async washedClasses(d1: D1Database, businessId: string, shopId: string): Promise<Set<string>> {
    const data = await requireData(d1, businessId);
    const list = await catalogRepo.branchVehicles(createPlatformDb(d1), shopId);
    return new Set(data.bodyTypes.filter((b) => b.active && (list == null || list.has(b.id))).map((b) => b.classId));
  },

  /** One price book's base prices (paise), for building branch menus. */
  async entries(pdb: DbClient, businessId: string, priceBookId: string) {
    return pdb.priceBookEntry.findMany({
      where: { businessId, priceBookId },
      select: { serviceId: true, sizeId: true, price: true, doorstepPrice: true },
    });
  },

  async isAdmin(pdb: DbClient, businessId: string, phone: string): Promise<boolean> {
    const row = await pdb.businessAdmin.findUnique({ where: { businessId_phone: { businessId, phone } } });
    return row != null;
  },

  /** HQ of any business: held to the same 6-digit PIN as owners. */
  async isAdminAnywhere(pdb: DbClient, phone: string): Promise<boolean> {
    return (await pdb.businessAdmin.findFirst({ where: { phone }, select: { phone: true } })) != null;
  },

  /**
   * The business's HQ home: where HQ people who work at no branch sign in. Made the first time
   * it's needed; it holds only their team rows and is never a branch (no menu, washes or cash).
   */
  async hqHome(d1: D1Database, businessId: string): Promise<{ id: string }> {
    const pdb = createPlatformDb(d1);
    const found = await pdb.shop.findFirst({ where: { businessId, kind: 'hq' }, select: { id: true } });
    if (found) return found;
    const business = await pdb.business.findUnique({ where: { id: businessId }, select: { name: true } });
    const id = newId();
    await runStatements(d1, [
      {
        sql: `INSERT INTO shops (id, code, name, business_id, kind, offer_hub, offer_community, offer_doorstep)
              VALUES (?, ?, ?, ?, 'hq', 0, 0, 0)`,
        params: [id, `HQ-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`, `${business?.name ?? 'Mana Wash'} HQ`, businessId],
      },
    ]);
    return { id };
  },

  /** HQ people who work at no branch: they sign in through the HQ home. */
  async hqOnlyPeople(pdb: DbClient, businessId: string): Promise<CatalogView['hqOnly']> {
    const home = await pdb.shop.findFirst({ where: { businessId, kind: 'hq' }, select: { id: true } });
    if (!home) return [];
    const [rows, admins] = await Promise.all([
      pdb.user.findMany({
        where: { shopId: home.id, removedAt: null, active: true },
        orderBy: { createdAt: 'asc' },
        select: { phone: true, name: true, pinHash: true },
      }),
      pdb.businessAdmin.findMany({ where: { businessId }, select: { phone: true } }),
    ]);
    const isAdmin = new Set(admins.map((a) => a.phone));
    return rows.filter((r) => isAdmin.has(r.phone)).map((r) => ({ phone: r.phone, name: r.name, pinSet: r.pinHash != null }));
  },

  /**
   * Someone on a team at one of the business's branches is made HQ as they are. Someone who
   * works at no branch needs a name: they get an HQ-only sign-in (a row in the HQ home), and
   * confirm the number with a WhatsApp code on first sign-in, like any new teammate.
   */
  async addAdmin(
    d1: D1Database,
    businessId: string,
    phone: string,
    name?: string,
  ): Promise<{ hqOnly: boolean; hasPin: boolean }> {
    const pdb = createPlatformDb(d1);
    const rows = await pdb.user.findMany({ where: { phone, removedAt: null, active: true }, select: { shopId: true } });
    const onTeam = rows.length > 0 && (await pdb.shop.count({ where: { id: { in: rows.map((r) => r.shopId) }, businessId, kind: 'branch' } })) > 0;
    // Someone who already signs in somewhere keeps their one PIN.
    const person = await pdb.user.findFirst({
      where: { phone, removedAt: null, pinHash: { not: null } },
      select: { pinHash: true, pinDigits: true, pinSetAt: true },
    });
    if (!onTeam) {
      if (!name?.trim()) fail('needs_name', 'This number isn’t on a branch team. Add their name: they get an HQ-only sign-in.');
      const home = await catalogRepo.hqHome(d1, businessId);
      const db = createShopDb(d1, home.id);
      const here = await db.user.findFirst({ where: { phone, removedAt: null }, select: { id: true } });
      if (here) {
        await db.user.update({ where: { id: here.id }, data: { active: true } });
      } else {
        await db.user.create({
          data: {
            name: name!.trim(),
            phone,
            role: 'owner',
            pinHash: person?.pinHash ?? null,
            pinDigits: person?.pinDigits ?? null,
            pinSetAt: person?.pinSetAt ?? null,
          },
        });
      }
    }
    await runStatements(d1, [
      { sql: 'INSERT OR IGNORE INTO business_admins (business_id, phone) VALUES (?, ?)', params: [businessId, phone] },
    ]);
    return { hqOnly: !onTeam, hasPin: person != null };
  },

  /**
   * The last admin can't be removed: someone must always be able to change prices. An HQ-only
   * person is taken off the HQ home too, so their sign-in stops and every phone signs out.
   */
  async removeAdmin(d1: D1Database, businessId: string, phone: string) {
    const pdb = createPlatformDb(d1);
    const admins = await pdb.businessAdmin.findMany({ where: { businessId }, select: { phone: true } });
    if (!admins.some((a) => a.phone === phone)) fail('not_found', 'Not an admin.');
    if (admins.length <= 1) fail('last_admin', 'Add another admin before removing the last one.');
    await pdb.businessAdmin.deleteMany({ where: { businessId, phone } });
    const home = await pdb.shop.findFirst({ where: { businessId, kind: 'hq' }, select: { id: true } });
    if (home) {
      await createShopDb(d1, home.id).user.updateMany({
        where: { phone, removedAt: null },
        data: { active: false, pinHash: null, pinDigits: null, removedAt: new Date(), sessionVersion: { increment: 1 } },
      });
    }
  },

  async renameBusiness(d1: D1Database, businessId: string, name: string) {
    await runStatements(d1, [{ sql: 'UPDATE businesses SET name = ? WHERE id = ?', params: [name, businessId] }]);
  },

  // ─── Vehicles ─────────────────────────────────────────────────────────────

  async renameClass(d1: D1Database, businessId: string, classId: string, name: string) {
    const data = await requireData(d1, businessId);
    if (!data.classes.some((c) => c.id === classId)) fail('not_found', 'Vehicle class not found.');
    await runStatements(d1, [
      { sql: 'UPDATE vehicle_classes SET name = ? WHERE business_id = ? AND id = ?', params: [name, businessId, classId] },
      bump(businessId),
    ]);
  },

  async renameSize(d1: D1Database, businessId: string, sizeId: string, name: string) {
    const data = await requireData(d1, businessId);
    if (!data.classes.some((c) => c.sizes.some((s) => s.id === sizeId))) fail('not_found', 'Size not found.');
    await runStatements(d1, [
      { sql: 'UPDATE vehicle_sizes SET name = ? WHERE business_id = ? AND id = ?', params: [name, businessId, sizeId] },
      bump(businessId),
    ]);
  },

  /** Rename a body type, move it to another size of its class (re-prices it everywhere), or retire it. */
  async updateBodyType(
    d1: D1Database,
    businessId: string,
    id: string,
    patch: { name?: string; sizeId?: string },
  ) {
    const data = await requireData(d1, businessId);
    const body = data.bodyTypes.find((b) => b.id === id) ?? fail('not_found', 'Body type not found.');
    if (patch.sizeId !== undefined) {
      const cls = data.classes.find((c) => c.id === body.classId);
      if (!cls?.sizes.some((s) => s.id === patch.sizeId)) fail('invalid', 'That size isn’t in this vehicle class.');
    }
    const set = setClause([
      ['name', patch.name],
      ['size_id', patch.sizeId],
    ]);
    if (!set) return;
    await runStatements(d1, [
      { sql: `UPDATE body_types SET ${set.sql} WHERE business_id = ? AND id = ?`, params: [...set.params, businessId, id] },
      bump(businessId),
    ]);
  },

  /** Head office's switch for many kinds of vehicle at once (a whole group). */

  // ─── Services ─────────────────────────────────────────────────────────────

  async createService(
    d1: D1Database,
    businessId: string,
    input: { name: string; description: string | null; modes: ServiceModes; classIds: string[]; sizeIds?: string[]; includes: string[] } & ServiceDetails,
  ): Promise<string> {
    const data = await requireData(d1, businessId);
    checkServiceShape(data, null, input.classIds, input.includes);
    const sizeIds = resolveSizes(data, input.classIds, input.sizeIds);
    const id = newId();
    const sortOrder = data.services.reduce((n, s) => Math.max(n, s.sortOrder + 1), 0);
    await runStatements(d1, [
      {
        sql: `INSERT INTO catalog_services (id, business_id, name, description, modes, team_at, duration_minutes, kind, popular,
                show_in_app, coming_soon, checklist, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          id,
          businessId,
          input.name,
          input.description,
          input.modes,
          input.teamAt ?? 'both',
          input.durationMin ?? null,
          input.kind ?? 'wash',
          input.popular ? 1 : 0,
          input.showInApp === false ? 0 : 1,
          input.comingSoon ? 1 : 0,
          input.checklist?.length ? JSON.stringify(input.checklist) : null,
          sortOrder,
        ],
      },
      ...insertRows(
        'catalog_service_classes',
        ['business_id', 'service_id', 'class_id'],
        [...new Set(input.classIds)].map((c) => [businessId, id, c]),
      ),
      ...insertRows('catalog_service_sizes', ['business_id', 'service_id', 'size_id'], sizeIds.map((z) => [businessId, id, z])),
      ...insertRows(
        'catalog_combo_items',
        ['business_id', 'combo_id', 'service_id'],
        [...new Set(input.includes)].map((s) => [businessId, id, s]),
      ),
      bump(businessId),
    ]);
    return id;
  },

  async updateService(
    d1: D1Database,
    businessId: string,
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      modes?: ServiceModes;
      sortOrder?: number;
      active?: boolean;
      classIds?: string[];
      sizeIds?: string[];
      includes?: string[];
    } & ServiceDetails,
  ) {
    const data = await requireData(d1, businessId);
    const current = requireService(data, id);
    checkServiceShape(data, id, patch.classIds, patch.includes);
    const sizeIds =
      patch.classIds || patch.sizeIds ? resolveSizes(data, patch.classIds ?? current.classIds, patch.sizeIds, current.sizeIds) : null;
    const set = setClause([
      ['name', patch.name],
      ['description', patch.description],
      ['modes', patch.modes],
      ['team_at', patch.teamAt],
      ['duration_minutes', patch.durationMin],
      ['kind', patch.kind],
      ['popular', patch.popular],
      ['show_in_app', patch.showInApp],
      ['coming_soon', patch.comingSoon],
      ['checklist', patch.checklist === undefined ? undefined : patch.checklist.length ? JSON.stringify(patch.checklist) : null],
      ['sort_order', patch.sortOrder],
      ['active', patch.active],
    ]);
    const statements: SqlStatement[] = [];
    if (set) {
      statements.push({
        sql: `UPDATE catalog_services SET ${set.sql}, updated_at = ${SQL_NOW} WHERE business_id = ? AND id = ?`,
        params: [...set.params, businessId, id],
      });
    }
    if (patch.classIds) {
      statements.push(
        { sql: 'DELETE FROM catalog_service_classes WHERE business_id = ? AND service_id = ?', params: [businessId, id] },
        ...insertRows(
          'catalog_service_classes',
          ['business_id', 'service_id', 'class_id'],
          [...new Set(patch.classIds)].map((c) => [businessId, id, c]),
        ),
      );
    }
    if (sizeIds) {
      statements.push(
        { sql: 'DELETE FROM catalog_service_sizes WHERE business_id = ? AND service_id = ?', params: [businessId, id] },
        ...insertRows('catalog_service_sizes', ['business_id', 'service_id', 'size_id'], sizeIds.map((z) => [businessId, id, z])),
      );
    }
    if (patch.includes) {
      statements.push(
        { sql: 'DELETE FROM catalog_combo_items WHERE business_id = ? AND combo_id = ?', params: [businessId, id] },
        ...insertRows(
          'catalog_combo_items',
          ['business_id', 'combo_id', 'service_id'],
          [...new Set(patch.includes)].map((s) => [businessId, id, s]),
        ),
      );
    }
    if (!statements.length) return;
    await runStatements(d1, [...statements, bump(businessId)]);
  },

  /**
   * Deletes a service. It leaves the catalog and every branch's menu (the branches' copies are
   * retired at their next build, so past washes keep its name); a wash plan or combo that uses it
   * has to let go of it first.
   */
  async deleteService(d1: D1Database, businessId: string, id: string) {
    const data = await requireData(d1, businessId);
    const service = requireService(data, id);
    if (!service.active) fail('not_found', 'Service not found.');
    const plan = await createPlatformDb(d1).washPlan.findFirst({
      where: { businessId, active: true, OR: [{ catalogServiceId: id }, { upgradeServiceId: id }] },
      select: { name: true },
    });
    if (plan) fail('in_use', `${service.name} is used by the wash plan “${plan.name}”. Change or remove that plan first.`);
    const combo = data.services.find((s) => s.active && s.includes.includes(id));
    if (combo) fail('in_use', `${service.name} is in the ${combo.name} combo. Take it out of the combo first.`);
    await runStatements(d1, [
      { sql: `UPDATE catalog_services SET active = 0, updated_at = ${SQL_NOW} WHERE business_id = ? AND id = ?`, params: [businessId, id] },
      { sql: 'DELETE FROM branch_menu_services WHERE catalog_service_id = ?', params: [id] },
      { sql: 'DELETE FROM catalog_combo_items WHERE business_id = ? AND combo_id = ?', params: [businessId, id] },
      bump(businessId),
    ]);
  },

  /** New order of the whole list, top first. */
  async reorderServices(d1: D1Database, businessId: string, ids: string[]) {
    const data = await requireData(d1, businessId);
    const known = new Set(data.services.map((s) => s.id));
    if (ids.some((id) => !known.has(id))) fail('not_found', 'Service not found.');
    await runStatements(d1, [
      ...ids.map((id, i) => ({
        sql: 'UPDATE catalog_services SET sort_order = ? WHERE business_id = ? AND id = ?',
        params: [i, businessId, id],
      })),
      bump(businessId),
    ]);
  },

  // ─── Prices ───────────────────────────────────────────────────────────────

  /** The business's default price book (every branch without its own uses it). */
  async defaultPriceBookId(d1: D1Database, businessId: string): Promise<string | null> {
    const book = await createPlatformDb(d1).priceBook.findFirst({ where: { businessId, isDefault: true }, select: { id: true } });
    return book?.id ?? null;
  },

  /**
   * Base prices in one save; `price: null` stops offering the service for that size.
   * `doorstepPrice` sets the size's own community price (null = back to the doorstep rule;
   * left out = unchanged).
   */
  async setPrices(
    d1: D1Database,
    businessId: string,
    priceBookId: string,
    entries: { serviceId: string; sizeId: string; price: number | null; doorstepPrice?: number | null }[],
  ) {
    const data = await requireData(d1, businessId);
    if (!data.priceBooks.some((b) => b.id === priceBookId)) fail('not_found', 'Price book not found.');
    const services = new Set(data.services.map((s) => s.id));
    const sizes = new Set(data.classes.flatMap((c) => c.sizes.map((s) => s.id)));
    for (const e of entries) {
      if (!services.has(e.serviceId)) fail('not_found', 'Service not found.');
      if (!sizes.has(e.sizeId)) fail('not_found', 'Size not found.');
    }
    const last = new Map(entries.map((e) => [`${e.serviceId}|${e.sizeId}`, e]));
    const set = [...last.values()].filter((e) => e.price != null);
    const cleared = [...last.values()].filter((e) => e.price == null);
    const withDoorstep = set.filter((e) => e.doorstepPrice !== undefined);
    const baseOnly = set.filter((e) => e.doorstepPrice === undefined);
    await runStatements(d1, [
      ...insertRows(
        'price_book_entries',
        ['business_id', 'price_book_id', 'service_id', 'size_id', 'price'],
        baseOnly.map((e) => [businessId, priceBookId, e.serviceId, e.sizeId, e.price]),
        { onConflict: `ON CONFLICT (price_book_id, service_id, size_id) DO UPDATE SET price = excluded.price, updated_at = ${SQL_NOW}` },
      ),
      ...insertRows(
        'price_book_entries',
        ['business_id', 'price_book_id', 'service_id', 'size_id', 'price', 'doorstep_price'],
        withDoorstep.map((e) => [businessId, priceBookId, e.serviceId, e.sizeId, e.price, e.doorstepPrice]),
        {
          onConflict: `ON CONFLICT (price_book_id, service_id, size_id) DO UPDATE SET price = excluded.price,
            doorstep_price = excluded.doorstep_price, updated_at = ${SQL_NOW}`,
        },
      ),
      ...cleared.map((e) => ({
        sql: 'DELETE FROM price_book_entries WHERE business_id = ? AND price_book_id = ? AND service_id = ? AND size_id = ?',
        params: [businessId, priceBookId, e.serviceId, e.sizeId],
      })),
      bump(businessId),
    ]);
  },

  async createPriceBook(d1: D1Database, businessId: string, name: string, copyFrom: string | null): Promise<string> {
    const data = await requireData(d1, businessId);
    if (copyFrom && !data.priceBooks.some((b) => b.id === copyFrom)) fail('not_found', 'Price book not found.');
    const id = newId();
    const statements: SqlStatement[] = [
      { sql: 'INSERT INTO price_books (id, business_id, name) VALUES (?, ?, ?)', params: [id, businessId, name] },
    ];
    if (copyFrom) {
      statements.push({
        sql: `INSERT INTO price_book_entries (business_id, price_book_id, service_id, size_id, price, doorstep_price)
              SELECT business_id, ?, service_id, size_id, price, doorstep_price FROM price_book_entries
              WHERE business_id = ? AND price_book_id = ?`,
        params: [id, businessId, copyFrom],
      });
    }
    await runStatements(d1, statements);
    return id;
  },

  async renamePriceBook(d1: D1Database, businessId: string, id: string, name: string) {
    const data = await requireData(d1, businessId);
    if (!data.priceBooks.some((b) => b.id === id)) fail('not_found', 'Price book not found.');
    await runStatements(d1, [{ sql: 'UPDATE price_books SET name = ? WHERE business_id = ? AND id = ?', params: [name, businessId, id] }]);
  },

  /** Branches without a price book of their own follow the default. */
  async setDefaultPriceBook(d1: D1Database, businessId: string, id: string) {
    const data = await requireData(d1, businessId);
    if (!data.priceBooks.some((b) => b.id === id)) fail('not_found', 'Price book not found.');
    await runStatements(d1, [
      { sql: 'UPDATE price_books SET is_default = 0 WHERE business_id = ? AND is_default = 1', params: [businessId] },
      { sql: 'UPDATE price_books SET is_default = 1 WHERE business_id = ? AND id = ?', params: [businessId, id] },
      bump(businessId),
    ]);
  },

  async deletePriceBook(d1: D1Database, businessId: string, id: string) {
    const data = await requireData(d1, businessId);
    const book = data.priceBooks.find((b) => b.id === id) ?? fail('not_found', 'Price book not found.');
    if (book.isDefault) fail('default_book', 'Make another price book the default first.');
    const users = await createPlatformDb(d1).shop.count({ where: { businessId, priceBookId: id } });
    if (users) fail('in_use', 'Branches still use this price book.');
    await runStatements(d1, [
      { sql: 'DELETE FROM price_book_entries WHERE business_id = ? AND price_book_id = ?', params: [businessId, id] },
      { sql: 'DELETE FROM price_books WHERE business_id = ? AND id = ?', params: [businessId, id] },
    ]);
  },

  // ─── Pricing rules ────────────────────────────────────────────────────────

  /** The extra for a way of delivering, for one class or (classId null) every class. */
  async setAdjustment(
    d1: D1Database,
    businessId: string,
    input: { mode: DeliveryMode; classId: string | null; percentBp: number; fixedPaise: number; minExtraPaise: number },
  ) {
    const data = await requireData(d1, businessId);
    if (input.classId && !data.classes.some((c) => c.id === input.classId)) fail('not_found', 'Vehicle class not found.');
    await runStatements(d1, [
      {
        sql: `INSERT INTO mode_adjustments (id, business_id, mode, class_id, percent_bp, fixed_paise, min_extra_paise)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (id) DO UPDATE SET percent_bp = excluded.percent_bp, fixed_paise = excluded.fixed_paise,
                min_extra_paise = excluded.min_extra_paise, updated_at = ${SQL_NOW}`,
        params: [
          adjustmentId(businessId, input.mode, input.classId),
          businessId,
          input.mode,
          input.classId,
          input.percentBp,
          input.fixedPaise,
          input.minExtraPaise,
        ],
      },
      bump(businessId),
    ]);
  },

  async deleteAdjustment(d1: D1Database, businessId: string, mode: DeliveryMode, classId: string | null) {
    await runStatements(d1, [
      {
        sql: 'DELETE FROM mode_adjustments WHERE business_id = ? AND id = ?',
        params: [businessId, adjustmentId(businessId, mode, classId)],
      },
      bump(businessId),
    ]);
  },

  async createZone(d1: D1Database, businessId: string, input: { name: string; percentBp: number }): Promise<string> {
    const id = newId();
    await runStatements(d1, [
      { sql: 'INSERT INTO price_zones (id, business_id, name, percent_bp) VALUES (?, ?, ?, ?)', params: [id, businessId, input.name, input.percentBp] },
    ]);
    return id;
  },

  async updateZone(
    d1: D1Database,
    businessId: string,
    id: string,
    patch: { name?: string; percentBp?: number; active?: boolean },
  ) {
    const data = await requireData(d1, businessId);
    if (!data.zones.some((z) => z.id === id)) fail('not_found', 'Zone not found.');
    const set = setClause([
      ['name', patch.name],
      ['percent_bp', patch.percentBp],
      ['active', patch.active],
    ]);
    if (!set) return;
    await runStatements(d1, [
      { sql: `UPDATE price_zones SET ${set.sql} WHERE business_id = ? AND id = ?`, params: [...set.params, businessId, id] },
      bump(businessId),
    ]);
  },

  async setPolicy(d1: D1Database, businessId: string, patch: Partial<PricingPolicy>, phone: string | null) {
    const rows = (Object.keys(POLICY_KEYS) as (keyof PricingPolicy)[])
      .filter((field) => patch[field] !== undefined)
      .map((field) => [businessId, POLICY_KEYS[field], String(patch[field]), phone]);
    if (!rows.length) return;
    await runStatements(d1, [
      ...insertRows('business_settings', ['business_id', 'key', 'value', 'updated_by_phone'], rows, {
        onConflict: `ON CONFLICT (business_id, key) DO UPDATE SET value = excluded.value,
          updated_by_phone = excluded.updated_by_phone, updated_at = ${SQL_NOW}`,
      }),
      bump(businessId),
    ]);
  },

  /** Which price book and zone a branch uses (null = the default book / no zone). */
  async setBranchPricing(
    d1: D1Database,
    businessId: string,
    shopId: string,
    patch: { priceBookId?: string | null; priceZoneId?: string | null },
  ) {
    const data = await requireData(d1, businessId);
    const shop = await createPlatformDb(d1).shop.findUnique({ where: { id: shopId }, select: { businessId: true } });
    if (shop?.businessId !== businessId) fail('not_found', 'Branch not found.');
    if (patch.priceBookId && !data.priceBooks.some((b) => b.id === patch.priceBookId)) fail('not_found', 'Price book not found.');
    if (patch.priceZoneId && !data.zones.some((z) => z.id === patch.priceZoneId)) fail('not_found', 'Zone not found.');
    const set = setClause([
      ['price_book_id', patch.priceBookId],
      ['price_zone_id', patch.priceZoneId],
    ]);
    if (!set) return;
    await runStatements(d1, [
      {
        sql: `UPDATE shops SET ${set.sql}, menu_version = 0 WHERE business_id = ? AND id = ?`,
        params: [...set.params, businessId, shopId],
      },
    ]);
  },

  /** Every branch of the business gets its menu rebuilt on the next publish. */
  async markAllStale(d1: D1Database, businessId: string) {
    await runStatements(d1, [{ sql: 'UPDATE shops SET menu_version = 0 WHERE business_id = ?', params: [businessId] }]);
  },

  /** Ids of a business's branches whose menu is behind the catalog. */
  async staleBranches(pdb: DbClient, businessId?: string): Promise<string[]> {
    const shops = await pdb.shop.findMany({
      where: { ...(businessId ? { businessId } : { businessId: { not: null } }), kind: 'branch' },
      select: { id: true, businessId: true, menuVersion: true },
    });
    if (!shops.length) return [];
    const businesses = await pdb.business.findMany({
      where: { id: { in: [...new Set(shops.map((s) => s.businessId!))] } },
      select: { id: true, catalogVersion: true },
    });
    const version = new Map(businesses.map((b) => [b.id, b.catalogVersion]));
    return shops.filter((s) => s.menuVersion < (version.get(s.businessId!) ?? 0)).map((s) => s.id);
  },
};
