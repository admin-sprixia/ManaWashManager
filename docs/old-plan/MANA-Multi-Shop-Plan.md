# MANA Car Wash Manager — Multi-Shop Plan

> **Update, 4 Oct 2026:** MANA is no longer sold to other car washes. MANA is the car wash's own
> brand and app. The multi-shop foundation built from this plan stays, because each **branch** is
> a shop; public sign-up closes and plan screens are hidden for MANA's own shops (see
> [MANA-Community-Implementation-Plan.md](MANA-Community-Implementation-Plan.md), Part 1.3).
> The rest of this document is kept as history.

**Product:** MANA Car Wash Manager, by Sprixia Labs Private Limited
**Goal:** any car wash in India can download the app, sign up with their shop name, and run
their shop on it for ₹2,000 a month. MANA Car Wash (our own shop) becomes customer #1.

Decisions are agreed (Part 5). **Phase 1 (foundation) is built** — see "Phase 1 status" below.
Phase 2 sign-up and joining are built too (see "Phase 2 status"). Next: the starter menu for new
shops, then Phase 3 (shop name everywhere).

---

## Part 1 — What it looks like for a shop owner

### Scenario: a new shop signs up

Ravi owns **Sparkle Wash** in Pune. He finds "MANA Car Wash Manager" on the Play Store.

1. He opens the app and taps **Start free trial**.
2. He enters his mobile number. He gets a 6-digit code on WhatsApp and types it in.
3. He types his shop name ("Sparkle Wash") and city.
4. He picks a PIN for daily sign-in.
5. He lands on the Job Board — the **same app MANA uses today** — already filled with a
   starter menu (Complete Wash, Exterior Wash, Interior, add-ons) and typical prices, which he
   edits in Settings.
6. He adds his two staff from **More → Team** and sets their PINs.
7. His customers get WhatsApp messages that say **Sparkle Wash**, not MANA.
8. The trial lasts 14 days. On day 10 the app reminds him. He pays ₹2,000 and keeps going.

### Scenario: a staff member signs in

Suresh works at Sparkle Wash. The owner added him with his phone number and a PIN. Suresh opens
the app, enters his phone, then his PIN. He only ever sees Sparkle Wash. He never gets WhatsApp
codes — PIN only, exactly like today.

### Scenario: a shop stops paying

Sparkle Wash doesn't pay on time.

- **Days 1–7 after due date (grace):** everything works; a yellow banner says "Payment due".
- **After day 7 (read-only):** they can still open the app, see jobs, customers and reports,
  and export them — but can't start new washes until they pay. We never hold their data hostage.
- **Cancelled for 90 days:** their data is deleted (after a final export offer).

### Scenario: MANA (our own shop)

MANA is set up as a normal shop on the same platform, on a free plan. Nothing special in the
code — if it works for MANA, it works for every shop.

### Scenario: Sprixia support

Ravi forgot his PIN **and** lost WhatsApp access. He calls Sprixia support. We check it's really
him (registered phone, shop name, last payment), then press **Reset owner PIN** in the Sprixia
admin panel. He gets a fresh WhatsApp code on his new number. We never learn or hold any
password. (This replaces today's single server-wide recovery code, which can't work for many
shops.)

---

## Part 2 — Where the code is today (honest status)

**Already right, reused as-is:**

- Every screen: New Wash, Job Board, payments, commission, cash drawer, attendance, photos,
  reports, reminders, coupons, referrals.
- Offline mode and the outbox.
- PIN sign-in for everyone, WhatsApp code for owners.
- Services, prices and vehicle types are data the owner edits, not hardcoded — so each shop can
  have its own menu with zero code changes.
- The session token already has a slot for "which organization" (`orgId`), today always
  `'mana'`.
- All data access goes through one repository layer (`packages/db`), so "which shop" can be
  enforced in one place.

**Not built yet:**

- There is no concept of a "shop" in the database. All 22 tables hold one shop's data.
- Phone numbers, car numbers and coupon codes are unique across the whole database, so two
  shops couldn't both have car `TS09AB1234`.
- The shop name is hardcoded as `'MANA Car Wash'` in `apps/manager/src/config/shop.ts`.
- The service, price and vehicle-type lists can be read without signing in (they'd need to know
  which shop).
- No sign-up, no trial, no billing, no Sprixia admin panel.
- One owner recovery code for the whole server.
- Nightly backups, photo cleanup and error alerts treat the whole server as one shop.

---

## Part 3 — The big decision: how to keep shops apart

There are two proven ways. **This must be decided first**, because everything else depends on it.

### Option A — A separate database for every shop

This is what the original build plan chose (Data model, point 1).

