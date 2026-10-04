# MANA — Apartment Mobile Service Plan (PRD)

**Product:** MANA Wash Manager, by Sprixia Labs Private Limited
**Goal:** a new MANA feature, **Apartment Service**, that lets any car wash on MANA wash cars
and bikes inside apartment complexes on subscription. One technician rides from the car wash to
one apartment and washes many vehicles in one trip, using the apartment's water. The car wash is
the **hub**: it stores the kits, charges batteries, does repairs and takes the heavy jobs.

**Who is who:**

- **Sprixia Labs** builds and sells MANA. It is the software vendor.
- **SRI Car Wash** (working name) is a separate business that subscribes to MANA, and is the
  first car wash to run Apartment Service. Sprixia and SRI have the same owner, but in the
  software SRI is an ordinary customer of MANA, exactly like any other car wash.
- **Residents** are SRI's customers, not Sprixia's. SRI owns its customer relationship and its
  data; Sprixia only operates the platform.

So nothing in this plan is written for SRI specifically. SRI's apartments, plans, prices, brand
and technicians are all SRI's own data and settings. If it works for SRI, it works for the next
car wash that buys it.

**Status:** draft for approval. No code has been written for this yet. Every price, plan,
number of washes, duration, commission and provider below is a setting, not a decision; section
10 lists what is still open.

---

## 1. The idea in one picture

```
Sprixia Labs runs MANA (the platform)
 └─ Business = a car wash company that subscribes to MANA (first: SRI Car Wash)
  └─ Hub = one of its branch car washes (today: one MANA shop)
       ├─ the physical car wash (exactly what MANA does today)
       └─ Service zones
            └─ Apartments
                 └─ Towers → parking levels / zones → slots
                      └─ Vehicles (cars, bikes) ← Customers (residents)

Subscription ("8 washes a month, exterior + vacuum, for this car")
   └─ the scheduler creates Service visits (one per wash, on a date)
        └─ visits are grouped by apartment + date into an Apartment job batch
             └─ a technician works the batch, car by car
                  └─ each wash leaves Evidence (photos, times, issues)
```

The one rule everything rests on: **a subscription is not a wash.** A subscription is a
promise. Visits are the washes we plan to do. A batch is one trip to one apartment. Evidence
proves what happened. They are four separate records, and the reports, money and complaints all
hang off the right one.

### Principles (from the business brief, in the order they shape the software)

1. Apartment density beats random bookings: a car wash only serves apartments it has approved.
2. Subscriptions come first; one-time washes are allowed but secondary.
3. One trip, many vehicles: visits are planned per apartment per day, never one car at a time.
4. Mobile washes are fast and standard; heavy work is sent to the hub as a lead.
5. Hub customers who live in apartments are offered a subscription; unsupported apartments are
   recorded as demand, not turned away.
6. Equipment is modular: one broken washer must not stop a technician for days.
7. Nothing commercial is hardcoded: prices, plans, taxes, durations, commissions, vehicle
   categories.
8. Each car wash owns its customer relationship and data; Sprixia owns the software. Hoora is
   a market reference only; nothing of theirs is copied.
9. Built for every car wash on MANA, never for one: SRI is the first user, not a special case.

---

## 2. How it fits into MANA

MANA today runs walk-in car washes: one **shop** per car wash, owner and staff sign in with a
PIN, the job board, New Wash, cash, rewards and reports. An owner with several branches already
has one shop per branch. Each car wash pays Sprixia for a MANA plan (Free or Pro today).

Apartment Service is switched on per business. Which MANA plan includes it, and what Sprixia
charges for it, is Sprixia's pricing decision (section 10); the software just checks whether the
business's plan includes it, the same way Rewards checks for Pro today.

**What stays exactly as it is:** the physical car wash. The hub's job board, New Wash, cash
drawer, coupons, rewards and reports don't change.

**What we reuse:**

