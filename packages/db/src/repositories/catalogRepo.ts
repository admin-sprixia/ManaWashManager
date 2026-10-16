import {
  BODY_TYPES,
  VEHICLE_CLASSES,
  SIZE_NAMES,
  catalogIds,
  categoryForClass,
  parsePricingPolicy,
  parseServiceModes,
  type BranchStatus,
  type DeliveryMode,
  type PricingPolicy,
  type ServiceModes,
  type VehicleCategory,
} from '@mana/domain';
import { createPlatformDb, type D1Database, type DbClient } from '../client';
import { newId } from '../ids';
import { insertRows, runStatements, SQL_NOW, type SqlStatement } from '../sql';

/**
 * The business catalog of the service network: vehicle classes, sizes and body types, services,
 * price books, pricing rules and policy. Every read and write is pinned to one business id.
 * Writes bump `businesses.catalog_version`, which marks every branch's menu as out of date;
 * menuRepo.publish rebuilds them.
 */

export type CatalogErrorCode =
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

export interface CatalogServiceView {
  id: string;
  name: string;
  description: string | null;
  modes: ServiceModes;
  sortOrder: number;
  active: boolean;
  classIds: string[];
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
  prices: { priceBookId: string; serviceId: string; sizeId: string; price: number }[];
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
    owners: { id: string; name: string; phone: string; active: boolean; pinSet: boolean }[];
  }[];
  admins: string[];
}

async function readData(pdb: DbClient, businessId: string): Promise<CatalogData | null> {
  const [business, classes, sizes, bodyTypes, services, serviceClasses, comboItems, books, adjustments, zones, settings] =
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
    ]);
  if (!business) return null;

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
      sortOrder: s.sortOrder,
      active: s.active,
      classIds: classIdsByService.get(s.id) ?? [],
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
      select: { id: true, name: true, businessId: true, priceBookId: true, priceZoneId: true, menuVersion: true },
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
    const [data, prices, branches, admins] = await Promise.all([
      catalogRepo.load(d1, businessId),
      pdb.priceBookEntry.findMany({
        where: { businessId },
        select: { priceBookId: true, serviceId: true, sizeId: true, price: true },
      }),
      pdb.shop.findMany({
        where: { businessId },
        orderBy: { name: 'asc' },
        select: { id: true, code: true, name: true, city: true, priceBookId: true, priceZoneId: true, menuVersion: true, status: true, statusReason: true },
      }),
      pdb.businessAdmin.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' }, select: { phone: true } }),
    ]);
    if (!data) return null;
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
      branches: branches.map(({ menuVersion, ...b }) => ({
        ...b,
        status: b.status as BranchStatus,
        upToDate: menuVersion >= data.business.catalogVersion,
        owners: owners
          .filter((o) => o.shop_id === b.id)
          .map((o) => ({ id: o.id, name: o.name, phone: o.phone, active: Number(o.active) === 1, pinSet: Number(o.pin_set) === 1 })),
      })),
      admins: admins.map((a) => a.phone),
    };
  },

  /** One price book's base prices (paise), for building branch menus. */
  async entries(pdb: DbClient, businessId: string, priceBookId: string) {
    return pdb.priceBookEntry.findMany({
      where: { businessId, priceBookId },
      select: { serviceId: true, sizeId: true, price: true },
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
   * Only someone already on a team at one of the business's branches can be made HQ: a mistyped
   * number, or one the telco later gives to a stranger, must never become HQ when it joins later.
   */
  async addAdmin(d1: D1Database, businessId: string, phone: string) {
    const pdb = createPlatformDb(d1);
    const rows = await pdb.user.findMany({ where: { phone, removedAt: null, active: true }, select: { shopId: true } });
    const onTeam = rows.length > 0 && (await pdb.shop.count({ where: { id: { in: rows.map((r) => r.shopId) }, businessId } })) > 0;
    if (!onTeam) fail('not_on_team', 'Add this person to a branch team first (as an owner or manager), then make them HQ.');
    await runStatements(d1, [
      { sql: 'INSERT OR IGNORE INTO business_admins (business_id, phone) VALUES (?, ?)', params: [businessId, phone] },
    ]);
  },

  /** The last admin can't be removed: someone must always be able to change prices. */
  async removeAdmin(d1: D1Database, businessId: string, phone: string) {
    const pdb = createPlatformDb(d1);
    const admins = await pdb.businessAdmin.findMany({ where: { businessId }, select: { phone: true } });
    if (!admins.some((a) => a.phone === phone)) fail('not_found', 'Not an admin.');
    if (admins.length <= 1) fail('last_admin', 'Add another admin before removing the last one.');
    await pdb.businessAdmin.deleteMany({ where: { businessId, phone } });
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
    patch: { name?: string; sizeId?: string; active?: boolean },
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
      ['active', patch.active],
    ]);
    if (!set) return;
    await runStatements(d1, [
      { sql: `UPDATE body_types SET ${set.sql} WHERE business_id = ? AND id = ?`, params: [...set.params, businessId, id] },
      bump(businessId),
    ]);
  },

  // ─── Services ─────────────────────────────────────────────────────────────

  async createService(
    d1: D1Database,
    businessId: string,
    input: { name: string; description: string | null; modes: ServiceModes; classIds: string[]; includes: string[] },
  ): Promise<string> {
    const data = await requireData(d1, businessId);
    checkServiceShape(data, null, input.classIds, input.includes);
    const id = newId();
    const sortOrder = data.services.reduce((n, s) => Math.max(n, s.sortOrder + 1), 0);
    await runStatements(d1, [
      {
        sql: 'INSERT INTO catalog_services (id, business_id, name, description, modes, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
        params: [id, businessId, input.name, input.description, input.modes, sortOrder],
      },
      ...insertRows(
        'catalog_service_classes',
        ['business_id', 'service_id', 'class_id'],
        [...new Set(input.classIds)].map((c) => [businessId, id, c]),
      ),
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
      includes?: string[];
    },
  ) {
    const data = await requireData(d1, businessId);
    requireService(data, id);
    checkServiceShape(data, id, patch.classIds, patch.includes);
    const set = setClause([
      ['name', patch.name],
      ['description', patch.description],
      ['modes', patch.modes],
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

  /** Base prices in one save; `price: null` stops offering the service for that size. */
  async setPrices(
    d1: D1Database,
    businessId: string,
    priceBookId: string,
    entries: { serviceId: string; sizeId: string; price: number | null }[],
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
    await runStatements(d1, [
      ...insertRows(
        'price_book_entries',
        ['business_id', 'price_book_id', 'service_id', 'size_id', 'price'],
        set.map((e) => [businessId, priceBookId, e.serviceId, e.sizeId, e.price]),
        { onConflict: `ON CONFLICT (price_book_id, service_id, size_id) DO UPDATE SET price = excluded.price, updated_at = ${SQL_NOW}` },
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
        sql: `INSERT INTO price_book_entries (business_id, price_book_id, service_id, size_id, price)
              SELECT business_id, ?, service_id, size_id, price FROM price_book_entries
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
      where: businessId ? { businessId } : { businessId: { not: null } },
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
