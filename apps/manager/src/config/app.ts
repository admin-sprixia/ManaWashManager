import pkg from '../../package.json';
import release from './release.json';

/** Shared product version (see scripts/version.mjs); shown in More and attached to crash reports. */
export const APP_VERSION: string = pkg.version;

/** Where a new teammate installs this app; sent in the WhatsApp invite from Team. */
export const TEAM_APP_LINK = 'https://play.google.com/store/apps/details?id=com.sprixia.srimanawash';

/**
 * Where a customer gets their exact price: the business WhatsApp number, printed (with a QR code)
 * at the end of every menu PDF. The link opens a chat with "Hi" typed in.
 */
export const CUSTOMER_WHATSAPP_LINK = 'https://wa.me/919154752999?text=Hi';
export const CUSTOMER_WHATSAPP_NUMBER = '91547 52999';

/**
 * MANA Pay: the shop's HDFC Vyapar UPI QR, the same one on the counter card, so the sound box
 * announces the payment. The customer enters the amount themselves (merchant QRs don't take one).
 * Replace it if the bank issues a new QR (also in branding/flex/shop-posters/build-shop-posters.mjs).
 */
export const MANA_PAY_QR = 'upi://pay?pa=Vyapar.178760059376@hdfcbank&pn=Default&mc=8999&tr=STQU178760059376&cu=INR';

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