- Customers, vehicles, vehicle types, services and per-size prices.
- Inventory and stock moves (issue chemicals and cloths to a technician).
- Expenses (hub costs: rent, electricity, salaries), attendance, job photos.
- WhatsApp codes and messages, offline mode and the outbox, the error log.
- Coupons and rewards (a subscriber can still earn and use them at the hub).
- Razorpay code from Plans and billing, when we add online customer payments.

**What is new:**

- A **business** above shops, so one car wash company (e.g. SRI with two branches) can have
  several hubs that share apartments, customers, plans and technicians, with reports per hub and
  combined. Businesses never see each other's data, like shops today.
- Apartments, towers, parking locations and their rules (water, power, hours, access).
- Mobile services, subscription plans, subscriptions, visits, batches and evidence.
- The **technician app** (a new mode of the staff app).
- The **customer app** (new; today customers never sign in).
- Customer payments and invoices, behind a payment-provider switch.
- Complaints, incidents, hub leads and apartment demand.
- Roles beyond owner and staff, and an audit log.

The physical car wash and the mobile service share one customer record: the same person who
brings their SUV to the hub can subscribe for their bike at home, and both show on their page.

---

## 3. Who uses it (roles)

Roles are sets of permissions inside one business, so a car wash can add or split roles later
without code changes. At SRI during the pilot, most of these are one person.

Sprixia's own people are **not** a role inside any business. Sprixia support works from the
Sprixia admin panel (plans, billing, owner PIN reset), and doesn't browse a car wash's customers.

| Role | Can do |
|---|---|
| Business owner | Everything, across every hub. |
| Operations manager | Apartments, plans, schedules, technicians, batches, complaints; no money settings. |
| Hub manager | Their hub's car wash (today's owner screens), its technicians, kits, stock. |
| Sales | Apartment pipeline, apartment demand, hub-to-subscription leads. |
| Support | Customers, subscriptions (pause, credit), complaints, refund requests. |
| Accountant | Payments, invoices, refunds, financial reports; read-only elsewhere. |
| Hub staff | Today's staff role at the car wash. |
| Technician | Their own day: batches, vehicles, evidence, exceptions, leads. |
| Customer | Their own vehicles, subscriptions, visits, payments, complaints. |
| Apartment admin (later) | Their apartment's schedule, approved technicians, counts; never resident details. |

Today's "owner" becomes Business owner + Hub manager; today's "staff" becomes Hub staff. Nobody
loses access in the change.

---

## 4. How it works for people (journeys)

### A resident subscribes (customer app)

Priya lives in **Prestige Lakeside, Tower B**.

1. She installs the app, enters her mobile number and the WhatsApp code.
2. She searches for her apartment. It's supported, so she picks Tower B and flat 1204.
3. She adds her car: make, model, colour, number plate, a photo, and where it's parked
   (Basement 2, Zone C, Slot C-142) with a photo of the slot.
4. She sees the plans for a car **in her apartment** (apartment prices if set), picks one and
   sees her wash days (Prestige Lakeside is washed on Tuesday and Friday).
5. She pays (see section 6.6) and gets a WhatsApp confirmation and her first wash date.
6. After each wash she gets a WhatsApp message and sees the after photo in the app. She can rate
   it or raise a complaint from that wash.

### A resident's apartment isn't supported

Arjun searches for **Sunrise Towers**. It isn't supported. The app says "We're not in Sunrise
Towers yet — SRI Car Wash will tell you when it is", and saves his name, phone, vehicle and apartment as
**demand**. When Sunrise Towers has 17 interested residents, sales sees it at the top of the
demand list and approaches the association. When it launches, all 17 get a WhatsApp message.

### A technician's day

Ravi checks in at the hub at 7:00, picks up **KIT-001** and **Bike 01**.

1. The app shows **Today: Prestige Lakeside — 13 vehicles (8 cars, 5 bikes)**, then
   **Green Meadows — 6 vehicles**. Water point, hours and security notes are on the first screen.
