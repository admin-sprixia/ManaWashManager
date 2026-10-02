import type { DbClient } from '../client';

export const loginCodeRepo = {
  async create(db: DbClient, data: { userId: string; codeHash: string; expiresAt: Date }) {
    return db.loginCode.create({ data });
  },

  /** Codes asked for since `since`, newest first — for the resend wait and the hourly cap. */
  async listSince(db: DbClient, userId: string, since: Date) {
    return db.loginCode.findMany({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true },
    });
  },

  /** The newest code still usable: not used, not expired, guesses left. */
  async findLive(db: DbClient, userId: string, now: Date, maxAttempts: number) {
    return db.loginCode.findFirst({
      where: { userId, usedAt: null, expiresAt: { gt: now }, attempts: { lt: maxAttempts } },
      orderBy: { createdAt: 'desc' },
    });
  },

  /**
   * Takes one guess from the code's allowance before it's compared, in a single conditional
   * UPDATE — parallel guesses can't exceed `maxAttempts`. Returns the guesses left after this
   * one, or null when none were left.
   */
  async reserveGuess(db: DbClient, id: string, maxAttempts: number): Promise<number | null> {
    const { count } = await db.loginCode.updateMany({
      where: { id, usedAt: null, attempts: { lt: maxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (count !== 1) return null;
    const row = await db.loginCode.findUnique({ where: { id }, select: { attempts: true } });
    return Math.max(0, maxAttempts - (row?.attempts ?? maxAttempts));
  },

  /** Marks the code used. False when another request already used it — only one sign-in wins. */
  async consume(db: DbClient, id: string, now: Date): Promise<boolean> {
    const { count } = await db.loginCode.updateMany({ where: { id, usedAt: null }, data: { usedAt: now } });
    return count === 1;
  },

  /** A new code replaces any older live ones, so only the latest message works. */
  async retireOthers(db: DbClient, userId: string, keepId: string, now: Date) {
    await db.loginCode.updateMany({
      where: { userId, usedAt: null, id: { not: keepId } },
      data: { usedAt: now },
    });
  },
};
