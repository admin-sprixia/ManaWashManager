import type { DbClient } from '../client';
import { retryOnClash } from '../retryOnClash';

/** Keys the app reads and the owner edits. Internal keys (e.g. recovery bookkeeping) stay server-side. */
export const PUBLIC_SETTING_KEYS = ['google_review_url'] as const;
export type PublicSettingKey = (typeof PUBLIC_SETTING_KEYS)[number];

export const settingsRepo = {
  async get(db: DbClient, key: string): Promise<string | null> {
    const row = await db.appSetting.findFirst({ where: { key } });
    return row?.value ?? null;
  },

  async set(db: DbClient, key: string, value: string, userId: string | null) {
    return retryOnClash(() =>
      db.appSetting.upsert({
        where: { shopId_key: { shopId: db.$shopId(), key } },
        create: { key, value, updatedByUserId: userId },
        update: { value, updatedByUserId: userId, updatedAt: new Date() },
      }),
    );
  },

  /** Inserts only if the key is new. False when it already exists — a one-shot claim, no race. */
  async claim(db: DbClient, key: string, value: string, userId: string | null): Promise<boolean> {
    try {
      await db.appSetting.create({ data: { key, value, updatedByUserId: userId } });
      return true;
    } catch {
      return false;
    }
  },

  async remove(db: DbClient, key: string) {
    await db.appSetting.deleteMany({ where: { key } });
  },

  async listPublic(db: DbClient): Promise<Record<PublicSettingKey, string | null>> {
    const rows = await db.appSetting.findMany({ where: { key: { in: [...PUBLIC_SETTING_KEYS] } } });
    const out = Object.fromEntries(PUBLIC_SETTING_KEYS.map((k) => [k, null])) as Record<
      PublicSettingKey,
      string | null
    >;
    for (const r of rows) out[r.key as PublicSettingKey] = r.value;
    return out;
  },
};

/** Settings for the platform itself, shared by every shop (e.g. the error-alert timer). */
export const platformSettingsRepo = {
  async get(db: DbClient, key: string): Promise<string | null> {
    const row = await db.platformSetting.findUnique({ where: { key } });
    return row?.value ?? null;
  },

  async set(db: DbClient, key: string, value: string) {
    await retryOnClash(() =>
      db.platformSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value, updatedAt: new Date() },
      }),
    );
  },

  /** Inserts only if the key is new. False when it already exists — a one-shot claim, no race. */
  async claim(db: DbClient, key: string, value: string): Promise<boolean> {
    try {
      await db.platformSetting.create({ data: { key, value } });
      return true;
    } catch {
      return false;
    }
  },
};
