import type { DbClient } from '../client';
import type { UserRole } from '@mana/domain';

/** Public shape of a team member — never includes the PIN hash. */
const publicSelect = {
  id: true,
  name: true,
  phone: true,
  role: true,
  active: true,
  pinHash: true,
  createdAt: true,
} as const;

export const userRepo = {
  /** Includes removed members — old jobs and reports still point at them. */
  async findById(db: DbClient, id: string) {
    return db.user.findUnique({ where: { id } });
  },

  /** Someone still on the team (active or turned off), not removed. */
  async findMember(db: DbClient, id: string) {
    return db.user.findFirst({ where: { id, removedAt: null } });
  },

  /**
   * A phone belongs to one person on the whole platform. Pass the platform client to look across
   * every shop (sign-in, "is this number taken?"); a shop client only sees its own team.
   * Removed members have given the number up. An owner with several branches has a row in each;
   * this returns the oldest (their first shop).
   */
  async findByPhone(db: DbClient, phone: string) {
    return db.user.findFirst({ where: { phone, removedAt: null }, orderBy: { createdAt: 'asc' } });
  },

  /** Every shop this number is live in, oldest first — one for staff, one per branch for owners. */
  async listByPhone(db: DbClient, phone: string) {
    return db.user.findMany({ where: { phone, removedAt: null }, orderBy: { createdAt: 'asc' } });
  },

  /**
   * Same person in every shop: one PIN and lockout for all of an owner's branches. A new (or
   * cleared) PIN also signs out every phone still holding an older session.
   */
  async setPinHashForPhone(db: DbClient, phone: string, pinHash: string | null) {
    await db.user.updateMany({
      where: { phone, removedAt: null },
      data: { pinHash, pinFailedAttempts: 0, pinLockedUntil: null, sessionVersion: { increment: 1 } },
    });
  },

  async updateForPhone(db: DbClient, phone: string, data: { name?: string; phone?: string }) {
    await db.user.updateMany({ where: { phone, removedAt: null }, data });
  },

  /** Team list: active first, owners before staff, then alphabetical. */
  async list(db: DbClient) {
    const users = await db.user.findMany({ where: { removedAt: null }, select: publicSelect });
    return users
      .map(({ pinHash, ...u }) => ({ ...u, hasPin: pinHash != null }))
      .sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        if (a.role !== b.role) return a.role === 'owner' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  },

  async create(db: DbClient, data: { name: string; phone: string; role: UserRole }) {
    return db.user.create({ data });
  },

  async update(
    db: DbClient,
    id: string,
    data: { name?: string; phone?: string; role?: UserRole; active?: boolean },
  ) {
    // Turning someone off ends their sessions too, so turning them back on doesn't revive old ones.
    const signOut = data.active === false ? { sessionVersion: { increment: 1 } } : {};
    return db.user.update({ where: { id }, data: { ...data, ...signOut } });
  },

  async createWithPin(
    db: DbClient,
    data: { name: string; phone: string; role: UserRole; pinHash: string },
  ) {
    return db.user.create({ data });
  },

  async countActiveOwners(db: DbClient) {
    return db.user.count({ where: { role: 'owner', active: true } });
  },

  /**
   * Takes owner access away from an active owner (demote and/or switch off) only while another
   * active owner remains. One statement, so two owners removing each other at the same moment
   * can't leave the shop with none: the second one finds no other owner and changes nothing.
   * Returns false when nothing changed.
   */
  async dropOwnerAccess(db: DbClient, id: string, change: { demote: boolean; deactivate: boolean }) {
    const shopId = db.$shopId();
    const demote = change.demote ? 1 : 0;
    const deactivate = change.deactivate ? 1 : 0;
    const changed = await db.$executeRaw`
      UPDATE users
         SET role = CASE WHEN ${demote} = 1 THEN 'staff' ELSE role END,
             active = CASE WHEN ${deactivate} = 1 THEN 0 ELSE active END,
             session_version = session_version + ${deactivate}
       WHERE id = ${id} AND shop_id = ${shopId} AND role = 'owner' AND active = 1
         AND EXISTS (
           SELECT 1 FROM users o
            WHERE o.shop_id = ${shopId} AND o.id <> ${id} AND o.role = 'owner' AND o.active = 1
         )`;
    return changed === 1;
  },

  /** Off the team for good: signed out, no PIN, and the number can join another shop. */
  async remove(db: DbClient, id: string, now: Date) {
    return db.user.update({
      where: { id },
      data: {
        active: false,
        pinHash: null,
        pinFailedAttempts: 0,
        pinLockedUntil: null,
        removedAt: now,
        sessionVersion: { increment: 1 },
      },
    });
  },

  /**
   * Setting (or clearing) a PIN also clears any lockout from previous wrong attempts and signs
   * out the phones that used the old one.
   */
  async setPinHash(db: DbClient, id: string, pinHash: string | null) {
    return db.user.update({
      where: { id },
      data: { pinHash, pinFailedAttempts: 0, pinLockedUntil: null, sessionVersion: { increment: 1 } },
    });
  },

  /**
   * Takes one PIN guess from the allowance *before* the PIN is checked. Each call is a single
   * conditional UPDATE, so a burst of parallel guesses can't all pass the check: once
   * `maxAttempts` slots are taken, the rest get false. An expired lock starts a fresh round.
   */
  async reservePinAttempt(db: DbClient, id: string, maxAttempts: number, now: Date): Promise<boolean> {
    await db.user.updateMany({
      where: { id, pinLockedUntil: { lte: now } },
      data: { pinFailedAttempts: 0, pinLockedUntil: null },
    });
    const { count } = await db.user.updateMany({
      where: { id, pinLockedUntil: null, pinFailedAttempts: { lt: maxAttempts } },
      data: { pinFailedAttempts: { increment: 1 } },
    });
    return count === 1;
  },

  /** After a wrong guess: how many have been used, locking the PIN once they're all gone. */
  async settlePinFailure(db: DbClient, id: string, maxAttempts: number, lockUntil: Date) {
    await db.user.updateMany({
      where: { id, pinLockedUntil: null, pinFailedAttempts: { gte: maxAttempts } },
      data: { pinLockedUntil: lockUntil },
    });
    return db.user.findUnique({
      where: { id },
      select: { pinFailedAttempts: true, pinLockedUntil: true },
    });
  },

  async clearPinFailures(db: DbClient, id: string) {
    return db.user.update({
      where: { id },
      data: { pinFailedAttempts: 0, pinLockedUntil: null },
    });
  },
};
