import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createPlatformDb } from '@mana/db';
import { requireAuth, requireRole } from '../middleware/auth';
import { clearAwaiting, graphSend, logOutgoing, waId, whatsappConfigured } from '../lib/whatsapp';
import type { Env } from '../types';

/**
 * The WhatsApp inbox in the team app: conversations on the business number, the ones the assistant
 * couldn't answer first ("needs reply"), and replies from a teammate through the same number.
 * Owners and managers of the business's branches only. WhatsApp lets a business write freely only
 * within 24 hours of the customer's last message, so a reply after that is refused.
 */

/** How long the assistant stays quiet after a teammate replies, so it doesn't talk over them. */
const BOT_PAUSE_MS = 2 * 60 * 60_000;
/** WhatsApp's customer service window. */
const WINDOW_MS = 24 * 60 * 60_000;
const LIST_MAX = 100;
const THREAD_MAX = 200;

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}
const d1 = (env: Env) => env.DB as unknown as { prepare(q: string): D1Statement };

type Ctx = Context<{ Bindings: Env }>;

/** The business whose number this is, when the signed-in teammate's branch belongs to it. */
async function inboxBusiness(c: Ctx): Promise<string | null> {
  const businessId = c.env.WHATSAPP_BUSINESS_ID?.trim();
  if (!businessId || !whatsappConfigured(c.env)) return null;
  const shop = await createPlatformDb(c.env.DB).shop.findUnique({ where: { id: c.get('session').shopId }, select: { businessId: true } });
  return shop?.businessId === businessId ? businessId : null;
}

const notHere = { error: 'inbox_unavailable' as const, message: 'WhatsApp isn’t set up for this branch.' };

/** A short, readable line for a message: menu taps and buttons aren't shown as their codes. */
export function inboxPreview(direction: string, kind: string, body: string | null): string {
  if (!body) return kind === 'template' ? 'Automatic message' : '';
  if (direction === 'in' && /^[a-z]+\|/.test(body)) return 'Tapped a menu option';
  if (direction === 'in' && /^(stop|start)$/i.test(body)) return body.toUpperCase() === 'STOP' ? 'Stopped offers' : 'Started offers';
  return body.replace(/\s+/g, ' ').slice(0, 160);
}

const phoneParam = z.object({ phone: z.string().regex(/^\d{10}$/) });
const replySchema = z.object({ text: z.string().trim().min(1, 'Type a message').max(4000) });

const customerNameSql = `(SELECT cu.name FROM customers cu JOIN shops s ON s.id = cu.shop_id
   WHERE cu.phone = c.phone AND s.business_id = ?1 AND cu.name IS NOT NULL ORDER BY cu.created_at DESC LIMIT 1)`;

