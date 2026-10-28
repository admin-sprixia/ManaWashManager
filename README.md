# Mana Wash Partner

MANA's own operations app: job tracking, customer history, payments — built per the
[app build plan](./docs/old-plan/MANA-Wash-Manager-App-Build-Plan.md). Release 0.2.0: job board and new
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
cd apps/manager
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
cd apps/manager
npx react-native run-android
```

Only needed the first time, or after adding/upgrading a native dependency (e.g. a new
`react-native-*` package). For everyday JS-only edits, Metro's Fast Refresh updates the
already-installed app automatically — no need to re-run this; just reopen the app from the
phone if it's not already in the foreground.

**Sign in** — day to day, everyone signs in with phone + PIN, on a phone their number trusts. The
first time on a phone (or after a reset, or after choosing Sign out) the app asks for a WhatsApp
code; a number with no PIN yet chooses one straight after. Owners and managers use 6-digit PINs,
staff 4 to 6. Locally no message is sent — the code is fixed:

- Phone: `9100000000` (also Mana Wash HQ in the seed)
- WhatsApp code: `000000` (dev only — `DEV_RECOVERY_CODE` in `.dev.vars`)
- While Meta reviews WhatsApp: keep `WHATSAPP_OTP_BYPASS=true` in `.dev.vars` so the app uses
  `000000` and never sends a real message. Set it to `false` when you’re ready to send real codes.

Nobody sets or sees someone else's PIN. Everyone chooses their own after a WhatsApp code; an owner,
manager or HQ can only **reset** one (see [Forgotten or reset PINs](#forgotten-or-reset-pins)).
Every sign-in case, limit and error is in [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md).

If the app ever shows "Cannot connect to Metro" or a red error screen, check Terminals 1 and 2
are both still running and the `adb reverse` step was re-run after the last USB reconnect —
that covers the two most common causes.

## Structure

```text
apps/
  mobile/     React Native CLI app (TypeScript) — the Mana Wash Partner app (team app)
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
   npx wrangler secret put WHATSAPP_API_TOKEN        # see "WhatsApp sign-in codes" below
   npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
   ```
   Never set `DEV_MODE` / `DEV_RECOVERY_CODE` in production.

   **WhatsApp sign-in codes** — everyone gets a 6-digit code on WhatsApp on a new phone or after
   forgetting their PIN. WhatsApp is the only way in on a new phone, so set this up before go-live. One-time setup in [Meta for Developers](https://developers.facebook.com/):
   create a Business app → add **WhatsApp** → add and verify the shop's business number (it
   can't also be used in the normal WhatsApp app) → copy its **Phone number ID**. In Business
   Settings → System users, create a system user with the `whatsapp_business_messaging`
   permission and generate a **permanent token**. In WhatsApp Manager → Message templates,
   create an **Authentication** template named `login_code` (language English) with a
   **Copy code** button, and wait for approval. A different name or language goes in
   `WHATSAPP_OTP_TEMPLATE` / `WHATSAPP_OTP_LANGUAGE`. Meta charges a small per-message fee for
   authentication messages. Until this is set up, nobody can sign in on a new phone.
   **WhatsApp assistant** — the same number answers customers: prices for their model, hours and
   location (`src/routes/whatsapp.ts`, replies built in `@mana/domain`'s `whatsappChat.ts`).
   ```bash
   npx wrangler secret put WHATSAPP_APP_SECRET      # Meta app → App settings → Basic → App secret
   npx wrangler secret put WHATSAPP_VERIFY_TOKEN    # any long random text: openssl rand -hex 24
   npx wrangler secret put WHATSAPP_BUSINESS_ID     # the business whose branches it answers for
   ```
   Then in the Meta app → WhatsApp → Configuration (or Production setup → Configure Webhooks):
   Callback URL `https://<api host>/whatsapp/webhook`, Verify token = `WHATSAPP_VERIFY_TOKEN`,
   **Verify and save**, subscribe the **messages** field, switch on **Subscribe webhooks** for the
   number, and **Publish** the app (Meta sends real customers' messages only to a published app).
   Subscribe the app to the number's WhatsApp Business Account too, or no message reaches the
   webhook: `curl -X POST "https://graph.facebook.com/v25.0/<WABA id>/subscribed_apps" -H "Authorization: Bearer <token>"`.
   **Ready and bill messages** go out by themselves when a hub wash moves to Ready and when a wash
   is paid (`src/lib/washMessages.ts`), from the `wash_ready` and `wash_bill` templates in English
   and Telugu (`@mana/domain`'s `whatsappTemplates.ts`). Submit them to Meta once and check their
   approval with `npm run whatsapp:templates -- submit` / `npm run whatsapp:templates` (needs
   `WHATSAPP_BUSINESS_ACCOUNT_ID` in `.dev.vars`). Until they're approved nothing is sent.
   **Services & Prices Flow** (optional) — a full-screen picker inside WhatsApp: companies with
   logos → models → prices (`@mana/domain`'s `whatsappFlow.ts`; screens answered by
   `POST /whatsapp/flow`). WhatsApp encrypts every Flow request, so it needs a key pair (kept in
   the gitignored `.wrangler/flow-keys/`):
   ```bash
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out .wrangler/flow-keys/<env>-private.pem
   openssl pkey -in .wrangler/flow-keys/<env>-private.pem -pubout -out .wrangler/flow-keys/<env>-public.pem
   npx wrangler secret put WHATSAPP_FLOW_PRIVATE_KEY < .wrangler/flow-keys/<env>-private.pem
   curl -X POST "https://graph.facebook.com/v25.0/<phone number id>/whatsapp_business_encryption" \
     -H "Authorization: Bearer <token>" --data-urlencode "business_public_key@.wrangler/flow-keys/<env>-public.pem"
   npm run whatsapp:flow -- https://<api host> publish   # prints WHATSAPP_FLOW_ID
   ```
   Then set `WHATSAPP_FLOW_ID` (a var) and deploy. WhatsApp sends Flows only once the business has
   passed Meta's business verification; until `WHATSAPP_FLOW_ID` is set, Car / Bike use plain lists.
   Company logos come from the app's; run `node scripts/build-flow-logos.mjs` after adding one.
   Test locally with `npm run test:whatsapp` (its header shows the `wrangler dev` flags).
4. **Create the tables** — `npm run db:migrate:remote` applies every file in `migrations/`.
   The live database starts empty: no demo shop, no demo accounts. Then load India Post's
   pincode list (about 165,000 offices, used to open branches):
   `npm run data:post-offices -- --into remote --yes`. Run it again any time to refresh it.
   Then set up the business and its first branch once:
   `npm run setup:business -- --name "…" --phone … --town Kovur --town-code KVR --pincode 524137 --lat … --lng … --business "Sri Mana Wash" --into remote --yes`.
5. **Deploy** — `npm run deploy`. Note the `https://mana-api.<subdomain>.workers.dev` URL it
   prints.
6. **Point the app at it** — from `apps/manager`:
   `npm run set-api-url -- https://mana-api.<subdomain>.workers.dev`
   It calls `/health` first and refuses an address that isn't the MANA API, then saves it in
   `src/config/release.json`. Debug builds keep using `localhost:8787`. A release build stops
   with an error while this is still the placeholder, so a phone can never ship pointing nowhere.
7. **Build the release app** — from `apps/manager`: `npm run build:release`. Install
   `android/app/build/outputs/apk/release/app-release.apk` on each shop phone (the `.aab` next
   to it under `bundle/release` is the Play Store upload).
8. **First sign-in** — nobody can start a shop from the app. Mana Wash HQ (a phone in
   `business_admins`) opens each branch from **More → Mana Wash HQ → All branches → Open a
   branch**: the pincode, a pin on the map, and the owner's name and phone. Nothing else is
   typed: the server finds the town from India Post's offices, gives each town one 3-letter
   code for good (big cities their known one: HYD, BLR, MAA…; others from the name, never one
   another town has), numbers the branch (KVR-001, KVR-002), names it, and asks HQ to confirm
   anything odd (a branch next door, a pin far from its pincode, a new state, a look-alike town
   name). Codes never change after opening, because receipts carry them. HQ also ticks the
   services in the branch's agreement (Hub, Community, Doorstep); the owner switches those on
   and off in Shop details › Services, never more. The branch gets the
   business menu straight away; its owner signs in with their phone and a WhatsApp code, then sets
   a 6-digit PIN. The owner (or a manager, for staff) adds the team in **More → Team**; each person
   signs in with a WhatsApp code and chooses their own PIN. Only HQ adds or removes branch owners.

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

**Payments (Razorpay)** — branches don't pay for the app: every branch gets every feature, and
Mana Wash HQ settles royalties outside it. Razorpay is used only for **customer payment links**
(community wash plans). One-time setup, in **Test Mode** first (top-right toggle in the
[Razorpay Dashboard](https://dashboard.razorpay.com/)):

1. **Account & Settings → API Keys → Generate Test Key.** Copy the Key ID (`rzp_test_…`) and
   the Key Secret (shown once).
2. **Account & Settings → Webhooks → Add New Webhook.** URL
   `https://api-staging.manawashmanager.com/pay/webhook` (production:
   `https://api.manawashmanager.com/pay/webhook`), a long random **Secret**
   (`openssl rand -hex 32`), and tick the `payment_link.*` events.
3. **Set the three secrets** from `apps/api` (each prompts for the value; drop `--env staging`
   for production):
   ```bash
   npx wrangler secret put RAZORPAY_KEY_ID --env staging
   npx wrangler secret put RAZORPAY_KEY_SECRET --env staging
   npx wrangler secret put RAZORPAY_WEBHOOK_SECRET --env staging
   ```

The API treats any key ID that doesn't start with `rzp_test_` / `rzp_live_` as "not set up"; plans
are then paid at the counter only. Going live: activate the Razorpay account (KYC), generate
**Live** keys and a live webhook the same way, and put them into the production secrets.

**Pausing or closing a branch** — HQ only, from **More → Mana Wash HQ → All branches → the
branch**, with a reason the team sees. Paused: no new washes, but washes already open can be
finished and paid. Closed: everyone there is signed out and can't sign in; its records are kept,
and HQ can reopen it. Every change is logged with who made it and why.

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

### Forgotten or reset PINs

- **Forgot it, phone in hand** — tap **Forgot PIN? → Send code on WhatsApp**, then choose a new PIN.
- **Lost phone, or locked out** — someone above resets it: the owner resets staff and managers, a
  manager resets staff (**More → Team → the person → Reset PIN**), HQ resets owners and anyone
  working at more than one branch (**All branches → the branch → Reset PIN**). A reset signs them out everywhere and forgets
  every phone they trusted; it never signs anyone in. They get back in with a WhatsApp code, choose
  a new PIN, and are told who reset it and when. Every reset is logged.
- **HQ itself** — Sprixia resets it after a phone call, from `apps/api`:
  `npm run support:reset-pin -- --phone 98XXXXXXXX --into remote --yes --by "Name (Sprixia)"`
  (`--into local` or `staging` to rehearse; `--by` is what the person is shown).

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

`seed.sql` adds the test branch Mana Wash Nellore City (code `NLR-01`), its menu and prices, and the sign-in accounts
listed under [Run the app](#run-the-app). `db:seed:demo` resets again and fills in customers,
washes, photos, expenses, stock, cash days, a second branch and three staff (PIN `258025` for
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

MANA is Android-only (no iOS build target is maintained). `apps/manager/android` is already
generated and configured — verified end to end on a real device (a USB-connected Motorola
Edge 40 Neo): `npm run android` builds, installs, and launches the app, and it renders the
real Login screen in the white/water-blue theme.

Two monorepo-specific fixes are already baked into `apps/manager/android` and
`apps/manager/metro.config.js` — know these exist if node_modules ever gets wiped and
regenerated, or if you copy this setup elsewhere:

1. **Gradle's node_modules paths.** The stock RN template assumes `node_modules` sits right
   next to `android/`; npm workspaces hoists it to the repo root instead. `settings.gradle`
   and `app/build.gradle` point at `../../../node_modules` / `../../../../node_modules`
   accordingly (see the comments in those files) — don't "fix" these back to the template
   defaults.
2. **Metro doesn't resolve `package.json` "exports" maps by default**, and Hono's client
   (`hono/client`, used by `apps/manager/src/api/client.ts`) relies on one. Without
   `resolver.unstable_enablePackageExports: true` in `metro.config.js`, the bundle fails to
   build (a blank/gray screen on device, a 500 from Metro in the logs).

Debug builds talk to `http://localhost:8787` (with `adb reverse tcp:8787 tcp:8787`); release
builds use the address saved by `npm run set-api-url` in `src/config/release.json`. With a device connected
via USB (`adb devices` should list it) or an emulator running:

```bash
cd apps/manager
npm run android
```

If you ever do need an iOS build, the native `ios/` folder was never generated (CocoaPods
isn't installed on this machine and MANA doesn't need it) — generate it the same way `android/`
was: extract the `template/ios` folder from the `react-native` npm package and rename the
`HelloWorld` placeholders to `SriManaWashPartner` / `com.sprixia.srimanawashpartner`.

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
builds a fresh local database, starts the API and runs every API end-to-end test below.
Don't merge a red build.

**Shop isolation test** — the platform runs many car washes on one database (see
`docs/old-plan/MANA-Multi-Shop-Plan.md`). With the local API running (`cd apps/api && npm run dev`):

```bash
cd apps/api && npm run test:isolation   # adds a second shop and proves neither can see or change the other's data
cd apps/api && npm run test:team        # no self sign-up, HQ opens branches and manages owners, add and remove teammates
cd apps/api && npm run test:access      # roles (owner, manager, staff), PIN resets, trusted phones, 6-digit PINs, pause and close
cd apps/api && npm run test:rewards     # stamp cards, free washes, welcome gifts and owed gifts, including voids and retries
cd apps/api && npm run test:races       # double taps and parallel requests can't double-count
cd apps/api && npm run test:cash        # cash drawer: shop cash, doorstep handovers, carry-over, undo
cd apps/api && npm run test:stock       # inventory: items, use/add/count, never below zero, replays
cd apps/api && npm run test:reports     # reports, staff report, corrections feed, attendance, team cash guard
cd apps/api && npm run test:services    # HQ services: places, sizes and prices, details, branch menus, app, plans
cd apps/api && npm run test:customer-app  # the Mana Wash app (customers): sign-in, branches, vehicles, washes, requests
cd apps/api && npm run test:catalog     # business price list, vehicle sizes, branches and service points
cd apps/api && npm run test:pricing     # community rule and volume discount, doorstep visit charge, same visit, too far
cd apps/api && npm run test:places      # places, joining (flows A–E), plans, payments, receipts, refunds, nightly
```

These expect a fresh local database: run `npm run db:reset:local` first, and `npm run db:seed:demo`
afterwards to get the demo data back. `test:places` checks the signed payment webhook when
`RAZORPAY_WEBHOOK_SECRET` is set in the shell to the same value the local API uses (CI does this).
It runs a stand-in Razorpay on port 8799; start the API pointed at it to include the payment-link
checks:

```bash
npx wrangler dev --var RAZORPAY_WEBHOOK_SECRET:local --var RAZORPAY_KEY_ID:rzp_test_standin \
  --var RAZORPAY_KEY_SECRET:standin --var RAZORPAY_API_BASE:http://127.0.0.1:8799/v1
RAZORPAY_WEBHOOK_SECRET=local npm run test:places
```

`RAZORPAY_API_BASE` is ignored unless the key id starts with `rzp_test_`. Places, plans and
payments are described in `docs/old-plan/MANA-Registration-and-Plans.md`. The scripts sign in
with a fixed device key kept in `apps/api/.wrangler/script-device-key`, so they trust the local
API once like a real phone.

**Getting onto a team** — nobody signs themselves up. An owner or manager adds people in More →
Team; they sign in with a WhatsApp code and choose their own PIN. A number on no team is told to
ask them (`no_account`). New branches are opened only by HQ (`POST /business/branches`, for
a phone in `business_admins`); every branch belongs to the Mana Wash business, and only HQ adds or
removes owners (`/business/branches/:id/owners`; Team refuses with `hq_only`). The seeded HQ
admin is `9100000000`.

Run it after any change to a route or repository. Every signed-in route must use
`c.get('db')` (locked to the signed-in shop), never `createPlatformDb`.

## Design

White and water-blue only, defined once in `apps/manager/src/theme/colors.ts` — every screen
composes from those tokens rather than choosing colors per-screen.
