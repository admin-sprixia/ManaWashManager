# Changelog

All notable changes to MANA Wash Manager. One version number is shared by every app and package
(`npm run version:set -- X.Y.Z`); the Android `versionCode` follows it automatically.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/admin-sprixia/ManaWashManager/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/admin-sprixia/ManaWashManager/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/admin-sprixia/ManaWashManager/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/admin-sprixia/ManaWashManager/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/admin-sprixia/ManaWashManager/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/admin-sprixia/ManaWashManager/releases/tag/v0.1.0
