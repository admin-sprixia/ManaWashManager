# Changelog

All notable changes to Mana Wash Partner and Mana Wash. One version number is shared by every app and package
(`npm run version:set -- X.Y.Z`); the Android `versionCode` follows it automatically.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **WhatsApp assistant on the business number.** Anyone who messages the shop's WhatsApp number
  gets Car / Bike / Location & hours buttons, then picks the company and the model from WhatsApp
  lists (or just types it: "swift", "activa"), and sees only that model's hub prices and wash
  plans, with hours. Location sends the map pin, address and phone; "Talk to us" gives the team's
  number. STOP turns offers and reminders off and START turns them back on. Every message in
  and out is logged with its delivery status. Meta's webhook is
  `/whatsapp/webhook`, refused without Meta's signature. New settings: `WHATSAPP_APP_SECRET`,
  `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_BUSINESS_ID` (README → WhatsApp assistant).
- **Privacy policy and data-deletion pages** at `/legal/privacy` and `/legal/data-deletion` on the
  API, for publishing the Meta app and the Play Store listings.

- **New community, step by step.** The visit form is now 7 clear steps with a track at the top
  (Place → Photos → Site check → Vehicles & time → Who to call → Days residents want → Check &
  send). Each step says in one line what to do, shows what it still needs, and saves the draft on
  Next; the last step shows every answer with Change buttons before sending to the owner.
- **Stricter community visits.** A visit can go to the owner only with its name, label and gate
  pin; every answer (society, water, power point, parking, space to wash, vehicle count); a photo on
  each required tab — gate, parking and wash space (water point and power point photos are optional);
  who to call there, name and number (the security guard's name and number
  can be added too, optional); and 3 to 5 choices of days and time residents want. Notes stay
  optional. Each photo tab says exactly
  what it must show, and the camera opens on the next one missing. The owner can't make a community live
  until its flats (or houses) are added. "Best time to wash" is now a time, not a choice of three
  (older answers read as 6:00 AM, 8:00 AM or 5:00 PM).
- **Branch menu.** More › Menu shows the hub, community and doorstep menus (only the ones the
  branch runs) — plans first, then services in Express, Basic, Shine order — for every vehicle,
  cars or bikes, a size, or a company and model, with only what the branch washes. It shares as a
  PDF on the logo's night indigo, ending with the app link and a QR code for the exact price.

### Changed

- **One baseline migration before launch.** The 39 development migrations are now one file,
  `migrations/0001_init.sql`, which builds exactly the same database (proved with `db:check`
  and a table-by-table comparison). New schema changes start at `0002_…`. `schema.sql` was
  missing the community photo kinds and the security contact columns; fixed.
- **Staging rebuilt from scratch.** The staging Worker, its D1 database and both R2 buckets were
  deleted (after a full backup) and created again: the database from the baseline, a new
  `JWT_SECRET`, the India Post pincode list, and the business set up again.
- **Communities pay more than the hub, and less as neighbours join.** Prices now always run
  Hub ≤ Community ≤ Doorstep. A community pays the hub price plus HQ's community rule (10% by
  default, ending in 9: ₹499 → ₹549); the rule can no longer go below the hub. The volume discount
  by number of cars is replaced by a neighbours discount: every 10% of a community's flats that
  wash with us (a plan running, or a wash booked this month) takes 1% off every price and plan
  there, up to 10% when every flat joins (HQ can set 0–20%), and never below the hub price. The
  price is fixed when a plan is bought and worked out again at each renewal. Staff and residents
  see "7 of 10 flats wash with us: 7% off · 1 more flat → 8% off" on the join screens and the
  community page. HQ's community screen sets the rule (Same, +5% … +20%) and the discount. A home
  visit's default fee is now ₹99 (was ₹49), and HQ is warned when the visit fee would make a home
  wash cheaper than a community one. Existing HQs move to the new rules (a "less than the hub" rule
  becomes +10%) and every branch is re-priced.
- **Plans save the same everywhere.** HQ's plan prices are set against its Standard price book;
  a branch whose washes cost differently (another book, its own prices, a zone, the community
  discount) now gets its plans moved by the same amount, so a plan saves the same share at every
  branch (a branch on a 10% cheaper book gets 10% cheaper plans). As a safety net a plan never
  costs less than 5% below its washes one by one; HQ's plan editor shows when that applies.
- **Second car in the same home: 10% off its plan.** At the counter, a customer who already has a
  plan running on another vehicle is offered the plan 10% off (the bill shows it as a discount);
  joining a community with several cars, the dearest plan is full price and the rest 10% off
  (every new plan, when one is already running). The order's title says "second car 10% off".

### Fixed

- **Wash photos showed as blank tiles once uploaded.** The wash page loaded them with the session
  only; since sign-in is tied to the phone, the server needs this phone's key too and refused
  them. Photos now load with both (like community photos already did).
- **Opening a wash from the home list was slow and sometimes stuck.** The page waited to read
  the whole day's list from storage before it could draw, and redrew itself several times as the
  server answered. It now opens filled in from the board's copy in memory, applies each answer
  in one go, and starts the download and photos once it has slid in. The board itself redraws
  once per refresh (not once per value), and a row redraws only when its own wash changes.
