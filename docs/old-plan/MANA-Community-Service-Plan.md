# MANA — Community Service Plan (PRD)

**Brand:** MANA Car Wash. **App:** MANA Wash Manager, built by Sprixia Labs Private Limited
**Feature:** **Communities**: MANA Car Wash washes cars and bikes where its customers live,
on subscription. One technician rides from the car wash to one community and washes many
vehicles in one trip, using the community's water. The car wash is the **hub**: it stores the
kits, charges batteries, does repairs and takes the heavy jobs.

**Status:** draft for approval. No code has been written for this yet. Every price, plan,
number of washes, duration, commission and provider below is a setting, not a decision; section
11 lists what is still open.

---

## 0. The story

Hrushikesh owns **Sprixia Labs Private Limited**, a software company, and bought a car wash in
Nellore. Being the tech person, he builds its software himself.

**MANA is the car wash's brand.** The car wash is **MANA Car Wash**, and **MANA Wash Manager**
is its own in-house app, built by Sprixia Labs. MANA is not sold to other car washes (decided
4 Oct 2026): public sign-up is closed, and the app exists to run MANA Car Wash as well as
possible.

MANA Car Wash will grow in two directions:

- **Branches:** more MANA car washes (hubs), added by the owner.
- **Communities:** washing cars and bikes at apartments, gated villas and small clusters of
  houses near each hub, on subscription.

### Names

| Layer | Name | Who sees it |
|---|---|---|
| Brand | MANA Car Wash | Everyone: walk-in customers, residents, staff, signage |
| Staff app | MANA Wash Manager | Owner, managers, staff, technicians |
| Customer app | MANA Car Wash | Residents |
| Builder | Sprixia Labs Private Limited | Nobody day to day (the company that writes the software) |

### Why the code still keeps shops apart

MANA's multi-shop foundation stays: each **branch is a shop**, and the code that keeps shops'
data apart keeps every branch's cash, staff and reports clean. It also keeps the door open: if
the software is ever sold later, it would get its own product name, separate from the car wash
brand, and the foundation is already there.

---

## 1. The idea in one picture

```
MANA Car Wash (the business)
  └─ Hub = one of its car washes (each is a shop in the app)
       ├─ the physical car wash (exactly what MANA does today)
       └─ Service zones (areas around the hub)
            └─ Communities: an apartment, a gated villa layout, or 3–4 houses on a street
                 └─ its own layout, as deep or flat as it really is
                    (towers, blocks, wings, phases, streets, buildings — or nothing)
                      └─ Homes (flat 1204, villa 17, house 3-45)
                           └─ Customers (residents) and their Vehicles (cars, bikes)

Subscription ("8 washes a month, exterior + vacuum, for this car")
   └─ the scheduler creates Service visits (one per wash, on a date)
        └─ visits are grouped by community + date into a Community job batch
             └─ a technician works the batch, car by car
                  └─ each wash leaves Evidence (photos, times, issues)
```

The one rule everything rests on: **a subscription is not a wash.** A subscription is a
promise. Visits are the washes the car wash plans to do. A batch is one trip to one community.
Evidence proves what happened. They are four separate records, and the reports, money and
complaints all hang off the right one.

### Principles

1. Density beats random bookings: a car wash only serves communities it has added and switched
   on. A "community" can be as small as 3 houses, as long as it's worth the trip.
2. Subscriptions come first; one-time washes are allowed but secondary.
3. One trip, many vehicles: visits are planned per community per day, never one car at a time.
4. Mobile washes are fast and standard; heavy work is sent to the hub as a lead.
5. Hub customers are offered a subscription where they live; communities the car wash doesn't
   serve yet are recorded as demand, not turned away.
6. Real places are messy: a community's layout is whatever it really is, never a fixed
   "tower → floor → flat" form.
7. Joining needs the customer's consent: staff can enrol a customer, but the customer confirms
   with a WhatsApp code.
8. Equipment is modular: one broken washer must not stop a technician for days.
9. Nothing commercial is hardcoded: prices, plans, taxes, durations, commissions, vehicle
   categories.
10. MANA owns its customer relationship, its data and its software. Hoora is a market reference
    only; nothing of theirs is copied.
11. Built for many branches from day one: nothing is tied to the first hub.

---

## 2. How it fits into MANA

MANA today runs walk-in car washes: one **shop** per car wash, owner and staff sign in with a
PIN, the job board, New Wash, cash, rewards and reports. An owner with several branches already
has one shop per branch. With sign-up closed, the owner adds branches; MANA's own shops are
always on the full plan, so Free/Pro limits never get in the way.

Communities is switched on per hub in Settings (a hub that doesn't serve communities yet keeps
the icon hidden).

