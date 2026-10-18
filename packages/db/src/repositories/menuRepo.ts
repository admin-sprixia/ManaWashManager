import {
  BRANCH_SERVICES_SELECT,
  COMMUNITY_TEAM_RADIUS_KM,
  DEFAULT_POINT_CLASSES,
  basePriceKey,
  branchServicesOf,
  bodyTypeForName,
  branchCapabilities,
  branchPriceKey,
  catalogIds,
  categoryForClass,
  checkOverride,
  effectivePrice,
  planBranchMenu,
  type BranchCapabilities,
  type DeliveryMode,
  type ModeAdjustment,
  type PricingPolicy,
} from '@mana/domain';
import { createPlatformDb, createShopDb, type D1Database, type DbClient } from '../client';
import { newId } from '../ids';
import { retryOnClash } from '../retryOnClash';
import { deleteIn, insertRows, queryRows, runStatements, SQL_NOW, type SqlStatement } from '../sql';
import { CatalogError, catalogRepo, type CatalogData } from './catalogRepo';

/**
 * Branch menus generated from the business catalog. `publish` rebuilds one branch's catalog
 * services, combo items and prices (the rows washes, rewards, commissions and reports read) from
 * the catalog, its service points, price book, zone and the branch's own overrides — in one
 * transaction. Services the branch made by hand are never touched.
 */

const SHOP_VT_COLUMNS = ['id', 'shop_id', 'name', 'category', 'sort_order', 'active', 'body_type_id'] as const;
const SERVICE_COLUMNS = [
  'id',
  'shop_id',
  'name',
  'description',
  'active',
  'applies_to',
  'sort_order',
  'catalog_service_id',
  'modes',
  'branch_hidden',
  'team_at',
  'duration_min',
  'kind',
  'popular',
  'show_in_app',
  'checklist',
] as const;
const PRICE_COLUMNS = ['id', 'shop_id', 'service_id', 'vehicle_type_id', 'price', 'mode', 'source', 'list_price'] as const;

export interface PublishResult {
  shopId: string;
  published: boolean;
  /** Rows written: services, combo items, prices, vehicle types, points. 0 = already up to date. */
  changes: number;
}

interface CatalogIndex {
  classKey: Map<string, string>;
  classIdByKey: Map<string, string>;
  /** Active body types only: a retired one gets no catalog prices. */
  body: Map<string, { classKey: string; sizeKey: string }>;
  allClassKeys: string[];
  adjustments: ModeAdjustment[];
}

function indexCatalog(data: CatalogData): CatalogIndex {
  const classKey = new Map(data.classes.map((c) => [c.id, c.key]));
  const sizeKey = new Map(data.classes.flatMap((c) => c.sizes.map((s) => [s.id, s.key] as const)));
  const body = new Map<string, { classKey: string; sizeKey: string }>();
  for (const b of data.bodyTypes) {
    const ck = classKey.get(b.classId);
    const sk = sizeKey.get(b.sizeId);
    if (b.active && ck && sk) body.set(b.id, { classKey: ck, sizeKey: sk });
  }
  return {
    classKey,
    classIdByKey: new Map(data.classes.map((c) => [c.key, c.id])),
    body,
    allClassKeys: data.classes.map((c) => c.key),
    adjustments: data.adjustments.map((a) => ({
      mode: a.mode,
      classKey: a.classId ? (classKey.get(a.classId) ?? null) : null,
      percentBp: a.percentBp,
      fixedPaise: a.fixedPaise,
      minExtraPaise: a.minExtraPaise,
    })),
  };
}

/** A radius the service_points CHECK accepts, or none. */
function pointRadius(km: number | null): number | null {
  return km != null && km >= 0.5 && km <= 50 ? km : null;
}

async function readBranch(db: DbClient) {
  const [vehicleTypes, points, services, comboItems, prices, overrides, menuPicks, kindPicks] = await Promise.all([
    db.vehicleType.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, category: true, active: true, bodyTypeId: true, sortOrder: true, hqHidden: true },
    }),
    db.servicePoint.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, kind: true, active: true, classes: { select: { classId: true } } },
    }),
    // Catalog services, and live hand-made ones (a catalog service of the same name adopts one).
    db.service.findMany({
      where: { OR: [{ catalogServiceId: { not: null } }, { active: true }] },
      select: {
        id: true,
        name: true,
        description: true,
        active: true,
        appliesTo: true,
        sortOrder: true,
        catalogServiceId: true,
        modes: true,
        branchHidden: true,
        teamAt: true,
        durationMin: true,
        kind: true,
        popular: true,
        showInApp: true,
        checklist: true,
      },
    }),
    db.serviceComboItem.findMany({ select: { comboId: true, serviceId: true } }),
    db.servicePrice.findMany({
      where: { service: { OR: [{ catalogServiceId: { not: null } }, { active: true }] } },
      select: { id: true, serviceId: true, vehicleTypeId: true, mode: true, price: true, listPrice: true, source: true },
    }),
    db.branchPriceOverride.findMany({ select: { serviceId: true, vehicleTypeId: true, mode: true, price: true } }),
    // The head-office services switched on for this branch.
    db.branchMenuService.findMany({ select: { catalogServiceId: true } }),
    // The kinds of vehicle it washes (none listed: every kind).
    db.branchBodyType.findMany({ select: { bodyTypeId: true } }),
  ]);
  const linkedIds = new Set(services.filter((s) => s.catalogServiceId).map((s) => s.id));
  return {
    vehicleTypes,
    points,
    menu: new Set(menuPicks.map((p) => p.catalogServiceId)),
    kinds: kindPicks.length ? new Set(kindPicks.map((p) => p.bodyTypeId)) : null,
    /** Services generated from the catalog. */
    services: services.filter((s) => s.catalogServiceId),
    /** Live services the branch made by hand. */
    manual: services.filter((s) => !s.catalogServiceId),
    comboItems: comboItems.filter((i) => linkedIds.has(i.comboId)),
    prices: prices.filter((p) => linkedIds.has(p.serviceId)),
    manualPrices: prices.filter((p) => !linkedIds.has(p.serviceId)),
    allComboItems: comboItems,
    overrides,
  };
}

