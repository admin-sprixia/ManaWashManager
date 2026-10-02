import type { DbClient } from '../client';

const publicSelect = { id: true, code: true, name: true, city: true } as const;

export const shopRepo = {
  async findById(db: DbClient, id: string) {
    return db.shop.findUnique({ where: { id }, select: publicSelect });
  },

  async listByIds(db: DbClient, ids: string[]) {
    return db.shop.findMany({ where: { id: { in: ids } }, select: publicSelect });
  },

  async findByCode(db: DbClient, code: string) {
    return db.shop.findUnique({ where: { code }, select: publicSelect });
  },

  async create(
    db: DbClient,
    data: { code: string; name: string; city: string | null; plan: 'trial' | 'free'; trialEndsAt: Date | null },
  ) {
    return db.shop.create({ data });
  },

  async rename(db: DbClient, id: string, data: { name: string; city: string | null }) {
    return db.shop.update({ where: { id }, data, select: publicSelect });
  },

  /** Only for undoing a sign-up whose owner couldn't be created (e.g. the number was just taken). */
  async deleteEmpty(db: DbClient, id: string) {
    await db.shop.delete({ where: { id } });
  },
};
