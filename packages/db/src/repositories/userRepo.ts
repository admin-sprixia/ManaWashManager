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
  async findById(db: DbClient, id: string) {
    return db.user.findUnique({ where: { id } });
  },

  async findByPhone(db: DbClient, phone: string) {
    return db.user.findUnique({ where: { phone } });
  },

  /** Team list: active first, owners before staff, then alphabetical. */
  async list(db: DbClient) {
    const users = await db.user.findMany({ select: publicSelect });
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
    return db.user.update({ where: { id }, data });
  },

  async countActiveOwners(db: DbClient) {
    return db.user.count({ where: { role: 'owner', active: true } });
  },

  /** Setting (or clearing) a PIN also clears any lockout from previous wrong attempts. */
  async setPinHash(db: DbClient, id: string, pinHash: string | null) {
    return db.user.update({
      where: { id },
      data: { pinHash, pinFailedAttempts: 0, pinLockedUntil: null },
    });
  },

  async recordPinFailure(db: DbClient, id: string, attempts: number, lockedUntil: Date | null) {
    return db.user.update({
      where: { id },
      data: { pinFailedAttempts: attempts, pinLockedUntil: lockedUntil },
    });
  },

  async clearPinFailures(db: DbClient, id: string) {
    return db.user.update({
      where: { id },
      data: { pinFailedAttempts: 0, pinLockedUntil: null },
    });
  },
};
