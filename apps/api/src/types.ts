import type { D1Database } from '@mana/db';

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  MSG91_API_KEY: string;
  WHATSAPP_API_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  /** Dev-only: skips the real MSG91 call, accepts DEV_OTP_CODE for any phone. Never set in production. */
  DEV_OTP_BYPASS?: string;
  DEV_OTP_CODE?: string;
}