**Where it lives in the app:** a new **Communities** icon (a group of buildings) in the home
screen header, next to Reports. Header order: Reminders · Reports · **Communities** · More.

**What stays exactly as it is:** the physical car wash: job board, New Wash, cash drawer,
coupons, rewards and reports.

**What we reuse:**

- Customers, vehicles, vehicle types, services and per-size prices.
- WhatsApp codes (already used to sign owners in), now also to confirm a customer joining.
- Inventory and stock moves (issue chemicals and cloths to a technician).
- Expenses (hub costs), attendance, job photos.
- Offline mode and the outbox, the error log.
- Coupons and rewards (a subscriber still earns and uses them at the hub).
- Razorpay code from Plans and billing, when online customer payments are added.

**What is new:**

- A **business** above shops, so one car wash company can have several hubs that share
  communities, customers, plans and technicians, with reports per hub and combined. Businesses
  never see each other's data, like shops today.
- Communities, their flexible layout, homes and parking spots.
- Community membership: which customer lives in which home, and how they joined.
- Mobile services, subscription plans, subscriptions, visits, batches and evidence.
- The **technician mode** in the staff app.
- The **customer app** (new; today customers never sign in).
- Customer payments and invoices, behind a payment-provider switch.
- Complaints, incidents, hub leads and community demand.
- Roles beyond owner and staff, and an audit log.

The physical car wash and the community service share **one customer record**: the person who
brings their SUV to the hub can subscribe for their bike at home, and both show on their page.

---

## 3. Communities

### 3.1 What counts as a community

Anything the car wash can reach in one trip and wash several vehicles at:

- An apartment (one building, or many towers)
- A gated community of villas or row houses
- A layout or colony with plots and streets
- **3–4 independent houses** next to each other on a street
- Later, anything else (an office car park, a hostel) — the type is just a label

The **type** only pre-fills the setup and helps reports; it never limits what can be entered.

### 3.2 Layout: as deep or as flat as the place really is

Some apartments have towers and blocks, some only towers, some one building with nothing.
Villas have phases and streets; a house cluster has nothing at all. So a community's layout is a
**tree the car wash builds**, not a fixed form:

- Each level has a **name the user picks**: Tower, Block, Wing, Phase, Building, Street, Lane,
  Floor, Basement, Parking area — or any word they type ("Sector", "Cross", "Annexe").
