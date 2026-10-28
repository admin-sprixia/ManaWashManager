import type { ChatMessage } from '@mana/domain';
import type { Env } from '../types';
import { sameHex } from './recovery';

/**
 * WhatsApp Cloud API on the business number: sending, Meta's webhook signature, and the message
 * log (whatsapp_messages / whatsapp_contacts, written straight through D1 like rate_limits).
 * Sign-in codes go through here too (lib/loginCode.ts).
 */

const GRAPH_API = 'https://graph.facebook.com/v25.0';

/** Tests send Graph calls to a stand-in server; only honoured with DEV_MODE (never in production). */
export function graphBase(env: Env): string {
  return env.DEV_MODE === 'true' && env.WHATSAPP_API_BASE ? env.WHATSAPP_API_BASE : GRAPH_API;
}

export function whatsappConfigured(env: Env): boolean {
  return Boolean(env.WHATSAPP_API_TOKEN?.trim() && env.WHATSAPP_PHONE_NUMBER_ID?.trim());
}

/** 10-digit Indian mobile → WhatsApp's "91XXXXXXXXXX"; Meta's wa_id back to 10 digits (null if not Indian). */
export const waId = (phone: string) => `91${phone}`;
export function phoneFromWaId(wa: string): string | null {
  const d = wa.replace(/\D/g, '');
  return d.length === 12 && d.startsWith('91') ? d.slice(2) : null;
}

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

/** One Cloud API call to the business number's /messages. */
export async function graphSend(env: Env, payload: Record<string, unknown>): Promise<SendResult> {
  try {
    const res = await fetch(`${graphBase(env)}/${env.WHATSAPP_PHONE_NUMBER_ID!.trim()}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.WHATSAPP_API_TOKEN!.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`WhatsApp send failed: ${res.status} ${text}`);
      return { ok: false, error: graphError(text) ?? `HTTP ${res.status}` };
    }
    const id = (JSON.parse(text) as { messages?: { id?: string }[] }).messages?.[0]?.id;
    return id ? { ok: true, id } : { ok: false, error: 'No message id in the reply' };
  } catch (e) {
    console.error('WhatsApp send failed', e);
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

function graphError(body: string): string | null {
  try {
    const e = (JSON.parse(body) as { error?: { message?: string; code?: number } }).error;
    return e?.message ? `${e.message}${e.code ? ` (${e.code})` : ''}` : null;
  } catch {
    return null;
  }
}

/** The Cloud API body for one of the assistant's messages. */
export function chatPayload(m: ChatMessage): { kind: string; body: string; payload: Record<string, unknown> } {
  switch (m.type) {
    case 'text':
      return { kind: 'text', body: m.text, payload: { type: 'text', text: { body: m.text, preview_url: true } } };
    case 'buttons':
      return {
        kind: 'buttons',
        body: m.text,
        payload: {
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: m.text },
            ...(m.footer ? { footer: { text: m.footer } } : {}),
            action: { buttons: m.buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
          },
        },
      };
    case 'list':
      return {
        kind: 'list',
        body: m.text,
        payload: {
          type: 'interactive',
          interactive: {
            type: 'list',
            body: { text: m.text },
            ...(m.footer ? { footer: { text: m.footer } } : {}),
            action: { button: m.button, sections: [{ title: m.title, rows: m.rows }] },
          },
        },
      };
    case 'location':
      return {
        kind: 'location',
        body: `${m.name} · ${m.address}`,
        payload: { type: 'location', location: { latitude: m.latitude, longitude: m.longitude, name: m.name, address: m.address } },
      };
  }
}

/** Sends the assistant's messages in order (stops at the first failure) and logs each one. */
export async function sendChat(env: Env, phone: string, messages: ChatMessage[], purpose = 'chat'): Promise<boolean> {
  for (const m of messages) {
    const { kind, body, payload } = chatPayload(m);
    const sent = await graphSend(env, { recipient_type: 'individual', to: waId(phone), ...payload });
    await logOutgoing(env, { phone, kind, body, purpose, sent });
    if (!sent.ok) return false;
  }
  return true;
}

/** Blue ticks on the customer's message and "typing…" while the reply is built. */
export async function markReadTyping(env: Env, messageId: string): Promise<void> {
  try {
    await fetch(`${graphBase(env)}/${env.WHATSAPP_PHONE_NUMBER_ID!.trim()}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.WHATSAPP_API_TOKEN!.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: { type: 'text' } }),
    });
  } catch {
    // Only cosmetic.
  }
}