Each shop gets its own D1 database. Sparkle Wash's data physically lives in a different database
from MANA's.

- **Good:** shops can't see each other's data even if the code has a bug. Deleting or exporting
  one shop's data is trivial. One huge shop can't slow down others.
- **Hard part:** Cloudflare Workers can't pick a database at runtime — every database has to be
  wired in ("bound") ahead of time. So each new shop needs a new Worker deployment wired to its
  new database. For self-serve sign-up that means using Cloudflare's **Workers for Platforms**
  (a separate paid product, around $25/month plus usage at the time of writing) and building an
  automatic "create database → apply schema → deploy worker" step that runs during sign-up.
- **Also needed:** a central "directory" database (which phone belongs to which shop, plans,
  billing), and every schema change must be applied to every shop's database, one by one.
- The build plan says the Worker is "already wired to resolve which database per request" —
  that part was never actually built.

### Option B — One shared database, every row stamped with its shop (recommended)

Every table gets a `shop_id` column. Every request knows its shop from the sign-in session, and
every query is automatically limited to that shop.

- **Good:** sign-up is instant (just a new row). One schema, one deploy, one migration. The
  Sprixia admin panel and billing are simple queries. Cheapest to run. This is how most SaaS
  products (Zoho, Shopify-style apps) start.
- **Risk:** if one query forgets the shop filter, a shop could see another's data. We remove
  that risk by design, not by being careful (see Phase 1: the database client itself is created
  per shop, and a test suite proves Shop B can't touch Shop A's data on every endpoint).
- **Limit:** one D1 database holds up to 10 GB (at the time of writing). A busy car wash
  produces very roughly tens of MB a year (photos live in R2, not the database), so this covers
  many hundreds of shop-years. When we get close, large shops can be moved to their own database
  — the `shop_id` stamp makes that a clean copy.

### Decision

**Option B** (agreed). It gets a paying product to market much sooner, with far fewer moving parts, and
the data-leak risk is handled structurally. Option A's real advantages (physical isolation, no
size ceiling) only start to matter at a scale where moving the biggest shops out is affordable.

If we choose B, the build plan's "one database per organization" sections get rewritten to match.

---

## Part 4 — Build phases (assuming Option B)

Each phase ends with something testable. Phases 1–4 are needed before the first paying shop.

### Phase 1 — Foundation: shops that can never see each other

The most important and largest phase. It touches every route and repository.

**Database (`apps/api/schema.sql` + `schema.prisma`):**

- New `shops` table: `id`, `name`, `city`, `slug`, `plan` (trial | active | past_due |
  read_only | cancelled | free), `trial_ends_at`, `paid_until`, `created_at`.
- Add `shop_id` (required, references `shops`) to every table: `users`, `vehicle_types`,
  `services`, `service_prices`, `customers`, `vehicles`, `jobs`, `job_events`, `job_services`,
  `expenses`, `coupons`, `referrals`, `app_settings`, `commission_rates`, `job_washers`,
  `job_sellers`, `attendance`, `cash_days`, `job_photos`, `vehicle_reminders`, `login_codes`,
  `app_errors` (nullable here, for platform-level errors).
- "Unique" becomes "unique within a shop":
  - `customers.phone` → unique per `(shop_id, phone)`
  - `vehicles.registration_number` → unique per `(shop_id, registration_number)`
  - `coupons.code` → unique per `(shop_id, code)`
  - `cash_days` key `date` → `(shop_id, date)`
  - `app_settings` key `key` → `(shop_id, key)`
  - The one-live-coupon-per-vehicle rule and other unique indexes gain `shop_id`.
- Every hot-path index starts with `shop_id` (e.g. `(shop_id, created_at)` for the Job Board),
  so one shop's queries never scan another's rows.
- Seed data becomes: shop `shop_mana` (MANA, free plan) with today's menu, prices and owner.
  Seed IDs like `svc_complete_wash` become per-shop generated IDs.

**Server:**

- The session token carries the shop (`orgId` claim → the real shop id).
- `requireAuth` loads the user **and their shop** on every request, rejects a token whose shop
  doesn't match the user's, and puts `shopId` on the request.
- **Enforced in one place:** routes stop calling `createDbClient(env.DB)` directly. Instead they
  get a shop-scoped client from the request, and every repository function requires a `shopId`
  — a query without a shop won't compile. Creating a record always stamps the shop.
- Checks on IDs sent by the app (a job ID, customer ID, staff ID in a picker) verify the record
  belongs to the same shop — otherwise treated as "not found".
- The public service / price / vehicle-type lists require sign-in.
- Per-shop settings: `google_review_url`, `errors_seen_at`, alert timers.

