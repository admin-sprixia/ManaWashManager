# MANA Wash Manager

MANA's own operations app: job tracking, customer history, payments — built per the
[app build plan](./MANA-Wash-Manager-App-Build-Plan.md). Release 0.2.0: job board and new
wash entry (works offline), customer history, PIN sign-in, before/after photos, WhatsApp
ready/thank-you messages with a Google review link, cash drawer close, staff commission on
selected services and attendance, reminders with comeback and referral offers, reports and expenses.

## Run the app

Everything below assumes setup is already done (see [Setup](#setup) if starting from a fresh
clone — D1 created, schema applied, `.dev.vars` filled in). Once that's done, running it
day to day is two terminals left open + your phone on USB.

**Terminal 1 — the API**

```bash
cd apps/api
npm run dev
```

Leave this running. Confirm it's up: `curl http://localhost:8787/health` → `{"ok":true}`.

**Terminal 2 — Metro (the JS bundler)**

```bash
cd apps/mobile
npx react-native start
```

Leave this running too.

**Every time you (re)connect the phone over USB** — forward both ports:

```bash
adb reverse tcp:8081 tcp:8081
adb reverse tcp:8787 tcp:8787
```

**Install and launch on the phone:**

```bash
cd apps/mobile
npx react-native run-android
```

Only needed the first time, or after adding/upgrading a native dependency (e.g. a new
`react-native-*` package). For everyday JS-only edits, Metro's Fast Refresh updates the
already-installed app automatically — no need to re-run this; just reopen the app from the
phone if it's not already in the foreground.

**Sign in** — day to day, everyone signs in with phone + PIN. On a fresh local database nobody
has a PIN yet: the owner enters their phone, the app asks for a WhatsApp code, and then they
pick a PIN. Locally no message is sent — the code is fixed:

- Phone: `9100000000`
- WhatsApp code (and recovery code): `000000` (dev only — `DEV_RECOVERY_CODE` in `.dev.vars`)
- While Meta reviews WhatsApp: keep `WHATSAPP_OTP_BYPASS=true` in `.dev.vars` so the app uses
  `000000` and never sends a real message. Set it to `false` when you’re ready to send real codes.

Staff PINs are set by the owner from **More → Team**; staff never get WhatsApp codes.

If the app ever shows "Cannot connect to Metro" or a red error screen, check Terminals 1 and 2
are both still running and the `adb reverse` step was re-run after the last USB reconnect —
that covers the two most common causes.

## Structure

```text
apps/
  mobile/     React Native CLI app (TypeScript) — the actual MANA Wash Manager app
  api/        Cloudflare Worker (Hono) — mana-api, backed by D1 (mana_db)
packages/
  domain/     Pure business rules: pricing calculation, job status transitions (unit tested)
  db/         Prisma schema (types) + repository functions + the shop-scoped database client
```

Naming, schema and architecture decisions here follow the build plan's "Naming conventions"
and "Architecture and engineering principles" sections exactly — read those before changing
how something is named or structured.

## What's actually running right now

`mana_db` exists on Cloudflare in the Asia-Pacific region (database id
`6dbc5c3d-93a6-4aee-b2e0-5cccb1b39dc3`) with every migration applied and no data; locally
the API, the full demo data (`npm run db:seed:demo`) and the Android app on a real device are
verified end to end. Going live is a deliberate, one-time sequence — see [Go live](#go-live).

## Go live

Run everything from `apps/api` unless noted. Every step is safe to re-run — nothing here can
wipe the live database.

1. **Sign in to Cloudflare** — `npx wrangler login` (opens a browser).
2. **Create the two buckets** — photos, and backups kept apart from them:
   ```bash
   npx wrangler r2 bucket create mana-files
   npx wrangler r2 bucket create mana-backups
   ```
3. **Set the production secrets** (each prompts for the value; nothing is committed):
   ```bash
   npx wrangler secret put JWT_SECRET            # 32+ random characters: openssl rand -base64 48
   npx wrangler secret put OWNER_RECOVERY_CODE   # 8+ characters, works once — keep it offline
   npx wrangler secret put WHATSAPP_API_TOKEN        # see "WhatsApp sign-in codes" below
   npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
   ```
   Never set `DEV_MODE` / `DEV_RECOVERY_CODE` in production.

   **WhatsApp sign-in codes** — the owner gets a 6-digit code on WhatsApp on a new phone or after
   forgetting their PIN. One-time setup in [Meta for Developers](https://developers.facebook.com/):
   create a Business app → add **WhatsApp** → add and verify the shop's business number (it
   can't also be used in the normal WhatsApp app) → copy its **Phone number ID**. In Business
   Settings → System users, create a system user with the `whatsapp_business_messaging`
   permission and generate a **permanent token**. In WhatsApp Manager → Message templates,
   create an **Authentication** template named `login_code` (language English) with a
   **Copy code** button, and wait for approval. A different name or language goes in
   `WHATSAPP_OTP_TEMPLATE` / `WHATSAPP_OTP_LANGUAGE`. Meta charges a small per-message fee for
   authentication messages. Until this is set up, the owner uses the recovery code.
4. **Create the tables** — `npm run db:migrate:remote` applies every file in `migrations/`.
   The live database starts empty: no demo shop, no demo accounts.
5. **Deploy** — `npm run deploy`. Note the `https://mana-api.<subdomain>.workers.dev` URL it
   prints.
6. **Point the app at it** — from `apps/mobile`:
   `npm run set-api-url -- https://mana-api.<subdomain>.workers.dev`
   It calls `/health` first and refuses an address that isn't the MANA API, then saves it in
   `src/config/release.json`. Debug builds keep using `localhost:8787`. A release build stops
   with an error while this is still the placeholder, so a phone can never ship pointing nowhere.
7. **Build the release app** — from `apps/mobile`: `npm run build:release`. Install
   `android/app/build/outputs/apk/release/app-release.apk` on each shop phone (the `.aab` next
   to it under `bundle/release` is the Play Store upload).
8. **First sign-in** — the owner opens the app, enters their phone, picks **Start a new shop**
   (WhatsApp code → PIN → name, shop name, city), then adds services and prices from
   **More → Services & prices**, staff from **More → Team**, and the Google review link from
   **More**. Staff join with the 6-digit shop ID shown in **More → shop name**.

**Changing the database later** — never edit a table by hand and never edit an old migration.
Add the next numbered file (`migrations/0002_what_it_does.sql`), make the same change in
`schema.sql` and `packages/db/prisma/schema.prisma`, run `npm run db:check` (fails if
`schema.sql` and the migrations disagree), try it with `npm run db:reset:local`, then
`npm run db:migrate:remote` before deploying the code that needs it.
`npm run db:migrations:status` lists what the live database has.

**What runs by itself after that** — a nightly cron at 03:00 IST (`wrangler.toml`
`[triggers]`) backs up every table to the `mana-backups` bucket
(`backups/YYYY-MM-DD/<table>/00001.json…`, written page by page so it works at any size, with a
`manifest.json` written last as proof the copy is complete; kept 30 days), deletes job photos
older than 90 days, retries any photo files a failed delete left behind, and prunes the error
log and old rate-limit counters. App crashes and API errors land in **More → Error log**
(owner only); new ones put a red dot on the Job Board's More button and a count on the Error
log row until the owner opens it. Every request is also kept in the Cloudflare dashboard
(Workers → mana-api → Logs).

**Error alerts on your phone (optional, free)** — so you hear about problems even with the app
closed. In Discord, create a private server (just you) → add a channel like `#mana-alerts` →
channel **Edit → Integrations → Webhooks → New Webhook** → **Copy Webhook URL**. Then:
```bash
npx wrangler secret put DISCORD_WEBHOOK_URL
```
Treat the URL like a password — anyone who has it can post into that channel.
You'll get at most one message per 15 minutes, with a count of errors since the last one —
covering API errors, app crashes and a failed nightly backup.

**Payments: Free and Pro (Razorpay)** — every shop gets a 14-day Pro trial, then drops to Free
unless it pays. Free: the owner + 1 staff, 300 washes a month, reports for the last 7 days. Pro
(₹499 a month or ₹4,999 a year; the first 50 shops to pay get ₹399 / ₹3,990, for life; each extra branch ₹349 / ₹3,490): 5 staff,
unlimited washes and every feature. The server enforces all of it; the app only mirrors it. Owners
pay with UPI AutoPay or a card on Razorpay's hosted page — the app never sees card or UPI details.
One-time setup, in **Test Mode** first (top-right toggle in the
[Razorpay Dashboard](https://dashboard.razorpay.com/)):

1. **Account & Settings → API Keys → Generate Test Key.** Copy the Key ID (`rzp_test_…`) and
   the Key Secret (shown once).
2. **Account & Settings → Webhooks → Add New Webhook.** URL
   `https://api-staging.manawashmanager.com/billing/webhook` (production:
   `https://api.manawashmanager.com/billing/webhook`), a long random **Secret**
   (`openssl rand -hex 32`), and tick every `subscription.*` event.
3. **Set the three secrets** from `apps/api` (each prompts for the value; drop `--env staging`
   for production):
   ```bash
   npx wrangler secret put RAZORPAY_KEY_ID --env staging
   npx wrangler secret put RAZORPAY_KEY_SECRET --env staging
   npx wrangler secret put RAZORPAY_WEBHOOK_SECRET --env staging
   ```
4. **Try it** — More → Your plan → Upgrade. Test Mode pays with Razorpay's
   [test UPI ID or test cards](https://razorpay.com/docs/payments/payments/test-card-upi-details/);
   no real money moves. Pro switches on when the owner returns to the app (it asks Razorpay
   directly) or when the webhook lands, whichever is first. A nightly job catches up any shop
   whose renewal webhook went missing.

**Right now staging has placeholder values** for all three secrets (an action item in the build
plan's Next steps). The API treats any key ID that doesn't start with `rzp_test_` / `rzp_live_` as
"not set up", so the app works normally and only the Upgrade button explains that payments
aren't ready. Replace all three with the commands above when the Razorpay account exists.

Going live later: activate the Razorpay account (KYC), generate **Live** keys and a live webhook
the same way, and put the live values into the production secrets. Razorpay plans are created by
the API on first use, per key, so nothing else changes. Without the keys the app still works —
the plan screen just says payments aren't set up yet.

**Restoring** — D1's built-in Time Travel is the first resort (any minute in the last 30 days):
`npx wrangler d1 time-travel restore mana_db --timestamp=<ISO time>`. The nightly backups are
the fallback if the database itself is lost:

```bash
npm run backup:restore -- --list                                 # which days exist
npm run backup:restore -- --date 2026-10-01 --into local         # rehearse on your machine first
npm run backup:restore -- --date 2026-10-01 --into remote --yes  # the real thing
```

It only fills an **empty** database that already has every migration (locally:
`npm run db:reset:local -- --no-seed`; live: create a fresh D1 database, put its id in
`wrangler.toml`, run `npm run db:migrate:remote`), skips a backup without a `manifest.json`,
and checks every table's row count at the end. Rehearse a restore into local once a month so
you know it works before you need it.

**Staging (try a release before the shops get it)** — a second copy of everything, named
`mana-api-staging`. One time: `npx wrangler d1 create mana_db_staging` (paste its id into the
`[env.staging]` block of `wrangler.toml`), create the `mana-files-staging` and
`mana-backups-staging` buckets, and set the same secrets with `--env staging`. Then each
release: `npm run db:migrate:staging`, `npx wrangler deploy --env staging`, and point a test
phone's build at the staging URL with `set-api-url`. `--into staging` restores a production
backup there for realistic testing.

**Lost the owner PIN** — tap **Forgot PIN? → Send code on WhatsApp**. If WhatsApp isn't
reachable, rotate the recovery code (`npx wrangler secret put OWNER_RECOVERY_CODE`) and sign in
with the new one; each recovery code works once.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create the D1 database

```bash
cd apps/api
npx wrangler login
npx wrangler d1 create mana_db
```

Copy the `database_id` it prints into `apps/api/wrangler.toml` (replacing
`REPLACE_WITH_D1_DATABASE_ID`).

### 3. Generate the Prisma client

```bash
npm run db:generate -w @mana/db
```

`npm run dev` and `npm run deploy` in `apps/api` also run this automatically (`predev`/
`predeploy`), so you only need it by hand after changing `packages/db/prisma/schema.prisma`.

### 4. Build the local database

```bash
npm run db:reset:local   # inside apps/api — wipes the LOCAL database, applies every migration, loads seed.sql
npm run db:seed:demo     # optional, with the API running: 90 days of realistic shop data
```

`seed.sql` adds the MANA shop (ID `482193`), its menu and prices, and the sign-in accounts
listed under [Run the app](#run-the-app). `db:seed:demo` resets again and fills in customers,
washes, photos, expenses, stock, cash days, a second branch and three staff (PIN `2580` for
everyone; it prints the phone numbers). There is no remote reset — the live database is only
ever changed by migrations. `schema.sql` is the readable picture of the whole database;
`db:check` keeps it identical to the migrations.

### 5. Set secrets

```bash
cp .dev.vars.example .dev.vars   # inside apps/api — fill in JWT_SECRET for local dev
```

Production secrets are covered in [Go live](#go-live).

Then run the API locally:

```bash
npm run dev   # inside apps/api — starts wrangler dev on http://localhost:8787
```

### 6. The Android app — Android-only, by design

MANA is Android-only (no iOS build target is maintained). `apps/mobile/android` is already
generated and configured — verified end to end on a real device (a USB-connected Motorola
Edge 40 Neo): `npm run android` builds, installs, and launches the app, and it renders the
real Login screen in the white/water-blue theme.

Two monorepo-specific fixes are already baked into `apps/mobile/android` and
`apps/mobile/metro.config.js` — know these exist if node_modules ever gets wiped and
regenerated, or if you copy this setup elsewhere:

1. **Gradle's node_modules paths.** The stock RN template assumes `node_modules` sits right
   next to `android/`; npm workspaces hoists it to the repo root instead. `settings.gradle`
   and `app/build.gradle` point at `../../../node_modules` / `../../../../node_modules`
   accordingly (see the comments in those files) — don't "fix" these back to the template
   defaults.
2. **Metro doesn't resolve `package.json` "exports" maps by default**, and Hono's client
   (`hono/client`, used by `apps/mobile/src/api/client.ts`) relies on one. Without
   `resolver.unstable_enablePackageExports: true` in `metro.config.js`, the bundle fails to
   build (a blank/gray screen on device, a 500 from Metro in the logs).

Debug builds talk to `http://localhost:8787` (with `adb reverse tcp:8787 tcp:8787`); release
builds use the address saved by `npm run set-api-url` in `src/config/release.json`. With a device connected
via USB (`adb devices` should list it) or an emulator running:

```bash
cd apps/mobile
npm run android
```

If you ever do need an iOS build, the native `ios/` folder was never generated (CocoaPods
isn't installed on this machine and MANA doesn't need it) — generate it the same way `android/`
was: extract the `template/ios` folder from the `react-native` npm package and rename the
`HelloWorld` placeholders to `ManaWashManager` / `com.sprixia.manawashmanager`.

### 7. Deploy the API

```bash
cd apps/api
npm run deploy
```

## Development

```bash
npm run test           # packages/domain's Vitest suite (pricing, job status, cash, stock, commission)
npm run typecheck      # strict TypeScript across every package
npm run lint
npm run version:check  # the app, API and packages all carry the same version
cd apps/api && npm run db:check   # schema.sql matches the migrations
```

**CI** — `.github/workflows/ci.yml` runs all of the above on every push to `main` and every pull request, then
builds a fresh local database, starts the API and runs the isolation and sign-up tests below.
Don't merge a red build.

**Shop isolation test** — the platform runs many car washes on one database (see
`MANA-Multi-Shop-Plan.md`). With the local API running (`cd apps/api && npm run dev`):

```bash
cd apps/api && npm run test:isolation   # adds a second shop and proves neither can see or change the other's data
cd apps/api && npm run test:signup      # new shop sign-up, join requests (approve/reject/cancel), remove from team
cd apps/api && npm run test:plans       # Free limits (staff seats, 300 washes, 7-day reports, Pro-only features), trial, grace, webhook signature
cd apps/api && npm run test:rewards     # stamp cards, free washes, welcome gifts and owed gifts, including voids and retries
```

`test:plans` checks a correctly signed webhook too when `RAZORPAY_WEBHOOK_SECRET` is set in the
shell to the same value the local API uses (CI does this). It also runs a stand-in Razorpay on
port 8799 for the checkout worst cases (last founder spot, double taps, a duplicate paid
subscription); start the API pointed at it to include them:

```bash
npx wrangler dev --var RAZORPAY_WEBHOOK_SECRET:local --var RAZORPAY_KEY_ID:rzp_test_standin \
  --var RAZORPAY_KEY_SECRET:standin --var RAZORPAY_API_BASE:http://127.0.0.1:8799/v1
RAZORPAY_WEBHOOK_SECRET=local npm run test:plans
```

`RAZORPAY_API_BASE` is ignored unless the key id starts with `rzp_test_`.

**Sign-up flow** — a number with no account picks "Start a new shop" (WhatsApp code → PIN twice →
name, shop name, city) or "I work at a shop" (6-digit shop ID → WhatsApp code → name → the owner
approves in More → Team → they choose their own PIN). The seeded MANA shop's ID is `482193`.

Run it after any change to a route or repository. Every signed-in route must use
`c.get('db')` (locked to the signed-in shop), never `createPlatformDb`.

## Design

White and water-blue only, defined once in `apps/mobile/src/theme/colors.ts` — every screen
composes from those tokens rather than choosing colors per-screen.