export const whatsappInboxRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  .use('*', requireRole('owner', 'manager'))
  /** How many customers are waiting for a person (the board's badge). */
  .get('/count', async (c) => {
    if (!(await inboxBusiness(c))) return c.json({ waiting: 0 });
    const row = await d1(c.env).prepare('SELECT COUNT(*) AS n FROM whatsapp_contacts WHERE awaiting_reply_at IS NOT NULL').first<{ n: number }>();
    return c.json({ waiting: row?.n ?? 0 });
  })
  /** Conversations, waiting ones first, then by latest message. `?waiting=1` for only those. */
  .get('/', zValidator('query', z.object({ waiting: z.enum(['0', '1']).optional() })), async (c) => {
    const businessId = await inboxBusiness(c);
    if (!businessId) return c.json(notHere, 404);
    const onlyWaiting = c.req.valid('query').waiting === '1';
    const rows = await d1(c.env)
      .prepare(
        `SELECT c.phone, c.profile_name AS profileName, c.awaiting_reply_at AS awaitingSince, c.last_inbound_at AS lastInboundAt,
                c.marketing_stopped_at AS stoppedOffers, ${customerNameSql} AS customerName,
                m.direction AS lastDirection, m.kind AS lastKind, m.body AS lastBody, m.created_at AS lastAt
         FROM whatsapp_contacts c
         -- A waiting chat shows what the customer asked, not the assistant's "we'll reply".
         LEFT JOIN whatsapp_messages m ON m.id = (
           SELECT id FROM whatsapp_messages WHERE phone = c.phone AND (c.awaiting_reply_at IS NULL OR direction = 'in')
           ORDER BY created_at DESC LIMIT 1)
         WHERE c.last_inbound_at IS NOT NULL ${onlyWaiting ? 'AND c.awaiting_reply_at IS NOT NULL' : ''}
         ORDER BY (c.awaiting_reply_at IS NULL), COALESCE(m.created_at, c.last_inbound_at) DESC
         LIMIT ${LIST_MAX}`,
      )
      .bind(businessId)
      .all<{
        phone: string;
        profileName: string | null;
        awaitingSince: string | null;
        lastInboundAt: string | null;
        stoppedOffers: string | null;
        customerName: string | null;
        lastDirection: string | null;
        lastKind: string | null;
        lastBody: string | null;
        lastAt: string | null;
      }>();
    const now = Date.now();
    return c.json({
      conversations: rows.results.map((r) => ({
        phone: r.phone,
        name: r.customerName ?? r.profileName ?? null,
        whatsappName: r.profileName,
        awaitingSince: r.awaitingSince,
        canReply: !!r.lastInboundAt && now - Date.parse(r.lastInboundAt) < WINDOW_MS,
        stoppedOffers: !!r.stoppedOffers,
        last: r.lastAt
          ? { fromCustomer: r.lastDirection === 'in', text: inboxPreview(r.lastDirection ?? 'in', r.lastKind ?? 'text', r.lastBody), at: r.lastAt }
          : null,
      })),
    });
  })
  /** One conversation: the latest messages, oldest first, with who sent each reply. */
  .get('/:phone', zValidator('param', phoneParam), async (c) => {
    const businessId = await inboxBusiness(c);
    if (!businessId) return c.json(notHere, 404);
    const { phone } = c.req.valid('param');
    const [contact, messages] = await Promise.all([
      d1(c.env)
        .prepare(
          `SELECT c.phone, c.profile_name AS profileName, c.awaiting_reply_at AS awaitingSince, c.last_inbound_at AS lastInboundAt,
                  c.marketing_stopped_at AS stoppedOffers, ${customerNameSql} AS customerName
           FROM whatsapp_contacts c WHERE c.phone = ?2`,
        )
        .bind(businessId, phone)
        .first<{ phone: string; profileName: string | null; awaitingSince: string | null; lastInboundAt: string | null; stoppedOffers: string | null; customerName: string | null }>(),
      d1(c.env)
        .prepare(
          `SELECT id, direction, kind, body, purpose, status, created_at AS at, sent_by_user_id AS sentBy
           FROM whatsapp_messages WHERE phone = ?1 ORDER BY created_at DESC LIMIT ${THREAD_MAX}`,
        )
        .bind(phone)
        .all<{ id: string; direction: string; kind: string; body: string | null; purpose: string; status: string; at: string; sentBy: string | null }>(),
    ]);
    if (!contact) return c.json({ error: 'not_found' as const, message: 'No conversation with this number.' }, 404);
    const senderIds = [...new Set(messages.results.map((m) => m.sentBy).filter((id): id is string => !!id))];
    const senders = senderIds.length
      ? await createPlatformDb(c.env.DB).user.findMany({ where: { id: { in: senderIds } }, select: { id: true, name: true } })
      : [];
    const senderName = new Map(senders.map((u) => [u.id, u.name]));
    return c.json({
      phone: contact.phone,
      name: contact.customerName ?? contact.profileName ?? null,
      whatsappName: contact.profileName,
      awaitingSince: contact.awaitingSince,
      canReply: !!contact.lastInboundAt && Date.now() - Date.parse(contact.lastInboundAt) < WINDOW_MS,
      replyUntil: contact.lastInboundAt ? new Date(Date.parse(contact.lastInboundAt) + WINDOW_MS).toISOString() : null,
      stoppedOffers: !!contact.stoppedOffers,
      messages: messages.results.reverse().map((m) => ({
        id: m.id,
        fromCustomer: m.direction === 'in',
        /** Who wrote it on our side: a teammate's name, or the assistant / an automatic message. */
        by: m.direction === 'in' ? null : m.sentBy ? (senderName.get(m.sentBy) ?? 'Team') : m.kind === 'template' ? 'Automatic' : 'Assistant',
        text: inboxPreview(m.direction, m.kind, m.body),
        status: m.status,
        at: m.at,
      })),
    });
  })
  /** A teammate's reply, sent from the business number; the assistant then stays quiet a while. */
  .post('/:phone/reply', zValidator('param', phoneParam), zValidator('json', replySchema), async (c) => {
    const businessId = await inboxBusiness(c);
    if (!businessId) return c.json(notHere, 404);
    const { phone } = c.req.valid('param');
    const { text } = c.req.valid('json');
    const contact = await d1(c.env)
      .prepare('SELECT last_inbound_at AS lastInboundAt FROM whatsapp_contacts WHERE phone = ?1')
      .bind(phone)
      .first<{ lastInboundAt: string | null }>();
    if (!contact?.lastInboundAt || Date.now() - Date.parse(contact.lastInboundAt) >= WINDOW_MS) {
      return c.json(
        {
          error: 'window_closed' as const,
          message: 'WhatsApp only allows replies within 24 hours of the customer’s last message. Ask them to message us again, or call them.',
        },
        409,
      );
    }
    const sent = await graphSend(c.env, { recipient_type: 'individual', to: waId(phone), type: 'text', text: { body: text, preview_url: true } });
    const id = await logOutgoing(c.env, { phone, kind: 'text', body: text, purpose: 'staff', sent, sentByUserId: c.get('session').sub });
    if (!sent.ok) return c.json({ error: 'send_failed' as const, message: `WhatsApp didn’t take it: ${sent.error}` }, 502);
    await clearAwaiting(c.env, phone, new Date(Date.now() + BOT_PAUSE_MS));
    return c.json({ id, at: new Date().toISOString() }, 201);
  })
  /** Handled without a reply (called them, or nothing to say): off the waiting list, assistant back on. */
  .post('/:phone/done', zValidator('param', phoneParam), async (c) => {
    if (!(await inboxBusiness(c))) return c.json(notHere, 404);
    await clearAwaiting(c.env, c.req.valid('param').phone, null);
    return c.json({ ok: true as const });
  });
