import {
  BODY_TYPES,
  VEHICLE_MAKE_MAX,
  categoryForClass,
  listedModel,
  vehicleModelKey,
  type VehicleCategory,
  type VehicleModelEdit,
} from '@mana/domain';
import { createPlatformDb, type D1Database, type DbClient } from '../client';
import { runStatements, SQL_NOW, type SqlStatement } from '../sql';

export class VehicleModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VehicleModelError';
  }
}
const fail = (message: string): never => {
  throw new VehicleModelError(message);
};

const upsert = (businessId: string, e: VehicleModelEdit, phone: string | null): SqlStatement => ({
  sql: `INSERT INTO vehicle_models (business_id, model_key, make, model, category, body_key, updated_by_phone)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (business_id, model_key) DO UPDATE SET make = excluded.make, model = excluded.model,
          category = excluded.category, body_key = excluded.body_key, updated_by_phone = excluded.updated_by_phone,
          updated_at = ${SQL_NOW}`,
  params: [businessId, vehicleModelKey(e.make, e.model), e.make.trim(), e.model.trim(), e.category, e.bodyKey, phone],
});
const drop = (businessId: string, make: string, model: string): SqlStatement => ({
  sql: 'DELETE FROM vehicle_models WHERE business_id = ? AND model_key = ?',
  params: [businessId, vehicleModelKey(make, model)],
});

/** A name that can be saved: trimmed, 1–40 characters. */
function cleanName(value: string, what: string): string {
  const v = value.trim().replace(/\s+/g, ' ');
  if (!v) fail(`Enter the ${what}.`);
  if (v.length > VEHICLE_MAKE_MAX) fail(`The ${what} is up to ${VEHICLE_MAKE_MAX} characters.`);
  return v;
}

/**
 * Head office's changes to the list of companies and models. The list ships with the app; a
 * change adds a model, moves one to another kind of vehicle, renames or removes one. Business
 * level: one list for every branch and the customer app.
 */
export const vehicleModelRepo = {
  async list(pdb: DbClient, businessId: string): Promise<VehicleModelEdit[]> {
    return (await vehicleModelRepo.listMany(pdb, [businessId])).get(businessId) ?? [];
  },

  async listMany(pdb: DbClient, businessIds: string[]): Promise<Map<string, VehicleModelEdit[]>> {
    const rows = businessIds.length
      ? await pdb.vehicleModel.findMany({
          where: { businessId: { in: businessIds } },
          orderBy: [{ make: 'asc' }, { model: 'asc' }],
          select: { businessId: true, make: true, model: true, category: true, bodyKey: true },
        })
      : [];
    const out = new Map<string, VehicleModelEdit[]>(businessIds.map((id) => [id, []]));
    for (const r of rows) {
      out.get(r.businessId)?.push({ make: r.make, model: r.model, category: r.category === 'bike' ? 'bike' : 'car', bodyKey: r.bodyKey });
    }
    return out;
  },

  /**
   * Adds a model or changes one. `from` is the model being edited when its company or name
   * changes: the old name goes off the list (a listed one is marked removed, an added one is
   * deleted). Saving a listed model exactly as it ships undoes the change.
   */
  async save(
    d1: D1Database,
    businessId: string,
    input: { make: string; model: string; category: VehicleCategory; bodyKey: string; from?: { make: string; model: string } },
    phone: string | null,
  ) {
    const make = cleanName(input.make, 'company');
    const model = cleanName(input.model, 'model');
    const body = BODY_TYPES.find((b) => b.key === input.bodyKey) ?? fail('Pick the kind of vehicle.');
    if (categoryForClass(body.classKey) !== input.category) fail(`A ${body.label} isn’t a ${input.category === 'bike' ? 'two-wheeler' : 'car'}.`);
    const statements: SqlStatement[] = [];
    const renamed = input.from && vehicleModelKey(input.from.make, input.from.model) !== vehicleModelKey(make, model);
    if (renamed && input.from) {
      statements.push(
        listedModel(input.from.make, input.from.model)
          ? upsert(businessId, { make: input.from.make, model: input.from.model, category: input.category, bodyKey: null }, phone)
          : drop(businessId, input.from.make, input.from.model),
      );
    }
    const listed = listedModel(make, model);
    if (!input.from && !listed) {
      const existing = await createPlatformDb(d1).vehicleModel.findUnique({
        where: { businessId_modelKey: { businessId, modelKey: vehicleModelKey(make, model) } },
        select: { bodyKey: true },
      });
      if (existing?.bodyKey) fail(`${make} ${model} is already on the list.`);
    }
    statements.push(
      listed && listed.bodyKey === body.key && listed.category === input.category
        ? drop(businessId, make, model)
        : upsert(businessId, { make, model, category: input.category, bodyKey: body.key }, phone),
    );
    await runStatements(d1, statements);
    return { make, model, bodyKey: body.key };
  },

  /** Takes a model off the list (a listed one is marked removed; an added one is deleted). */
  async remove(d1: D1Database, businessId: string, input: { make: string; model: string; category: VehicleCategory }, phone: string | null) {
    await runStatements(d1, [
      listedModel(input.make, input.model)
        ? upsert(businessId, { ...input, bodyKey: null }, phone)
        : drop(businessId, input.make, input.model),
    ]);
  },

  /** Undoes head office's change to a listed model: back to how it ships. */
  async reset(d1: D1Database, businessId: string, input: { make: string; model: string }) {
    if (!listedModel(input.make, input.model)) fail('Only a model on the original list can be put back.');
    await runStatements(d1, [drop(businessId, input.make, input.model)]);
  },

  /** Models head office removed from the list, so they can be put back. */
  async removed(pdb: DbClient, businessId: string) {
    return pdb.vehicleModel.findMany({
      where: { businessId, bodyKey: null },
      orderBy: [{ make: 'asc' }, { model: 'asc' }],
      select: { make: true, model: true, category: true },
    });
  },
};
