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
   * Removed members have given the number up. Someone at several branches has a row in each;
   * this returns the oldest (their first shop).
   */
  async findByPhone(db: DbClient, phone: string) {
    return db.user.findFirst({ where: { phone, removedAt: null }, orderBy: { createdAt: 'asc' } });
  },

  /** Every branch this number is live in, oldest first. */
  async listByPhone(db: DbClient, phone: string) {
    return db.user.findMany({ where: { phone, removedAt: null }, orderBy: { createdAt: 'asc' } });
  },

  /**
   * Same person in every branch: one PIN and lockout for all their rows. A new (or cleared) PIN
   * also signs out every phone still holding an older session. `pinSetAt` only moves when the
   * person chooses a PIN, so resets since then can be shown to them.
   */
  async setPinHashForPhone(db: DbClient, phone: string, pin: { hash: string; digits: number } | null, now = new Date()) {
    await db.user.updateMany({
      where: { phone, removedAt: null },
      data: {
        pinHash: pin?.hash ?? null,
        pinDigits: pin?.digits ?? null,
        pinSetAt: pin ? now : undefined,
        pinFailedAttempts: 0,
        pinLockedUntil: null,
        pinLockCount: 0,
        sessionVersion: { increment: 1 },
      },
    });
  },

  async updateForPhone(db: DbClient, phone: string, data: { name?: string; phone?: string }) {
    await db.user.updateMany({ where: { phone, removedAt: null }, data });
  },

  /**
   * Moves someone to a new number on every branch, signs out their sessions on the old one, and
   * moves HQ with them: an old number left as HQ could be given to a stranger by the telco.
   */
  async movePhone(db: DbClient, from: string, to: string) {
    const admins = await db.businessAdmin.findMany({ where: { phone: from }, select: { businessId: true } });
    for (const a of admins) {
      await db.businessAdmin.upsert({
        where: { businessId_phone: { businessId: a.businessId, phone: to } },
        create: { businessId: a.businessId, phone: to },
        update: {},
      });
    }
    await db.user.updateMany({
      where: { phone: from, removedAt: null },
      data: { phone: to, sessionVersion: { increment: 1 } },
    });
    await db.businessAdmin.deleteMany({ where: { phone: from } });
  },

  /** Team list: active first, then owners, managers, staff, then alphabetical. */
  async list(db: DbClient) {
    const users = await db.user.findMany({ where: { removedAt: null }, select: publicSelect });
    const rank = (role: string) => (role === 'owner' ? 0 : role === 'manager' ? 1 : 2);
    return users
      .map(({ pinHash, ...u }) => ({ ...u, hasPin: pinHash != null }))
      .sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        if (a.role !== b.role) return rank(a.role) - rank(b.role);
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

  /**
   * A new row for someone who may already work at another branch: `pin` is copied from their
   * other rows so one PIN still opens every branch.
   */
  async createWithPin(
    db: DbClient,
    data: { name: string; phone: string; role: UserRole; pin: { hash: string | null; digits: number | null; setAt: Date | null } },
  ) {
    const { pin, ...rest } = data;
    return db.user.create({ data: { ...rest, pinHash: pin.hash, pinDigits: pin.digits, pinSetAt: pin.setAt } });
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
        pinDigits: null,
        pinFailedAttempts: 0,
        pinLockedUntil: null,
        removedAt: now,
        sessionVersion: { increment: 1 },
      },
    });
  },

  /** The PIN shared by someone's live rows, to copy onto a new row for them; null if none. */
  async personPin(db: DbClient, phone: string) {
    const row = await db.user.findFirst({
      where: { phone, removedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { name: true, pinHash: true, pinDigits: true, pinSetAt: true },
    });
    return row ? { name: row.name, pin: { hash: row.pinHash, digits: row.pinDigits, setAt: row.pinSetAt } } : null;
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

  /**
   * After a wrong guess: how many have been used, locking the PIN once they're all gone. Each
   * lock in a row lasts longer: `lockMinutes[n]` for the (n+1)th, the last one from then on.
   */
  async settlePinFailure(db: DbClient, id: string, maxAttempts: number, now: Date, lockMinutes: readonly number[]) {
    const before = await db.user.findUnique({ where: { id }, select: { pinLockCount: true } });
    const step = Math.min(before?.pinLockCount ?? 0, lockMinutes.length - 1);
    const lockUntil = new Date(now.getTime() + lockMinutes[step]! * 60 * 1000);
    await db.user.updateMany({
      where: { id, pinLockedUntil: null, pinFailedAttempts: { gte: maxAttempts } },
      data: { pinLockedUntil: lockUntil, pinLockCount: { increment: 1 } },
    });
    return db.user.findUnique({
      where: { id },
      select: { pinFailedAttempts: true, pinLockedUntil: true },
    });
  },

  async clearPinFailures(db: DbClient, id: string) {
    return db.user.update({
      where: { id },
      data: { pinFailedAttempts: 0, pinLockedUntil: null, pinLockCount: 0 },
    });
  },

  /** Signs out every phone holding a session for this number, on every branch. */
  async signOutEverywhere(db: DbClient, phone: string) {
    await db.user.updateMany({ where: { phone, removedAt: null }, data: { sessionVersion: { increment: 1 } } });
  },
};