type Branch = Awaited<ReturnType<typeof readBranch>>;

/** Vehicle types not yet tied to a body type, matched by name ("Mini SUV" → Compact SUV). */
function linkVehicleTypes(shopId: string, businessId: string, data: CatalogData, branch: Branch): SqlStatement[] {
  const bodyIds = new Set(data.bodyTypes.map((b) => b.id));
  const statements: SqlStatement[] = [];
  for (const vt of branch.vehicleTypes) {
    if (vt.bodyTypeId && bodyIds.has(vt.bodyTypeId)) continue;
    const def = bodyTypeForName(vt.name);
    if (!def || categoryForClass(def.classKey) !== vt.category) continue;
    const bodyId = catalogIds.bodyType(businessId, def.key);
    if (!bodyIds.has(bodyId)) continue;
    vt.bodyTypeId = bodyId;
    statements.push({
      sql: 'UPDATE vehicle_types SET body_type_id = ? WHERE shop_id = ? AND id = ?',
      params: [bodyId, shopId, vt.id],
    });
  }
  return statements;
}

/**
 * The kinds of vehicle head office lets the branch wash: a branch vehicle type whose kind isn't
 * on the branch's list is hidden; putting it back on the list shows again only the ones hidden
 * that way (never one the owner removed). Plans already sold for it carry on.
 */
function applyHqSwitches(shopId: string, data: CatalogData, branch: Branch): SqlStatement[] {
  const off = new Set(data.bodyTypes.filter((b) => !b.active || (branch.kinds != null && !branch.kinds.has(b.id))).map((b) => b.id));
  const statements: SqlStatement[] = [];
  for (const vt of branch.vehicleTypes) {
    const hqOff = vt.bodyTypeId != null && off.has(vt.bodyTypeId);
    if (hqOff && vt.active) {
      vt.active = false;
      vt.hqHidden = true;
    } else if (!hqOff && vt.hqHidden) {
      vt.active = true;
      vt.hqHidden = false;
    } else continue;
    statements.push({
      sql: 'UPDATE vehicle_types SET active = ?, hq_hidden = ? WHERE shop_id = ? AND id = ?',
      params: [vt.active, vt.hqHidden, shopId, vt.id],
    });
  }
  return statements;
}

