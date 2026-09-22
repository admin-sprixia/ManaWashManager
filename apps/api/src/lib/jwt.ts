import { jwtVerify, SignJWT } from 'jose';

export interface SessionClaims {
  sub: string; // user id
  orgId: string;
  role: 'owner' | 'staff';
  phone: string;
}

const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

export async function createSessionToken(claims: SessionClaims, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ orgId: claims.orgId, role: claims.role, phone: claims.phone })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key);
}

export async function verifySessionToken(token: string, secret: string): Promise<SessionClaims> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key);

  if (typeof payload.sub !== 'string' || typeof payload.orgId !== 'string') {
    throw new Error('Malformed session token');
  }

  return {
    sub: payload.sub,
    orgId: payload.orgId,
    role: payload.role as 'owner' | 'staff',
    phone: payload.phone as string,
  };
}