**App:**

- The offline cache and outbox are tied to the signed-in shop; signing into a different shop
  clears them (so no queued job can land in the wrong shop).

**Phase 1 status (built 26 Sep 2026):**

- `shops` and `platform_settings` tables; `shop_id` on all 22 other tables; per-shop uniques;
  composite foreign keys; indexes lead with `shop_id`. MANA is seed shop `shop_mana` (free plan).
- `packages/db/src/client.ts`: `createShopDb(d1, shopId)` (Prisma extension that filters and
  stamps every query) and `createPlatformDb(d1)` (unfiltered — only sign-in lookups, the
  "is this phone taken?" check, the nightly job and platform alerts use it).
- `requireAuth` checks the token's `shopId` against the user's shop and sets `c.get('db')`.
  Every route uses it; the service, price and vehicle-type lists now need sign-in.
- Photos stored under `shops/<shopId>/photos/…`; each shop's error log is its own; Discord
  alerts name the shop; the alert timer and recovery-code bookkeeping are platform settings.
- App: the signed-in user carries `shopId`; saved data is cleared when a different shop signs in
  on the phone. The upload queue was already per person (and one person = one shop).
- `cd apps/api && npm run test:isolation` — 51 checks, all passing.

Still open from this phase: the "plan" column isn't enforced yet (Phase 4).

**Done when:**

- A new **isolation test suite** creates Shop A and Shop B and, for **every** endpoint, proves
  Shop B's owner and staff get "not found" for Shop A's jobs, customers, vehicles, photos,
  expenses, coupons, team, reports and cash — and can't write into Shop A by sending A's IDs.
- MANA works end to end exactly as today (the existing test doc `testing/new-wash.md` passes).

### Phase 2 — Sign-up and onboarding

**Phase 2 status (sign-up and joining built 26 Sep 2026; starter menu and checklist still open):**

- Unknown number → "New here?" choice: **Start a new shop** or **I work at a shop**.
- New shop: WhatsApp code → PIN twice → your name, shop name, city (optional). The shop, owner and
  PIN are created together in the last step, so an app closed halfway leaves nothing behind.
  14-day trial starts then. Every shop gets a 6-digit **shop ID** (`shops.code`; MANA = 482193).
- Join a shop: shop ID → "Join MANA Car Wash, Hyderabad?" → WhatsApp code → name → waiting screen
  (saved on the phone; checks every 15 s and on reopening; can cancel). The owner sees
  "Waiting to join" in Team with a badge on More, approves or declines. Approval adds them as
  Staff; they then choose their own PIN. Requests expire after 7 days; one open request per
  number; at most 10 waiting per shop. The owner can still add staff directly.
- **Remove from team** (different from "Turn off access"): signs them out, keeps their name on
  past work, and frees the number (`users.removed_at`; phone is unique only among live users).
- Sign-up codes: 30 s resend wait and 5 an hour per number, plus 20 an hour per device (IP).
  Steps are linked by short signed tickets that can never be used as a session.
- `cd apps/api && npm run test:signup` — 49 checks, all passing.

- **New owner flow:** phone → WhatsApp code → set PIN → name + shop name + city → Job Board.
- Guard against spam sign-ups: WhatsApp code required, a limit on shops per phone, a limit on
  sign-ups per hour.
- **Starter menu template** copied into the new shop: generic vehicle types, services and prices
  (without MANA-specific names like "MANA Combo"). The owner edits them in Settings.
- A short first-run checklist on the Job Board: "Check your prices", "Add your staff",
  "Add your Google review link".
- **Existing phone rule:** for launch, one phone number belongs to one shop. If a number already
  exists, sign-up says so. (See open decision 2 for staff who work at two shops.)

**Done when:** a brand-new phone can sign up, create a shop, add staff and complete a wash, and
MANA sees none of it.

### Phase 3 — Each shop's own name and details

- Shop name comes from the `shops` row everywhere it's shown: WhatsApp messages to customers,
  PDF reports, the header, the review-link message. Remove the hardcoded `'MANA Car Wash'`.
- Owner can edit shop name, city and address from Settings.
- The product brand stays "MANA Car Wash Manager by Sprixia Labs" on the sign-in screen and
  About page.
- Later (not for launch): shop logo on PDF reports.

### Phase 4 — Plans and billing (₹2,000 a month)

- Plan states: **trial** (14 days) → **active** → **past_due** (7-day grace) → **read_only** →
  **cancelled** (data deleted after 90 days, after an export offer). MANA is **free**.
- The server checks the plan on every request: read-only shops can view and export but not
  create jobs, expenses, or change money.