2. At the gate he taps **Start apartment**. The queue is sorted by tower and parking level.
3. For each vehicle: plate, photo, exact slot and slot photo, the service, the customer's notes.
   **Start** → before photo (if the service requires it) → wash → **Complete** → after photo.
4. Problems are one tap, with a photo where it helps: car not there, can't reach parking, no
   water, equipment problem, battery problem, existing damage, **recommend hub service**.
5. Everything works with no signal (basements). It syncs when he's back in range.
6. **Finish apartment** shows done, skipped and why. He moves on, or returns to swap batteries.
7. Back at the hub he checks the kit in and checks out. The day's summary is saved.

### A car isn't there

Ravi taps **Car not there** with a photo of the empty slot. The visit is marked
*customer missed*. What happens to the wash (counted as used, or carried forward) follows the
plan's missed-visit rule (section 6.3). Priya gets a WhatsApp message with a photo.

### We can't do the wash

The apartment's water is off. Ravi taps **No water**. Every remaining visit in that batch becomes
*we missed*, never charged to the customer, and operations gets an alert to reschedule them
(usually the apartment's next wash day, or an extra day).

### A washer breaks

Ravi taps **Equipment problem** on the pressure washer. Operations sees the alert and assigns
the spare washer from the hub (Phase 2: by kit and equipment ID). The broken one gets a repair
ticket when it comes back. In the pilot this is an alert plus a note; full equipment tracking is
Phase 2.

### Mobile customer → hub service

Ravi sees heavy stains on Priya's seats and taps **Recommend hub service → Interior deep
clean**, with a photo. Priya sees the suggestion in her app; support also gets a lead to call
her. If she books and the hub does the job, the revenue is credited to the mobile lead.

### Hub customer → subscription

A customer pays at the hub. The New Wash or pay screen shows "Lives in an apartment? Offer a
subscription". Staff ask for the apartment: if it's supported, she gets an invite on WhatsApp;
if not, it's saved as demand for that apartment.

### Pausing, renewing, cancelling

Priya goes away for 3 weeks and pauses in the app. No visits are created while paused; the end
date moves (if the plan allows pauses). Renewal is reminded on WhatsApp before the end. If she
cancels, future visits are removed; what she gets back follows the plan's refund rule.

### A complaint

Priya says her car was missed on one side. She raises it from that visit in the app (photo
attached). Support sees the visit, technician, evidence and apartment together, and can approve a
rewash (a new visit on the next wash day), a credit, or a refund.

---

## 5. Data model

All tables carry `businessId` (and `hubId` where the record belongs to one hub), so a second hub
or city is a row, not a rebuild. Money is in paise, times in UTC, like today.

### 5.1 Places

- **Business:** the company. Owns hubs, apartments, plans, customers and technicians.
- **City.**
- **Hub:** today's shop, plus address, location and opening hours. Physical car wash and mobile
  base.
- **ServiceZone:** belongs to a hub; a named area (and later a boundary) of apartments.
  Enabled or temporarily disabled.
- **Apartment:** name, address, location, zone, status (lead → active → paused → closed),
  approximate vehicles, **wash days** (e.g. Tue + Fri), allowed hours, entry process, security
  notes, technician requirements.
- **ApartmentFacilities:** water available, water point and photo, tap type or adapter, water
  limits, washing spot, drainage, electricity available and allowed.
- **ApartmentContact:** name, role (association, property manager, security), phone, email.
- **ApartmentAgreement:** status, start and end, revenue share (configurable), documents.
- **Tower** (block) → **ParkingArea** (level, zone) → **ParkingSlot** (label, photo). A vehicle
  can also have a free-text spot and landmark when slots aren't numbered.

### 5.2 People

- **User:** anyone who signs in (staff, technician, customer); phone plus PIN or WhatsApp code.
- **Role, Permission, UserRole:** what each person can do, per business and per hub.
- **Customer:** name, phone, email, apartment, tower, flat, preferences. Today's customer
  record, extended; one customer can have many vehicles and subscriptions.
- **Vehicle:** today's vehicle record, plus car or bike, make, model, variant, colour, apartment,
  parking slot, photos and instructions. Permanent; never just a booking field.
- **Technician:** a user with a profile: hub, zones, skills, employment status, shift.
- **TechnicianShift**, **Attendance** (reuse today's), **Leave** (Phase 2).

### 5.3 What the car wash sells

- **Service:** today's service, plus **channel** (hub, mobile or both), **duration by vehicle
  type**, and whether before or after photos are required.
- **ServicePrice:** today's per-size price; one-time mobile prices use the same table.
- **SubscriptionPlan:** name, vehicle types, services included, **washes per cycle**, cycle
  length (week, month or custom), wash pattern (on the apartment's wash days, or N per cycle),
  validity, tax, pause rule, carry-forward rule, missed-visit rule, refund rule, active from and
  to.
- **PlanPrice:** price per vehicle type, optionally **per apartment** or zone, and promotional
  prices with dates. A new price never changes existing subscribers (see 6.1).
- **AddOn:** an extra service that can be added to a subscription or to one visit.

### 5.4 Subscriptions and visits

- **Subscription:** customer, plan, the **price and rules copied at the time of sale**, status,
  start, current cycle, end, auto-renew, pause history.
- **SubscriptionVehicle:** which vehicles it covers (one plan can cover a car and a bike if the
  plan allows).
- **SubscriptionCycle:** one billing period: washes allowed, used, missed, carried forward;
  linked to its payment.
- **ServiceVisit:** one planned wash of one vehicle on one date: subscription (or one-time
  booking), vehicle, services, status, reason, technician, start and end times, batch.
- **ApartmentJobBatch:** one apartment on one date for one technician or team: status (planned →
  in progress → done), start and finish, counts.
- **TechnicianAssignment:** who works which batch.
- **ServiceEvidence:** photo (before, after, damage, exception), time, technician, visit, notes.
- **VisitEvent:** every status change with who and when (like today's job events).

### 5.5 Money

- **Payment:** amount, method, provider, provider reference, status, for which cycle, booking
  or add-on.
- **Invoice:** gap-free number per business per financial year, GST lines, PDF.
- **Refund**, **Credit** (customer wallet for credits and goodwill), **Discount**, and
  today's **Coupon**.
- **PaymentProvider:** the switch between "recorded by staff" and Razorpay (and others later).

### 5.6 Quality, support and growth

- **Rating** (per visit), **Complaint** (linked to customer, vehicle, visit, technician,
  apartment, payment), **Incident** (damage, injury, property, security, with witnesses, cost,
  resolution).
- **HubServiceLead:** from a technician or support, visit, recommended service, status (new →
  contacted → booked → done → lost), linked hub job, revenue.
- **SubscriptionLead:** from hub staff, the customer and apartment, status.
- **ApartmentDemand:** an interested resident in an unsupported apartment; grouped by apartment.
- **ApartmentLead** (Phase 2 pipeline): stage, decision maker, meetings, follow-up date,
  proposal, expected vehicles, trial.
- **Notification:** event, channel (WhatsApp, SMS, push, email), recipient, status; behind a
  provider switch like payments.
- **AuditLog:** who changed what and when, for every money and operations action.

### 5.7 Equipment (Phase 2)

- **Equipment:** type, brand, model, serial number, hub, kit, condition, warranty, maintenance
  dates. Generic; no manufacturer is built in.
- **Battery:** platform, capacity, status (charging, ready, in use, faulty), cycles, dates.
- **MobileKit:** a named set of equipment and batteries, assigned to a technician and a bike.
- **Bike:** registration, insurance, PUC, odometer, service, fuel expenses.
- **RepairTicket:** fault, reported by, replacement assigned, repair, back in service.

---

## 6. Rules

### 6.1 Prices are locked at sale

A subscription copies the plan's price and rules when it's bought. Changing the plan later
affects new subscribers only, and renewals only if the owner chooses "apply at renewal".

### 6.2 Visit statuses and what they cost the customer

| Status | Meaning | The wash |
|---|---|---|
| Scheduled | Planned for a date | Reserved |
| In progress | Technician started | Reserved |
| Done | Completed, evidence saved | Used |
| Customer missed | Car not there, moved, owner said skip | Per plan's missed-visit rule |
| We missed | No water, no access, equipment, technician absent, weather | Never used; must be redone |
| Skipped by customer | Customer skipped in advance (before the cut-off) | Carried forward if the plan allows |
| Cancelled | Subscription paused or cancelled | Released |

"Customer missed" vs "We missed" is chosen by the reason the technician taps, not by hand, so the
reports on our reliability are honest.

### 6.3 Missed-visit and carry-forward rules (settings per plan)

- Customer missed: count as used, or carry forward up to N per cycle.
- We missed: always redone; first choice the apartment's next wash day, else an extra day.
- Unused washes at cycle end: lost, or carried into the next cycle up to N.

### 6.4 How visits are planned (pilot)

Each apartment has **wash days**. A plan with "2 per week" gets the apartment's two days; "8 per
month" gets two per week on those days; a weekly plan picks one. A nightly job creates visits
for the next 14 days and groups them into one batch per apartment per day; operations assigns
the technician (or the app suggests the apartment's usual one). Estimated time per batch comes
from service durations, so operations can see when a day is too full.

No route optimisation in the pilot: real durations and travel times from the pilot are what
Phase 3 needs first.

### 6.5 Service area

Customers can only subscribe in apartments the admin marked active, inside an enabled zone. An
address alone never creates a booking.

### 6.6 Payments (not decided; built so it doesn't matter)

Every payment goes through one interface with two providers at the start:

- **Recorded:** the customer pays by UPI or cash; staff (or the customer, with a UPI reference)
  record it; the subscription activates when staff confirm.
- **Razorpay:** added later as a second provider, with payment links first and auto-debit
  (UPI AutoPay or card mandate) after that.

Switching providers is a setting. Unpaid cycles follow the plan's rule (e.g. visits stop after N
days unpaid).

### 6.7 Evidence

Each service says whether before and after photos are required. A required photo blocks
**Complete** unless the technician gives a reason. Photos carry the time and technician. GPS is
saved when available, but isn't relied on; it doesn't work in basements.

---

## 7. Features by phase

### Pilot MVP — one hub, one kit, one technician, a few apartments

Built in this order; each milestone is usable on its own.

1. **Foundation:** business above shops, roles and permissions, audit log, hub, zones.
2. **Apartments:** apartments with facilities, contacts, wash days and hours, towers and
   parking, documents and notes. Admin screens in the staff app.
3. **Catalogue:** mobile services (channel, durations, photo rules), subscription plans,
   per-apartment prices, add-ons.
4. **Customers and vehicles:** the existing records extended with apartment, flat, parking
   slot and photos; several vehicles per customer.
5. **Subscriptions:** create, pay, activate, pause, resume, renew, cancel, credit; locked
   prices; cycles.
6. **Scheduler:** nightly visit creation and apartment batches; assign a technician; move,
   skip or add a visit by hand.
7. **Technician app:** today, batches, vehicle queue by parking, start and complete, photos,
   exceptions, hub-service recommendation, finish apartment, end of day; offline.
8. **Customer app:** sign in, find an apartment (or register demand), add vehicles and parking,
   choose a plan, pay, see upcoming and past washes with photos, skip a wash, pause, rate,
   complain.
9. **Payments:** the provider interface, the "recorded" provider, receipts; GST invoices.
10. **Notifications:** WhatsApp for subscribed, wash tomorrow, done (with photo), missed,
    payment due, renewal; push in the customer app.
11. **Complaints and incidents:** linked to every related record; rewash, credit, refund.
12. **Owner dashboard and reports:** vehicles today (cars, bikes), monthly recurring revenue,
    active subscriptions, subscribers and visits per apartment, missed visits by reason,
    complaints, average wash time per service, technician vehicles per day.

### Phase 2 — after the pilot works

- Apartment sales pipeline and agreements; apartment demand dashboard and launch messages.
- Mobile kits, equipment, batteries, bikes, repair tickets, equipment failure workflow.
- Consumables issued to technicians and used per visit (on today's inventory).
- Technician shifts, leave, overtime, incentives (rules configurable).
- Hub bookings from the customer app (deep clean, detailing, etc. from the hub's own menu).
- Mobile → hub and hub → subscription leads with revenue attribution.
- Support desk (tickets with status and SLAs).
- Razorpay (payment links, then auto-debit); refunds through the provider.
- Profit per apartment, per technician; hub vs mobile vs combined profit.

### Phase 3 — many apartments and technicians

- Cluster scheduling and route optimisation; automatic technician assignment.
- Capacity, demand and inventory forecasting; preventive equipment maintenance.
- Apartment admin (RWA) portal.
- Multiple hubs and cities in daily use; zone boundaries on a map.
- Advanced analytics.

---

## 8. Apps and screens

- **Staff app (today's app):**
  - Hub staff and owners keep today's screens.
  - New **Mobile** area for owners and operations: Apartments, Plans, Subscriptions, Schedule
    (calendar of batches), Technicians, Complaints, Leads and demand, Dashboard.
  - Technicians who sign in get a **technician mode** home: Today → batch → vehicle.
- **Customer app (new):** a separate Android app (iOS later) for residents, built in the same
  repo with the same shared packages. Residents are the car wash's customers, so the app shows
  **the car wash's name, logo and colours** (SRI Car Wash for SRI's residents), never "MANA" or
  "Sprixia" except a small "Powered by MANA". Branding is data the car wash sets, not code. How
  a resident lands in the right car wash (one shared app vs a separate build per car wash) is open
  in section 10.
- **API:** the same Cloudflare Worker and database, new route groups (`/mobile/...`,
  `/customer/...`), with customers on their own sign-in that can only ever see their own data.

---

## 9. How we build it

- **Every table is tenant-scoped** through the existing repository layer, like shops today; the
  isolation tests are extended to customers (one resident can never see another's data) and to
  technicians (only their batches).
- **Offline first** for technicians: the day's batches, vehicles, slot photos and instructions
  download in the morning; every action goes through the outbox; photos upload later.
- **Speed:** every tap updates the screen at once and saves in the background (the database is
  about 165 ms per round trip from Chennai); visit planning runs at night, not on taps.
- **Providers behind switches:** payments, WhatsApp/SMS, push, maps.
- **Audit:** every money and status change is an event row with who and when; nothing
  financial is ever deleted, only reversed.
- **Tests:** end-to-end checks for subscriptions, scheduling, visit outcomes and their billing,
  technician offline sync, customer isolation; all in CI like today.
- **No hardcoded business values:** prices, washes, durations, taxes, commissions, vehicle
  categories and rules are all data.

---

## 10. Not decided yet (we won't invent these)

From the brief:

- SRI Car Wash's final brand name (it's a setting; renaming later changes no code).
- Pressure washer, vacuum and bike models (the software stays generic).
- Subscription and service prices; washes per month; plan structure.
- Technician salary and incentives; apartment revenue share and association terms.
- Service radius; wash durations; water and battery use (the pilot will measure them).
- Payment gateway (start with "recorded"; Razorpay later), WhatsApp/SMS provider, maps provider.

New questions this plan raises:

1. **How residents reach their car wash's app.** Either:
   - **One shared app** on the Play Store; the resident opens an invite link or QR from their car
     wash (or picks their apartment) and the app then shows that car wash's brand. One app to
     maintain; the Play Store listing name is generic.
   - **A separate build per car wash** ("SRI Car Wash" on the Play Store) from the same code, with
     the car wash's name and icon. Best brand for SRI; each new car wash needs a store listing.

   Recommended: the shared app first (the data model is the same either way), then branded builds
   as a paid extra once a car wash wants its own listing.
2. **Sprixia's pricing for Apartment Service:** included in Pro, a new higher plan, or an add-on
   per hub? (Sprixia's decision; SRI then pays it like any other car wash.)
3. **Who can subscribe on behalf of a resident?** Only the resident in the app, or also the car
   wash's staff (for residents who won't install an app)?
4. **Default wash days per apartment, or per customer?** The plan assumes the apartment sets the
   days (best for density). Some residents may want specific days.
5. **Cut-off for skipping a wash** (e.g. 8 pm the day before)? A setting per car wash; what
   should the default be?
6. **Missed-visit default:** counted as used, or carried forward once per cycle?
7. **GST on residents' invoices:** each car wash's own GSTIN (SRI's, not Sprixia's). Is SRI
   GST-registered, and should invoices show GST from day one? Sprixia's invoices to SRI for MANA
   are separate and already handled by Plans and billing.
8. **Technicians:** employees only, or contractors too (affects attendance and pay rules)?

---

## 11. Risks

- **Basement signal:** handled by offline-first; tested on a real phone in a real basement before
  launch.
- **Association permission is withdrawn:** apartment status → paused stops visits and notifies
  residents automatically; credits follow the plan's rule.
- **Damage disputes:** before photos and existing-damage notes protect both sides; incidents keep
  the full record.
- **Too much too early:** the pilot MVP is the whole first build; Phase 2 waits for real data.
- **Customer data across apartments and hubs:** strict scoping and isolation tests; the apartment
  admin never sees resident details.
- **SRI-only shortcuts creeping in:** because Sprixia and SRI share an owner, it's tempting to
  hardcode SRI's apartments, prices or name. Every such value is a setting, and the tests run
  with a second car wash to prove it.
- **Residents across car washes:** one resident could subscribe with two car washes on MANA (or
  an apartment could be served by two). Each car wash sees only its own subscription; the
  resident's phone signs into each separately.

---

## 12. Questions the owner can answer when this is done

"We" and "our" here mean the car wash (e.g. SRI), seeing only its own business. The same is true
of "we missed" in section 6.2: the car wash missed the visit, not the resident.

| Question | Where it comes from |
|---|---|
| How many vehicles did we service today? | Visits done today (cars, bikes) |
| How many vehicles can one technician do per day? | Visits done per technician-day, wash times |
| Which apartment is most profitable / losing money? | Revenue per apartment minus its costs (Phase 2 costs) |
| How much recurring revenue do we have? | Active subscriptions × monthly price |
| What's our churn? | Cancelled or not renewed per month |
| How long does each service really take? | Start to complete per service and vehicle type |
| How much travel time do we waste? | Batch finish to next batch start; hub check-out to first batch |
| Which equipment keeps failing? Which batteries need replacing? | Repair tickets, battery cycles (Phase 2) |
| How many mobile customers went to the hub, and hub customers subscribed? | Leads with revenue attribution |
| Which unsupported apartments should we launch next? | Demand per apartment |
| What does one car and one bike wash cost us? | Consumables, technician time, travel, share of hub costs |
| Profit of mobile, hub, and combined? | Revenue and costs split by channel |

---

## Suggested next step

Approve or change this plan, and answer the questions in section 10. Then I'll turn the pilot MVP
milestone 1 (foundation) into a detailed build plan with the exact database changes and
migration, the same way the multi-shop plan was done.
