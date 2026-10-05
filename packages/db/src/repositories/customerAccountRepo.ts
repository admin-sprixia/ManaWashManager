import type { DbClient } from '../client';
import { retryOnClash } from '../retryOnClash';

/** MANA Car Wash sign-ins. Always used with the platform client. */
export const customerAccountRepo = {
  async findById(db: DbClient, id: string) {
    return db.customerAccount.findUnique({ where: { id } });
  },

  /** The account for a number just proved with a WhatsApp code, created on first sign-in. */
  async ensure(db: DbClient, phone: string, now: Date) {
    return retryOnClash(async () => {
      const existing = await db.customerAccount.findUnique({ where: { phone } });
      if (existing) {
        return db.customerAccount.update({ where: { id: existing.id }, data: { lastSeenAt: now } });
      }
      return db.customerAccount.create({ data: { phone, lastSeenAt: now } });
    });
  },

  /** Signs the app out on every phone. */
  async signOutEverywhere(db: DbClient, id: string) {
    await db.customerAccount.update({ where: { id }, data: { sessionVersion: { increment: 1 } } });
  },

  /**
   * "Delete my account": the sign-in goes. The car wash's own records of washes and payments
   * stay with the car wash (they're its business records), and signing in again starts afresh.
   */
  async delete(db: DbClient, id: string) {
    await db.customerAccount.deleteMany({ where: { id } });
  },
};
