import type { Context } from 'hono';
import { resolveOccurredAt } from '@mana/domain';

/** What the phone's clock read as it sent the request; the app adds it to every call. */
export const CLIENT_TIME_HEADER = 'x-client-time';

/** When a queued action really happened, on the server's clock — see `resolveOccurredAt`. */
export function occurredAt(c: Context, value: string | undefined, now: Date = new Date()): Date {
  return resolveOccurredAt(value, now, c.req.header(CLIENT_TIME_HEADER));
}
