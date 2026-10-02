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
  /** One-time owner sign-in when setting up a device or after a forgotten PIN. See lib/recovery.ts. */
  OWNER_RECOVERY_CODE?: string;
  /** Optional: error alerts to Sprixia's private Discord channel. See lib/alerts.ts and the README. */
  DISCORD_WEBHOOK_URL?: string;
  /** WhatsApp Cloud API: sends the owner's sign-in codes. See lib/loginCode.ts and the README. */
  WHATSAPP_API_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  /** Name and language of the approved authentication template (defaults: login_code, en). */
  WHATSAPP_OTP_TEMPLATE?: string;
  WHATSAPP_OTP_LANGUAGE?: string;
  /**
   * Dev-only, and only honoured for requests to localhost: the recovery code and WhatsApp code
   * are both DEV_RECOVERY_CODE (default 000000), reusable, and no message is sent when WhatsApp
   * isn't configured (or when WHATSAPP_OTP_BYPASS is on).
   */
  DEV_MODE?: string;
  DEV_RECOVERY_CODE?: string;
  /**
   * Local only (needs DEV_MODE + localhost): skip sending WhatsApp and accept DEV_RECOVERY_CODE
   * instead. Use while Meta is reviewing the template; turn off when real codes should go out.
   */
  WHATSAPP_OTP_BYPASS?: string;
  /** Older names for DEV_MODE / DEV_RECOVERY_CODE, still honoured in local `.dev.vars`. */
  DEV_OTP_BYPASS?: string;
  DEV_OTP_CODE?: string;
}
