import type { userRepo } from '@mana/db';
import { createSessionToken } from './jwt';
import type { Env } from '../types';

export type DbUser = NonNullable<Awaited<ReturnType<typeof userRepo.findById>>>;

export function publicUser(user: DbUser) {
  const role: 'owner' | 'staff' = user.role === 'owner' ? 'owner' : 'staff';
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    role,
    hasPin: user.pinHash != null,
    shopId: user.shopId,
  };
}

export async function issueSession(user: DbUser, env: Env) {
  const token = await createSessionToken(
    {
      sub: user.id,
      shopId: user.shopId,
      role: publicUser(user).role,
      phone: user.phone,
      sv: user.sessionVersion,
    },
    env.JWT_SECRET,
  );
  return { token, user: publicUser(user) };
}
