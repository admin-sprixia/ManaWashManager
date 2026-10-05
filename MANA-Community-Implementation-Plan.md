# MANA — Communities: Implementation Plan

How [MANA-Community-Service-Plan.md](MANA-Community-Service-Plan.md) (the *what*) gets built
in this codebase (the *how*): milestone by milestone, with the database tables, business rules,
API routes, app screens, offline behaviour, tests and release for each.

**Status:** draft for approval. Nothing here is built yet.

---

## Part 1 — Decisions this plan makes

### 1.1 Communities belong to a hub (shop) in the pilot

Today every row carries `shopId` and `packages/db/src/client.ts` filters every query to the
signed-in shop, so one shop can never read another's data. Customers are unique **per shop**
(`@@unique([shopId, phone])`), and an owner's branches are separate shops linked by the owner's
phone.

The service plan describes a *business* above hubs that shares customers and communities
across branches. Building that first would change the scoping of every table at once — the
riskiest possible change, for a pilot with one hub. So:

- **Pilot:** a community, its homes, members, plans, subscriptions, visits and technicians all
  belong to **one hub** (`shopId`), protected by the same automatic scoping as everything today.
  New tables get it for free.
- **Prepared now:** a `businessId` on `shops` (milestone 0), so branches of one company are
  grouped from the start, for combined reports and the plan check.
- **Later (Phase 2, "Shared across branches"):** a community served by another branch, and one
  customer record across branches. Designed when the second branch is real.

Nothing the pilot builds has to be thrown away for that step: the IDs stay, and sharing is added
as links.

### 1.2 Decisions (agreed 4 Oct 2026; the numbers are settings)

| Topic | Decision |
|---|---|
| Who adds residents | Owners, managers and staff (business owner, branch owner, manager, staff) |
| Customer app sign-in | Only phone numbers the team added; anyone else gets **Request service** (approve/reject in the staff app after a call or visit) |
| Who can request service | Anyone: apartment residents, individual houses, 2–4 flat buildings, offices, places MANA hasn't talked to; starting prices shown first |
| Service area | Per branch: radius from the hub (map pin) + backup list of areas; outside → "not in your area yet", saved as demand with the location |
| Individual houses | Accepted; grouped as a "Nearby homes – <area>" community; manager sets the price; minimum vehicles is a guide |
| Confirmation | WhatsApp code; the fixed test code `000000` until a real WhatsApp number is connected |
| Messages | Saved to the customer's message history; actually sent once WhatsApp is connected |
| Skip cut-off | 8 pm the evening before (`communities.skipCutoff`) |
| Car not there / skipped | Postponed to the next wash day, up to **2 per plan month** (`communities.postponesPerMonth`); then counts as used; postponed washes stay within the month |
| Car wash's side (water, access, weather, equipment, absence) | Always postponed, no limit |
| Branch code | `MCW-<city>-<0001>` per city, e.g. MCW-KVL-0001; suggested, editable before saving, then permanent |
| Receipt numbers | `<branch code>/<FY>/<00001>`, e.g. MCW-KVL-0001/26-27/00001; per branch, restart each April |
| Owners | Business owner (all branches; adds branches and branch owners) and branch owner (only their branches) |
| Customers | Belong to one branch in the pilot |
| Wash days | Set per community; staff can move one vehicle to another day |
| Smallest community | Warning (not a block) below 3 vehicles per wash day |
| Payments | "Recorded" provider (UPI/cash confirmed by staff); Razorpay later |
| Customer app | One **MANA Car Wash** app for every branch; community QR and invite links |
| Communities on/off | A per-branch setting (`communities.enabled`) |
| Technicians | A user role; employment type is a profile field, no pay rules in the pilot |
| GST | None; residents get numbered receipts |

### 1.3 MANA is the car wash's own app (decided 4 Oct 2026)

MANA Wash Manager is no longer sold to other car washes. What that means for the code:

- **Kept:** the multi-shop foundation (each branch is a shop; data stays apart per shop), the
  isolation tests, and the billing code (dormant, not deleted).
- **Closed:** public sign-up. A platform setting `signup.open` (default **off** in production and
  staging; **on** in local dev and CI so `test:signup` and `test:plans` keep guarding that code)
  makes starting a new shop answer "Sign-up is closed". Staff asking to join a shop with its
  6-digit shop ID still works. The business owner adds branches from the app
  (**Add branch**, business-owner only). The very first shop on an empty production database is
  created once with a setup script (`scripts/create-house-shop.mjs`, run with approval).
