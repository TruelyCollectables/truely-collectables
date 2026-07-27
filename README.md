# Truely Collectables / TCOS

Copyright 2026 Dag Danky Holdings LLC. All rights reserved.

Authored by David Bakanas.

Software ownership: Dag Danky Holdings LLC.

This repository contains the Truely Collectables storefront and TCOS admin system.

Start with the operator manual:

- [TCOS Operator Manual](docs/TCOS_OPERATOR_MANUAL.md)
- [TCOS Operator Manual PDF](docs/TCOS_OPERATOR_MANUAL.pdf)
- [Production Deploy Runbook](docs/PRODUCTION_DEPLOY_RUNBOOK.md)

The manual explains daily store operation, inventory, orders, offers, eBay sync, AI descriptions, sales comps, suggested pricing, and required environment variables.

When the mobile app is built, maintain its operator manual and downloadable PDF separately from the main TCOS web manual while keeping shared policies consistent.

## Production deployment safety

The deployment helper command-pins Vercel CLI `56.2.0` and runs it through isolated `npm exec --package=vercel@56.2.0` without a machine-global `vercel` command. Its temporary cache stays outside application `node_modules` and the lockfile. Every Vercel call receives `--cwd` with the repository root.

`VERCEL_SCOPE` must be a simple Vercel team slug using only lowercase letters, numbers, and hyphens. flag-like, URL-like, whitespace, dotted, slashed, at-sign, uppercase, or secret-shaped values fail before quota status, preflight, Git fetch, or Vercel CLI work.

Production deploy and smoke target overrides accept only valid DNS hostnames or root HTTP(S) URLs. Smoke therefore cannot silently discard an unsafe suffix. Smoke request timeout overrides must be integer milliseconds from `1000` through `120000`; malformed, infinite, fractional, zero, negative, or too-large values fail before admin auth, Git fetch, or network requests.

Normal deploys also enforce the local quota cooldown before npm exec or Git fetch. Unwanted-alias cleanup must succeed or the deployment is not treated as complete.

## Nightly emergency backups

Run a manual backup with `npm run backup:nightly`, or install the nightly macOS LaunchAgent with `npm run backup:nightly:install`.

Use these read-only status and verification commands:

- `npm run status:nightly-backup`
- `npm --silent run status:nightly-backup:json`
- `npm run verify:nightly-backup`
- `npm --silent run verify:nightly-backup:json`
- `npm run archive:nightly-backup-status`
- `npm run archive:nightly-backup-verification`

The status helper reads only the LaunchAgent plist, launchd runtime state, backup directory, and archive metadata. It does not create an archive, push Git, deploy, create Checkout, buy postage, release payouts, approve launch, or revoke anything. Status evidence includes the freshest backup timestamp, UTC plus local timestamps for the latest backup and scheduled runs, approximate age, current-for-last-scheduled-run status, retention keep count, and over-retention count.

Schedule health is reported as `current`, `pending_first_run`, or `overdue_or_failed`. Scheduler proof is reported as `automatic_unproven`, `automatic_proven`, or `automatic_failed`; a manually current backup after an automatic failure is reported as `manual_current_after_automatic_failure`. The status output also includes launchd loaded/runs/last-exit evidence.

The verifier reads the newest backup archive, manifest, `.sha256` file, and tar listing. Timestamped evidence is written under `.codex-run/nightly-backup-verification/` and `.codex-run/nightly-backup-status/` only when the archive commands are explicitly run.

The default macOS backup root is `~/Backups`, using a seven-backup rolling window. Windows operators may use `C:\Backups`; Linux or mounted-volume operators may pass `--backup-dir /Backups`. Each emergency archive includes `.git` history and ignored `.env*` files, but the helper does not auto-add untracked files or commit ignored secrets.
