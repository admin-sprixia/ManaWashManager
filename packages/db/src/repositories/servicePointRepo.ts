import type { ServicePointKind } from '@mana/domain';
import { createShopDb, type D1Database } from '../client';
import { newId } from '../ids';
import { insertRows, runStatements, SQL_NOW, type SqlStatement } from '../sql';
import { CatalogError, catalogRepo } from './catalogRepo';

/**
 * How a branch delivers: its hub and doorstep teams, each with the vehicle classes it washes.
 * Points are switched off, never deleted, because washes record the point they were done by.
 * Every change marks the branch's menu for a rebuild (the caller publishes it).
 */

export interface ServicePointView {
  id: string;
  kind: ServicePointKind;
  name: string;
  latitude: number | null;
  longitude: number | null;
  radiusKm: number | null;
  active: boolean;
  sortOrder: number;
  classIds: string[];
}

export interface ServicePointInput {
  kind: ServicePointKind;
  name: string;
  latitude: number | null;
  longitude: number | null;
  radiusKm: number | null;
  classIds: string[];
}

const stale = (shopId: string): SqlStatement => ({ sql: 'UPDATE shops SET menu_version = 0 WHERE id = ?', params: [shopId] });

/** Classes must be the business's own; at least one. */
async function checkClasses(d1: D1Database, shopId: string, classIds: string[]) {
  if (!classIds.length) throw new CatalogError('invalid', 'Pick at least one vehicle class.');
  const businessId = await catalogRepo.businessForShop(d1, shopId);
  const data = await catalogRepo.load(d1, businessId);
  const known = new Set(data?.classes.map((c) => c.id) ?? []);
  if (classIds.some((id) => !known.has(id))) throw new CatalogError('invalid', 'Unknown vehicle class.');
}

function classRows(shopId: string, pointId: string, classIds: string[]) {
  return insertRows('service_point_classes', ['shop_id', 'point_id', 'class_id'], [...new Set(classIds)].map((c) => [shopId, pointId, c]));
}

export const servicePointRepo = {
  async list(d1: D1Database, shopId: string): Promise<ServicePointView[]> {
    const points = await createShopDb(d1, shopId).servicePoint.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { classes: { select: { classId: true } } },
    });
    return points.map((p) => ({
      id: p.id,
      kind: p.kind === 'doorstep' ? 'doorstep' : 'hub',
      name: p.name,
      latitude: p.latitude,
      longitude: p.longitude,
      radiusKm: p.radiusKm,
      active: p.active,
      sortOrder: p.sortOrder,
      classIds: p.classes.map((c) => c.classId),
    }));
  },

  async create(d1: D1Database, shopId: string, input: ServicePointInput): Promise<string> {
    await checkClasses(d1, shopId, input.classIds);
    const count = await createShopDb(d1, shopId).servicePoint.count();
    const id = newId();
    await runStatements(d1, [
      {
        sql: `INSERT INTO service_points (id, shop_id, kind, name, latitude, longitude, radius_km, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [id, shopId, input.kind, input.name, input.latitude, input.longitude, input.radiusKm, count],
      },
      ...classRows(shopId, id, input.classIds),
      stale(shopId),
    ]);
    return id;
  },

  async update(
    d1: D1Database,
    shopId: string,
    id: string,
    patch: Partial<ServicePointInput> & { active?: boolean },
  ): Promise<void> {
    const db = createShopDb(d1, shopId);
    const point = await db.servicePoint.findUnique({ where: { id } });
    if (!point) throw new CatalogError('not_found', 'Service point not found.');
    if (patch.classIds) await checkClasses(d1, shopId, patch.classIds);
    if (patch.active === false) {
      const others = await db.servicePoint.count({ where: { active: true, id: { not: id } } });
      if (!others) throw new CatalogError('invalid', 'A branch needs at least one working service point.');
    }
    const latitude = patch.latitude !== undefined ? patch.latitude : point.latitude;
    const longitude = patch.longitude !== undefined ? patch.longitude : point.longitude;
    const radiusKm = patch.radiusKm !== undefined ? patch.radiusKm : point.radiusKm;
    const statements: SqlStatement[] = [
      {
        sql: `UPDATE service_points SET kind = ?, name = ?, latitude = ?, longitude = ?, radius_km = ?, active = ?,
                updated_at = ${SQL_NOW}
              WHERE shop_id = ? AND id = ?`,
        params: [
          patch.kind ?? point.kind,
          patch.name ?? point.name,
          latitude,
          longitude,
          latitude == null ? null : radiusKm,
          patch.active ?? point.active,
          shopId,
          id,
        ],
      },
    ];
    if (patch.classIds) {
      statements.push(
        { sql: 'DELETE FROM service_point_classes WHERE shop_id = ? AND point_id = ?', params: [shopId, id] },
        ...classRows(shopId, id, patch.classIds),
      );
    }
    await runStatements(d1, [...statements, stale(shopId)]);
  },
};