- **Hidden:** the Plan screen, plan banners and upgrade prompts, for shops marked `house` (a new
  `shops.house` flag set on MANA's own shops). House shops always read as full Pro, with no trial,
  limits or seat locks.

### 1.4 Conventions kept from today

- **Migrations:** `apps/api/migrations/00NN_<name>.sql`, mirrored in `apps/api/schema.sql` and
  `packages/db/prisma/schema.prisma`; `npm run db:check` proves the three match.
- **Ids from the phone** (text ids made on the device) for anything created offline, so a
  retried sync never creates two rows — exactly like jobs today.
- **Money in paise, times in UTC, dates for IST days** (`lib/istDate.ts`).
- **Business rules in `packages/domain`** as pure functions with unit tests; **queries in
  `packages/db/src/repositories`**; **routes in `apps/api/src/routes`** with zod validation;
  **screens in `apps/manager/src/screens`**; offline writes through the outbox
  (`apps/manager/src/offline/dispatch.ts`).
- **D1 limits:** at most 100 bound parameters per statement, so bulk inserts (visits) are chunked;
  every list endpoint is paginated.
- **Speed:** each database round trip is ~165 ms from the Chennai Worker, so screens show
  results at once and save in the background; heavy work (visit planning) runs in the nightly
  job (`apps/api/src/scheduled.ts`, cron `30 21 * * *` = 3:00 am IST).
- **Each milestone ships as a minor version** (`npm run version:set`), with a CHANGELOG entry,
  green CI, staging deploy and seed, and a check on the tablet.

---

## Part 2 — Milestones at a glance

| # | Milestone | Version | Gives the car wash | Rough effort |
|---|---|---|---|---|
| 0 | Groundwork: sign-up closed, branches, owners, roles, audit, switch | 0.6.0 | Add branch with branch codes; business and branch owners; manager and technician roles; Communities on/off; no plan screens | 1.5 weeks |
| 1 | Communities and layouts | 0.7.0 | Communities icon, flexible layouts, homes, parking, QR | 2 weeks |
| 2 | Members, enrolment, service requests | 0.8.0 | Add residents (code), add hub customers, approve service requests (any home type), demand list and map | 2 weeks |
| 3 | Community services and plans | 0.9.0 | Plans, per-community prices, add-ons | 1 week |
| 4 | Subscriptions and recorded payments | 0.10.0 | Sell, pause, renew, cancel; receipts | 2 weeks |
| 5 | Scheduler and batches | 0.11.0 | Nightly visits, community batches, assignment | 1.5 weeks |
| 6 | Technician mode | 0.12.0 | The technician's offline day | 2.5 weeks |
| 7 | Notifications | 0.13.0 | A message at every step (saved now; sent once WhatsApp is connected) | 1 week |
| 8 | Complaints, incidents, hub leads | 0.14.0 | Rewash, credit, refund; leads to the hub | 1.5 weeks |
| 9 | Customer app | 0.15.0 | Residents subscribe and follow their washes | 4 weeks |
| 10 | Receipts and the community dashboard | 0.16.0 | Numbered receipts, MRR, per-community reports | 1.5 weeks |
| — | **Pilot launch** | **1.0.0** | One hub, one kit, one technician, a few communities | — |

The pilot can start operating after milestone 6 (staff enrol residents and take payment; the
technician works offline). WhatsApp stays on the test code and saved messages until a real number
is connected; nothing waits on it. The customer app (9) can start in parallel once milestone 4's
APIs exist.

---

## Part 3 — Milestones in detail

### Milestone 0 — Groundwork (0.6.0)

**Why first:** every later screen asks "may this person do this?", every money change needs an
audit row, the whole feature hides behind one switch, sign-up has to close (Part 1.3), and
branches need their codes before anything (receipts, messages) prints them.

**Order inside the milestone:** (1) close sign-up + Add branch + branch codes, (2) house shops,
(3) business grouping and owners, (4) roles, (5) audit log, (6) Communities switch.

**Database** (`0006_groundwork.sql`)

- `shops.business_id` (text, defaults to the shop's own id; a branch the owner adds gets the
  same id). Index.
- `shops.branch_code` (text, unique): `MCW-<AAA>-<0000>`, e.g. `MCW-KVL-0001`. Existing shops get
  one in the migration (city letters from `shops.city`, numbered per city by creation date).
- `shops.city_code` (3 letters) — kept with the shop so the next number per city is easy to find.
- `shops.house` (bool) — MANA's own shops: always full plan, no billing screens.
- `platform_settings` key `signup.open` (`false` in production and staging).
- `users.role`: add `manager` and `technician` to `owner` and `staff`. An `owner` row is a
  **branch owner**: full control of that one shop (people already have one row per shop).
- `business_owners`: business_id, phone, added_at — the **business owner(s)**: owner of every
  branch of the business, the only people who can add branches, add or remove branch owners, and
  see combined reports. Adding a branch gives every business owner an owner row in it.
- `audit_events`: id, shop_id, actor_id, action (e.g. `subscription.cancel`), subject_type,
  subject_id, before (JSON text), after (JSON text), at. Index `(shop_id, subject_type,
  subject_id)` and `(shop_id, at)`.
- `app_settings` keys (existing table): `communities.enabled` (false until the owner turns it on
  for the branch), `communities.skipCutoff` (`20:00`), `communities.postponesPerMonth` (2),
  `communities.minVehicles` (3).

**Domain** (`packages/domain/src/permissions.ts`)

- `type Role = 'owner' | 'manager' | 'staff' | 'technician'`.
- `can(role, permission, settings)` for permissions: `communities.view`,
  `communities.manage`, `members.enrol`, `plans.manage`, `subscriptions.sell`,
  `subscriptions.manage`, `payments.record`, `schedule.manage`, `visits.work`,
  `complaints.manage`, `reports.view`. Unit tests for every role × permission.
- `planStatus` treats `house` shops as full Pro forever (unit tested).
- `packages/domain/src/branches.ts`: `formatBranchCode(cityCode, n)` → `MCW-KVL-0001`,
  `isBranchCode`, `nextBranchNumber(existingCodes, cityCode)`, `cityCodeFrom(cityName)`
  (suggestion only: first three consonant-led letters, upper case; always editable). Unit tested.

**API**

- `middleware/auth.ts`: `requirePermission(p)` next to `requireRole('owner')`; the session
  carries the new roles. Existing `requireRole('owner')` routes keep working (owner has every
  permission).
- `lib/audit.ts`: `audit(db, actor, action, subject, before, after)` — written in the same
  database batch as the change it records.
- `/team`: create and edit people with the new roles; technicians can't open hub money screens.
- `requireCommunities` middleware on every community route: 404-style "not switched on" when the
  hub's `communities.enabled` is off.
- Starting a new shop (`/signup/code` and `/signup/verify` for sign-up, `/signup/shop`) refuses
  with `signup_closed` unless `signup.open` is on; `/auth/start` for an unknown phone returns
  `signupOpen: false` and the app goes straight to "Join your shop". **(Done.)**
- `POST /branches` (business owner only): name, city, city code and branch code (suggested by
  `GET /branches/suggest-code?city=`), copies the business's service menu and settings; every
  business owner gets an owner row in the new branch. `GET /branches` lists the business's
  branches with codes.
- `POST /team/branch-owner`, `DELETE /team/branch-owner/:id` (business owner only).

**App**

- **Add branch** (shop switcher, business owner only): name, city, branch code pre-filled
  (editable until saved). Shop switcher and Settings show "Kavali (MCW-KVL-0001)".
- Team screen: role picker (Branch owner, Manager, Staff, Technician); only a business owner can
  pick Branch owner or remove one. A branch owner's shop switcher
  shows only their branches; "Add branch" and combined reports are business-owner only.
- Tests (`test:isolation`): a branch owner of Kavali can't see or switch to Nellore, can't add a
  branch, and can't remove the business owner.
- A technician who signs in lands on a placeholder "Today" screen (filled in milestone 6) instead
  of the job board.
- Settings → **Communities** switch; the Communities icon is hidden when it's off.
- Login: "Start free trial" and shop sign-up removed when sign-up is closed (the server says
  so); Plan screen, plan banners and upgrade prompts hidden for house shops.
- Staging and production: MANA's shops marked `house` (a one-line SQL, run with approval).

**Tests**

- Domain: permissions matrix.
- `test:isolation` extended: a technician can't read cash, reports or the team list.
- New `scripts/branch-check.mjs` (`npm run test:branches`, in CI): add branch (business owner
  only); suggested codes per city (`MCW-NLR-0001`, `MCW-NLR-0002`, `MCW-KVL-0001`); duplicate
  code refused; code can't change after saving; menu copied; branch owner sees only their branch.
- `db:check` with the new migration.
- `test:signup` gains: sign-up refused when `signup.open` is off; works when on (CI turns it on).
- `test:plans` gains: a house shop is never limited, never sees trial or seat locks.

**Done when:** nobody new can create a shop, the business owner can add a branch with its code,
branch owners see only their branch, roles work end to end, audit rows appear for team changes,
MANA's shops never see plan screens, and nothing else behaves differently for owners and staff.

---

### Milestone 1 — Communities and layouts (0.7.0)

**Database** (`0007_communities.sql`)

- `service_zones`: id, shop_id, name, active, sort_order.
- `shops`: add `latitude?`, `longitude?` (the hub), `service_radius_km?` (empty = no radius, only
  the area list).
- `service_areas`: id, shop_id, name ("Kovur"), pincode?, active. The backup when a customer
  doesn't share a location; also what the owner reads as "where we work".
- `communities`: id, shop_id, zone_id?, name, kind (`apartment` | `villas` | `layout` |
  `houses` | `nearby_homes` | `other`), address, latitude?, longitude?, status (`demand` | `prospect` |
  `active` | `paused` | `closed`), wash_days (text, e.g. `tue,fri`), hours_from, hours_to,
  entry_notes, security_notes, technician_notes, permission (`none` | `verbal` | `letter` |
  `agreement`), permission_from?, permission_to?, approx_vehicles?, created_at, updated_at,
  archived_at?. Unique `(shop_id, name)` among non-archived. Index `(shop_id, status)`.
- `community_facilities`: community_id (PK), water (bool), water_point, water_photo_key,
  tap_type, water_limits, washing_spot, drainage, power (bool), power_allowed (bool).
- `community_contacts`: id, shop_id, community_id, name, role, phone, email, notes.
- `community_places`: id, shop_id, community_id, parent_id?, kind (free text: "Tower"),
  name ("B"), sort_order, archived_at?. Index `(community_id, parent_id)`.
- `homes`: id, shop_id, community_id, place_id?, kind (free text: "Flat"), number ("1204"),
  address? (for houses), notes, archived_at?. Unique `(community_id, place_id, number)` among
  non-archived. Index `(community_id)`.
- `parking_spots`: id, shop_id, community_id, place_id?, slot?, landmark?, photo_key?.
- `community_documents`: id, shop_id, community_id, kind, file_key, uploaded_by, at.

**Domain** (`packages/domain/src/communities.ts`)

- Layout tree: `buildTree(places)`, `pathOf(placeId)` ("Phase 2 › Block C › Tower 4"),
  `canMove(place, newParent)` (no cycles), maximum depth 8, names trimmed and unique among
  siblings.
- Quick-setup templates (`apartmentWithTowers(count)`, `singleBuilding()`, `blocksAndTowers`,
  `villas(phases|streets)`, `fewHouses()`, `empty()`) → the places and suggested home kind they
  create. Pure; unit tested.
- `parseWashDays('tue,fri')`, `nextWashDays(community, from, count)`.
- Home labels: `homeLabel(home, path)` → "Tower B · Flat 1204", "House 3-45, Gandhi Street".
- Community status transitions (which moves are allowed).
- Service area (`packages/domain/src/serviceArea.ts`): `distanceKm(a, b)` (haversine),
  `branchFor(pin | area, branches)` → the nearest branch whose radius contains the pin, else the
  branch listing the area, else none (out of area). Unit tested at the radius edge and with
  overlapping branches.

**API** (`routes/community.ts`, all behind `requireCommunities`)

- `GET /communities` (list with counts: homes, members, vehicles; filter by status, zone).
- `POST /communities` (with optional quick-setup template), `PATCH /communities/:id`,
  `POST /communities/:id/status`.
- `GET /communities/:id` (everything for the community page in one response: details,
  facilities, contacts, layout tree, counts).
- Layout: `POST /communities/:id/places`, `PATCH /places/:id` (rename, move, reorder),
  `DELETE /places/:id` (only when empty, else archive).
- Homes: `POST /communities/:id/homes` (single or bulk: "Flats 101–110 in Tower A"),
  `PATCH /homes/:id`, `DELETE /homes/:id` (archive when it has history).
- Parking: `POST/PATCH/DELETE /parking-spots`.
- Facilities, contacts, documents: `PUT /communities/:id/facilities`, contacts CRUD,
  `POST /communities/:id/documents` (to the `PHOTOS` bucket under `communities/`).
- Zones: `GET/POST/PATCH /zones`.
- Service area (owner): `GET/PUT /shop/service-area` (hub location, radius) and
  `GET/POST/PATCH /service-areas`.
- `GET /communities/:id/qr` → the invite link (`https://…/join/<shopCode>/<communityId>`)
  for the poster; the image is drawn on the phone.
- Every change writes `audit_events`.

**App**

- **Header:** a Communities icon (group of buildings, new `IconCommunities` in
  `components/Icons.tsx`) between Reports and More; shown when the plan has `communities` and the
  person has `communities.view`.
- **CommunitiesScreen:** list with status chips, counts, search; "Add community".
- **AddCommunitySheet:** name, type, address (+ "use my location"), quick-setup shape with a
  live preview of what it creates.
- **CommunityScreen** (tabs): *Overview* (status, wash days, hours, permission, notes),
  *Layout* (the tree: add level with any name, add homes in bulk, rename, drag to reorder, move),
  *Facilities* (water, power, photos), *Contacts*, *Documents*, *QR poster* (share or print).
- **Settings → Service area** (owner): hub location ("use my location" at the hub), radius in
  km, and the list of areas.
- **Pickers reused later:** `PlacePicker` (walk the tree or type a path) and `HomePicker`
  (pick, or type "Tower B, 1204" and create it on the spot).
- Reads cached for offline viewing (communities rarely change).

**Tests**

- Domain: tree, templates, moves, labels, wash days.
- New `scripts/community-check.mjs` (`npm run test:communities`, in CI): every quick-setup shape;
  a community with no levels; a 4-deep layout; bulk homes; rename and move keep homes; delete
  vs archive; status rules; a hub with Communities off is refused; staff without permission get
  403.
- `test:isolation`: shop B can't read or change shop A's communities, places, homes, spots or
  documents.

**Seed:** Prestige Lakeside (towers A–C, basement parking), Green Meadows (villas, two phases),
Gandhi Street houses (4 houses, no levels), Nearby homes – Kovur (individual houses), Sunrise
Towers (status *demand*); the hub's location, an 8 km radius and areas Nellore and Kovur.

**Done when:** a community of any shape can be entered and edited on the tablet in a few minutes.

---

### Milestone 2 — Members and enrolment (0.8.0)

**Database** (`0008_members.sql`)

- `customers`: add `email?`, `preferences?` (JSON text).
- `vehicles`: add `category` (copied from the type for quick filters), `colour?`, `variant?`,
  `home_id?`, `parking_spot_id?`, `photo_key?`, `instructions?`.
- `memberships`: id (from the phone), shop_id, customer_id, home_id, status
  (`unconfirmed` | `member` | `left`), joined_via (`staff_code` | `service_request` |
  `from_demand`), enrolled_by?, confirmed_at?, consent_text_version, left_at?, created_at.
  Unique `(home_id, customer_id)` among not-left. Index `(shop_id, customer_id)`.
- `join_codes`: id, shop_id, phone, membership_id, code_hash, attempts, expires_at,
  consumed_at. (Same hashing and lockout as `login_codes`.)
- `community_demand`: id, shop_id, community_id (a *demand* community, created if new),
  name?, phone, vehicles (JSON text), place_text?, latitude?, longitude?, out_of_area (bool),
  consent_at, source (`app` | `staff` | `hub_pay_screen`), converted_membership_id?,
  created_at. Unique `(community_id, phone)`.
- `service_requests`: id, shop_id (the branch from `branchFor`; when out of area, the nearest
  branch, so the business owner sees it), phone, name, latitude?, longitude?, area_id?,
  address, place_kind (`apartment` | `house` | `small_building` | `office` | `other`),
  community_id? and home_text? (when they picked a served community), vehicles (JSON text:
  cars, bikes, counts), preferred_time?, status (`pending` | `approved` | `rejected` |
  `out_of_area`), handled_by?, handled_at?, reason?, membership_id? (after approval),
  created_at. Unique `(phone)` among pending. Requests for places not served, and every
  out-of-area request, also count as demand.
  (Created by the customer app in milestone 9; staff can also log one from a phone call now.)

**Domain** (`packages/domain/src/members.ts`)

- Consent text and version (shown on screen and in the WhatsApp message).
- `membershipStatusAfter(event)`; service request transitions (pending → approved | rejected;
  out_of_area → pending when a branch's area grows to include it).
- Duplicate rules: one customer per phone per shop (existing); plate already on another
  customer → `plate_conflict` with the owner's name for the prompt.

**API** (`routes/member.ts`)

- `POST /members/start` `{ communityId, phone }` → finds the customer (existing or new), creates
  an *unconfirmed* membership, sends the WhatsApp code via `lib/loginCode.ts`'s sender,
  rate-limited per phone and per shop. Until a real WhatsApp number is connected, no message is
  sent and the fixed test code `000000` is accepted (as staging sign-in works today).
- `POST /members/:id/confirm` `{ code }` → *member*; records consent and who enrolled.
- `POST /members/:id/details` → name, home (existing id, or a typed path that creates the
  place and home), vehicles (new or existing, with parking spot and photo).
- `POST /members/:id/leave`, `POST /vehicles/:id/move` (new home/spot; future visits follow from
  milestone 5).
- `GET /communities/:id/members` (paginated, by place), `GET /customers/:id/memberships`.
- Demand: `POST /demand`, `GET /demand` (grouped by community with counts),
  `POST /communities/:id/launch` (status → active, demand → unconfirmed members, launch message
  queued for milestone 7).
- Service requests: `GET /service-requests` (pending first; filter by status and place kind),
  `POST /service-requests` (staff log one from a phone call), `PATCH /service-requests/:id`
  (notes from the call or visit), `POST /service-requests/:id/approve` `{ into: existing
  community + home | new community | nearby homes of an area }` (creates the customer, home and
  vehicles from the request — staff can correct them — and a *member* membership; "nearby
  homes" finds or creates the `nearby_homes` community for that area; the request's own sign-in
  code proved the phone), `POST /service-requests/:id/reject` `{ reason? }`.
- Demand map: `GET /demand?view=map` (pins of demand and out-of-area requests, business owner
  sees every branch's).
- Customer directory (`/customers/directory`) gains home and community, so New Wash and the
  technician can look people up offline.

**App**

- **Add customer** (from a community, or the global Communities screen): phone → code → details
  (home picker, vehicles with plate, make, model, colour, photo, parking spot + photo) → "Offer a
  plan" (enabled in milestone 4) or "Done".
- Existing customer found by phone or plate: their vehicles shown with checkboxes; plate
  conflict prompt.
- **Customer profile** (existing screen): Homes and communities section; "Add to community".
- **Hub pay screen:** "Lives in a community?" chip → pick community (or type a new place →
  demand).
- **Members tab** on CommunityScreen (by place, search, unconfirmed filter, resend code).
- **Requests** (Communities screen, with a count badge): each request's details, map pin,
  "Call" and "Directions" buttons, notes; Approve (into an existing community, a new one, or
  Nearby homes – area) or Reject (with reason). "Log a request" for phone enquiries.
- **Demand** (Communities screen): list (places by interested count; launch) and map
  (including out-of-area pins).
- Enrolment works on a weak signal: details are queued in the outbox (`member.details`) after the
  code is confirmed (the code itself needs a connection).

**Tests**

- New `scripts/member-check.mjs` (`npm run test:members`, in CI): new customer with code; wrong
  code lockout; existing customer added without retyping; plate conflict; typed path creates
  place and home; leave and re-join; demand grouping and launch; owner, manager and staff can
  enrol, technician can't; service request approved into each of the three places (member
  created) and rejected; out-of-area request lands on the nearest branch as demand; codes
  rate-limited.
- `test:isolation`: memberships, demand and codes per shop.
- `test:races`: two phones confirming the same membership; two enrolments of the same phone at
  once → one customer.

**Done when:** a resident can be signed up at the gate in under two minutes, with consent recorded.

---

### Milestone 3 — Community services and plans (0.9.0)

**Database** (`0009_plans.sql`)

- `services`: add `channel` (`hub` | `community` | `both`, default `hub` so nothing changes),
  `before_photo` (`off` | `optional` | `required`), `after_photo`.
- `service_durations`: service_id, vehicle_type_id, minutes.
- `subscription_plans`: id, shop_id, name, description, vehicle_category (`car` | `bike` |
  `both`), washes_per_cycle, cycle_unit (`week` | `month`), cycle_length (e.g. 1),
  pattern (`wash_days` | `n_per_cycle`), pause_allowed, max_pause_days,
  postpones_per_cycle? (empty = the branch setting, default 2), refund_rule (`none` |
  `unused_pro_rata`),
  unpaid_grace_days, tax_rate_bp (basis points, 0 = none), active, sort_order, created_at.
- `subscription_plan_services`: plan_id, service_id (what each wash includes).
- `plan_prices`: id, shop_id, plan_id, vehicle_type_id, community_id? (null = everywhere),
  price_paise, valid_from?, valid_to? (promotions). Index `(plan_id, vehicle_type_id,
  community_id)`.
- `add_ons`: service_id + price per vehicle type (reuses `service_prices` with the
  `community` channel).

**Domain** (`packages/domain/src/plans.ts` — rename today's billing `plans.ts` to `mana-plans.ts`
first, to keep "MANA plans" and "subscription plans" apart)

- `priceFor(plan, vehicleType, community, date)` — community price beats general price;
  promotions by date; never hardcoded.
- `cycleWindow(start, unit, length)`; `washesInCycle(plan)`; tax maths (`taxFor(price,
  rateBp)`, rounding rules).
- Validation: a plan needs at least one community service; washes per cycle 1–60.

**API:** `routes/plan.ts` — CRUD for subscription plans, plan services, prices (with community
overrides and promotion dates), durations, service channel and photo rules; `GET /plans/for
?vehicleId=` (what this vehicle can buy, at its community's price).

**App:** Settings → **Community services** (channel, durations, photo rules) and **Plans**
(list, editor with live "what the customer pays" preview per vehicle type and community).

**Tests:** domain price and cycle tests; `scripts/plan-catalogue-check.mjs` folded into
`test:communities`: overrides, promotions, inactive plans hidden, Communities off refused.

**Done when:** the owner can set up any plan shape without a code change.

---

### Milestone 4 — Subscriptions and recorded payments (0.10.0)

**Database** (`0010_subscriptions.sql`)

- `subscriptions`: id (from the phone), shop_id, customer_id, plan_id, **snapshot** (JSON text:
  plan name, services, washes per cycle, rules, price, tax — copied at sale), status
  (`pending_payment` | `active` | `paused` | `cancelled` | `ended`), starts_on, ends_on?,
  auto_renew, current_cycle_id?, sold_by, created_at, cancelled_at?, cancel_reason?.
- `subscription_vehicles`: subscription_id, vehicle_id. Unique `(vehicle_id)` among active
  subscriptions of the same plan.
- `subscription_cycles`: id, shop_id, subscription_id, starts_on, ends_on, washes_allowed,
  used, postpones_allowed (copied from the plan or branch setting), postpones_used,
  postpones_given (goodwill, by hand), missed_customer, missed_us, status (`unpaid` | `paid` |
  `waived`), payment_id?. Unique `(subscription_id, starts_on)`.
- `subscription_pauses`: id, subscription_id, from_on, to_on, reason, by.
- `payment_providers` (per shop): kind (`recorded` | `razorpay`), active, config (JSON text).
- `customer_payments`: id (from the phone), shop_id, customer_id, amount_paise, method
  (`upi` | `cash` | `card` | `link`), provider, provider_ref?, status (`pending` | `confirmed` |
  `failed` | `refunded`), for_type (`cycle` | `booking` | `add_on`), for_id, recorded_by,
  confirmed_by?, at.
- `customer_credits`: id, shop_id, customer_id, amount_paise (±), reason, ref_type, ref_id, by,
  at (a ledger; balance = sum).

**Domain** (`packages/domain/src/subscriptions.ts`)

- State machine: allowed transitions and their side effects (pause moves `ends_on`; cancel
  releases future visits; renew opens the next cycle).
- Cycle accounting: `openCycle(snapshot)` (every month starts clean — nothing carries over),
  `remaining(cycle)`, `onVisitOutcome(cycle, outcome)` → `used` | `postpone` | `postpone_free`:
  customer missed or skipped → postpone while `postpones_used < postpones_allowed +
  postpones_given`, else used; car wash's side → always `postpone_free`; a postponed wash that
  can't fit before the cycle ends is used. The rule table from the service plan §7.2–7.3, fully
  unit tested (last postpone warning, month end, goodwill postpone).
- Refund maths (`unused_pro_rata`), unpaid grace.

**API**

- `lib/payments/`: `PaymentProvider` interface (`createCharge`, `confirm`, `refund`,
  `webhook?`); `recorded.ts` now; `razorpay.ts` later reusing `lib/razorpay.ts`.
- `routes/subscription.ts`: `POST /subscriptions` (sell: plan, vehicles, start date; creates the
  first cycle `unpaid`), `POST /subscriptions/:id/pay` (record UPI/cash → `confirmed` by a
  person with `payments.record` → cycle `paid`, subscription `active`), `pause`, `resume`,
  `cancel` (refund per rule, into credit or as a refund record), `renew`, `PATCH` (auto-renew,
  vehicles), `GET /subscriptions` (filters: community, status, due), `GET
  /customers/:id/subscriptions`, credits ledger.
- Nightly job: open the next cycle for auto-renewing subscriptions; mark overdue cycles; stop
  after the grace period.
- Every action audited; money changes are reversible entries, never edits.

**App**

- "Offer a plan" step at the end of enrolment; **Sell plan** from a customer's page.
- **Subscription screen:** status, cycle (used / left / postpones left), next washes, payments,
  "Give an extra postpone" (owner or manager), pause
  (date range), resume, cancel (shows refund or credit first), renew.
- **Payments due** list (Communities screen): unpaid cycles, record payment.
- Outbox ops: `subscription.sell`, `subscription.pay` (ids from the phone, safe to retry).

**Tests:** domain state machine and accounting; new `scripts/subscription-check.mjs`
(`npm run test:subscriptions`, in CI): sell → pay → active; price snapshot survives a plan price
change; pause moves end; cancel refunds per rule; renew starts a clean month; 2 postpones then
used; car wash's side never counts; goodwill postpone; unpaid grace; replayed
payment doesn't double; staff without permission refused. `test:races`: two payments recorded at
once for one cycle → one confirmed. `test:isolation` for all new tables.

**Done when:** a member can be sold a plan and paid up, and every rupee is traceable.

---

### Milestone 5 — Scheduler and batches (0.11.0)

**Database** (`0011_visits.sql`)

- `community_batches`: id, shop_id, community_id, date (IST day), status (`planned` |
  `in_progress` | `done`), technician_id?, started_at?, finished_at?, planned_minutes,
  counts (JSON text). Unique `(community_id, date)`.
- `service_visits`: id, shop_id, batch_id, subscription_id?, cycle_id?, vehicle_id, date,
  services (JSON text snapshot), status (`scheduled` | `in_progress` | `done` |
  `customer_missed` | `we_missed` | `skipped` | `cancelled`), reason?, sort_key (from layout and
  parking), technician_id?, started_at?, finished_at?, redo_of?, created_at, updated_at.
  Unique `(vehicle_id, date, subscription_id)`. Index `(batch_id, sort_key)`,
  `(shop_id, date, status)`.
- `visit_events`: id, shop_id, visit_id, from, to, reason?, by, at, client_at.

**Domain** (`packages/domain/src/schedule.ts`)

- `planVisits({ subscriptions, communities, existingVisits, from, days: 14 })` → visits to
  create and to cancel: wash-days pattern, N-per-cycle spread across wash days, paused ranges,
  cycle allowance, vehicles moved to another community, a community paused or closed. Pure and
  deterministic; heavily unit tested (month ends, leap years, pauses across cycles, wash days
  changed).
- `sortKey(home path, parking spot)`; `plannedMinutes(visits, durations)`.
- Small-cluster grouping: communities in the same zone with the same wash day are listed
  together; warning when below `minVehicles`.

**API**

- Nightly job (`scheduled.ts`): for each shop with `communities`, run `planVisits` and write
  visits and batches in chunks (D1's 100-parameter limit), idempotent (unique keys) so a re-run
  changes nothing. Logged to the error log on failure.
- `POST /schedule/run` (owner: re-plan now, after changing wash days).
- `GET /schedule?from&to` (calendar: batches per day with counts and minutes),
  `GET /batches/:id`, `POST /batches/:id/assign` `{ technicianId }`,
  `POST /visits` (extra visit), `POST /visits/:id/move` `{ date }`, `POST /visits/:id/skip`
  (customer skip before 8 pm the evening before → postponed by the rules), `POST
  /batches/:id/cancel` (e.g. holiday → all
  `we_missed`, redo scheduled).

**App:** **Schedule screen** (Communities): week view, a card per community per day with
vehicles (cars/bikes), planned time, technician; assign; open a batch to move, skip or add
visits; warnings for over-full days and tiny clusters.

**Tests:** domain planner tests; new `scripts/schedule-check.mjs` (`npm run test:schedule`, in
CI): run twice → no duplicates; pause → visits removed; wash days changed → re-planned; vehicle
moved → follows; skip before and after cut-off; holiday cancels to *we missed* with redo. Timing
check: 500 subscriptions plan inside the cron's time budget.

**Done when:** the next two weeks of visits appear by themselves, grouped by community and day.

---

### Milestone 6 — Technician mode (0.12.0)

**Database** (`0012_evidence.sql`)

- `visit_evidence`: id (from the phone), shop_id, visit_id, kind (`before` | `after` |
  `damage` | `exception`), photo_key, taken_by, taken_at (phone time), latitude?, longitude?,
  note?.
- `technician_days`: id, shop_id, technician_id, date, checked_in_at?, checked_out_at?, kit
  (text, until Phase 2 kits), notes. (Reuses `attendance` for presence.)
- `equipment_alerts`: id, shop_id, technician_id, batch_id?, kind (`equipment` | `battery` |
  `water` | `access` | `other`), note, photo_key?, status (`open` | `resolved`), at,
  resolved_by?.

**Domain:** visit transitions for technicians (`start`, `complete` — blocked without a required
photo unless a reason is given — and the exception reasons mapped to `customer_missed` or
`we_missed`); "end apartment" summary; end-of-day totals.

**API** (`routes/tech.ts`, `requirePermission('visits.work')`, only the technician's own
batches)

- `GET /tech/day?date` → the **day pack**: batches, visits in order, vehicles, plates, homes,
  parking spots, photo URLs, instructions, community facilities and notes — one response,
  cached on the phone.
- `POST /tech/checkin`, `/tech/checkout`, `POST /batches/:id/start`, `/finish`.
- `POST /visits/:id/start`, `/complete`, `/exception` `{ reason, note }` — each carries the
  phone's time; replay-safe; out-of-order sync resolved by phone time (like job status today).
- `POST /visits/:id/evidence` (photo upload, as `/photos` today), `POST /alerts`,
  `POST /visits/:id/hub-lead` (stored now; managed in milestone 8).
- Visit outcomes update the cycle (`onVisitOutcome`) in the same batch.

**App** (technician home, replaces the job board for technicians)

- **Today:** check in; batches in order with vehicle counts; community card (water point photo,
  hours, security notes); download state ("Ready offline ✓").
- **Batch:** queue sorted by layout and parking; filters (to do / done / problems); progress.
- **Vehicle:** plate, vehicle photo, home, parking spot + photo, services, notes; big
  **Start** → before photo → **Complete** → after photo; one-tap problems (car not there, can't
  reach, no water, equipment, battery, existing damage) with optional photo; **Recommend hub
  service**.
- **Finish community:** done / skipped / problems summary.
- **End of day:** totals, check out.
- **Offline:** the day pack is downloaded at check-in (and refreshed when online); every action
  goes into the outbox (`visit.start`, `visit.complete`, `visit.exception`,
  `evidence.upload`, `alert.create`); photos stored on the phone until uploaded (as job photos
  are today). Works for a full day with no signal.
- **Manager side:** batch progress live on the Schedule screen; alerts badge.

**Tests:** domain transitions; new `scripts/tech-check.mjs` (`npm run test:tech`, in CI):
technician sees only their batches; start/complete/exception and the cycle effect; required
photo blocks complete without reason; replayed and out-of-order actions; *no water* marks the
rest *we missed* with redo; another shop's technician gets nothing. Manual: a full day in
airplane mode on the tablet, then sync — nothing lost, nothing doubled.

**Done when:** a technician can work a whole community underground and everything lands
correctly when back in signal.

---

### Milestone 7 — Notifications (0.13.0)

**Database** (`0013_notifications.sql`): `notifications`: id, shop_id, customer_id?, event,
channel (`whatsapp` | `sms` | `push` | `email`), template, params (JSON text), status
(`queued` | `sent` | `failed` | `skipped`), provider_ref?, error?, created_at, sent_at?;
`notification_prefs` per customer (opt-outs; consent from milestone 2).

**API:** `lib/notify/` — `NotificationProvider` interface with two providers: a **saving**
provider (default — writes the message with status `skipped` and sends nothing, so the history
is visible in the app) and a WhatsApp Cloud API provider reusing today's sender, switched on only
when a real WhatsApp number is configured. Templates per event; sends queued through `waitUntil`
(never slowing the tap) and retried by the nightly job. Events: joined, service request approved or
rejected, subscribed, payment confirmed, wash tomorrow (evening job), done (with after photo),
customer missed and postponed (with photo, and postpones left), last postpone used, car wash
missed + new date, payment due, renewal due, community launched. Messages sign off as
"MANA Car Wash – <branch city>" (e.g. "MANA Car Wash – Kavali").

**App:** customer page → message history; Settings → which messages to send.

**Tests:** `test:notifications` with a fake provider: each event queues the right template once;
opt-out respected; failure retried; no message to another shop's customers; with no WhatsApp
configured, messages are saved and nothing is sent.

**Done when:** residents hear from the car wash at every step without staff typing anything.

---

### Milestone 8 — Complaints, incidents, hub leads (0.14.0)

**Database** (`0014_support.sql`)

- `complaints`: id, shop_id, customer_id, vehicle_id?, visit_id?, community_id?, technician_id?,
  payment_id?, kind (`quality` | `missed` | `damage` | `behaviour` | `billing` | `other`),
  text, photo_keys, status (`open` | `in_progress` | `resolved` | `rejected`), resolution
  (`rewash` | `credit` | `refund` | `none`), resolution_ref?, created_by, created_at,
  resolved_at?.
- `incidents`: id, shop_id, kind, community_id?, visit_id?, vehicle_id?, technician_id?,
  description, witnesses?, cost_paise?, photo_keys, status, internal_notes, at.
- `ratings`: visit_id (PK), shop_id, stars, comment?, at.
- `hub_leads`: id, shop_id, customer_id, vehicle_id, visit_id?, service_id?, note, photo_key?,
  status (`new` | `contacted` | `booked` | `done` | `lost`), job_id? (the hub job that came from
  it), created_by, created_at.

**API:** complaints CRUD with resolution actions (rewash → a new visit on the next wash day;
credit → ledger entry; refund → payment refund record); incidents CRUD; hub leads list and status;
**New Wash links a hub job to an open lead** for the same vehicle automatically; ratings (from the
customer app).

**App:** Complaints screen (Communities), complaint detail showing visit, evidence, technician,
payments together; incident form; Leads list; New Wash banner "From a community lead".

**Tests:** `test:support`: each resolution path and its money effect; a lead converts when the
hub washes the car; isolation.

---

### Milestone 9 — Customer app (0.15.0)

**Structure:** `apps/customer` — a second React Native app in the monorepo, sharing
`packages/domain` and the typed API client (`hc<AppType>`). Package id e.g.
`com.sprixia.manacarwash`; Play Store listing **MANA Car Wash** with the MANA logo.

**Database** (`0015_customer_accounts.sql`)

- `customer_accounts` (platform-level, not shop-scoped; added to `PLATFORM_MODELS`): id, phone
  (unique), created_at, session_version.
- `customer_account_links`: account_id, shop_id, customer_id (which car washes this phone is a
  customer of).
- `shop_branding`: shop_id, display_name, logo_key, colour, support_phone.

**API** (`routes/customer-app.ts`)

- Branding: one app, **MANA Car Wash**; `shop_branding` only holds each branch's display name
  and support phone.
- Sign-in: `POST /c/auth/start` (WhatsApp code; test code `000000` until WhatsApp is live),
  `/c/auth/verify` → only numbers the car wash has registered (a customer, or an approved service
  request) get a **customer token**; any other number gets a short-lived **request ticket** and
  the "Request service" screen. The token is
  (`aud: customer`, account id, chosen shop) — a separate middleware `requireCustomer` that gives
  routes a shop-scoped client **and** the customer id; every customer route filters by both.
- `GET /c/shops` (car washes linked to this phone), `GET /c/communities/search?q=` (active
  communities of the chosen shop, or all shops when arriving from a QR with no account yet).
- Request service (with the request ticket, so the phone is proved):
  - `GET /c/prices/from` → the lowest active plan price per vehicle category across MANA's
    branches ("Cars from ₹X a month, bikes from ₹Y"); public, cached.
  - `POST /c/service-area/check` `{ latitude, longitude } | { areaId }` → the branch (via
    `branchFor`) or `out_of_area`; `GET /c/service-areas` lists the areas for the picker.
  - `POST /c/service-requests` → pin or area, address, place kind, community and home if picked
    (`GET /c/communities/search?q=` within the branch), vehicles, preferred time, name → a
    `service_requests` row (`pending`, or `out_of_area` + demand) handled in milestone 2's
    Requests screen.
  - `GET /c/service-requests/mine` shows the status. Once approved, the next sign-in gets a
    customer token. Customers never create memberships on their own.
- Plans for my vehicle, buy (recorded payment: "Pay ₹X by UPI to …, enter the UPI reference" →
  staff confirm; Razorpay later), my subscriptions, pause, resume, cancel (per plan rules), skip a
  wash (before 8 pm the evening before; counts as a postpone, shows postpones left), upcoming and past washes with photos, rate, complain, hub-service
  suggestions, demand ("not served yet").
- Deep links: `/join/<shopCode>/<communityId>` opens the app (or the Play Store) with the
  community picked.

**App screens:** Welcome (MANA Car Wash) → Sign in → (not registered: **Request service** —
starting prices → map pin or area → in area: place kind, community/home, vehicles, time, name →
"Request received — our team will call you" status; out of area: "We're not in your area yet —
we'll tell you when we come" + details saved) → Choose a plan → Pay → **Home** (next wash, plan status) → Washes (timeline with
photos) → Vehicles → Plan (pause, skip, cancel) → Help (complaints, contact the car wash) →
Profile (delete my data).

**Tests:** `scripts/customer-app-check.mjs` (`npm run test:customer-app`, in CI): sign-in; a
customer sees only their own homes, vehicles, subscriptions, visits and photos; can't read
another customer's visit by id; unregistered number can't sign in but can request service;
pin inside the radius → that branch, listed area without a pin → that branch, outside →
out of area + demand; individual house and small building requests accepted; approved request
can sign in, rejected can't; starting prices match the plans; skip before and after 8 pm; join
via QR link; place not listed becomes demand. `test:isolation` adds customer tokens: never another shop's or another customer's
data. Separate CI job builds the customer app (typecheck, lint).

**Done when:** a resident can install, join, pay and follow their washes without calling anyone.

---

### Milestone 10 — Invoices and the community dashboard (0.16.0)

**Database** (`0016_invoices.sql`): `invoice_series` (shop_id, financial_year e.g. `26-27`,
next_number) — receipt numbers are `<branch code>/<financial year>/<5 digits>`, e.g.
`MCW-KVL-0001/26-27/00001`, restarting at 00001 each April; numbers taken inside the same batch
as the invoice, so they never skip or repeat;
`invoices` (id, shop_id, number, customer_id, lines JSON, subtotal, tax, total, gstin?, pdf_key,
issued_at, cancelled_by_invoice_id?); shop settings: legal name, address (the prefix is the
branch code, never typed).

**API:** invoice on every confirmed payment (PDF built in the Worker and stored in `PHOTOS` under
`invoices/`), credit notes for refunds, `GET /invoices`, download link; **reports**:
`GET /reports/communities?range` → vehicles serviced (cars, bikes), MRR (active subscriptions ×
monthly-normalised price), new / cancelled / paused, churn, members and subscribers per
community, demand per place, missed visits by reason, complaints, average minutes per service
and vehicle type, vehicles per technician-day, time from hub check-out to first visit and between
batches.

**App:** Reports → **Communities** tab (cards and per-community table); invoice list on the
customer page and in the customer app.

**Tests:** gap-free numbering under concurrent payments (`test:races`); format and April reset
(domain unit tests); two branches never share a number; report numbers checked
against a known seed (`test:communities`).

---

## Part 4 — Pilot launch (1.0.0)

1. Production database migrated (every migration, in order) — only with your approval, as always.
2. WhatsApp: when a real number is ready, templates approved and the WhatsApp provider switched
   on; until then messages are saved only. The `000000` test code must be off in production
   before real residents sign in.
3. MANA Car Wash's real data entered: one hub, its zone, the first communities, plans and prices.
4. One technician account; a full rehearsal day on staging with the seed, then one real day.
5. Daily check for the first two weeks: sync errors, error log, missed-visit reasons, wash times.
6. After 4–6 weeks: review prices, wash times, water and battery use with real numbers, then plan
   Phase 2.

---

## Part 5 — After the pilot (Phase 2, outline)

Each becomes its own milestone when the pilot shows it's needed:

- **Shared across branches:** business-level customers and communities (Part 1.1).
- **Equipment:** `equipment`, `batteries`, `mobile_kits`, `bikes`, `repair_tickets`; kit
  check-in/out replaces the free-text kit; failure workflow from alerts.
- **Consumables per visit** on today's stock moves (issue to technician, use per visit).
- **Community sales pipeline** (`community_leads`, meetings, follow-ups, agreements).
- **Razorpay for residents:** payment links, then UPI AutoPay mandates, refunds through the
  provider, webhooks (reusing the billing webhook pattern).
- **Shifts, leave, incentives** (configurable rules).
- **Hub bookings** from the customer app.
- **Profit per community and per technician**, hub vs community vs combined (costs from expenses,
  consumables, technician time).

Phase 3 (route optimisation, forecasting, community admin portal, multi-city) waits for real data
from several communities and technicians.

---

## Part 6 — Quality bar for every milestone

- **No hardcoded business values:** prices, washes, durations, taxes, rules, names — all data.
- **Isolation:** every new table is shop-scoped by `client.ts`; `test:isolation` grows with each
  milestone; customer tokens and technician tokens get their own isolation cases.
- **Offline:** anything a technician or enrolling staff member does on site is queued, retry-safe
  (ids from the phone) and order-safe (phone time).
- **Money:** never edited, only reversed; every change audited; races tested.
- **Speed:** no screen waits on more than one round of queries; lists paginated; nightly work in
  the cron.
- **Tests and CI:** domain unit tests plus one end-to-end script per milestone, all in CI; staging
  deploy and seed; a check on the tablet before calling a milestone done.
- **Docs:** README (new scripts and settings), CHANGELOG, and the service plan updated when a
  decision changes.
- **Second branch in every test** to prove nothing is tied to the first hub.

---

## Part 7 — What I need from you before milestone 0

Decisions are all made (Part 1.2, 4 Oct 2026). Nothing else blocks milestone 0.

1. A real first community (or two) to model the seed and the rehearsal on — needed by milestone 1,
   not before.
2. A real WhatsApp number — only when you're ready; everything works with the test code until then.
