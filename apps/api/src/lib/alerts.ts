import { createPlatformDb, createShopDb, opsRepo, platformSettingsRepo } from '@mana/db';
import type { Env } from '../types';

/** The owner's "last opened the error log" mark; errors after it count as unseen. */
export const ERRORS_SEEN_SETTING = 'errors_seen_at';
const ALERT_SENT_SETTING = 'error_alert_sent_at';
/** At most one Discord message per window, however many errors land in it. */
const ALERT_WINDOW_MS = 15 * 60 * 1000;

export interface ErrorReport {
  source: 'app' | 'api';
  message: string;
  stack?: string | null;
  context?: string | null;
  userId?: string | null;
  appVersion?: string | null;
  /** The shop it happened in, so that shop's owner sees it. Null for platform errors. */
  shopId?: string | null;
}

// Stored as "ms:<epoch>" — the D1 adapter reads ISO-looking TEXT back as a DateTime, which
// breaks the String-typed app_settings.value column.
export function formatSettingDate(d: Date): string {
  return `ms:${d.getTime()}`;
}

export function parseSettingDate(value: string | null): Date | null {
  if (!value?.startsWith('ms:')) return null;
  const ms = Number(value.slice(3));
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * Pings Sprixia's private Discord channel when errors start landing in any shop, if
 * DISCORD_WEBHOOK_URL is set. Throttled platform-wide so a crash loop sends one message, not
 * hundreds.
 */
async function sendAlert(env: Env, latest: ErrorReport): Promise<void> {
  const webhookUrl = env.DISCORD_WEBHOOK_URL?.trim();
  if (!webhookUrl) return;

  const db = createPlatformDb(env.DB);
  const now = new Date();
  const lastSent = parseSettingDate(await platformSettingsRepo.get(db, ALERT_SENT_SETTING));
  if (lastSent && now.getTime() - lastSent.getTime() < ALERT_WINDOW_MS) return;
  await platformSettingsRepo.set(db, ALERT_SENT_SETTING, formatSettingDate(now));

  const count = await opsRepo.countErrorsSince(db, lastSent ?? new Date(now.getTime() - ALERT_WINDOW_MS));
  const shop = latest.shopId
    ? await db.shop.findUnique({ where: { id: latest.shopId }, select: { name: true } })
    : null;
  const where = latest.context ? ` · ${latest.context.slice(0, 80)}` : '';
  const text = [
    `⚠️ MANA Wash Manager: ${count > 1 ? `${count} new errors` : 'a new error'}`,
    `Shop: ${shop?.name ?? 'platform'}`,
    `Latest (${latest.source}${where}): ${latest.message.slice(0, 200)}`,
  ].join('\n');

  // allowed_mentions: error text must never ping @everyone in the channel.
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text, allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) console.error(`Discord alert failed: ${res.status}`);
}

/**
 * Records an error in its shop's error log and alerts Sprixia. Never throws — reporting a
 * failure must not become a second failure. Pass `waitUntil` so the alert doesn't hold up
 * the response.
 */
export async function reportError(
  env: Env,
  report: ErrorReport,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<void> {
  try {
    const db = report.shopId ? createShopDb(env.DB, report.shopId) : createPlatformDb(env.DB);
    await opsRepo.logError(db, report);
  } catch (e) {
    console.error(e);
    return;
  }
  const alert = sendAlert(env, report).catch((e) => console.error(e));
  if (waitUntil) waitUntil(alert);
  else await alert;
}
