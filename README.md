# MANA Wash Manager

MANA's own operations app: job tracking, customer history, payments — built per the
[app build plan](./MANA-Wash-Manager-App-Build-Plan.md). This repo is V0.1 + V1.0's core:
new job entry, customer/vehicle lookup, service picker with owner-editable pricing, the job
status board, and mark-paid.

## Structure

```text
apps/
  mobile/     React Native CLI app (TypeScript) — the actual MANA Wash Manager app
  api/        Cloudflare Worker (Hono) — mana-api, backed by D1 (mana_db)
packages/
  domain/     Pure business rules: pricing calculation, job status transitions (unit tested)
  db/         Prisma schema (types) + repository functions used by the Worker
```

Naming, schema and architecture decisions here follow the build plan's "Naming conventions"
and "Architecture and engineering principles" sections exactly — read those before changing
how something is named or structured.

## What's actually running right now

As of this setup pass: dependencies are installed, `mana_db` exists for real on Cloudflare
(database id `9691507c-caf1-4987-9f7c-5093357601e1`), both migrations are applied locally,
`npm run dev` in `apps/api` serves real data (`curl http://localhost:8787/services` returns
MANA's actual seeded menu), **and the Android app is built, installed, and running on a real
device** — the Login screen renders correctly in the white/water-blue theme against the local
API over `adb reverse`. Both the API and the Android app are verified end to end, not just
written.

Still needed, and each is a deliberate "go live" action rather than something to do as a side
effect of a setup pass:

1. **`npm run db:migrate:remote`** (in `apps/api`) — applies the same schema/seed to the real
   remote `mana_db`, not just the local dev copy.
2. **`npx wrangler secret put JWT_SECRET` / `MSG91_API_KEY`** — the local `.dev.vars` has
   placeholder values only; production secrets aren't set yet.
3. **`npm run deploy`** (in `apps/api`) — puts `mana-api` on a public `*.workers.dev` URL.
4. **Point `API_BASE_URL` at that public URL and build a release APK** — right now the app
   talks to `localhost:8787` via USB debugging; real staff phones need the deployed API and
   a signed release build (`cd apps/mobile/android && ./gradlew assembleRelease`), not a debug
   build tied to this Mac's Metro server.
4. **The `ios/`/`android/` native project folders.** React Native CLI generates these (Xcode
   project, Gradle project) from a template — they're not hand-writable, and need Xcode /
   Android Studio installed (see Setup, step 6).

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

### 4. Apply the schema and seed MANA's menu

```bash
npm run db:migrate:local   # creates the tables locally, for `wrangler dev`
npm run db:migrate:remote  # same, against the real D1 database, when you're ready to deploy
```

This runs `apps/api/migrations/0001_init.sql` (schema) and `0002_seed.sql` (MANA's actual
services and prices from the build plan). **Edit the seed owner phone number** in
`0002_seed.sql` (`+910000000000`) to the real owner's number before applying it for real.

### 5. Set secrets

```bash
cp .dev.vars.example .dev.vars   # inside apps/api — fill in JWT_SECRET and MSG91_API_KEY for local dev
npx wrangler secret put JWT_SECRET       # for production
npx wrangler secret put MSG91_API_KEY
```

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

Point `apps/mobile/src/api/client.ts`'s `API_BASE_URL` at your running Worker
(`http://localhost:8787` for local dev with `adb reverse tcp:8081 tcp:8081`, or your deployed
`*.workers.dev` URL), then, with a device connected via USB (`adb devices` should list it) or
an emulator running:

```bash
cd apps/mobile
npm run android
```

If you ever do need an iOS build, the native `ios/` folder was never generated (CocoaPods
isn't installed on this machine and MANA doesn't need it) — generate it the same way `android/`
was: extract the `template/ios` folder from the `react-native` npm package and rename the
`HelloWorld` placeholders to `ManaWashManager` / `com.manacarwash.washmanager`.

### 7. Deploy the API

```bash
cd apps/api
npm run deploy
```

## Development

```bash
npm run test        # runs packages/domain's Vitest suite (pricing + job-status logic)
npm run typecheck    # strict TypeScript across every package
npm run lint
```

## Design

White and water-blue only, defined once in `apps/mobile/src/theme/colors.ts` — every screen
composes from those tokens rather than choosing colors per-screen.
