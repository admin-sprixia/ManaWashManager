import type { D1Database } from '@mana/db';

/**
 * The slice of Cloudflare's R2Bucket this Worker uses. Declared here rather than taken from
 * the Workers globals because the mobile app type-checks this file through AppType.
 */
export interface FileBucket {
  put(
    key: string,
    value: ArrayBuffer | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream } | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<
    { objects: { key: string }[] } & ({ truncated: true; cursor: string } | { truncated: false })
  >;
}

export interface Env {
  DB: D1Database;
  /** Before/after job photos and expense receipts. */
  PHOTOS: FileBucket;
  /** Nightly database backups — a separate bucket, so a photo clean-up can never touch them. */
  BACKUPS: FileBucket;
  JWT_SECRET: string;
  /** Optional: error alerts to Sprixia's private Discord channel. See lib/alerts.ts and the README. */
  DISCORD_WEBHOOK_URL?: string;
  /** WhatsApp Cloud API: sends sign-in codes (new phone, forgotten PIN). See lib/loginCode.ts and the README. */
  WHATSAPP_API_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  /** Name and language of the approved authentication template (defaults: login_code, en). */
  WHATSAPP_OTP_TEMPLATE?: string;
  WHATSAPP_OTP_LANGUAGE?: string;
  /**
   * Meta's webhook (routes/whatsapp.ts): the app secret it signs every delivery with (App
   * settings → Basic), and the verify token typed into the webhook form when subscribing.
   */
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  /** The business whose branches the number answers for (prices, hours). Unset: every active branch. */
  WHATSAPP_BUSINESS_ID?: string;
  /** Tests only (needs DEV_MODE): send Graph API calls to a stand-in server. */
  WHATSAPP_API_BASE?: string;
  /** The published Services & Prices Flow (npm run whatsapp:flow); unset = plain company lists. */
  WHATSAPP_FLOW_ID?: string;
  /** Secret: decrypts the Flow's requests (PKCS#8 PEM; its public key is registered with Meta). */
  WHATSAPP_FLOW_PRIVATE_KEY?: string;
  /**
   * Dev-only, and only honoured for requests to localhost: every WhatsApp code is
   * DEV_RECOVERY_CODE (default 000000), reusable, and no message is sent when WhatsApp isn't
   * configured (or when WHATSAPP_OTP_BYPASS is on).
   */
  DEV_MODE?: string;
  DEV_RECOVERY_CODE?: string;
  /**
   * Local only (needs DEV_MODE + localhost): skip sending WhatsApp and accept DEV_RECOVERY_CODE
   * instead. Use while Meta is reviewing the template; turn off when real codes should go out.
   */
  WHATSAPP_OTP_BYPASS?: string;
  /** Local only (needs DEV_MODE + localhost): delay every database call, to count round trips. */
  DEV_DB_DELAY_MS?: string;
  /**
   * Staging Worker only: ENVIRONMENT=staging plus STAGING_TEST_CODES=true accepts the same fixed
   * codes as local dev (until WhatsApp is live). Production sets neither, so it can't turn on there.
   */
  ENVIRONMENT?: string;
  STAGING_TEST_CODES?: string;
  /**
   * Staging only: the numbers that may use the fixed test code (comma-separated), so a stranger
   * can't sign in to staging as any number. `*` allows every number, for a full test-script run
   * against staging only — take it out straight after.
   */
  STAGING_TEST_PHONES?: string;
  /**
   * Razorpay: customer payment links. Key id + secret from Dashboard → API Keys (rzp_test_… in
   * Test mode); the webhook secret is the one typed when adding the webhook. See lib/razorpay.ts
   * and the README. Without the keys, washes are paid at the counter only.
   */
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  /**
   * Tests only: send Razorpay calls to a stand-in server. Ignored unless the key id is a test
   * key, so it can never redirect live payments.
   */
  RAZORPAY_API_BASE?: string;
}
