import { jwtVerify, SignJWT } from 'jose';

/**
 * Short proofs handed to the phone during sign-up, before an account exists:
 * - `signup` / `join`: "this number was just verified on WhatsApp" (30 minutes), so the later
 *   steps don't need another code.
 * - `join_request`: lets the phone check on, cancel, or finish its request to join a shop.
 * - `service_request`: the MANA Car Wash app, for a number the car wash hasn't registered —
 *   lets that phone ask for service and follow its requests without another code.
 *
 * Signed with a key derived from JWT_SECRET but different from the session key, so a ticket can
 * never be used as a session and vice versa.
 */
export type TicketPurpose = 'signup' | 'join' | 'join_request' | 'service_request';

const TTL_SECONDS: Record<TicketPurpose, number> = {
  signup: 30 * 60,
  join: 30 * 60,
  join_request: 8 * 24 * 60 * 60,
  service_request: 30 * 24 * 60 * 60,
};

export interface Ticket {
  phone: string;
  purpose: TicketPurpose;
  requestId?: string;
}

function ticketKey(secret: string) {
  return new TextEncoder().encode(`${secret}:ticket`);
}

export async function createTicket(ticket: Ticket, secret: string): Promise<string> {
  return new SignJWT({
    purpose: ticket.purpose,
    ...(ticket.requestId ? { rid: ticket.requestId } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(ticket.phone)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS[ticket.purpose]}s`)
    .sign(ticketKey(secret));
}

/** The ticket's contents, or null if it's forged, expired, or for a different step. */
export async function readTicket(
  token: string,
  secret: string,
  purpose: TicketPurpose,
): Promise<Ticket | null> {
  try {
    const { payload } = await jwtVerify(token, ticketKey(secret));
    if (payload.purpose !== purpose || typeof payload.sub !== 'string') return null;
    return {
      phone: payload.sub,
      purpose,
      requestId: typeof payload.rid === 'string' ? payload.rid : undefined,
    };
  } catch {
    return null;
  }
}