/** One rebuild of a branch's menu; see `menuRepo.publish`. */
async function publishOnce(d1: D1Database, shopId: string): Promise<PublishResult> {
  const pdb = createPlatformDb(d1);
  const shop = await pdb.shop.findUnique({
    where: { id: shopId },
    select: {
      businessId: true,
      priceBookId: true,
      priceZoneId: true,
      latitude: true,
      longitude: true,
      serviceRadiusKm: true,
      ...BRANCH_SERVICES_SELECT,
    },
  });
  if (!shop?.businessId) return { shopId, published: false, changes: 0 };
  const businessId = shop.businessId;
  const data = await catalogRepo.load(d1, businessId);
  if (!data) return { shopId, published: false, changes: 0 };
  const version = data.business.catalogVersion;
  const index = indexCatalog(data);
  const book =
    data.priceBooks.find((b) => b.id === shop.priceBookId) ?? data.priceBooks.find((b) => b.isDefault) ?? null;
  const zone = data.zones.find((z) => z.id === shop.priceZoneId && z.active) ?? null;

  const db = createShopDb(d1, shopId);
  const [entries, branch] = await Promise.all([
    book ? catalogRepo.entries(pdb, businessId, book.id) : Promise.resolve([]),
    readBranch(db),
  ]);

  const statements: SqlStatement[] = [];
  let changes = 0;

  // Vehicle types: tie hand-made ones to body types.
  const links = linkVehicleTypes(shopId, businessId, data, branch);
  statements.push(...links);
  changes += links.length;
  const switched = applyHqSwitches(shopId, data, branch);
  statements.push(...switched);
  changes += switched.length;

  // The hub and the community team follow what the branch offers (head office allows, the owner
  // switches on): one is made at the branch's location the first time it's needed, brought back
  // when it's switched on again, and paused when it's off. The first ones wash what the branch
  // already does.
  const live = branchServicesOf(shop).live;
  const located = shop.latitude != null && shop.longitude != null;
  for (const [kind, wanted] of [
    ['hub', live.hub],
    ['doorstep', live.community],
  ] as const) {
    const own = branch.points.filter((p) => p.kind === kind);
    if (wanted && !own.some((p) => p.active)) {
      const paused = own[0];
      if (paused) {
        statements.push({ sql: 'UPDATE service_points SET active = 1 WHERE shop_id = ? AND id = ?', params: [shopId, paused.id] });
        paused.active = true;
      } else {
        const classes = new Set<string>(DEFAULT_POINT_CLASSES);
        for (const vt of branch.vehicleTypes) {
          const b = vt.active && vt.bodyTypeId ? index.body.get(vt.bodyTypeId) : undefined;
          if (b) classes.add(b.classKey);
        }
        // …and every group on the branch's list of vehicles (tractors chosen when it opened).
        for (const id of branch.kinds ?? []) {
          const b = index.body.get(id);
          if (b) classes.add(b.classKey);
        }
        const classIds = [...classes].map((k) => index.classIdByKey.get(k)).filter((id): id is string => !!id);
        const pointId = newId();
        statements.push(
          {
            sql: 'INSERT INTO service_points (id, shop_id, kind, name, latitude, longitude, radius_km, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            params: [
              pointId,
              shopId,
              kind,
              kind === 'hub' ? 'Main hub' : 'Community team',
              located ? shop.latitude : null,
              located ? shop.longitude : null,
              located ? (kind === 'hub' ? pointRadius(shop.serviceRadiusKm) : COMMUNITY_TEAM_RADIUS_KM) : null,
              branch.points.length,
            ],
          },
          ...insertRows(
            'service_point_classes',
            ['shop_id', 'point_id', 'class_id'],
            classIds.map((c) => [shopId, pointId, c]),
          ),
        );
        branch.points.push({ id: pointId, kind, active: true, classes: classIds.map((classId) => ({ classId })) });
      }
      changes += 1;
    }
    if (!wanted) {
      for (const p of own.filter((x) => x.active)) {
        statements.push({ sql: 'UPDATE service_points SET active = 0 WHERE shop_id = ? AND id = ?', params: [shopId, p.id] });
        p.active = false;
        changes += 1;
      }
    }
  }

  const caps = branchCapabilities(
    branch.points.map((p) => ({
      kind: p.kind === 'doorstep' ? 'doorstep' : 'hub',
      active: p.active,
      classKeys: p.classes.map((c) => index.classKey.get(c.classId)).filter((k): k is string => !!k),
    })),
    index.allClassKeys,
  );

  // Base prices by class and size.
  const sizeOf = new Map(data.classes.flatMap((c) => c.sizes.map((s) => [s.id, { classKey: c.key, sizeKey: s.key }] as const)));
  const basePrices = new Map<string, number>();
  const doorstepPrices = new Map<string, number>();
  const pricedSizes = new Set<string>();
  const activeServices = new Set(data.services.filter((s) => s.active).map((s) => s.id));
  for (const e of entries) {
    const size = sizeOf.get(e.sizeId);
    if (!size) continue;
    const key = basePriceKey(e.serviceId, size.classKey, size.sizeKey);
    basePrices.set(key, e.price);
    if (e.doorstepPrice != null) doorstepPrices.set(key, e.doorstepPrice);
    if (activeServices.has(e.serviceId)) pricedSizes.add(`${size.classKey}|${size.sizeKey}`);
  }

  // Kinds on the branch's list that it washes and has prices for get a vehicle type of their own,
  // so a doorstep team that starts washing tractors can bill one. A type the owner switched off
  // stays off.
  const linkedBodies = new Set(branch.vehicleTypes.map((vt) => vt.bodyTypeId).filter(Boolean));
  const takenNames = new Set(branch.vehicleTypes.map((vt) => vt.name.trim().toLowerCase()));
  let sortOrder = branch.vehicleTypes.reduce((n, vt) => Math.max(n, vt.sortOrder + 1), 0);
  const newTypes: unknown[][] = [];
  for (const b of data.bodyTypes) {
    const info = index.body.get(b.id);
    if (!info || linkedBodies.has(b.id) || takenNames.has(b.name.trim().toLowerCase())) continue;
    if (branch.kinds != null && !branch.kinds.has(b.id)) continue;
    if (!caps.classKeys.has(info.classKey) || !pricedSizes.has(`${info.classKey}|${info.sizeKey}`)) continue;
    const id = newId();
    const category = categoryForClass(info.classKey);
    newTypes.push([id, shopId, b.name, category, sortOrder, 1, b.id]);
    branch.vehicleTypes.push({ id, name: b.name, category, active: true, bodyTypeId: b.id, sortOrder, hqHidden: false });
    sortOrder += 1;
  }
  statements.push(...insertRows('vehicle_types', SHOP_VT_COLUMNS, newTypes));
  changes += newTypes.length;

  // Plan.
  const linkedByCatalog = new Map(branch.services.map((s) => [s.catalogServiceId!, s]));
  const catalogOfShopService = new Map(branch.services.map((s) => [s.id, s.catalogServiceId!]));
  const overrides = new Map<string, number>();
  for (const o of branch.overrides) {
    const catalogId = catalogOfShopService.get(o.serviceId);
    if (catalogId && (o.mode === 'hub' || o.mode === 'doorstep')) {
      overrides.set(branchPriceKey(catalogId, o.vehicleTypeId, o.mode), o.price);
    }
  }

  const runPlan = () =>
    planBranchMenu({
      services: data.services.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        modes: s.modes,
        details: {
          teamAt: s.teamAt,
          durationMin: s.durationMin,
          kind: s.kind,
          popular: s.popular,
          showInApp: s.showInApp,
          checklist: s.checklist.length ? JSON.stringify(s.checklist) : null,
        },
        classKeys: s.classIds.map((id) => index.classKey.get(id)).filter((k): k is string => !!k),
        sizeKeys: s.sizeIds.flatMap((id) => {
          const z = sizeOf.get(id);
          return z ? [`${z.classKey}|${z.sizeKey}`] : [];
        }),
        includes: s.includes,
        sortOrder: s.sortOrder,
        // Only what head office switched on for this branch (and still live at HQ).
        active: s.active && branch.menu.has(s.id),
      })),
      basePrices,
      doorstepPrices,
      adjustments: index.adjustments,
      policy: data.policy,
      zonePercentBp: zone?.percentBp ?? 0,
      classesByMode: caps.classesByMode,
      vehicles: branch.vehicleTypes.map((vt) => {
        const b = vt.bodyTypeId ? index.body.get(vt.bodyTypeId) : undefined;
        return { vehicleTypeId: vt.id, classKey: b?.classKey ?? null, sizeKey: b?.sizeKey ?? null };
      }),
      hidden: new Set(branch.services.filter((s) => s.branchHidden).map((s) => s.catalogServiceId!)),
      overrides,
    });

  // A catalog service adopts the branch's hand-made service of the same name instead of
  // adding a second one: its washes, rewards and commissions carry on, and where the branch
  // charged differently that stays as its own price. Only services the branch will offer
  // adopt, so a hand-made service is never switched off by it.
  const adoptedPrices = new Map<string, number>();
  const manualByName = new Map(branch.manual.map((s) => [s.name.trim().toLowerCase(), s]));
  const offered = new Set(runPlan().services.map((p) => p.catalogServiceId));
  for (const s of data.services) {
    if (!offered.has(s.id) || linkedByCatalog.has(s.id)) continue;
    const own = manualByName.get(s.name.trim().toLowerCase());
    if (!own) continue;
    manualByName.delete(s.name.trim().toLowerCase());
    statements.push({
      sql: 'UPDATE services SET catalog_service_id = ? WHERE shop_id = ? AND id = ? AND catalog_service_id IS NULL',
      params: [s.id, shopId, own.id],
    });
    changes += 1;
    const linked = { ...own, catalogServiceId: s.id, branchHidden: false };
    branch.services.push(linked);
    linkedByCatalog.set(s.id, linked);
    catalogOfShopService.set(own.id, s.id);
    for (const p of branch.manualPrices.filter((mp) => mp.serviceId === own.id)) {
      branch.prices.push(p);
      const key = branchPriceKey(s.id, p.vehicleTypeId, p.mode === 'doorstep' ? 'doorstep' : 'hub');
      if (!overrides.has(key)) {
        overrides.set(key, p.price);
        adoptedPrices.set(key, p.price);
      }
    }
    for (const item of branch.allComboItems) if (item.comboId === own.id) branch.comboItems.push(item);
  }
  const plan = runPlan();

  // Adopted prices equal to the list price are just the list price; the rest are kept as the
  // branch's own price, recorded as set by its first owner.
  if (adoptedPrices.size) {
    const owner = await db.user.findFirst({ where: { role: 'owner' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    const keep: unknown[][] = [];
    for (const p of plan.prices) {
      const key = branchPriceKey(p.catalogServiceId, p.vehicleTypeId, p.mode);
      const own = adoptedPrices.get(key);
      if (own == null) continue;
      if (own === p.listPrice || !owner) {
        p.price = p.listPrice;
        p.source = 'template';
        continue;
      }
      const serviceId = linkedByCatalog.get(p.catalogServiceId)!.id;
      keep.push([shopId, serviceId, p.vehicleTypeId, p.mode, own, owner.id]);
    }
    statements.push(
      ...insertRows(
        'branch_price_overrides',
        ['shop_id', 'service_id', 'vehicle_type_id', 'mode', 'price', 'updated_by_user_id'],
        keep,
        { orIgnore: true },
      ),
    );
  }

  // Services: create, refresh, or take off the menu.
  const shopServiceId = new Map<string, string>();
  const planned = new Set<string>();
  const newServices: unknown[][] = [];
  for (const p of plan.services) {
    planned.add(p.catalogServiceId);
    const existing = linkedByCatalog.get(p.catalogServiceId);
    if (!existing) {
      const id = newId();
      shopServiceId.set(p.catalogServiceId, id);
      const d = p.details;
      newServices.push([
        id,
        shopId,
        p.name,
        p.description,
        1,
        p.appliesTo,
        p.sortOrder,
        p.catalogServiceId,
        p.modes,
        0,
        d.teamAt,
        d.durationMin,
        d.kind,
        d.popular ? 1 : 0,
        d.showInApp ? 1 : 0,
        d.checklist,
      ]);
      continue;
    }
    shopServiceId.set(p.catalogServiceId, existing.id);
    if (
      existing.name !== p.name ||
      existing.description !== p.description ||
      existing.appliesTo !== p.appliesTo ||
      existing.modes !== p.modes ||
      existing.sortOrder !== p.sortOrder ||
      existing.teamAt !== p.details.teamAt ||
      existing.durationMin !== p.details.durationMin ||
      existing.kind !== p.details.kind ||
      existing.popular !== p.details.popular ||
      existing.showInApp !== p.details.showInApp ||
      existing.checklist !== p.details.checklist ||
      !existing.active
    ) {
      const d = p.details;
      statements.push({
        sql: `UPDATE services SET name = ?, description = ?, applies_to = ?, modes = ?, sort_order = ?, team_at = ?, duration_min = ?,
                kind = ?, popular = ?, show_in_app = ?, checklist = ?, active = 1 WHERE shop_id = ? AND id = ?`,
        params: [
          p.name,
          p.description,
          p.appliesTo,
          p.modes,
          p.sortOrder,
          d.teamAt,
          d.durationMin,
          d.kind,
          d.popular ? 1 : 0,
          d.showInApp ? 1 : 0,
          d.checklist,
          shopId,
          existing.id,
        ],
      });
      changes += 1;
    }
  }
  statements.push(...insertRows('services', SERVICE_COLUMNS, newServices));
  changes += newServices.length;
  const retired = branch.services.filter((s) => s.active && !planned.has(s.catalogServiceId!)).map((s) => s.id);
  statements.push(
    ...deleteIn('service_combo_items', 'combo_id', retired, { sql: 'shop_id = ?', params: [shopId] }),
    ...retired.map((id) => ({ sql: 'UPDATE services SET active = 0 WHERE shop_id = ? AND id = ?', params: [shopId, id] })),
  );
  changes += retired.length;

  // Combo items.
  const wantItems = new Set<string>();
  for (const p of plan.services) {
    const comboId = shopServiceId.get(p.catalogServiceId)!;
    for (const inc of p.includes) wantItems.add(`${comboId}|${shopServiceId.get(inc)!}`);
  }
  const retiredSet = new Set(retired);
  const haveItems = new Set(branch.comboItems.filter((i) => !retiredSet.has(i.comboId)).map((i) => `${i.comboId}|${i.serviceId}`));
  for (const key of haveItems) {
    if (wantItems.has(key)) continue;
    const [comboId, serviceId] = key.split('|');
    statements.push({
      sql: 'DELETE FROM service_combo_items WHERE shop_id = ? AND combo_id = ? AND service_id = ?',
      params: [shopId, comboId, serviceId],
    });
    changes += 1;
  }
  const addItems = [...wantItems].filter((k) => !haveItems.has(k)).map((k) => [shopId, ...k.split('|')]);
  statements.push(...insertRows('service_combo_items', ['shop_id', 'combo_id', 'service_id'], addItems));
  changes += addItems.length;

  // Prices: a changed row is replaced (nothing references price rows by id).
  const have = new Map(branch.prices.map((p) => [`${p.serviceId}|${p.vehicleTypeId}|${p.mode}`, p]));
  const stale: string[] = [];
  const fresh: unknown[][] = [];
  const wanted = new Set<string>();
  for (const p of plan.prices) {
    const serviceId = shopServiceId.get(p.catalogServiceId)!;
    const key = `${serviceId}|${p.vehicleTypeId}|${p.mode}`;
    wanted.add(key);
    const row = have.get(key);
    if (row && row.price === p.price && row.listPrice === p.listPrice && row.source === p.source) continue;
    if (row) stale.push(row.id);
    fresh.push([newId(), shopId, serviceId, p.vehicleTypeId, p.price, p.mode, p.source, p.listPrice]);
  }
  // A hand-typed price for a vehicle type the catalog can't price (not tied to a body type)
  // stays, so linking a service never takes a price away.
  const catalogPriced = new Set(branch.vehicleTypes.filter((vt) => vt.bodyTypeId && index.body.has(vt.bodyTypeId)).map((vt) => vt.id));
  const retiredIds = new Set(retired);
  for (const [key, row] of have) {
    if (wanted.has(key)) continue;
    if (row.source === 'manual' && !catalogPriced.has(row.vehicleTypeId) && !retiredIds.has(row.serviceId)) continue;
    stale.push(row.id);
  }
  statements.push(
    ...deleteIn('service_prices', 'id', stale, { sql: 'shop_id = ?', params: [shopId] }),
    ...insertRows('service_prices', PRICE_COLUMNS, fresh),
  );
  changes += stale.length + fresh.length;

  statements.push({
    sql: 'UPDATE shops SET menu_version = MAX(menu_version, ?) WHERE id = ?',
    params: [version, shopId],
  });
  await runStatements(d1, statements);
  return { shopId, published: true, changes };
}

export const menuRepo = {
  /** How the branch works today: ways it delivers and classes it washes. */
  /**
   * Vehicle types only the doorstep team washes (its classes aren't taken at the hub). They have
   * hub prices, because home washes are priced like the hub, but aren't washed at the shop.
   */
  async homeOnlyTypes(d1: D1Database, shopId: string): Promise<Set<string>> {
    const db = createShopDb(d1, shopId);
    const points = await db.servicePoint.findMany({
      where: { active: true },
      select: { kind: true, classes: { select: { classId: true } } },
    });
    // No points: a plain hub that washes everything. No team: nothing is washed only at homes.
    if (!points.some((p) => p.kind === 'doorstep') || !points.some((p) => p.kind !== 'doorstep')) return new Set();
    const atHub = new Set(points.filter((p) => p.kind !== 'doorstep').flatMap((p) => p.classes.map((c) => c.classId)));
    const types = await db.vehicleType.findMany({ where: { bodyTypeId: { not: null } }, select: { id: true, bodyTypeId: true } });
    const bodyIds = [...new Set(types.map((t) => t.bodyTypeId!))];
    const bodies = bodyIds.length
      ? await createPlatformDb(d1).bodyType.findMany({ where: { id: { in: bodyIds } }, select: { id: true, classId: true } })
      : [];
    const classOf = new Map(bodies.map((b) => [b.id, b.classId]));
    return new Set(types.filter((t) => { const c = classOf.get(t.bodyTypeId!); return c != null && !atHub.has(c); }).map((t) => t.id));
  },

  async capabilities(d1: D1Database, shopId: string): Promise<BranchCapabilities & { businessId: string | null; policy: PricingPolicy | null }> {
    const pdb = createPlatformDb(d1);
    const shop = await catalogRepo.branchOf(pdb, shopId);
    const data = shop?.businessId ? await catalogRepo.load(d1, shop.businessId) : null;
    const db = createShopDb(d1, shopId);
    const points = await db.servicePoint.findMany({ select: { kind: true, active: true, classes: { select: { classId: true } } } });
    const classKey = new Map(data?.classes.map((c) => [c.id, c.key]) ?? []);
    const caps = branchCapabilities(
      points.map((p) => ({
        kind: p.kind === 'doorstep' ? 'doorstep' : 'hub',
        active: p.active,
        classKeys: p.classes.map((c) => classKey.get(c.classId)).filter((k): k is string => !!k),
      })),
      data ? data.classes.map((c) => c.key) : [],
    );
    return { ...caps, businessId: shop?.businessId ?? null, policy: data?.policy ?? null };
  },

  /**
   * Rebuilds a branch's menu from the catalog. Safe to run any time and from several places at
   * once: it computes the menu from scratch and writes only the difference, so a second run
   * changes nothing. The branch is marked as built from the catalog version read at the start;
   * a catalog change made meanwhile leaves it stale for the next run.
   */
  async publish(d1: D1Database, shopId: string): Promise<PublishResult> {
    // Two rebuilds of one branch at once (a background one and a menu read) can both add the
    // same row; the loser's transaction rolls back and running it again finds the winner's rows.
    return retryOnClash(() => publishOnce(d1, shopId));
  },

  /**
   * Rebuilds the given branches one after another; a failure is reported and the rest still
   * run (the failed one stays stale and is retried by the nightly run).
   */
  async publishMany(d1: D1Database, shopIds: readonly string[], onError?: (shopId: string, e: unknown) => void) {
    const results: PublishResult[] = [];
    for (const shopId of shopIds) {
      try {
        results.push(await menuRepo.publish(d1, shopId));
      } catch (e) {
        onError?.(shopId, e);
      }
    }
    return results;
  },

  /** Every branch whose menu is behind its business's catalog (nightly). */
  async publishStale(d1: D1Database, onError?: (shopId: string, e: unknown) => void) {
    return menuRepo.publishMany(d1, await catalogRepo.staleBranches(createPlatformDb(d1)), onError);
  },

  /** Marks a branch's menu as needing a rebuild (its points, overrides or hidden list changed). */
  async markStale(d1: D1Database, shopId: string) {
    await runStatements(d1, [{ sql: 'UPDATE shops SET menu_version = 0 WHERE id = ?', params: [shopId] }]);
  },

  /** Rebuilds the branch's menu only when it is behind the catalog: one cheap read otherwise. */
  async publishIfStale(d1: D1Database, shopId: string): Promise<boolean> {
    const [row] = await queryRows<{ stale: number }>(
      d1,
      `SELECT s.menu_version < b.catalog_version AS stale
       FROM shops s JOIN businesses b ON b.id = s.business_id WHERE s.id = ?`,
      [shopId],
    );
    if (!row?.stale) return false;
    await menuRepo.publish(d1, shopId);
    return true;
  },

  /**
   * A branch's own price for a catalog service, within the business policy; `null` goes back to
   * the list price. Applied straight to the price row, so the menu doesn't need a rebuild.
   */
  async setOverride(
    d1: D1Database,
    shopId: string,
    userId: string,
    input: { serviceId: string; vehicleTypeId: string; mode: DeliveryMode; price: number | null },
  ): Promise<{ price: number; listPrice: number; overridden: boolean }> {
    const pdb = createPlatformDb(d1);
    const db = createShopDb(d1, shopId);
    const shop = await catalogRepo.branchOf(pdb, shopId);
    const [data, row] = await Promise.all([
      shop?.businessId ? catalogRepo.load(d1, shop.businessId) : Promise.resolve(null),
      db.servicePrice.findFirst({
        where: { serviceId: input.serviceId, vehicleTypeId: input.vehicleTypeId, mode: input.mode },
        select: { id: true, listPrice: true, service: { select: { catalogServiceId: true } } },
      }),
    ]);
    if (!data || !row?.service.catalogServiceId || row.listPrice == null) {
      throw new CatalogError('not_found', 'This price isn’t set by the business catalog.');
    }
    const list = row.listPrice;
    if (input.price != null) {
      const check = checkOverride(list, input.price, data.policy);
      if (check === 'not_allowed') throw new CatalogError('invalid', 'Branch prices are switched off by the business.');
      if (check === 'out_of_range') throw new CatalogError('invalid', 'That price is outside what the business allows.');
    }
    const eff = effectivePrice(list, input.price, data.policy);
    const key = [input.serviceId, input.vehicleTypeId, input.mode];
    await runStatements(d1, [
      input.price == null
        ? {
            sql: 'DELETE FROM branch_price_overrides WHERE shop_id = ? AND service_id = ? AND vehicle_type_id = ? AND mode = ?',
            params: [shopId, ...key],
          }
        : {
            sql: `INSERT INTO branch_price_overrides (shop_id, service_id, vehicle_type_id, mode, price, updated_by_user_id)
                  VALUES (?, ?, ?, ?, ?, ?)
                  ON CONFLICT (service_id, vehicle_type_id, mode) DO UPDATE SET price = excluded.price,
                    updated_by_user_id = excluded.updated_by_user_id, updated_at = ${SQL_NOW}`,
            params: [shopId, ...key, input.price, userId],
          },
      {
        sql: 'UPDATE service_prices SET price = ?, source = ? WHERE shop_id = ? AND id = ?',
        params: [eff.price, eff.overridden ? 'override' : 'template', shopId, row.id],
      },
    ]);
    return { price: eff.price, listPrice: list, overridden: eff.overridden };
  },

  /** Stop (or start again) offering a catalog service at this branch, when the policy allows. */
  async setHidden(d1: D1Database, shopId: string, serviceId: string, hidden: boolean) {
    const db = createShopDb(d1, shopId);
    const service = await db.service.findUnique({ where: { id: serviceId }, select: { catalogServiceId: true } });
    if (!service?.catalogServiceId) throw new CatalogError('not_found', 'Not a business catalog service.');
    const caps = await menuRepo.capabilities(d1, shopId);
    if (hidden && !caps.policy?.branchCanHideServices) {
      throw new CatalogError('invalid', 'The business doesn’t let branches remove its services.');
    }
    await runStatements(d1, [
      { sql: 'UPDATE services SET branch_hidden = ? WHERE shop_id = ? AND id = ?', params: [hidden, shopId, serviceId] },
      { sql: 'UPDATE shops SET menu_version = 0 WHERE id = ?', params: [shopId] },
    ]);
    return menuRepo.publish(d1, shopId);
  },

  /**
   * Starts (or extends) the catalog from a branch's hand-made menu: each of its services becomes
   * a catalog service (unless one of the same name exists), and its prices become the default
   * price book's base prices where none are set yet. The rebuild that follows links the
   * branch's services to them (see `publish`), so washes, rewards and commissions carry on.
   */
  async importFromBranch(d1: D1Database, businessId: string, shopId: string) {
    const pdb = createPlatformDb(d1);
    const shop = await catalogRepo.branchOf(pdb, shopId);
    if (shop?.businessId !== businessId) throw new CatalogError('not_found', 'Branch not found.');
    const data = await catalogRepo.load(d1, businessId);
    if (!data) throw new CatalogError('not_found', 'Business not found.');
    const book = data.priceBooks.find((b) => b.isDefault)!;
    const index = indexCatalog(data);
    const db = createShopDb(d1, shopId);
    const [branch, manual, manualItems, manualPrices, entries] = await Promise.all([
      readBranch(db),
      db.service.findMany({ where: { catalogServiceId: null, active: true }, orderBy: { sortOrder: 'asc' } }),
      db.serviceComboItem.findMany({ where: { combo: { catalogServiceId: null, active: true } } }),
      db.servicePrice.findMany({ where: { mode: 'hub', service: { catalogServiceId: null, active: true } } }),
      catalogRepo.entries(pdb, businessId, book.id),
    ]);
    const statements: SqlStatement[] = linkVehicleTypes(shopId, businessId, data, branch);

    const sizeIdOf = new Map<string, string>();
    for (const b of data.bodyTypes) sizeIdOf.set(b.id, b.sizeId);
    const vtSize = new Map<string, { sizeId: string; classKey: string }>();
    for (const vt of branch.vehicleTypes) {
      const info = vt.bodyTypeId ? index.body.get(vt.bodyTypeId) : undefined;
      const sizeId = vt.bodyTypeId ? sizeIdOf.get(vt.bodyTypeId) : undefined;
      if (info && sizeId) vtSize.set(vt.id, { sizeId, classKey: info.classKey });
    }
    const vtOrder = new Map(branch.vehicleTypes.map((vt) => [vt.id, vt.sortOrder]));

    const byName = new Map(data.services.map((s) => [s.name.trim().toLowerCase(), s]));
    const linkedCatalog = new Set(branch.services.map((s) => s.catalogServiceId));
    const catalogFor = new Map<string, string>();
    const created = new Set<string>();
    let sortOrder = data.services.reduce((n, s) => Math.max(n, s.sortOrder + 1), 0);
    for (const s of manual) {
      const existing = byName.get(s.name.trim().toLowerCase());
      if (existing) {
        if (linkedCatalog.has(existing.id)) continue;
        catalogFor.set(s.id, existing.id);
        linkedCatalog.add(existing.id);
        continue;
      }
      const id = newId();
      catalogFor.set(s.id, id);
      linkedCatalog.add(id);
      created.add(id);
      const priced = manualPrices.filter((p) => p.serviceId === s.id);
      const classKeys = new Set(priced.map((p) => vtSize.get(p.vehicleTypeId)?.classKey).filter((k): k is string => !!k));
      if (!classKeys.size) {
        if (s.appliesTo !== 'bike') classKeys.add('car');
        if (s.appliesTo !== 'car') classKeys.add('twoWheeler');
      }
      statements.push(
        {
          sql: 'INSERT INTO catalog_services (id, business_id, name, description, modes, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
          params: [id, businessId, s.name.slice(0, 60), s.description?.slice(0, 160) ?? null, 'both', sortOrder++],
        },
        ...insertRows(
          'catalog_service_classes',
          ['business_id', 'service_id', 'class_id'],
          [...classKeys].map((k) => index.classIdByKey.get(k)).filter((c): c is string => !!c).map((c) => [businessId, id, c]),
        ),
      );
    }
    const comboRows = manualItems
      .filter((i) => created.has(catalogFor.get(i.comboId) ?? '') && catalogFor.has(i.serviceId))
      .map((i) => [businessId, catalogFor.get(i.comboId)!, catalogFor.get(i.serviceId)!]);
    statements.push(...insertRows('catalog_combo_items', ['business_id', 'combo_id', 'service_id'], comboRows));

    // Base prices: the first vehicle type (in the branch's order) of each size sets it.
    const base = new Map(entries.map((e) => [`${e.serviceId}|${e.sizeId}`, e.price]));
    const newEntries = new Map<string, number>();
    const sorted = [...manualPrices].sort((a, b) => (vtOrder.get(a.vehicleTypeId) ?? 0) - (vtOrder.get(b.vehicleTypeId) ?? 0));
    for (const p of sorted) {
      const catalogId = catalogFor.get(p.serviceId);
      const size = vtSize.get(p.vehicleTypeId);
      if (!catalogId || !size) continue;
      const key = `${catalogId}|${size.sizeId}`;
      if (base.has(key) || newEntries.has(key)) continue;
      newEntries.set(key, p.price);
    }
    statements.push(
      ...insertRows(
        'price_book_entries',
        ['business_id', 'price_book_id', 'service_id', 'size_id', 'price'],
        [...newEntries].map(([key, price]) => [businessId, book.id, ...key.split('|'), price]),
      ),
    );

    // The branch they came from keeps selling them: they're switched on there (and only there).
    statements.push(
      ...insertRows(
        'branch_menu_services',
        ['shop_id', 'catalog_service_id'],
        [...new Set(catalogFor.values())].map((id) => [shopId, id]),
        { orIgnore: true },
      ),
    );
    statements.push({ sql: 'UPDATE businesses SET catalog_version = catalog_version + 1 WHERE id = ?', params: [businessId] });
    await runStatements(d1, statements);
    const result = await menuRepo.publish(d1, shopId);
    return { created: created.size, prices: newEntries.size, publish: result };
  },
};
