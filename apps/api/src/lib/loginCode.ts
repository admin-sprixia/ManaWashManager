import { LOGIN_CODE_LENGTH, LOGIN_CODE_TTL_MINUTES } from '@mana/domain';
import type { Env } from '../types';
import { randomDigits } from './random';
import { sha256Hex, usesTestCodes } from './recovery';

const GRAPH_API = 'https://graph.facebook.com/v25.0';

export function generateLoginCode(): string {
  return randomDigits(LOGIN_CODE_LENGTH);
}

/**
 * Keyed with the server secret and who the code is for (a user id, or `purpose:phone` before an
 * account exists), so a leaked table can't be brute-forced offline.
 */
export function hashLoginCode(code: string, subject: string, secret: string): Promise<string> {
  return sha256Hex(`${secret}:${subject}:${code.trim()}`);
}

export function whatsappConfigured(env: Env): boolean {
  return Boolean(env.WHATSAPP_API_TOKEN?.trim() && env.WHATSAPP_PHONE_NUMBER_ID?.trim());
}

/**
 * Local testing without Meta: use the fixed DEV_RECOVERY_CODE and don't send WhatsApp.
 * True when WhatsApp isn't set up yet, or when WHATSAPP_OTP_BYPASS=true (e.g. template in review).
 * Always needs usesTestCodes (DEV_MODE + localhost, or the staging Worker's test-code switch),
 * so it can't open the production Worker.
 */
export function bypassWhatsAppOtp(env: Env, requestUrl: string): boolean {
  if (!usesTestCodes(env, requestUrl)) return false;
  return env.WHATSAPP_OTP_BYPASS === 'true' || !whatsappConfigured(env);
}

/**
 * Sends the code with the approved WhatsApp "authentication" template (Meta requires one for
 * OTPs). The template's body takes the code, and its copy-code button takes it again.
 */
export async function sendLoginCodeOnWhatsApp(env: Env, phone: string, code: string): Promise<boolean> {
  const res = await fetch(`${GRAPH_API}/${env.WHATSAPP_PHONE_NUMBER_ID!.trim()}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_API_TOKEN!.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: `91${phone}`,
      type: 'template',
      template: {
        name: env.WHATSAPP_OTP_TEMPLATE?.trim() || 'login_code',
        language: { code: env.WHATSAPP_OTP_LANGUAGE?.trim() || 'en' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      },
    }),
  });
  if (!res.ok) console.error(`WhatsApp code failed: ${res.status} ${await res.text().catch(() => '')}`);
  return res.ok;
}

export function loginCodeExpiry(now: Date): Date {
  return new Date(now.getTime() + LOGIN_CODE_TTL_MINUTES * 60 * 1000);
}