- Any depth: `Phase 2 → Block C → Tower 4`, or just `Tower A`, or no levels at all.
- **Homes** (flat, villa, house, plot — again the user's word) sit at any level, including
  directly under the community.
- Levels and homes can be added, renamed, moved or merged later, without breaking members,
  vehicles or history.

**Quick setup** offers starting shapes, all fully editable afterwards:

| Starting shape | Pre-fills |
|---|---|
| Apartment with towers | Towers A, B…; homes typed as flat numbers |
| Single building | No levels; homes as flat numbers |
| Blocks and towers | Blocks, each with towers |
| Villas / gated layout | Phases or streets; homes as villa numbers |
| Few houses | No levels; homes as house numbers with their own addresses |
| Start empty | Nothing; build it as you go |

And a car wash never has to finish the layout first: it can add "Flat 1204, Tower B" while
enrolling a customer, and the level and home are created on the spot.

### 3.3 Where the vehicle is parked

Parking is separate from the home, because a flat in Tower B can park in Basement 2 of Tower
A. Each vehicle has an optional **parking spot**:

- a place in the layout (e.g. `Basement 2 → Zone C`), if the community has one;
- a slot label (`C-142`), free text;
- a landmark ("next to the lift, under the tree"), free text;
- a photo of the spot.

For a house it's usually just "in front of the gate" and a photo. All of it is optional, and the
technician's queue sorts by whatever is filled in.

### 3.4 What else a community holds

- Address, map location, service zone, contacts (association, property manager, security, a
  house owner for small clusters).
- Water: available, where (with photo), tap type or adapter, limits. Electricity: available,
  allowed. Washing spot, drainage.
- Wash days and allowed hours; entry process; security instructions; technician requirements.
- Permission: none needed (houses), verbal, letter, agreement — with dates and documents.
- Status: **Demand** (residents asked, not served) → **Prospect** (talking to them) →
  **Active** → **Paused** → **Closed**.
- Notes and documents.

### 3.5 Several homes, several communities

A customer can have more than one home (their flat, and their parents' house in another
community). Each **vehicle** has one home location at a time; moving a vehicle moves its future
visits.

---

## 4. Getting customers into a community

**MANA's team adds every resident.** Owners, managers and staff can add residents (4.1, 4.2).
Residents can't sign themselves up: the customer app only lets in phone numbers the team has
added. **Anyone else** — an apartment resident, an individual house, a 2–4 flat building, a place
MANA has never talked to — can send a **service request**; the manager calls or visits, explains
the prices, and approves (they become a customer) or rejects it (4.3, 4.4).

Every path ends in the same place: a **member** of the community (a customer linked to a home,
with vehicles), who may or may not have a subscription yet. A member without a subscription is a
lead the car wash can follow up, offer a one-time wash, or invite later.

**WhatsApp for now:** codes are the fixed test code (`000000`), as sign-in works on staging
today, and messages are saved to the customer's message history without being sent. When a real
WhatsApp number is connected, codes and messages go out for real with no other change.

### 4.1 A new customer, enrolled by staff (phone + WhatsApp code)

At the community (or a stall at the gate), staff tap **Communities → Prestige Lakeside → Add
customer**.

1. Enter the customer's phone number.
2. The app sends a **6-digit code on WhatsApp to the customer** ("MANA Car Wash: your code to join
   at Prestige Lakeside is 482193").
3. The customer reads it out; staff type it in. This proves the number is theirs and records
   their consent to be a MANA Car Wash customer (required under India's data protection law, DPDP
   Act 2023).
4. Name, home (pick or type: Tower B → Flat 1204), vehicles (plate, car or bike, make, model,
   colour, photo) and parking spot.
5. Optionally pick a plan and take payment now (section 7.6), or leave them as a member.

If the code doesn't arrive (no WhatsApp), the customer can confirm through a link by SMS later
(once an SMS provider is chosen), and the member is marked **unconfirmed** until then: they can
be saved, but no subscription starts.

### 4.2 An existing hub customer

The person is already a customer of the car wash (they've come in for washes). Staff search by
**phone or plate**, either from **Communities → Add customer** or from the customer's page at the
hub (**Add to community**).

1. Their existing record and vehicles appear; nothing is retyped.
2. Pick the community and home; tick which of their vehicles are parked there.
3. A WhatsApp code confirms (same as 4.1). They're already a customer, so this isn't about
   identity; it's consent to home visits and checking the phone is still theirs.
4. Offer a plan, or leave them as a member.

The hub's pay screen also nudges staff: "Lives in a community you serve? Add them" — and if the
community isn't served yet, it's saved as **demand** for that community (4.4).

### 4.3 The customer app: registered numbers only, plus "Request service"

**A resident the team has added:** installs the MANA Car Wash app, enters the same phone number
and the WhatsApp code, and sees their home, vehicles, plan and washes straight away. In the app
they can pick or change a plan and pay, skip a wash, pause, rate and complain — but not add
themselves to a community or create a new account.

**A number the team hasn't added** can't sign in. Instead of a dead end, the app shows
**Request service**, open to anyone:

1. **Starting prices first:** "Car wash plans from ₹X a month, bikes from ₹Y. Final price after
   our team talks to you." (Taken from the plans' lowest prices, so it's never typed twice.)
2. **Where:** drop a **map pin** (or pick an area from a list if they won't share location),
   then the address. If they live in a community MANA serves, they can pick it, and their home.
3. **What kind of place:** apartment, individual house, small building (2–4 flats), office or
   other.
4. **Vehicles** (car or bike, how many) and a preferred time.
5. Name; the phone is already proved by the WhatsApp code.

The request appears in the staff app (**Communities → Requests**, with the map pin). The manager
calls or visits, explains the prices and agrees a deal, then **approves** it (the customer is added
as in 4.1 with the details already filled in, and can then sign in) or **rejects** it (with an
optional reason sent to them). Approving puts the customer in one of three places:

- **An existing community**, if they live in one MANA serves.
- **A new community**, for an apartment or a group of houses (the free layout fits both).
- **"Nearby homes – <area>"**, a simple community per area for individual houses, so the
  technician visits them on one route. The manager sets the price in the deal; the branch's
  minimum-vehicles setting is a guide, not a block.

Until approved, the app shows "Request received — our team will call you" with the request's
status.

Each community gets a **QR poster and a link** ("Scan to join MANA Car Wash at Prestige Lakeside")
for the notice board or the residents' WhatsApp group. Scanning opens the app with the community
already picked: a registered resident just signs in; anyone else lands on Request service.

### 4.4 Service area, and places not served yet

Each branch has a **service radius** (e.g. 8 km from the hub, set by the owner) and a backup
**list of areas** (Nellore, Kovur, …) for customers who don't share their location. A pin inside
any branch's radius, or a listed area, is **serviceable**: the request goes to that branch.

**Outside every branch's area**, the app doesn't stop at "not available". It says "We're not in
your area yet. Leave your details and we'll tell you when MANA Car Wash comes to you", and saves
the request as **demand** with its location. The owner sees demand on a list and a map: where
people are asking is where the next branch or route should go.

Inside the area, a place MANA doesn't serve yet works the same way. Arjun requests service from
**Sunrise Towers**: it's saved as **demand** for that place (creating a Demand community if it's
the first request). When Sunrise Towers has 17 requests, it tops the demand list and the owner
approaches the association. When it launches, all 17 get a message, and approving them makes them
members in one tap. Four neighbours on one street asking is a community worth starting.

### 4.5 Duplicates and moves

- One phone = one customer per branch. Adding someone already known always links the existing
  record. In the pilot a customer belongs to one branch; the same person at two branches is two
  records, as today (sharing across branches comes later).
- A plate already on another customer is flagged ("This car is on Ravi's account — sold or
  shared?") rather than duplicated.
- Moving home: change the vehicle's home; visits from the next date follow it; history stays.

---

## 5. Who uses it (roles)

Roles are sets of permissions, so MANA can add or split roles later without code changes. During
the pilot, most of these are one person.

| Role | Can do |
|---|---|
| Business owner | Everything, across every hub; the only one who can add branches, add branch owners and see all branches together. |
| Branch owner | Everything an owner does today, but only in the branch (or branches) given to them; can't add branches or see other branches. |
| Operations manager | Communities, plans, schedules, technicians, batches, complaints; no money settings. |
| Hub manager | Their hub's car wash (today's owner screens), its technicians, kits, stock. |
| Sales | Community pipeline, demand, enrolling members, hub-to-subscription leads. |
| Support | Customers, subscriptions (pause, credit), complaints, refund requests. |
| Accountant | Payments, invoices, refunds, financial reports; read-only elsewhere. |
| Hub staff | Today's staff role, plus adding residents and handling service requests. |
| Technician | Their own day: batches, vehicles, evidence, exceptions, leads. |
| Customer | Their own homes, vehicles, subscriptions, visits, payments, complaints. |
| Community admin (later) | Their community's schedule, approved technicians, counts; never resident details. |

Today's "owner" becomes Business owner + Hub manager; today's "staff" becomes Hub staff. Nobody
loses access in the change.

A branch owner is added by the business owner from that branch's Team screen. Removing them, or
moving them to another branch, is one tap and never touches the branch's data.

---

## 6. Day-to-day journeys

### A resident's subscription

Priya (Prestige Lakeside, Tower B, Flat 1204) subscribes. She sees her wash days (Prestige
Lakeside is washed Tuesday and Friday), pays, and gets a WhatsApp confirmation with her first
wash date. After each wash she gets a WhatsApp message and sees the after photo in the app. She
can rate it or raise a complaint from that wash.

### A technician's day

Ravi checks in at the hub at 7:00, picks up **KIT-001** and **Bike 01**.

1. The app shows **Today: Prestige Lakeside — 13 vehicles (8 cars, 5 bikes)**, then **Gandhi
   Street houses — 4 vehicles**. Water point, hours and security notes are on the first screen.
2. At the gate he taps **Start community**. The queue follows the layout and parking spots.
3. For each vehicle: plate, photo, parking spot and photo, the service, the customer's notes.
   **Start** → before photo (if the service requires it) → wash → **Complete** → after photo.
4. Problems are one tap, with a photo where it helps: car not there, can't reach parking, no
   water, equipment problem, battery problem, existing damage, **recommend hub service**.
5. Everything works with no signal (basements). It syncs when he's back in range.
6. **Finish community** shows done, skipped and why. He moves on, or returns to swap batteries.
7. Back at the hub he checks the kit in and checks out. The day's summary is saved.

### A car isn't there

Ravi taps **Car not there** with a photo of the empty spot. The visit is marked *customer
missed* and the wash is **postponed** to her next wash day, using one of her 2 postpones this
month (7.3). Priya gets a message with the photo and the new date.

### The car wash can't do the wash

The community's water is off. Ravi taps **No water**. Every remaining visit in that batch becomes
*car wash missed*, never charged to the customer, and operations is alerted to reschedule them
(the next wash day, or an extra day). Rain works the same way (**Weather**).

### A washer breaks

Ravi taps **Equipment problem**. Operations sees the alert and sends the spare from the hub. In
the pilot this is an alert plus a note; full equipment tracking is Phase 2.

### Community customer → hub service

Ravi sees heavy stains on Priya's seats and taps **Recommend hub service → Interior deep
clean**, with a photo. Priya sees the suggestion in her app; staff get a lead to call her. If she
books and the hub does the job, the revenue is credited to the community lead.

### Pausing, renewing, cancelling

Priya goes away for 3 weeks and pauses in the app. No visits are created while paused; the end
date moves (if the plan allows pauses). Renewal is reminded on WhatsApp before the end. If she
cancels, future visits are removed; any refund follows the plan's rule.

### A complaint

Priya says one side was missed. She raises it from that visit (photo attached). Staff see the
visit, technician, evidence and community together, and approve a rewash, a credit or a refund.

---

## 7. Rules

### 7.1 Prices are locked at sale

A subscription copies the plan's price and rules when it's bought. Changing the plan later
affects new subscribers only, and renewals only if the owner chooses "apply at renewal".

### 7.2 Visit statuses and what they cost the customer

| Status | Meaning | The wash |
|---|---|---|
| Scheduled | Planned for a date | Reserved |
| In progress | Technician started | Reserved |
| Done | Completed, evidence saved | Used |
| Customer missed | Car not there, moved, customer said skip on the spot | Postponed (uses a postpone; used once the month's postpones are gone) |
| Car wash missed | No water, no access, equipment, technician absent, weather | Always postponed; never counts |
| Skipped by customer | Skipped in the app before 8 pm the day before | Postponed (uses a postpone) |
| Cancelled | Subscription paused or cancelled | Released |

Which "missed" it is comes from the reason the technician taps, not a manual choice, so
reliability reports are honest.

### 7.3 Postponing (decided 4 Oct 2026)

- **Car not there, or skipped in advance:** the wash moves to the next wash day. Up to **2
  postpones per plan month** (a setting the owner can change; default 2). The app warns the
  resident on the last one ("This was your last postpone this month").
- **After the month's postpones are used,** a further missed or skipped wash counts as used.
- **Postponed washes must be used within the same plan month;** they don't carry into the next
  month, so every month starts clean.
- **Car wash's side** (no water, no access, weather, technician absent, equipment): always
  postponed, with no limit and never counted against the resident.
- **Extra postpone by hand:** an owner or manager can give one as goodwill (audited).

### 7.3a Skipping a wash

A resident can skip a coming wash in the app until **8 pm the evening before** (a setting), so
the technician's list for the morning is final. After 8 pm the app says it's too late for
tomorrow's wash. A skip is postponed by the rules above.

### 7.3b Branch codes and receipt numbers (decided 4 Oct 2026)

- Every branch has a permanent **branch code**: `MCW-<3-letter city>-<4-digit number>`, numbered
  per city, e.g. **MCW-NLR-0001**, **MCW-NLR-0002**, **MCW-KVL-0001**. The app suggests it when the
  owner adds a branch (city letters + next free number); it can be edited before saving and never
  changes afterwards.
- Residents see the **branch name**: messages say "MANA Car Wash – Kavali"; the customer app
  shows "Your branch: MANA Car Wash – Kavali". Staff screens show "Kavali (MCW-KVL-0001)".
- **Receipt numbers:** `<branch code>/<financial year>/<5-digit count>`, e.g.
  **MCW-KVL-0001/26-27/00001**, restarting at 00001 each April, per branch. Never repeated or
  skipped.
- The existing 6-digit shop ID that staff type to ask to join a shop stays, for staff only.

### 7.4 How visits are planned (pilot)

Each community has **wash days**. A plan with "2 per week" gets the community's two days; "8 per
month" gets two per week on those days; a weekly plan picks one. A nightly job creates visits for
the next 14 days and groups them into one batch per community per day; operations assigns the
technician (or the app suggests the usual one). Small communities near each other (four houses
on Gandhi Street, three on Nehru Street) are put on the same day so one trip covers both.
Estimated time per batch comes from service durations, so operations sees when a day is too
full.

No route optimisation in the pilot: real durations and travel times from the pilot come first.

### 7.5 Service area

Customers can only subscribe in communities the car wash marked **Active**, inside an enabled
zone. An address alone never creates a booking; it creates a service request (inside a branch's
radius or listed areas) or demand (outside them) — see 4.4.

### 7.6 Payments (not decided; built so it doesn't matter)

Every payment goes through one interface with two providers at the start:

- **Recorded:** the customer pays by UPI or cash; staff (or the customer, with a UPI reference)
  record it; the subscription activates when staff confirm.
- **Razorpay:** added later as a second provider, with payment links first and auto-debit (UPI
  AutoPay or card mandate) after that.

Switching providers is a setting. Unpaid cycles follow the plan's rule (e.g. visits stop after N
days unpaid).

### 7.7 Evidence

Each service says whether before and after photos are required. A required photo blocks
**Complete** unless the technician gives a reason. Photos carry the time and technician. GPS is
saved when available, but isn't relied on; it doesn't work in basements.

### 7.8 Consent and privacy

- A customer joins a community only after confirming (code or link). Every enrolment records who
  enrolled them, how they confirmed and when.
- Customers can see and delete their data from the app; the car wash can export it.
- A community admin (later) sees counts and schedules, never names, phones or flats.

---

## 8. Data model

All tables carry `businessId` (and `hubId` where the record belongs to one hub), so a second hub
or city is a row, not a rebuild. Money is in paise, times in UTC, like today.

### 8.1 Places

- **Business:** the car wash company. Owns hubs, communities, plans, customers, technicians.
- **City.**
- **Hub:** today's shop, plus address, location, opening hours, **service radius** and
  **service areas** (named areas or pincodes, the backup when there's no pin).
- **ServiceZone:** belongs to a hub; a named area of communities. Enabled or disabled.
- **Community:** name, type label, address, location, zone, status, wash days, hours, entry
  process, security notes, permission, approximate vehicles.
- **CommunityFacilities:** water, water point and photo, tap type, limits, washing spot,
  drainage, electricity available and allowed.
- **CommunityContact:** name, role, phone, email.
- **CommunityAgreement:** permission type, dates, revenue share (configurable), documents.
- **CommunityPlace:** one level of the layout: community, parent place (empty = top level),
  **kind** (the user's word: Tower, Block, Street…), name, sort order. Any depth.
- **Home:** community, place (optional), **kind** (Flat, Villa, House, Plot…), number, own
  address (for houses), notes.
- **ParkingSpot:** community, place (optional), slot label, landmark, photo.

### 8.2 People

- **User:** anyone who signs in (staff, technician, customer); phone plus PIN or WhatsApp code.
- **Role, Permission, UserRole:** what each person can do, per business and per hub.
- **Customer:** today's record, extended with email and preferences. One per phone per business.
- **Membership:** customer, home, status (unconfirmed, member, left), **how they joined**
  (staff with code, approved service request, from demand), enrolled or approved by, confirmed at.
- **ServiceRequest:** from the customer app: name, phone, map pin and/or area, address, place
  kind (apartment, house, small building, office, other), community and home if picked,
  vehicles, preferred time, branch (from the service area, empty when outside), status
  (pending, approved, rejected, out of area), handled by, reason.
- **Vehicle:** today's record, plus car or bike, make, model, variant, colour, **home** and
  **parking spot**, photos, instructions. Permanent; never just a booking field.
- **CommunityDemand:** a person interested in a place not served yet, or outside every branch's
  area (phone, name, vehicles, place typed or picked, map pin, consent).
- **Technician:** a user with a profile: hub, zones, skills, employment status, shift.
- **TechnicianShift**, **Attendance** (reuse today's), **Leave** (Phase 2).

### 8.3 What the car wash sells

- **Service:** today's service, plus **channel** (hub, community or both), **duration by vehicle
  type**, and whether before or after photos are required.
- **ServicePrice:** today's per-size price; one-time community prices use the same table.
- **SubscriptionPlan:** name, vehicle types, services, **washes per cycle**, cycle length,
  wash pattern, validity, tax, pause, postpones per month, refund rules, active dates.
- **PlanPrice:** price per vehicle type, optionally **per community** or zone, promotional prices
  with dates. A new price never changes existing subscribers (7.1).
- **AddOn:** an extra service on a subscription or a single visit.

### 8.4 Subscriptions and visits

- **Subscription:** customer, plan, the **price and rules copied at sale**, status, start, end,
  auto-renew, pause history.
- **SubscriptionVehicle:** which vehicles it covers.
- **SubscriptionCycle:** one billing period: washes allowed, used, missed, postpones used and
  left (nothing carries into the next month); linked to its payment.
- **ServiceVisit:** one planned wash of one vehicle on one date: subscription (or one-time
  booking), vehicle, services, status, reason, technician, times, batch.
- **CommunityJobBatch:** one community on one date for one technician or team; status, times,
  counts.
- **TechnicianAssignment:** who works which batch.
- **ServiceEvidence:** photo (before, after, damage, exception), time, technician, visit, notes.
- **VisitEvent:** every status change with who and when (like today's job events).

### 8.5 Money

- **Payment:** amount, method, provider, reference, status; for a cycle, booking or add-on.
- **Invoice (receipt):** gap-free number per business per financial year, PDF.
- **Refund**, **Credit** (customer wallet), **Discount**, and today's **Coupon**.
- **PaymentProvider:** the switch between "recorded" and Razorpay (and others later).

### 8.6 Quality, support and growth

- **Rating** (per visit), **Complaint** (linked to customer, vehicle, visit, technician,
  community, payment), **Incident** (damage, injury, property, security; witnesses, cost,
  resolution).
- **HubServiceLead:** from a technician or staff; recommended service; status (new → contacted →
  booked → done → lost); linked hub job; revenue.
- **CommunityLead** (Phase 2 pipeline): stage, decision maker, meetings, follow-up, proposal,
  expected vehicles, trial.
- **Notification:** event, channel (WhatsApp, SMS, push, email), recipient, status; behind a
  provider switch.
- **AuditLog:** who changed what and when, for every money and operations action.

### 8.7 Equipment (Phase 2)

- **Equipment:** type, brand, model, serial, hub, kit, condition, warranty, maintenance dates.
  Generic; no manufacturer is built in.
- **Battery:** platform, capacity, status (charging, ready, in use, faulty), cycles, dates.
- **MobileKit:** a named set of equipment and batteries, assigned to a technician and a bike.
- **Bike:** registration, insurance, PUC, odometer, service, fuel expenses.
- **RepairTicket:** fault, reported by, replacement assigned, repair, back in service.

---

## 9. Features by phase

### Pilot MVP — one hub, one kit, one technician, a few communities

Built in this order; each milestone is usable on its own.

1. **Foundation:** business above shops, roles and permissions, audit log, zones.
2. **Communities:** the Communities icon; add a community (type, quick setup), the flexible
   layout, homes, parking spots, facilities, contacts, wash days and hours, status, QR poster.
3. **Enrolment:** add a new customer with a WhatsApp code (test code for now); add an existing
   hub customer; memberships; service requests (approve or reject, with map pin); demand
   (list and map); branch service radius and areas; "add to community" from
   the hub's customer page and pay screen.
4. **Catalogue:** community services (channel, durations, photo rules), subscription plans,
   per-community prices, add-ons.
5. **Subscriptions:** create, pay, activate, pause, resume, renew, cancel, credit; locked prices;
   cycles.
6. **Scheduler:** nightly visits and community batches; assign a technician; move, skip or add a
   visit by hand.
7. **Technician mode:** today, batches, vehicle queue by layout and parking, start and complete,
   photos, exceptions, hub-service recommendation, finish community, end of day; offline.
8. **Customer app:** sign in with a number the team added (others: request service, with
   starting prices and a service-area check), see home and
   vehicles, choose a plan, pay, see washes with photos, skip (until 8 pm the day before), pause,
   rate, complain.
9. **Payments:** the provider interface, the "recorded" provider, receipts.
10. **Notifications:** WhatsApp for joined, subscribed, wash tomorrow, done (with photo), missed,
    payment due, renewal, community launched; push in the customer app.
11. **Complaints and incidents:** linked to every related record; rewash, credit, refund.
12. **Owner dashboard and reports:** vehicles today (cars, bikes), monthly recurring revenue,
    active subscriptions, members and subscribers per community, demand per place, missed visits
    by reason, complaints, average wash time, technician vehicles per day.

Milestones 1–3 alone already let MANA map its first communities and sign residents up from
the staff app, before a single subscription is sold.

### Phase 2 — after the pilot works

- Community sales pipeline and agreements; demand dashboard and launch messages.
- Mobile kits, equipment, batteries, bikes, repair tickets, equipment failure workflow.
- Consumables issued to technicians and used per visit (on today's inventory).
- Technician shifts, leave, overtime, incentives (rules configurable).
- Hub bookings from the customer app (deep clean, detailing… from the hub's own menu).
- Community → hub and hub → community leads with revenue attribution.
- Support desk (tickets with status and SLAs).
- Razorpay (payment links, then auto-debit); refunds through the provider.
- Profit per community and per technician; hub vs community vs combined profit.

### Phase 3 — many communities and technicians

- Cluster scheduling and route optimisation; automatic technician assignment.
- Capacity, demand and inventory forecasting; preventive equipment maintenance.
- Community admin (association) portal.
- Multiple hubs and cities in daily use; zone boundaries on a map.
- Advanced analytics.

---

## 10. Apps and how we build it

### Apps

- **Staff app (today's app):** hub screens unchanged; the **Communities** icon for owners and
  permitted staff (communities, layout, members, enrolment, plans, subscriptions, schedule,
  technicians, complaints, demand, dashboard); **technician mode** for technicians.
- **Customer app (new):** **MANA Car Wash** on the Play Store, Android first (iOS later), same
  repo and shared packages, with the MANA logo and colours. Residents of any MANA branch use the
  same app; their community decides which hub serves them.
- **API:** the same Cloudflare Worker and database, new route groups (`/communities/...`,
  `/customer/...`); customers have their own sign-in and can only ever see their own data.

### How we build it

- **Every table is scoped to its hub** through the repository layer, like shops today; isolation
  tests extended to customers (never another resident's data) and technicians (only their
  batches).
- **Offline first** for technicians: the day's batches, vehicles, spot photos and instructions
  download in the morning; actions go through the outbox; photos upload later.
- **Speed:** every tap updates the screen at once and saves in the background; planning runs at
  night, not on taps.
- **Providers behind switches:** payments, WhatsApp/SMS, push, maps.
- **Audit:** every money and status change is an event row; nothing financial is deleted, only
  reversed.
- **Tests:** end-to-end checks for layouts (flat and deep), enrolment and consent, subscriptions,
  scheduling, visit outcomes and billing, offline sync, isolation; always run with a second
  branch to prove nothing is tied to the first hub. All in CI like today.

---

## 11. Decisions and what's still open

### Decided (4 Oct 2026)

1. MANA is the car wash's own brand and app; not sold to other car washes; public sign-up closed.
2. One **MANA Car Wash** customer app for all branches.
3. Branches are added only by the business owner; each has a name and a permanent code like
   **MCW-KVL-0001** (7.3b). Messages show "MANA Car Wash – <branch name>".
4. Roles: business owner (all branches), branch owner (only their branches), manager, staff,
   technician.
5. Communities can be any shape (apartments, villas, layouts, a few houses), with free layouts.
6. Owners, managers and staff add residents. The customer app lets in only numbers the team
   added; anyone else sends a **service request**, approved or rejected by the team.
7. Skipping allowed until 8 pm the evening before.
8. Car not there or skipped: postponed, up to 2 per plan month (setting); the car wash's side
   always postponed; postponed washes stay within the month.
9. WhatsApp: fixed test code and saved (unsent) messages until a real number is connected.
10. Customers belong to one branch in the pilot.
11. Residents get numbered receipts (no GST invoices).
12. **Request service is open to anyone** (apartments, individual houses, small buildings, new
    places); the manager calls or visits, agrees the deal, and approves or rejects. Starting
    prices are shown before they request.
13. **Service area:** each branch has a radius from the hub (map pin) plus a backup list of areas.
    Outside it: "not in your area yet", saved as demand with the location.
14. **Individual houses** are accepted and grouped as "Nearby homes – <area>"; the manager sets
    the price; minimum vehicles is a guide.

### Still open (settings, so none of these block the build)

- Pressure washer, vacuum and bike models.
- Subscription and service prices; washes per month; plan structure.
- Technician salary and incentives; community revenue share and association terms.
- Each branch's radius and area list; wash durations; water and battery use (the pilot will
  measure them).
- Payment gateway (start with "recorded"), real WhatsApp number, maps provider.
- Wash days set per community (assumed; staff can move one vehicle to another day).
- Smallest community worth a trip (warning below 3 vehicles per wash day, a setting).
- Technicians: employees only, or contractors too (a profile field; no pay rules in the pilot).

---

## 12. Risks

- **Basement signal:** offline-first, tested in a real basement before launch.
- **Association permission is withdrawn:** community → Paused stops visits and notifies members;
  credits follow the plan's rule.
- **Damage disputes:** before photos and existing-damage notes protect both sides.
- **Messy layouts:** the free layout keeps real places enterable; homes typed in service requests
  are checked by staff when approving.
- **Small clusters that don't pay:** the minimum-vehicles setting and same-day grouping of nearby
  clusters; profit per community in Phase 2 shows which to drop.
- **Consent:** no subscription without a confirmed member; every enrolment is recorded.
- **Too much too early:** the pilot MVP is the whole first build; Phase 2 waits for real data.
- **First-hub shortcuts:** with one hub, it's tempting to hardcode its communities, prices or
  name. Every such value is a setting, and tests run with a second branch.
- **Residents across branches:** in the pilot a resident is a customer of one hub; sharing across
  branches comes later (implementation plan, Part 1.1).

---

## 13. Questions the owner can answer when this is done

"We" here means the car wash, seeing only its own business.

| Question | Where it comes from |
|---|---|
| How many vehicles did we service today? | Visits done today (cars, bikes) |
| How many vehicles can one technician do per day? | Visits per technician-day, wash times |
| Which community is most profitable / losing money? | Revenue per community minus its costs (Phase 2) |
| How much recurring revenue do we have? | Active subscriptions × monthly price |
| What's our churn? | Cancelled or not renewed per month |
| How long does each service really take? | Start to complete per service and vehicle type |
| How much travel time do we waste? | Batch finish to next batch start; hub to first batch |
| Which equipment keeps failing? Which batteries need replacing? | Repair tickets, battery cycles (Phase 2) |
| How many community customers went to the hub, and hub customers joined a community? | Leads and memberships with their source |
| Which places should we launch next? | Demand per place (apartments and house clusters) |
| What does one car and one bike wash cost us? | Consumables, technician time, travel, share of hub costs |
| Profit of community service, hub, and combined? | Revenue and costs split by channel |

---

## Suggested next step

Approve or change this plan and answer the questions in section 11. Then milestones 1–3
(foundation, communities, enrolment) become a detailed build plan with the exact database changes
and migration, the same way the multi-shop plan was done.