- **Unsynced changes are kept safe (audit H1–H3).**
  - If the phone can't read its saved queue, it never overwrites it: new changes are kept apart
    and merged back as soon as it reads again (on this run or the next start).
  - Switching branch stops the previous branch's sync before it sends or saves anything else;
    "Sync now" waits for a sync already running instead of returning at once.
  - Every queued change records its branch: the board and wash pages show only this branch's
    unsynced washes. A wash still waiting on a teammate's unsynced change can't be changed by
    someone else (it says who it's waiting on). Owners and managers see teammates' waiting
    changes in More and can discard one after a warning.
- **Offline washes keep the quoted price (H4).** A wash that reaches the server well after it
  happened keeps the price the phone showed if prices changed meanwhile (within half to double
  today's), so the bill matches the cash taken; the wash's activity says "Kept the price … quoted
  offline".
- **The HQ home is never a branch (H5).** The server lets HQ-only people reach only sign-in and
  account, HQ's tools, the size guide and the shop name; washes, cash, customers and team are
  shut there. HQ's admin list shows only real admins. The app no longer loads branch data in
  the background for HQ-only people.
- **Owner-only money actions (H6, H7).** Removing a community member who has a paid plan (it
  refunds the plan) is owner-only; staff see why. Approving a customer's vehicle that belongs to
  another customer today is owner- or manager-only; staff see "Ask the owner or a manager".
- **HQ home: switch to your branch (H8).** HQ-only people who also work at a branch get a
  "Switch branch" row on the HQ home.
- **Error log for every owner (H10).** The row moved into More › Branch, so the "new errors"
  alert on the board always leads somewhere.
- **Community wash days work offline (H9).** The day's list is kept on the phone; washed, not
  found and missed are queued like hub washes and sync when there's signal, showing straight
  away as saved on this phone (the after photo and Undo open once synced).
- **Report PDF: text drawn over text.** Small headings were covered by the row below them,
  sections split across pages (GST's first line on one page, the rest on the next) and long
  lines were cut. The PDF is laid out again: every block takes its own space, small sections
  move to the next page whole, the shop's address wraps, and tables have header bands that
  repeat on each page. The cover shows the period on the right; the staff table lines up
  (washes, services sold, commission, collected); every wash shows the date and time, customer
  and services, the plate (spaced) and vehicle, and the amount with Cash/UPI and who took it,
  Void in red or Not paid yet in amber. Averages are in whole rupees and counts say what they
  count ("1 visit", "4 washes"). The footer is a night band like the header, with CONFIDENTIAL,
  "for <branch> only", the page number and the app version; the header carries a large faint
  Mana Wash mark behind it (and a small one on the continued pages).
- **New Wash opened slowly.** It redrew the whole screen once per catalog list (about a dozen
  times) while sliding in, and started five downloads, the customer sync and the keyboard at the
  same moment. Now the catalog is kept in memory (read ahead while the home board is open) and
  applied in one go, every step is drawn at once from the phone's copy, and the downloads start
  once it's open. Nothing redraws when the server's catalog hasn't changed.
- **Company list opened slowly.** Long dropdowns (the 80+ companies, a company's models) drew
  every row and logo before opening; they now draw only what's on screen, as one tight list
  with thin dividers.
- **Managers couldn't open Attendance.** The row was in More, but the page only opened for
  owners.
- **Branch price limits in whole rupees.** "20% less to 20% more" of ₹499 showed ₹399.2 to
  ₹598.8, and moving every price +20% could save ₹598.80; the limits now snap to whole rupees
  (₹400 to ₹598).
- **Removing the UPI ID did nothing.** Clearing it and tapping Save kept the old ID (and the QR);
  the server now clears it.
- **Plan sales counted as washes.** Plans sold at the counter are shown on their own in Reports
  ("Includes ₹… from N plans sold at the shop", a "Plans sold at the shop" row), the PDF ("Plans
  sold at the shop") and the Staff report ("N wash plans sold at the shop"). They're no longer in
  washes started, washes done or the average per vehicle; their money is still in revenue and in
  what each person collected, so the cash drawer still adds up.
- **PDF days in India time.** The PDF's day-by-day, busiest day and top lists put a wash on the
  day it was paid in India time (a wash paid at 1 am was on the day before), and count paid washes
  only, so they match the summary.
- **Google review link: Google links only.** It goes to customers on WhatsApp, so only g.page,
  maps.app.goo.gl, goo.gl, g.co, google.com and google.co.in links are accepted, in the app and
  on the server.
- **Error log flooding.** One person can send 30 error reports an hour; past that the phone keeps
  them and sends them later.
- **Owners in Attendance.** A branch's owner is on their own attendance sheet and marks their own
  day (nobody above them can); managers and staff still can't mark themselves.

- **Staff report counted money on the wrong day.** Money collected, washes done and commission
  were counted by when a wash was started, while Reports and the cash drawer count by when it was
  paid — a car started at night and paid in the morning landed on different days, so a shift's
  cash didn't reconcile. They now count on the day paid (washes started and voids still by when
  started); the staff report's cash for a day adds up to Reports' cash. A staff member's own
  earnings follow the same rule.
- **Plan washes at the shop counted twice.** A community plan member's wash at the shop also
  writes a community visit, so the staff report counted it as a shop wash and a community wash.
  It's now a shop wash only.
- **Managers showed as "Staff"** on the staff report.
- **Corrections feed showed "cashSource"** for an expense's Paid from change; it now reads "Paid
  from: Shop cash box → Doorstep cash".
- **Switching branch while changes are syncing.** The sync queue noted who was signed in when a
  round started, but each request read the sign-in at the moment it went out. Switching branch
  in the middle of a backlog could send the rest of one branch's washes, payments or expenses to
  the other branch. A sync round now sends everything as the session it started with and stops
  when the signed-in account changes; the rest waits for that branch. More › Sync also tells your
  own changes from another branch apart from a teammate's.
- **Plan washes don't earn loyalty stamps.** A community plan member's wash at the shop was
  stamping their card although the plan had already paid for it, so plan members earned free
  washes on top of their plan. The service the plan paid for is now recorded on the wash
  (`jobs.plan_service_id`, migration `0024_job_plan_service`, past plan washes filled in) and earns
  no stamp; anything else paid on the same bill still does.
- **Expenses for a long period.** Opening a period with more than about 99 expenses (This year,
  a busy month) failed with a server error: the "edited" check sent every id in one query, past
  D1's 100-value limit. It now goes in slices; `npm run test:expenses` covers 150 entries.

### Added

- **Sell a plan any time the customer asks.** Besides New Wash (before the wash starts):
  - **From the customer's profile:** "Sell plan" in the quick actions asks which vehicle: one of
    theirs, or **another vehicle** (number plate, then company and model, which picks its type;
    or pick the type). Then the plans for that vehicle show. A new vehicle is added to the
    customer with its company and model; a plate saved under someone else is flagged first and
    moves to this customer.
  - **From the wash page** (waiting, washing, ready or paid).
  - The plan is registered for that vehicle; today's wash is paid as usual and the plan starts
    from the next visit. Needs internet; not for walk-ins or doorstep washes.
- **Before photos in New Wash.** Between the vehicle and the services, staff take or pick up to 10
  before photos (scratches, dents) as the vehicle arrives; tap ✕ to drop one. They're attached to
  the wash when it's started and upload in the background, offline too (queued behind the wash).
  Photos of a wash that's never started are deleted from the phone. On the wash page, before
  photos can be added only while it's waiting, and after photos only once it has started.
- **Wash page, redesigned.** A full-width header in the colour of where the wash stands (indigo on
  the board, teal paid, red voided): back, a status pill, the company and model with its logo,
  the plate and shop or doorstep, the amount in large type with how it was paid or that it's to
  collect, and a Waiting → Washing → Ready → Paid bar. A white sheet with rounded corners slides
  over it: the customer (avatar, number, call and WhatsApp), the bill like a receipt (stamp-card
  freebies, discount, a bold total), Details as label and value (started, washed by, got the
  service, payment, welcome gift; tap to change), photos, an activity timeline, and Void as a
  quiet link at the end. The big button at the bottom keeps the next step.
- **Home board rows, clean and minimal.** Plain full-width rows with thin dividers, no icons:
  - the **company and model** ("Maruti Suzuki Swift") and the total; a wash with no saved model
    is headed by its number plate instead (never "Car" or "Three-wheeler");
  - the company logo, the **number plate** in plain spaced letters ("AP 39 CK 7710"), and Doorstep;
  - the services, then the customer, time, washer, Cash/UPI and Gift owed/given as one line;
  - the next step as a small pill with its icon: ▶ Start, ✓ Ready, ₹ Collect ₹… (solid), and Thank you
    with the WhatsApp logo (soft green).
- **New Wash: company, then model.** Step 2 now asks for the company (with its logo) and the
  model, both searchable. The model picks the branch's vehicle type (Swift → Hatchback), and
  the services and prices open on their own. Each model in the list shows the type it will
  be, or "Not washed here".
  - **Model not in the list?** "Pick the vehicle type yourself" opens the Cars/Bikes cards as
    before. "Change" next to a picked type does the same.
  - The company and model are **saved on the customer's vehicle** and sent to every phone, so a
    returning customer shows as "Maruti Suzuki Swift · Hatchback". A later wash with another
    model updates it; one without a model leaves it as saved.
  - Uses head office's edits to the size guide's list, and works offline.
  - The model-to-type matching is now shared by the customer app's Add a vehicle and New Wash.
- **HQ-only sign-in.** Mana Wash HQ people who work at no branch now sign in like anyone else
  (number, WhatsApp code, their own 6-digit PIN) and the app opens on its own **HQ home**:
  - today across every branch (open branches, paid today, washes in progress, one row per branch
    that opens it), HQ's tools (All branches, Services and plans, Base prices, Pricing rules, HQ
    settings, Vehicle size guide) and their account. No job board, cash, team or branch screens.
  - **HQ settings → Admins:** type a number that's on no branch team and a name field appears;
    one button **Add and send invite on WhatsApp**. Admins now show by name, with an **HQ only**
    tag, and "hasn't signed in yet" with **Send invite again** until they do.
  - **Removing an HQ-only admin** signs them out on every phone and stops their sign-in.
  - Behind it: each business has one hidden HQ home (`shops.kind = 'hq'`, migration 0035) that
    holds only these people. It never shows as a branch: not in All branches, today's numbers,
    branch towns, menu rebuilds, the customer app or HQ's branch tools.
  - The HQ tools and Account rows on More are now shared with the HQ home.
- **This branch's prices, set by the branch owner.** The page is laid out like HQ's Base prices,
  but for the branch's own price book (e.g. "Standard prices"), so a branch owner never needs HQ's
  pages.
  - **Tabs** for each vehicle group the branch washes (two-wheeler, car, three-wheeler,
    commercial, heavy, farm), from the vehicles picked when the branch was opened.
  - **Grid of services × sizes (S, M, L, XL).** Tap a price to set it for every vehicle of that
    size: quick picks (HQ's price, −10%, −5%, +5%, +10%) or a typed price, a preview of the shop,
    community and home price, and the staff commission. Your own prices show in amber with HQ's
    beside them; "Mixed" when the vehicles of a size differ. "Use HQ's price" undoes it.
  - **Move every price** of a group by −10%, −5%, +5% or +10% at once, or back to HQ's prices.
  - **Community and Doorstep tabs** show what those customers pay. Community prices follow the
    shop price by the community rule (e.g. 5% less) and can't be typed; home prices add the visit
    charge.
  - HQ's limits apply everywhere (e.g. 20% less to 20% more), and edges are whole rupees.
  - The "Edit base prices in Mana Wash HQ" button is gone.
  - **Branches sell Mana Wash HQ's services only.** There's no "Your own services" any more, and
    the server refuses a branch adding, editing or pricing a service of its own.
  - Switching vehicle tabs no longer drops size labels or the legend (Android layout animation).
- **Wash plans at the shop.** A plan can now be sold at the community, the shop, or both (HQ ›
  Services and plans › Plans › "Where it’s sold"; the service must be done there).
  - **Selling:** New Wash shows "Sell a plan for KA01AB1234" once the phone and number plate are
    in. Pick a plan and pay cash, UPI or other; it's a paid bill on Cash and Reports
    ("plans sold") and isn't counted as a car washed.
  - **Using:** the vehicle's plan shows up in New Wash with washes left and the end date, and pays
    for the wash. Rules: one vehicle only (not the owner's other vehicles), only at the branch
    that sold it, at most one wash a day, and only for its months (bought 31 Jan for a month,
    it ends 28 Feb). There's no weekly schedule.
  - **Void:** voiding a plan wash gives the wash back. A plan sale can be voided only while no
    wash has been used from it.
  - **Community plans at the shop:** a switch per plan, "A community plan can also pay for a wash
    at the shop", on by default. Turned off, the plan is used at its community only.
  - `npm run test:shop-plans` (apps/api) covers selling, using, the one-a-day and branch rules,
    and voids.
- **Base prices, redesigned around three ways to buy.** HQ › Base prices has three tabs:
  - **Hub**: the price per service per size. Every other price starts here.
  - **Community**: every community price is the hub price with one rule, "X% less than the
    hub" (all vehicles or one vehicle class), picked with one tap (Same, 5%, 10%, 15%, 20%
    less). A size can't be given its own community price, so the rule is the only control
    (the API refuses one). It also holds **volume discount** steps, so bigger
    communities pay less, e.g. 10+ cars 5% off and 25+ cars 10% off (never more than 10%). A step comes off every
    wash and plan at that community as people join or renew. Off until HQ adds a step.
  - **Doorstep**: the **hub price + one visit charge per visit**. The visit charge is a visit
    fee (₹49), then ₹10 per km after the first 3 km from the branch, up to 15 km, rounded up
    to end in 9. HQ can add busy-time extras (e.g. +₹30 on Sunday mornings). The tab has a
    "charge by distance" table and a "Try it" calculator (service, size, distance, time →
    what the customer pays).

  All of it is editable. The community rule moved here from Pricing rules.
- **Visit charge in New Wash, measured, never typed.** A doorstep wash shows a Visit charge
  card. It takes the phone's location as soon as it opens (the team is at the home); nobody
  types a distance. The bill gets its own "Visit charge" line.
  - The **server measures it**: from the branch's map pin to the home (road ≈ 1.3 × the
    straight line). Without the phone's location it uses the customer's saved home (from
    their last doorstep wash, or where they asked for a wash in the Mana Wash app). With
    neither, the wash is refused (`location_needed`).
  - The home is kept on the wash and saved on the customer for next time (migration 0030).
  - It's charged **once per visit**: a second car for the same customer that day pays none.
  - Homes beyond the furthest distance are refused.
  - Coupons and offers come off the services only, not the visit charge.
  - The distance is kept on the wash (migration 0029).
- **Customer app:** at-home prices are the shop price, with "+ ₹49 visit charge, and ₹10 a km
  after 3 km" and the furthest distance shown under them. Joining a community on a volume
  discount says so ("10% off every price here: 12 vehicles … already wash with us").
- `npm run test:pricing` (48 checks): community rule, volume discount, visit charge, same
  visit, too far, discounts, busy times, shop-only and home-only services. Domain tests for the
  visit charge, ending in 9, busy times and tiers.
- **Base prices looks new.** Three cards at the top show the same wash at the hub, at a
  community and at a home. A "how it adds up" strip shows the sum (hub → rule → community;
  hub + visit = customer pays). The tabs are cards and tiles: visit fee, free distance, per km
  and furthest; an "End in 9" switch; busy-time cards; visit charge by distance as bars; a
  price ladder for bigger communities.
- docs/BACKLOG.md: what we've agreed to do later.
- docs/PRICE_LIST.md gains **At home and at communities**: how the three prices work and the
  visit charge by distance, with Basic Wash examples.
- **Doorstep cash in the cash drawer.** Cash taken at a customer's home stays with the team member
  who collected it until they hand it in, so the drawer no longer expects it in the box straight
  away. The drawer adds up the morning cash, plus cash at the shop, plus doorstep cash handed in,
  minus cash spent. A Doorstep cash card shows what was collected, what was handed in and who still
  holds cash (carried over from day to day). **Take** records a handover into today's open drawer:
  all of it, part now with the rest still with them, or short with a reason. Closing while
  someone still holds cash asks for it first, or "close anyway"; the amount is kept with the close
  and in history. The owner can undo a mistaken handover while its day is open; undone ones stay on
  record. Two people taking the same cash at once record it once. Migration `0022_cash_handovers`
  (past doorstep cash is recorded as handed in that day, so old closes keep their totals);
  `npm run test:cash`.
- **Expenses paid from doorstep cash.** A cash expense has **Paid from**: the shop cash box, or
  "My doorstep cash" for someone holding cash from doorstep washes (petrol on the way, supplies at
  a customer's). It's still an expense in every report, but it comes off what that person holds,
  not the drawer, and never more than they hold (checked again when an offline entry syncs; the
  last known amount is kept on the phone for offline use). Owner edits are checked the same way;
  switching to UPI or deleting it gives the cash back to what they hold. The Doorstep cash card
  shows what each person spent. Migration `0023_expense_cash_source`.
- **Services: create, edit, delete — nothing else.** The editor's time is a number with
  Minutes / Hours / Days (− / + to adjust, "Takes 1 day 6 hr" under it), up to 30 days (migration
  `0028_service_duration_days`). What's included is typed with commas: each item turns into a
  chip as you type (× removes one, backspace on an empty box edits the last); no suggestion chips.
  "Switch off everywhere" is gone; **Delete service** takes it off the catalog and every
  branch's menu (past washes keep its name) and is refused while a live wash plan or a combo uses
  it (`DELETE /business/services/:id`). The Services list shows only services, grouped by vehicle,
  with kind, time, badge and combo; prices and branch information live in Base prices and the
  branch pages.
- **Sizes on each service.** In the service editor, each kind of vehicle picked shows its sizes
  to tick (cars S · Small … XL · Luxury, bikes Regular / Premium), with the body types in each
  size underneath. Base prices then asks for prices only for those sizes (the others read "Not"),
  and branches sell the service only for them, even where another size has a price. A new
  vehicle brings its sizes that have vehicles in them; every vehicle needs at least one size.
  Existing services keep the sizes they were priced for (migration `0027_service_sizes`).
- **HQ switches services on branch by branch.** Adding or changing a service at HQ no longer
  reaches every branch: a new service starts off everywhere, and HQ switches it on per branch in
  the branch's new **Services** tab (All branches › a branch; the Hub/Community/Doorstep tab is
  now **Agreement**). Each service has its own switch, with All on / All off; a combo brings the
  services it bundles; a service that won't sell yet says why (no prices, or a place the branch
  doesn't run). Opening a branch has a **Services it sells** step. Switching a service off at
  HQ still takes it off everywhere; switching it back on returns it to the branches that had it.
  Services › the list shows "At 1 of 1 branches" / "Not at any branch yet". Copying a branch's
  menu in keeps those services on at that branch. Existing branches keep everything they sold
  (migration `0026_branch_menus`, `PUT /business/branches/:id/menu`).
- **Services and prices apart.** The service editor no longer has prices: services are defined
  in Services, prices are set in Base prices.
- **Add / edit service, rebuilt (HQ › Services).** A full screen instead of a sheet:
  - **Where it's done:** Shop, Community and Doorstep as three ticks in any mix; one tick reads
    "Shop only" / "Community only" / "Doorstep only". Community and doorstep share the team's price.
  - **Vehicles:** pick the kinds of vehicle (only those switched on); "Which size is my
    vehicle?" opens the size guide.
  - **Combo builder:** tap service cards (with their starting prices) to bundle them.
  - **Time** (quick picks or minutes), **kind** (Wash, Protection, Add-on), a **What's included**
    checklist (up to 12 lines, with suggestions), **Show in the customer app** and a **Most
    popular** badge.
  - Everything reaches branch menus: New Wash shows the time and badge and doesn't offer a
    community-only service at the door (the server refuses it too); the customer app shows the
    time, badge and checklist, hides staff-only services and doesn't sell community-only ones at
    the door; community menus list only what's done at communities. A plan can't use a service
    not done at communities, and its service can't stop being done there. Migration
    `0025_service_details`; `npm run test:services`.
- **Vehicle size guide (More › Vehicle size guide).** Every company and model we list (1,820)
  with its body type and size (S, M, L, XL) as head office set them: search by company or model,
  filter by size, company or body type, a legend of what each size holds, vehicles we don't wash
  hidden unless asked. For everyone on the team, works offline; also opened from New Wash and
  the service editor.
- **The menu is the 7 services only.** The 13 car add-ons, 4 shop-only services and 5 bike extras
  that were switched off are removed from the catalog (with their prices) and from
  `npm run db:seed:menu`, so loading the menu again doesn't bring them back. Nothing had used
  them: no branch menu, plan or wash.
- **HQ › Services, redone.** Services are grouped by vehicle (Cars, Two-wheelers…), each with its
  starting price and a "Needs prices" warning when it has none (it can't be sold until it does).
  "Where it's done" is three clear choices with a line saying what each means: Shop & community,
  Shop only, Community only (the community team does communities and customers' homes). "For
  which vehicles" offers only the kinds switched on in Vehicles we wash, and says which sizes it's
  priced by. "Retired" is now "Switched off" (kept with prices, switch on any time), and moving a
  service up or down stays within its group. `npm run db:seed:menu` can sign in as any business
  admin (`MENU_ADMIN_PHONE`, `MENU_ADMIN_PIN`).
- **Reports: where washes happened.** Reports and the PDF show washes at the shop, at customers'
  homes (with their money) and at communities (paid by plans); Vehicles washed includes the
  community ones.
- **Staff report: doorstep cash.** Each person's doorstep cash held now, and any amount handed in
  short in the period, with a link to the cash drawer.
- **Corrections feed: handovers and cash days.** Undone doorstep handovers and reopened cash days
  are listed with who did it, why, and what the close had counted.
- **Nobody leaves the team holding doorstep cash.** Removing or switching off a team member who
  still holds doorstep cash is refused until it's taken (or recorded short) in the cash drawer.
- `npm run test:reports` (apps/api): Reports, the staff report, the corrections feed, attendance
  and the team guard, checked by the numbers.
- `npm run test:stock` (apps/api): inventory end to end — items, use in any matching unit, owner-only
  adds and counts, never below zero, replays and parallel counts, removed items, other branches.
- **The printed price menu, exactly.** A base price can have its own community (doorstep) price
  instead of the doorstep rule (HQ › Base prices has an At the hub / Community switch; empty
  community cells follow the rule). A wash plan can have its own price per vehicle size, at the
  hub and at a community (moved by the branch's zone), and can make every Nth wash a better one:
  Shine is Basic with every 4th wash Premium. The wash-day list shows "Wash 4 of 4 · Premium
  Wash" and a PREMIUM tag, and a plan used at the shop covers the Premium wash on that visit.
  Customers see "Save ₹…" against the washes one by one. Migration `0018_menu_prices`.
- `npm run db:seed:menu` (apps/api) loads the Mana Wash menu into HQ: Express, Basic, Premium,
  13 add-ons, 4 hub-only services, anti-rust; monthly, 3-month (13 washes) and 12-month
  (13 months for the price of 12) Express, Basic and Shine plans; ₹1 rounding; menu sizes
  (compact SUV with sedans, SUV with MUVs). Luxury cars pay 35% more than a big SUV; bikes are
  re-priced with community about 10% less. Old services and plans are switched off.
- **Premium bikes.** Two-wheelers have an XL size and a new **Premium bike** body type
  (Harley-Davidson 750+, Ducati, Hayabusa, big BMW, Triumph and Kawasaki models, Gold Wing,
  Africa Twin…), about 50% above a sports bike. Autos, vans, pickups, trucks, lorries, tractors
  and JCBs get Express / Basic (and Premium where it makes sense) prices.
- **Vehicles we wash.** HQ › Vehicles we wash has an on/off switch for every kind of vehicle and
  for each group (Cars, Two-wheelers, Three-wheelers, Commercial, Heavy, Farm & machines). A
  kind switched off disappears from every branch (customers can't pick it, staff can't start a
  wash, no plans are sold); plans already running carry on, and switching it back on brings back
  only what HQ hid (`vehicle_types.hq_hidden`, migration `0019_vehicle_switches`). Branch owners
  can't add a kind HQ switched off. Starts with cars and two-wheelers on.
- **What each branch offers: Hub, Community, Doorstep.** Head office decides what a branch's
  agreement allows — when opening it (Open a branch › Services in the agreement) and later (the
  branch's page › Services); the owner switches those on and off in Shop details › Services,
  never more. A branch keeps the hub or communities; Doorstep needs the community team (the
  same team goes to homes); Community can't be switched off or taken away while community
  plans are running. The branch's hub and community team follow: made at the branch's location
  the first time, brought back when switched on again, paused when off. Washing at homes was
  one switch for the whole business; it is now each branch's (HQ › "Washing at single homes" is
  gone). Customers can't join a community at a branch whose Community is off. Migration
  `0021_branch_services`; `npm run test:branch-services`.
- **Branch location.** Shop details › Location shows the branch on a Google map with Open in
  Google Maps, and the owner can move it (phone location, drag the pin, or paste the numbers);
  a branch's only hub moves with it.
- **Branches from a pincode and a pin.** HQ › All branches › Open a branch now asks for the
  pincode, a pin on the map (drag, GPS or pasted coordinates) and the owner; the town, its code,
  the branch number and name are worked out by the server from India Post's office list
  (`post_offices`, loaded by `npm run data:post-offices`). Each town of the business keeps one
  3-letter code for good (`branch_towns`): big cities their known code (HYD, BLR, MAA, NLR,
  VGA…), other towns one made from the name that no other town or big city has (Kovur → KVR).
  Branches are numbered in three digits (KVR-001, KVR-002); older two-digit codes still count.
  Names never clash ("Kovur Cutchery", "Hyderabad Kukatpally", "Kovur 2", "Kovur (Tiruvallur)").
  HQ must confirm a branch within 300 m of another, a pin over 25 km from its pincode, a new
  state and a look-alike town name; a check that appears between the preview and opening sends
  HQ back to look. Opening is locked per business, so two at once never share a number or code.
  Branches opened before keep their codes and join their town. Migration `0020_branch_towns`;
  `npm run test:branch-towns` checks it end to end.
- `docs/PRICE_LIST.md`: every company and model with its size and hub / community prices, built
  from the live catalog by `npm run docs:price-list` (apps/api).

### Changed

- **Add and send invite.** Adding a teammate is name, mobile number and role, then one button,
  **Add … and send invite**: it adds them and opens WhatsApp on your phone with the invite ready
  (install link, their number, the WhatsApp code, choose their own PIN) — you press send. The
  "Details → WhatsApp code → Their PIN" bar is gone (those happen on their phone). Someone who
  already works at another branch is told to use the PIN they have. Anyone who hasn't signed in
  yet has **Send invite again** in Team. HQ's Open a branch and Add an owner send the same
  invite to the new owner.
- **More is three sections: Branch, Mana Wash HQ, Account** (Sync stays on top).
  - **Branch:** Reports, Staff report, Attendance, Team · Prices, Vehicles, How this branch
    washes, Branch details, Google review link, UPI QR code · Cash drawer, Expenses, Inventory,
    Rewards, Vehicle size guide · People asking, Customer feedback and Switch branch when they
    apply. Managers see Attendance, Team and the shift rows; staff see the shift rows and their
    earnings, as before.
  - **Mana Wash HQ** (admins only): All branches, Services and plans, Base prices, Pricing rules,
    HQ settings, Error log.
  - **Account:** Edit profile, Change PIN, Your phones, Sign out.
- **Opening hours, clearly.** Times are picked, not typed: an hour, minutes and AM / PM in a
  sheet, shown as "7:00 AM". The week is a Mon–Sun strip: tap a day to close it, **as many days
  as you like** (at least one stays open). A line says it plainly ("Open 7:00 AM to 8:00 PM ·
  6 days a week · closed Sunday"), and the header shows the hours in AM / PM. The customer app
  shows several closed days too ("closed Saturdays and Sundays", "opens Monday 8 am").
  Migration **0034** adds `shops.weekly_off_days`; `weekly_off` stays as the first closed day for
  older apps.
- **Branch details has tabs:** Name (with how it reads on a bill), Contact & hours, Location (the
  map and how far you serve customers), UPI & review (the UPI QR code and the Google review link,
  which moved here from More), In the app (listed or not, and the areas), From HQ (the
  facts HQ set, locked). Each section is a card with its own icon and a one-line explanation.
- **Branch details** replaces "Branch in the app" and the shop-name sheet: name and city, address,
  customer phone, opening and closing time, weekly holiday, the location on the map, the app's
  radius and areas, and what HQ set (code, business, opened on, status, owners). The location
  is set once, on the map; the separate "Hub location" box is gone (both saved the same place,
  but only the map moved the shop's wash point).
- **Vehicles** has its own page in Branch: the same screen as HQ's page for the branch (each
  group with a switch, its kinds by size, a switch each), saving **the same list**. A switch
  in either place shows in the other, in New Wash, This branch's prices and the customer app; a
  kind switched back on brings its vehicle back even if it was once removed by hand. The old
  photo-picker drawer is gone.
- **A plan opens on its own page,** like a service (HQ › Services and plans › Plans): a header
  that updates as you type (where it's sold, from ₹…, discount or own prices), then The plan
  (name, the wash, washes and months with − / +, a better wash now and then), Where it's sold
  (Communities / At the shop / Shop and communities, with shop use and paying in parts), Price
  (from the wash price less a discount, or an own price per size, with what members pay), and
  How it shows. Services and plans share the same editor cards.
- **Price books in This branch's prices.** Above "Move every price", the owner sees HQ's price
  books (Standard, Metro, Value…) and the one the branch uses. A new Pricing rule, **"Owners may
  pick their price book"** (off by default), lets them switch: they're warned first, their own
  prices are cleared, and every price (community too) becomes the new book's. With the rule off
  the books are shown, and HQ picks.
- **All branches shows each branch's pricing:** "Standard prices", or "Standard + 12 own prices"
  when its owner set some; each price book says how many of its branches have their own prices.
- **How this branch washes is just the three switches** (Shop, Community, Doorstep). "Where you
  wash" and its sheet are gone: every place washes exactly what's switched on in Vehicles (kept
  in step on every menu build), and starts from the branch's location (moving the pin moves the
  team too).
- **One distance for the branch:** Branch details › "How far you serve customers" (3–30 km). It's
  how far people find the branch in the customer app, and how far its team goes; saving it sets
  the hub's and the team's reach, so there's no second distance to keep in step.
- **HQ sees what a branch changed.** On HQ's page for a branch, a service its owner stopped
  selling says "Stopped by the branch", and Prices says how many shop prices the owner set
  themselves (or that every price is the book's).
- **Vehicle size guide:** each company's logo beside its name in "Pick a company" and in the
  list. The logos now live in the shared UI package, used by both apps.
- **What this branch offers** (shop, community, doorstep switches) moved to How this branch
  washes.
- **This branch's prices: one tab per vehicle group.** Instead of "Cars & more" and
  "Two-wheelers", the page has a tab for each group the branch washes (Two-wheeler, Car,
  Three-wheeler, Commercial, Heavy, Farm & machines), as chosen when it opened. Each tab shows
  that group's vehicles and only the HQ services priced for them (Anti-Rust isn't under
  Three-wheeler).
- **Plans live with Services.** HQ › Services and plans has a Services | Plans tab bar; the
  separate Wash plans row under Communities is gone.
- **HQ wording brought up to date.**
  - A service's "Where it's done" says how prices work now: one hub price, a community pays it less
    the community rule, a home adds the visit charge (it used to say community and doorstep share
    one price).
  - The plan editor's second price column is "Community ₹" (it read "Doorstep ₹").
  - A branch's "Plans sold here" knows shop plans: each plan says where it's sold at this branch
    (at the shop, at communities, or both) and which switch in the agreement it needs.
  - A branch's price book shows its real name (Standard, not "Default book"), and Metro or Value
    read "Any branch can use it · 0 branches" instead of "This branch only".
  - Pricing rules' example names the vehicle and size: "Basic Wash · Car S at ₹499".
  - Smaller: the Base prices row no longer mentions vehicle sizes (they're in the vehicle size
    guide), the Services and plans screen is titled so, and a branch with one person reads
    "1 person".
- **Mana Wash HQ without the extra screen.** More › Mana Wash HQ now lists All branches,
  Services and plans, Base prices and Pricing rules directly; the "Business price list" screen in
  between is gone, with its Branches and "Hub, community and doorstep" rows (both opened All
  branches, which already shows the price books). The business name, admins, "Update every branch
  now" and "Copy this branch's menu in" are in **HQ settings**. The owner's own row, "Services &
  prices", is now **This branch's prices**, so it isn't mixed up with HQ's. Counts read
  "0 branches", not "0 branchs".
- **Opening a branch is six steps**, one screen each, with a progress bar, Back and Next (the
  phone's back button goes back a step): 1 Where it is (pincode, map pin) · 2 The branch (code,
  name, town and area, checks) · 3 Services in the agreement · 4 Services and plans it sells
  (every service with a switch, and which plans that sells) · 5 Vehicles it washes (by group and
  size) · 6 Its owner, with a summary to change any step, then Open branch. Steps 4 and 5 use the
  same lists as the branch page's Services and Vehicles tabs; the Services tab now shows the
  plans sold there too.
- **Each branch washes its own vehicles.** "Vehicles we wash" is gone from the Business price
  list. What a branch washes is now set per branch (migration 0031; every branch keeps what it
  washed: Kovur, cars and two-wheelers):
  - **Opening a branch** has a step "Vehicles it washes" (cars and two-wheelers ticked to start).
  - **A branch's page** has a **Vehicles** tab: a switch per group and per kind. A kind switched
    off leaves that branch's New Wash and customer app (plans already sold carry on) and its
    size guide says "we don't wash these". A group no hub or team takes yet is given to them, so
    the kind gets prices.
  - **Which size each kind is priced as** (Compact SUV = M) stays with head office, in the
    **vehicle size guide** (see below).
  - The business-wide on/off switch is retired (`PATCH /business/body-types` no longer takes
    `active`; the bulk switch is removed).
- **Everything about vehicles is in the vehicle size guide.** Staff look things up; head office
  gets **Edit guide**:
  - **Kinds and sizes** for every group: move a kind to another size (its price changes at every
    branch), rename kinds, sizes and groups.
  - **Models**: add a new launch, move a model to another kind, rename it, take it off the list,
    or put a changed or removed one back. Changes show as "Added" / "Changed".
  - The 1,820 models still ship with the app; head office's changes are kept on the server
    (migration 0032) and reach the guide on every phone and the customer app's "add your
    vehicle" (company and model lists, and the suggested vehicle type).
  - Base prices no longer has the sizes; it's only prices.
- **No vehicle photos.** The 31 vehicle pictures are gone (6 MB smaller). Vehicles show as a
  simple bike or car icon everywhere: New Wash, the vehicle picker, customer profiles, the size
  guide, Vehicles we wash and the customer app. Brand logos and the Mana logo stay. Demo data
  and the speed report use one plain drawn sample picture instead.
- **Pricing rules is simpler.** It now holds only what branch owners may do: set their own
  prices (up to a % more or less, with an example like "Basic Wash at ₹299: an owner can
  charge ₹239 to ₹359") and stop offering a service. Its link shows where the prices are
  (Base prices). Removed:
  - **Price zones** (on the backlog for when branches open in very different towns). The
    zone picker is gone from a branch's Prices tab.
  - **The extra on shop prices.** Shop prices are the hub prices; the API refuses one.
  - **The rounding choice.** Worked-out prices always round to the nearest ₹1.
- **Home washes use the hub price.** Branch menus give a hub price to every service the team
  does at homes, even where the shop itself doesn't do it, and to vehicles only the team washes.
  The shop still doesn't sell those: New Wash leaves them off "At the shop", the customer app
  doesn't list them at the shop, and the API refuses them (`not_at_shop`). A service done only
  at the shop or only at communities is refused at homes (`not_at_homes`). A branch's own
  hand-made services keep their doorstep prices.
- A community rule can now be a discount: before, "10% less" was raised to ₹0 by the minimum
  extra. The minimum now only applies to extras.
- **Sri Mana Wash Partner.** The team app is now named **Sri Mana Wash Partner**, with package
  `com.sprixia.srimanawashpartner` (was `com.sprixia.manawashpartner`). It installs as a new app,
  so the team signs in again (WhatsApp code, then PIN). The splash shows శ్రీ above MANA, in the
  printed card's gold, and the card itself stacks శ్రీ above MANA. The customer app is unchanged.
- **New app names.** The team app is now **Mana Wash Partner** (package
  `com.sprixia.manawashpartner`, was `com.sprixia.manawashmanager`) and the customer app is
  **Mana Wash** (package and iOS bundle `com.sprixia.manawash`, was `com.sprixia.manacarwash`;
  links now open with `manawash://`). Each new package installs as a new app, so phones sign in
  once again. Every screen, message, web page and logo uses the new names, and migration
  `0015_brand_names` renames the business row from "MANA Car Wash" to "Mana Wash".
- **Launcher icon** drop is 25% smaller, so it no longer looks zoomed in on the home screen.
- **Sign-in clean-up.** Every session is now tied to a phone: anything that signs in needs the
  phone key (`device_key_required` otherwise), and tokens without one are refused. All of a
  number's live rows are one person (the PIN-match check is gone). The business lookup no longer
  makes a business for a branch without one (`catalogRepo.businessForShop`; HQ opens every
  branch inside Mana Wash). Removed the old `DEV_OTP_BYPASS` / `DEV_OTP_CODE` setting names (use
  `DEV_MODE` / `DEV_RECOVERY_CODE`), the unused `signup` code purpose and `notePinDigits`.
  `MAX_SHOPS_PER_OWNER` is now `MAX_BRANCHES_PER_PERSON`.
- **Staging test codes only for listed numbers.** Staging accepts the fixed test code only for
  the numbers in `STAGING_TEST_PHONES` (the demo team), so nobody can sign in there as someone
  else; `*` allows every number for a deliberate test-script run. Local dev is unchanged.
- **No more join requests.** Nobody signs themselves up: the owner (or a manager, for staff) adds
  people from Team, and HQ adds owners. A number on no team is told to ask them (`no_account`
  from `POST /auth/start`). Removed the `/signup` routes, join tickets, the Team requests list and
  approve/decline, the branch-ID invite, and the `join_requests` table (migration
  `0016_remove_join_requests`). `test:signup` is now `test:team`.
- **HQ only from the team.** A number can be made HQ only if it is already on a team at one of the
  business's branches (`not_on_team` otherwise), so a mistyped or recycled number can't become HQ.

### Added

- **Managers.** A third role between owner and staff: everything staff do, plus adding staff,
  approving or declining join requests, and resetting staff PINs. No money fixes, prices, reports
  or settings — every money fix stays with the owner. Owners add managers; HQ adds owners
  (`canManageMember`). Migration `0013_roles_and_trusted_phones` widens the role check.
- **Branch status, set by HQ only.** Active, Paused (no new washes; washes already open can be
  finished and paid; no join requests) or Closed (nobody there can sign in; hidden from customers).
  Pausing or closing needs a reason, which the team sees on the Home screen; every change is
  logged with who made it (`PATCH /business/branches/:id/status`, history at
  `GET /business/branches/:id/status`, migration `0012_branch_status`).
- **Mana Wash HQ section** in More, for phones in `business_admins`: **All branches** shows today's
  and this month's paid washes and takings, washes in progress and team size for every branch
  (`GET /business/overview`), with pause / close / reopen, owners and price books per branch.
- **Trusted phones.** The first sign-in on a phone needs a WhatsApp code, after which the PIN is
  enough. A phone stays trusted until its user signs out, or their PIN is reset. The app sends a
  random per-install key (`x-device-key`); only its hash is stored (`trusted_devices`).
- **The PIN reset ladder.** The owner resets staff and managers, HQ resets owners and anyone at
  more than one branch, Sprixia resets HQ after a phone call (`npm run support:reset-pin`). A reset
  clears the PIN on every branch, signs the person out and forgets their phones; it never signs
  anyone in. They return with a WhatsApp code, choose a new PIN, and are told who reset it and
  when. Every reset is logged (`pin_resets`).
- People at two branches (owners, managers or staff) switch between them from the branch name,
  with one PIN for both.
- HQ sees each branch's managers and staff in **All branches → the branch**, with Reset PIN for
  people who work at more than one branch (`GET /business/branches/:id/team`).
- `docs/AUTHENTICATION.md`: every sign-in process, case, limit and error code in one place.
- `npm run test:access` (74 checks): roles, resets, trusted phones, the 6-digit upgrade, pause and
  close, history and the HQ overview. Runs in CI.

### Changed

- **Changing your phone number** now signs out your other phones, stops trusting phones for the
  old number, and trusts the phone that made the change for the new one.

- **6-digit PINs for owners, managers and HQ.** Staff keep 4 to 6 digits. An owner or manager on a
  shorter PIN is asked for a new 6-digit one (after their current PIN) before anything else opens.
- **Forgot PIN works the same for everyone**: a WhatsApp code, then a new PIN.
- Team: owners and managers no longer set anyone's PIN — everyone chooses their own after a
  WhatsApp code. "Set PIN" and "Remove PIN" are replaced by **Reset PIN**.
- Sign out also stops trusting the phone, so the next sign-in there needs a WhatsApp code.
- **Branches are opened only by Mana Wash HQ.** Nobody can start a shop from the app any more:
  the "owner or staff" choice is gone, and a new number goes straight to "Join your branch" (enter
  the 6-digit branch ID; an owner or manager approves in Team). HQ (a phone in `business_admins`)
  opens branches from **More → Mana Wash HQ → All branches → Open a branch** with the branch name, city and
  owner's name and phone (`POST /business/branches`); the branch gets the business menu at once
  and its owner signs in with a WhatsApp code and sets a PIN. Every branch belongs to the Mana
  Wash business; migration `0011_hq_branches` links any branch that wasn't.
- **Only HQ adds or removes branch owners.** In Team, owners add staff and managers, managers add
  staff, and neither can change, turn off or remove an owner (`hq_only`). HQ does it from the
  branch in All branches (`/business/branches/:id/owners`), and can't remove a branch's last
  owner.

- **New look for the MANA Car Wash app (and the shared UI).** Deep indigo and white throughout:
  a new hero (gradient, glow, stars and the logo watermark), a floating bottom bar, and the same
  edge-to-edge lists on every screen. Home gets a latest-wash card, free-wash cards that show each
  stamp as a water drop, offer and gift tickets with a Copy button, an invite card, and skeleton
  loading. Washes are grouped by month in one continuous list. The shared form fields, chips,
  buttons, bottom sheet and dialogs follow the new look, so the Wash Manager picks it up too.
- The wash list and wash detail the customer app reads now say whether the vehicle is a car or a
  bike (`vehicle.category`), so the right icon shows.
- The customer app needs a native rebuild: it adds `@react-native-clipboard/clipboard` (run
  `npm run pods` in `apps/customer` for iOS).

### Removed

- **Software plans.** Free / Pro, the 14-day trial, staff seats, the 300-washes limit, 7-day
  reports, the plan screen, upgrade sheets and PRO badges, and Razorpay subscriptions
  (`/billing`). Every branch gets every feature. Razorpay stays for customer payment links only.
  `test:plans` is replaced by `test:access`.
- **The owner recovery code** (`POST /auth/recover`, `OWNER_RECOVERY_CODE`). WhatsApp codes and
  the reset ladder replace it.
- `PUT` / `DELETE /team/:id/pin` (an owner choosing someone else's PIN); use
  `POST /team/:id/reset-pin`.
- Starting a shop: `POST /signup/shop`, the `signup` code purpose, the `signup.open` platform
  setting (deleted by migration 0011) and the app's sign-up screens.
- "Open another shop" for owners (`POST /auth/shops`); owners still switch between their branches.
- Business admins are no longer created automatically: the first owner of a business used to
  become its admin on first visit. HQ is now exactly the phones listed in `business_admins`.

## [0.5.1] - 2026-10-03

### Fixed

- Overlapping requests no longer hang on Cloudflare ("Worker's code had hung", request
  cancelled). 0.5.0 shared one Prisma client across requests, but Cloudflare won't let one request
  wait on database work another request started. Each request now borrows its own client from a
  small pool for its whole life (including work that finishes after the response) and hands it
  back afterwards, so clients are reused without being shared and memory stays flat. Cron jobs get
  their own client.

## [0.5.0] - 2026-10-03

### Added

- **Rewards (Pro): stamp cards and welcome gifts.** The owner sets it up in More → Rewards.
  - **Stamp cards:** turn on a card for any service, with a free one every 2 to 100 washes. Each
    car has its own card per service. A paid wash adds a stamp (combos count, one visit can
    stamp several cards) and voiding it takes the stamp back. Existing wash history counts.
  - **Free wash:** when a card is full, New Wash shows "Use free". The customer decides; it's
    never applied on its own. It's priced at the car's size, the washer still earns commission,
    and it's saved as a full-price line with a 100% "Loyalty reward" discount. It needs internet,
    so two phones can't give away the same one, and it earns no stamp.
  - **6-month rule:** if a car skips that service for 6 months its card resets and a saved free
    wash expires. Staff see a warning 10 days before, on New Wash, the customer page and in
    Reminders. The WhatsApp reminder mentions a waiting free wash or the stamps so far.
  - **Welcome gift:** up to 5 Inventory items, given on every new car's first paid wash
    (including an existing customer's new car). Stock goes down on pay and back on void. The pay
    screen shows what to hand over.
  - **Owed gifts:** when an item is out of stock the wash goes ahead and the gift is saved as
    owed, with no expiry. Staff see it on the next visit and can mark it "Given" from New Wash,
    the customer page or Rewards. Inventory shows "N customers waiting".
  - **Job board:** a small tag on the row shows what to hand over: "Owed: Wash mitt" (amber)
    while the car is owed something, or the welcome gift given on today's paid wash.
  - **Reports:** free washes used and what they were worth, gifts handed over by item, and gifts
    owed now.
  - Walk-in plates never get stamps or gifts.
- `npm run test:rewards` (API, in CI): end-to-end checks for stamps, free washes, voids, gifts,
  owed gifts and the report. `test:isolation` now also proves one shop can't read or change
  another shop's rewards.
- Demo seed: two stamp cards, a welcome gift, one free wash used today and three gifts owed.
- Staging tooling (API): `npm run db:reset:staging`, `npm run db:seed:staging`, and the test
  scripts accept `--staging` (or `MANA_TARGET=staging`). `npm run perf:report` times every screen,
  read and write and saves a report to `apps/api/perf-results/`. Staging and local dev responses
  carry a `Server-Timing` header (server time, database time, rounds and queries).

### Changed

- Production database `mana_db` moved from Australia (OC) to Asia-Pacific (APAC), next to the
  Chennai server: the empty database was deleted, recreated in APAC and given every migration.
  It holds no data; shops are created by in-app sign-up.
- New MANA logo set (`branding/logo/`) and Android app icon, including the adaptive icon for
  Android 8 and later.

### Fixed

- The API no longer runs out of memory when requests overlap on Cloudflare ("RangeError: Invalid
  array buffer length", HTTP 500). Each request built new Prisma clients, each loading its own query
  engine; one client per database is now shared across requests, which also cuts CPU per request.
- Two phones using the same free wash a moment apart could both get it. Exactly one now does.
- The job board's More button told screen readers "new errors to review" whatever its dot meant;
  it now says why (new errors, someone waiting to join, or stock running low).
- Demo seed no longer stops at "Signing everyone in" when the local API is still reopening the
  freshly reset database.

## [0.4.1] - 2026-10-03

### Changed

- **Faster screens.** Each screen now asks the database for everything it needs at once instead of
  one question after another, and the answers are exactly the same as before. Most screens take
  one database trip; 24 common requests went from 98 trips to 30. Examples: job board and job
  details 13 → 1, reminders 8 → 1, customer directory 5 → 2, customer profile 6 → 2, and cash
  drawer, expenses, attendance, services, stats and staff report → 1.
- **Sign-in check remembered for reads.** Every request checks who's asking. That check loads the
  user, plan and staff order together, and screens that only read reuse it for 30 seconds.
  Writes, sign-in and billing always check fresh. Only Pro shops are remembered, so a payment
  shows at once. A shop's memory is dropped after any change it makes or any billing update.

### Fixed

- Reminders no longer fails with a server error when more than about 100 vehicles are due.

### Added

- `npm run perf:trips` (API): counts database trips per screen against a local server started
  with `--var DEV_DB_DELAY_MS:100`. The delay only works on a local dev server.
- Roadmap: a "Speed and latency" section with the options, the recommendation, and moving
  production `mana_db` to APAC before launch.

## [0.4.0] - 2026-10-03

### Added

- **Free and Pro plans**, the same rules for every shop:
  - **Free:** the owner + 1 staff, 300 washes a month, reports for today and the last 7 days.
  - **Pro:** up to 5 staff, unlimited washes, and photos, reminders, coupons, referrals, full
    reports and PDF export, expenses, cash drawer, commission, attendance, inventory, staff
    report and the audit trail.
  - New shops get a 14-day Pro trial, then drop to Free unless they pay. Nothing is deleted.
- **Payments with Razorpay** (Test Mode until the account is activated): UPI AutoPay or card on
  Razorpay's hosted page, ₹499 a month or ₹4,999 a year. The first 50 shops to pay get ₹399 /
  ₹3,990 for life (every renewal); shop 51 onwards pays ₹499. A founder slot is held from
  checkout until the first charge, so the 50 can't be oversold while payments are pending; when
  several owners take the last spot at once, exactly one gets it. A shop can't be charged twice:
  parallel upgrade taps start one checkout, and a second subscription that still goes live is
  cancelled and refunded automatically. A signed webhook, a check when the owner returns to the app and a nightly
  catch-up keep the plan right even if a webhook is late or lost. Setup: README → Go live →
  Payments.
- **Branch price:** an extra branch goes Pro for ₹349 a month or ₹3,490 a year while another of
  the owner's shops is on paid Pro (a trial doesn't count). A shop always gets the cheapest price
  it qualifies for. It's set when the branch subscribes,
  and the plan screen shows it as "Branch price" with a BRANCH tag on the subscription.
- **Your plan screen** (More → Your plan, owner only): trial or Pro status, this month's washes,
  monthly or yearly with the founder price, upgrade, check payment, cancel, and payment history.
- **PRO tags during the trial too** (teal, not locked) on every Pro feature, so owners know
  what needs Pro before the trial ends; the plan screen shows "After [date], these need Pro"
  next to an "Always free" list.
- **Upgrade sheet** whenever a Free shop taps a Pro feature or hits a limit, **PRO pills** on
  locked rows, and a Job Board banner when washes are running low, the limit is reached, a
  payment failed or the trial is ending.
- **`npm run test:plans`** (also in CI): every Free limit, the trial, payment grace,
  cancellation and the webhook signature, checked against the real API.

### Changed

- **Over the staff limit**, the owner and the longest-serving staff keep working; anyone else
  can't sign in (and is signed out) until the shop upgrades. Team shows them as "Needs Pro".
- **Wash #301 on Free** is refused with the upgrade sheet. Washes already started can still be
  finished and paid, and washes recorded offline still sync (up to 25 extra).
- **Opening another shop (branch) needs paid Pro** on one of the owner's shops; a free trial
  doesn't count. The new branch starts on Free with its own plan and bill, and no second trial. On Free
  or trial, More shows a PRO pill and the upgrade sheet.
- **Database:** migration `0002_billing.sql` adds the subscription columns on `shops` and the
  `billing_payments` and `billing_events` tables; `0003_founder_hold.sql` adds
  `shops.founder_hold_until` and `founder_hold_at`; `0004_cash_close_history.sql` adds
  `cash_day_closes`. Run `npm run db:migrate:staging` before deploying.
- **Changing your number** now sends a WhatsApp code to the new number; you enter it, then your
  PIN. A mistyped number can no longer lock you out of your account.
- **Service prices are capped at ₹1,00,000** (on the phone and the server), so an extra zero or
  two can't slip into every bill.

### Fixed

- **Two things at once** (checked by the new `npm run test:races`, also in CI):
  - Two owners demoting, switching off or removing each other at the same moment can no longer
    leave a shop with no owner: taking owner access away is one statement that only runs while
    another active owner remains.
  - A double tap on "Create shop" makes one shop, not two. Sign-up, join approval, adding a
    teammate, changing a number and opening a branch each hold a short lock on the number, so
    two of them can't both see it as free. Two owners approving the same request both get the
    new teammate back.
  - Switching shops and signing in only reach an owner's own branches (owner rows with the same
    PIN), never a stray row on the same number.
  - Two owners setting the day's first float, marking the same attendance, saving settings,
    prices, commissions, combos or a reminder at once both get a clean answer instead of an error.
  - Two phones uploading the 10th photo of a job at once can't make 11 (the count and the save
    share a lock; the extra image is deleted from storage).
  - Two owners adding the same stock item at once get one item; the other is told it exists.
  - Two people using the last of an item at once leave it at zero, not minus.
- **Stock never goes below zero.** Using more than the books show (two phones offline, or a voided
  purchase that was already used) empties the item and the note keeps how much was really meant,
  e.g. "3 L meant, only 2 L on the books". Float dust such as 0.19999 litres no longer shows up.
- **Reopening a closed cash day keeps the earlier close.** The count, note, who closed it, who
  reopened it and why are all shown under "Earlier close" on the Cash screen.
- **Retries after a crash finish the job:** a retried payment settles the referral, a retried void
  hands back the coupon and cancels the referral, a retried expense void takes its stock back
  off, and a wash left without its lines is completed from the retry instead of showing empty.
- **A service picked twice** on one wash is merged into one line; at most 20 of one service and
  30 lines per wash.
- **A phone with the wrong date or time** can no longer put a wash, payment or photo on another
  day. The app sends its clock reading with every request, and the server uses only how long the
  action waited on the phone.
- **Impossible dates** such as 31 February are refused in reports instead of rolling into March.

## [0.3.0] - 2026-10-02

### Added

- **Staging backend on Cloudflare** at `https://api-staging.manawashmanager.com`: Worker
  `mana-api-staging`, D1 database `mana_db_staging` (Asia-Pacific), R2 buckets
  `mana-files-staging` and `mana-backups-staging`, and the nightly backup at 03:00 IST.
- **Staging test codes**: until WhatsApp sign-in codes are live, staging accepts the fixed code
  `000000` (`ENVIRONMENT=staging` plus `STAGING_TEST_CODES=true`). Production sets neither, so it
  can't turn on there.
- **New sign-in header** (`AuthHero`): brand row, a large title for each step on the water
  gradient, a back button, and the phone number as a pill with a Change button.
- **Sign-up progress bar**: "Step 1–3 of 3" with a three-part bar.

### Changed

- **Sign-in screens redesigned**:
  - The number field highlights while typing.
  - "Who are you?" uses full-width Owner and Staff rows instead of boxed cards.
  - Forgot PIN uses simple rows with icons.
  - The WhatsApp code screen's back button returns to where you came from.
- **Release builds use the staging API** (`release.json`) while it's being tested. This switches
  to `https://api.manawashmanager.com` when production goes live.
- **Build plan**: WhatsApp sign-in codes added to the roadmap as an action item, alongside the
  staging and go-live steps.

## [0.2.0] - 2026-10-02

### Added

- **Multi-shop platform**:
  - Shop-scoped database client.
  - Shop sign-up, and join requests using a 6-digit shop ID.
  - Branches with a shop switcher.
  - Isolation and sign-up test suites.
- **Shop operations**: WhatsApp login codes, before/after photos, cash drawer, staff commission,
  attendance, referrals, inventory and an error log.
- **Database**:
  - Numbered migrations with a schema check, plus constraints and indexes.
  - Nightly paged backups with a restore script.
  - A staging environment config.
- **CI workflow** running typecheck, lint, tests and the database check.

### Changed

- **Mobile**:
  - Session stored in the keychain.
  - Hardened offline queue, plus an error boundary.
  - Package renamed to `com.sprixia.manawashmanager`.
- **Edge-to-edge home header**; report PDFs are named after the signed-in shop.

### Fixed

- **Release build**: Hermes path, vehicle images (JPEG data saved as `.png`), and an APK built
  for ARM only (34 MB instead of 61 MB).

### Security

- Atomic PIN and code attempt counters, and IP rate limits on sign-in.
- Session revocation when a PIN changes.
- Conditional job status updates, and replay-safe uploads.

## [0.1.0] - 2026-09-25

First numbered release. This is the starting point for release numbering; an earlier internal
build was labelled 2.0.0.

### Added

- **Washes**: job board, new wash with live pricing, payments (cash, UPI, other), and reports with
  PDF export.
- **Team**: team roles and PIN sign-in, offline sync and an audit trail.
- **Money and customers**: expenses and net reports, vehicle reminders with comeback coupons, and
  a customer profile.
- **One shared MAJOR.MINOR.PATCH version** across every app and package.

[Unreleased]: https://github.com/admin-sprixia/ManaWashManager/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/admin-sprixia/ManaWashManager/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/admin-sprixia/ManaWashManager/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/admin-sprixia/ManaWashManager/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/admin-sprixia/ManaWashManager/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/admin-sprixia/ManaWashManager/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/admin-sprixia/ManaWashManager/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/admin-sprixia/ManaWashManager/releases/tag/v0.1.0
