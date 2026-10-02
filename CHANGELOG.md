# Changelog

All notable changes to MANA Wash Manager. One version number is shared by every app and package
(`npm run version:set -- X.Y.Z`); the Android `versionCode` follows it automatically.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/admin-sprixia/ManaWashManager/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/admin-sprixia/ManaWashManager/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/admin-sprixia/ManaWashManager/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/admin-sprixia/ManaWashManager/releases/tag/v0.1.0
