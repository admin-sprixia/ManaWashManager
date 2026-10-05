import { jwtVerify, SignJWT } from 'jose';

/**
 * Sign-in for the MANA Car Wash app. Signed with a key derived from JWT_SECRET but different from
 * the team's session key and the sign-up tickets', and with its own audience, so a customer
 * token can never open the team app's API (or the other way round).
 */
export interface CustomerClaims {
  /** customer_accounts.id */
  sub: string;
  phone: string;
  /** The account's session_version when issued; an older one is signed out. */
  sv: number;
}

const AUDIENCE = 'mana-customer';
/** A customer's phone stays signed in; `requireCustomer` re-reads the account on every request. */
const TTL_SECONDS = 60 * 60 * 24 * 90;

function customerKey(secret: string) {
  return new TextEncoder().encode(`${secret}:customer`);
}

export async function createCustomerToken(claims: CustomerClaims, secret: string): Promise<string> {
  return new SignJWT({ phone: claims.phone, sv: claims.sv })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(customerKey(secret));
}

export async function verifyCustomerToken(token: string, secret: string): Promise<CustomerClaims | null> {
  try {
    const { payload } = await jwtVerify(token, customerKey(secret), { algorithms: ['HS256'], audience: AUDIENCE });
    if (typeof payload.sub !== 'string' || typeof payload.phone !== 'string') return null;
    return { sub: payload.sub, phone: payload.phone, sv: typeof payload.sv === 'number' ? payload.sv : 0 };
  } catch {
    return null;
  }
}