/** Meta signs each webhook body with the app secret: `X-Hub-Signature-256: sha256=<hex>`. */
export async function verifyMetaSignature(body: string, header: string | undefined, appSecret: string): Promise<boolean> {
  const given = header?.trim().toLowerCase().replace(/^sha256=/, '') ?? '';
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return sameHex(hex, given);
}

// ─── Log ─────────────────────────────────────────────────────────────────────

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
interface D1Like {
  prepare(query: string): D1Statement;
}
const d1 = (env: Env) => env.DB as unknown as D1Like;
const NOW = "strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')";
const clip = (s: string | null | undefined, max = 2000) => (s == null ? null : s.slice(0, max));

/**
 * Records a message from a customer. False when it was already recorded: Meta delivers a
 * webhook again if it isn't answered quickly, and each message gets one reply.
 */
export async function logIncoming(
  env: Env,
  m: { id: string; phone: string; kind: string; body: string | null; profileName: string | null },
): Promise<boolean> {
  const inserted = await d1(env)
    .prepare(`INSERT OR IGNORE INTO whatsapp_messages (id, direction, phone, kind, body, status) VALUES (?1, 'in', ?2, ?3, ?4, 'received')`)
    .bind(m.id, m.phone, m.kind, clip(m.body))
    .run();
  if (!inserted.meta?.changes) return false;
  await d1(env)
    .prepare(
      `INSERT INTO whatsapp_contacts (phone, profile_name, last_inbound_at) VALUES (?1, ?2, ${NOW})
       ON CONFLICT (phone) DO UPDATE SET profile_name = COALESCE(excluded.profile_name, profile_name), last_inbound_at = excluded.last_inbound_at`,
    )
    .bind(m.phone, clip(m.profileName, 120))
    .run();
  return true;
}

export async function logOutgoing(
  env: Env,
  m: { phone: string; kind: string; body: string | null; purpose: string; sent: SendResult; shopId?: string | null; jobId?: string | null },
): Promise<void> {
  // A failed send has no Meta id; give it one of ours so it's still on record.
  const id = m.sent.ok ? m.sent.id : `failed:${crypto.randomUUID()}`;
  await d1(env)
    .prepare(
      `INSERT OR IGNORE INTO whatsapp_messages (id, direction, phone, kind, body, purpose, status, error, shop_id, job_id)
       VALUES (?1, 'out', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(id, m.phone, m.kind, clip(m.body), m.purpose, m.sent.ok ? 'sent' : 'failed', m.sent.ok ? null : clip(m.sent.error, 500), m.shopId ?? null, m.jobId ?? null)
    .run();
}

const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

/** Meta's delivery report for a message we sent. Statuses arrive out of order; never step back. */
export async function logStatus(env: Env, s: { id: string; status: string; error: string | null }): Promise<void> {
  const rank = STATUS_RANK[s.status];
  if (!rank) return;
  await d1(env)
    .prepare(
      `UPDATE whatsapp_messages SET status = ?2, error = COALESCE(?3, error), updated_at = ${NOW}
       WHERE id = ?1 AND direction = 'out'
         AND (CASE status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END) < ?4`,
    )
    .bind(s.id, s.status, clip(s.error, 500), rank)
    .run();
}

/** STOP / START from the customer: offers and reminders off or back on. */
export async function setMarketing(env: Env, phone: string, on: boolean): Promise<void> {
  await d1(env)
    .prepare(
      `INSERT INTO whatsapp_contacts (phone, marketing_stopped_at) VALUES (?1, CASE WHEN ?2 THEN NULL ELSE ${NOW} END)
       ON CONFLICT (phone) DO UPDATE SET marketing_stopped_at = CASE WHEN ?2 THEN NULL ELSE ${NOW} END`,
    )
    .bind(phone, on ? 1 : 0)
    .run();
}

/** Whether this number said STOP to offers and reminders. */
export async function marketingStopped(env: Env, phone: string): Promise<boolean> {
  const row = await d1(env)
    .prepare('SELECT marketing_stopped_at AS stopped FROM whatsapp_contacts WHERE phone = ?1')
    .bind(phone)
    .first<{ stopped: string | null }>();
  return !!row?.stopped;
}
