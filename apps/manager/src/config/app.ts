import pkg from '../../package.json';
import release from './release.json';

/** Shared product version (see scripts/version.mjs); shown in More and attached to crash reports. */
export const APP_VERSION: string = pkg.version;

/** Where a new teammate installs this app; sent in the WhatsApp invite from Team. */
export const PARTNER_APP_LINK = 'https://play.google.com/store/apps/details?id=com.sprixia.srimanawashpartner';

/**
 * Where a customer gets their exact price: printed (with a QR code) at the end of every menu PDF.
 * A placeholder for now; swap in the Mana Wash app's real link when it's published.
 */
export const CUSTOMER_APP_LINK = 'https://manawashmanager.com/app';

/** Where "Send to support" in the error log goes. */
export const SUPPORT_EMAIL = 'support@sprixia.com';

/**
 * The deployed Worker, printed by `npm run deploy` in apps/api. Release builds always use it;
 * set it with `npm run set-api-url -- https://…` in apps/manager. Release builds fail
 * (android/app/build.gradle) while it's still the placeholder.
 */
export const PRODUCTION_API_URL: string = release.productionApiUrl;
/** Debug builds talk to `wrangler dev` on this Mac over `adb reverse tcp:8787 tcp:8787`. */
export const DEV_API_URL = 'http://localhost:8787';