- **Payments with Razorpay Subscriptions** (UPI autopay, cards). Razorpay tells our server when a
  payment succeeds or fails (a "webhook"), which moves the shop between plan states. GST invoices
  (18%) come from Razorpay.
- **Play Store note:** Google has rules about taking subscription payments inside an app. The
  safer launch path is paying on a Sprixia web page (the app just shows "Pay ₹2,000" and opens
  it), then checking Google's current policy for India before adding any in-app buy button.
- In the app: owner sees plan, next due date and a **Pay now** button in More → Subscription;
  staff never see billing.

**Done when:** a test payment in Razorpay's test mode activates a shop, a failed payment moves it
to past_due and then read-only on schedule.

### Phase 5 — Sprixia admin panel (for us, not shops)

A small, separate web page (or a hidden admin role), signed in only by Sprixia staff:

- List of shops: name, city, owner phone, plan, paid until, last active, jobs this month.
- Actions: extend trial, mark paid manually (cash/bank transfer), move to free plan, disable a
  shop, **reset owner PIN** after a verification call (replaces the server-wide recovery code).
- Monthly revenue and active-shop count.
- Every admin action is logged (who, what, when) — shops' data is not ours to browse.

### Phase 6 — Running many shops safely

- **Photos:** stored under `shops/<shopId>/photos/...` in R2; access checked against the
  signed-in shop.
- **Nightly job:** runs per shop (photo cleanup respects each shop), backup covers all shops,
  and a single shop's data can be exported on request.
- **Error log:** each shop's owner sees their own shop's errors; Sprixia's Discord alerts get
  all errors tagged with the shop name.
- **Rate limits per shop** so one misbehaving phone can't overload the server for everyone.
- **WhatsApp codes** go out from Sprixia's own WhatsApp Business number, using an approved
  "MANA Car Wash Manager" authentication template.

### Phase 7 — Launch readiness

- Play Store listing under Sprixia Labs Private Limited: screenshots, description, category.
- **Privacy policy and Terms of Service** on a Sprixia website. Under India's DPDP Act 2023,
  each shop owns its customers' data and Sprixia processes it on their behalf — the terms must
  say so, and we need a working "export my data" and "delete my shop" path.
- Support channel: a Sprixia WhatsApp number and email shown in More → Help.
- A pricing page and a simple landing page.

---

## Part 5 — Decisions (agreed 26 Sep 2026)

1. **Option B** — one shared database, every row stamped with its shop.
2. **Staff: one phone number = one shop.** Staff working at two shops comes later.
3. **Each branch is its own shop** at ₹2,000. *(Built 2 Oct 2026.)* An owner opens another branch
   from More → Shop and switches with the shop pill above the greeting on the home screen. They
   have one user row per shop with the same phone and PIN; sign-in checks the first row and opens
   the branch the phone used last. A number live in two shops must be the owner in both (API +
   `trg_users_phone_*` triggers), and co-owners can't reset a multi-shop owner's PIN or demote
   them. Still to come: an "All shops" combined report.
4. **14-day free trial.**
5. **₹2,000 + GST, monthly.** Yearly discount later.
6. **Read-only after a 7-day grace period** when unpaid — view and export, no new washes.
7. **Delete a cancelled shop's data after 90 days**, with an export offered first.
8. **Sprixia admin is a separate small website**, not a hidden role in the app.

---

## Part 6 — Risks and how we handle them

| Risk | How it's handled |
| --- | --- |
| One shop sees another's data | Shop-scoped database client, required `shopId` in every repository, isolation test suite on every endpoint |
| Wrong shop after switching phones | Offline cache and outbox cleared when the signed-in shop changes |
| Fake sign-ups / spam | WhatsApp code required, per-phone and per-hour limits, per-IP rate limits on every sign-in route |
| Payment disputes | Razorpay webhooks as the source of truth, admin can mark paid manually, every plan change logged |
| Database size ceiling | Shop-first indexes, paged backups and history; move the largest shops to their own database later |
| Data protection law | Privacy policy, processor terms, export and delete paths before launch |
| Changing live data | Numbered migrations only (`db:migrate:remote`), no remote reset; `db:check` in CI keeps `schema.sql` honest; staging first |
| Losing the database | D1 Time Travel (30 days), then the nightly per-table backups in their own bucket, restored with `npm run backup:restore` |

---

## Suggested order

1. Decide Part 5, questions 1–3.
2. Phase 1 (foundation + isolation tests) — the big one.
3. Phase 2 (sign-up) and Phase 3 (shop name) together.
4. Phase 4 (billing) and Phase 5 (admin) together.
5. Phase 6 and Phase 7, then launch with MANA as shop #1 and a few friendly shops on free trials.
