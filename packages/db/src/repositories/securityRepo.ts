import type { DbClient } from '../client';

/**
 * Trusted phones and PIN resets. Both belong to a person (a phone number), not a branch, so they
 * always go through the platform client.
 */
export const securityRepo = {
  async isTrusted(db: DbClient, phone: string, deviceHash: string, now = new Date()): Promise<boolean> {
    const { count } = await db.trustedDevice.updateMany({ where: { phone, deviceHash }, data: { lastUsedAt: now } });
    return count > 0;
  },

  /** Read-only check for every request: is the phone a session was issued to still trusted? */
  async stillTrusted(db: DbClient, phone: string, deviceHash: string): Promise<boolean> {
    return (await db.trustedDevice.findUnique({ where: { phone_deviceHash: { phone, deviceHash } }, select: { id: true } })) != null;
  },

  /**
   * Trusts this phone for the number. `pinConfirmed`: the right PIN was just used (or chosen) on
   * it, which is what lets owners, managers and HQ reset their own PIN here later.
   */
  async trust(
    db: DbClient,
    phone: string,
    deviceHash: string,
    opts: { now?: Date; label?: string | null; pinConfirmed?: boolean } = {},
  ) {
    const now = opts.now ?? new Date();
    const label = opts.label ?? undefined;
    const pinConfirmedAt = opts.pinConfirmed ? now : undefined;
    await db.trustedDevice.upsert({
      where: { phone_deviceHash: { phone, deviceHash } },
      create: { phone, deviceHash, createdAt: now, lastUsedAt: now, label: label ?? null, pinConfirmedAt: pinConfirmedAt ?? null },
      update: { lastUsedAt: now, ...(label ? { label } : {}), ...(pinConfirmedAt ? { pinConfirmedAt } : {}) },
    });
  },

  /** Whether the right PIN has been used on this phone for this number. */
  async isPinConfirmed(db: DbClient, phone: string, deviceHash: string): Promise<boolean> {
    const row = await db.trustedDevice.findUnique({
      where: { phone_deviceHash: { phone, deviceHash } },
      select: { pinConfirmedAt: true },
    });
    return row?.pinConfirmedAt != null;
  },

  /** The number's trusted phones, most recently used first. */
  async list(db: DbClient, phone: string) {
    return db.trustedDevice.findMany({
      where: { phone },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, deviceHash: true, label: true, createdAt: true, lastUsedAt: true },
    });
  },

  /** Stops trusting one of the number's phones; false when it isn't one of theirs. */
  async forgetById(db: DbClient, phone: string, id: string): Promise<boolean> {
    const { count } = await db.trustedDevice.deleteMany({ where: { id, phone } });
    return count > 0;
  },

  /** Signing out on a phone stops trusting it for that number. */
  async forget(db: DbClient, phone: string, deviceHash: string) {
    await db.trustedDevice.deleteMany({ where: { phone, deviceHash } });
  },

  async forgetAll(db: DbClient, phone: string) {
    await db.trustedDevice.deleteMany({ where: { phone } });
  },

  async forgetOthers(db: DbClient, phone: string, keepDeviceHash: string) {
    await db.trustedDevice.deleteMany({ where: { phone, deviceHash: { not: keepDeviceHash } } });
  },

  async logReset(db: DbClient, data: { phone: string; shopId: string | null; byPhone: string | null; byLabel: string }, now = new Date()) {
    await db.pinReset.create({ data: { ...data, createdAt: now } });
  },

  /** The latest reset since the person last chose a PIN (or ever, if they never did). */
  async resetSince(db: DbClient, phone: string, since: Date | null) {
    return db.pinReset.findFirst({
      where: { phone, ...(since ? { createdAt: { gt: since } } : {}) },
      orderBy: { createdAt: 'desc' },
      select: { byLabel: true, createdAt: true },
    });
  },
};
