import { jwtVerify, SignJWT } from 'jose';

export interface SessionClaims {
  sub: string; // user id
  shopId: string;
  role: 'owner' | 'staff';
  phone: string;
  /** The user's session_version when this token was issued; an older one is signed out. */
  sv: number;
}

/**
 * Shop phones stay signed in across shifts. A long session is safe because `requireAuth`
 * re-reads the user on every request — deactivating someone, changing their role, or changing
 * or resetting their PIN (which bumps session_version) takes effect on the next request.
 */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export async function createSessionToken(claims: SessionClaims, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ shopId: claims.shopId, role: claims.role, phone: claims.phone, sv: claims.sv })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key);
}

export async function verifySessionToken(token: string, secret: string): Promise<SessionClaims> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });

  if (typeof payload.sub !== 'string' || typeof payload.shopId !== 'string') {
    throw new Error('Malformed session token');
  }

  return {
    sub: payload.sub,
    shopId: payload.shopId,
    role: payload.role as 'owner' | 'staff',
    phone: payload.phone as string,
    sv: typeof payload.sv === 'number' ? payload.sv : 0,
  };
}
