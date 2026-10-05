import pkg from '../../package.json';
import release from './release.json';

/** Shared product version (see scripts/version.mjs); shown on the Profile tab. */
export const APP_VERSION: string = pkg.version;

export const APP_NAME = 'MANA Car Wash';

/** Where "Contact us" and the delete-account note point. */
export const SUPPORT_EMAIL = 'support@sprixia.com';

/**
 * The deployed Worker. Release builds always use it; set it with `npm run set-api-url -- https://…`
 * in apps/customer. Release builds fail (android/app/build.gradle) while it's still the placeholder.
 */
export const PRODUCTION_API_URL: string = release.productionApiUrl;
/**
 * Debug builds talk to `wrangler dev` on this Mac: over `adb reverse tcp:8787 tcp:8787` on
 * Android, and directly on the iOS simulator.
 */
export const DEV_API_URL = 'http://localhost:8787';
