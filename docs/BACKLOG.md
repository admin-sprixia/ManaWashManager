# Backlog — what we've agreed to do later

Ideas and follow-ups we decided to park, so they aren't lost. Move an item into the
CHANGELOG when it ships.

## Services

- **Products used per service.** Link stock items (shampoo, wax, cloths) to a service, so the
  stock goes down on its own with every wash and the cost of a wash is known.
- **Comeback reminders per service.** "Remind the customer after N days" set on each service
  (a Basic wash every 7 days, Anti-Rust every 6 months).
- **HQ commission per service.** Head office sets the staff commission per service and size,
  instead of each branch.
- **Suggest with.** Pair services so New Wash suggests one with the other ("Add Tyre shine?").
- **Service photo.** A picture for each service, shown in the customer app and New Wash.
- **Stamp card from the service.** Set a service's loyalty stamp card (how many washes for a
  free one) right in the service editor.

- **Shop plans at any branch.** A plan bought at the shop works only at the branch that sold
  it. Later, decide which branches may take it (all of the business's branches, or a group)
  and how the money is split between the branch that sold it and the one that washed.

## Prices

- **How price changes reach branches.** Today a saved price goes to every branch straight
  away. Decide between that and branches accepting new prices (or a date they start).
- **Price zones.** Taken off the screens while there's one branch. When branches open in very
  different towns (a village and a big city), a zone moves every price for its branches by a %
  (e.g. small towns −10%, metros +15%). The data model and API are still there; bring back the
  zone list in Pricing rules and the zone picker on a branch's Prices tab.
- **Plan prices follow the price book.** A plan's own prices (typed per size) are the same at
  every branch, so a Metro branch (+20%) sells single washes higher but the same ₹1,649 Basic
  Plan. Move own plan prices by the branch's price book too (or keep a price per book), the way
  "from the wash price" plans already follow it.
- **Owner hide rule.** Whether a branch owner may hide head-office services on their branch's
  menu, and which ones.
- **Regenerate docs/PRICE_LIST.md.** Community prices are now worked out by the rule (10% less
  than the hub), so the printed list still shows the old typed community prices. Run
  `npm run docs:price-list` in apps/api.
- **Visit charge in the customer app.** Show customers the exact visit charge for their home
  (from their saved location) before they book, and let them save their home in the app.
- **Measure from the team, not the branch.** Work out a home visit's distance from where the
  doorstep team is (or its van's base) rather than the branch's map pin.

## GST

- **Today: no GST.** Mana Wash isn't GST-registered, so Plan rules › GST stays at 0 and no bill
  or receipt shows GST.
- **When registered: GST included in the price (decided).** Set GST to 18% with the GSTIN and
  legal name. Customers pay the same price; receipts and the Reports PDF show how much of it is
  GST.
- **Later, maybe: customer pays GST on top.** A switch in HQ settings, "Customer pays GST", so a
  ₹499 wash bills ₹499 + ₹90 GST = ₹589. New Wash, payment, WhatsApp bills, the customer app,
  wash plans, the cash drawer and Reports would all follow it, with GST collected counted
  separately for filing.

## Before going live

- Create the production database from the baseline: `npm run db:migrate:remote` (builds it from
  `migrations/0001_init.sql`). The old production `mana_db` (from early October) predates the
  baseline: delete and recreate it the way staging was rebuilt on 2026-10-28.
- Import the post offices remotely: `npm run data:post-offices -- --into remote --yes`.
- Run the business setup remotely (`setup:business`).
- Phone run-through: New Wash at a home (the visit is measured from the phone's location and
  shows on the bill), the customer app's at-home prices with the visit note, and joining a
  community that has a volume discount.
