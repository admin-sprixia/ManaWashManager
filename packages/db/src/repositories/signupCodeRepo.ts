import type { DbClient } from '../client';

/**
 * signup / join: a number without an account. phone: moving an account to this new number.
 * customer: signing in to the MANA Car Wash app.
 */
export type SignupPurpose = 'signup' | 'join' | 'phone' | 'customer';

/** Codes sent to numbers that don't belong to the account (yet). Always used with the platform client. */
export const signupCodeRepo = {
  async create(
    db: DbClient,
    data: {
      phone: string;
      purpose: SignupPurpose;
      codeHash: string;
      ip: string | null;
      expiresAt: Date;
    },
  ) {
    return db.signupCode.create({ data });
  },

  /** Codes sent to this number since `since`, newest first — for the resend wait and hourly cap. */
  async listForPhoneSince(db: DbClient, phone: string, since: Date) {
    return db.signupCode.findMany({
      where: { phone, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true },
    });
  },

  async countForIpSince(db: DbClient, ip: string, since: Date) {
    return db.signupCode.count({ where: { ip, createdAt: { gte: since } } });
  },

  async findLive(
    db: DbClient,
    phone: string,
    purpose: SignupPurpose,
    now: Date,
    maxAttempts: number,
  ) {
    return db.signupCode.findFirst({
      where: {
        phone,
        purpose,
        usedAt: null,
        expiresAt: { gt: now },
        attempts: { lt: maxAttempts },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  /** Same as loginCodeRepo.reserveGuess: one atomic guess taken before comparing. */
  async reserveGuess(db: DbClient, id: string, maxAttempts: number): Promise<number | null> {
    const { count } = await db.signupCode.updateMany({
      where: { id, usedAt: null, attempts: { lt: maxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (count !== 1) return null;
    const row = await db.signupCode.findUnique({ where: { id }, select: { attempts: true } });
    return Math.max(0, maxAttempts - (row?.attempts ?? maxAttempts));
  },

  /** False when another request already used it. */
  async consume(db: DbClient, id: string, now: Date): Promise<boolean> {
    const { count } = await db.signupCode.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: now },
    });
    return count === 1;
  },

  /** A new code replaces older live ones for the same number. */
  async retireOthers(db: DbClient, phone: string, keepId: string, now: Date) {
    await db.signupCode.updateMany({
      where: { phone, usedAt: null, id: { not: keepId } },
      data: { usedAt: now },
    });
  },
};
