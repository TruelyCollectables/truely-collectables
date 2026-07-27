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

### Read-only Vercel quota status

Use `npm run status:production` for the human-readable read-only quota check, or `npm --silent run status:production:json` for schema `tcos.productionQuotaStatus.v1`. JSON evidence includes `vercelUploadStarted: false`, `deployTimeoutMs`, `deployTimeout`, and `deployTimeoutEnv`, plus the read-only guarantee.

The report shows exact UTC blocked/retry timestamps, local operator blocked/retry timestamps, the configured Vercel deploy timeout, and `Vercel upload started: no`. A malformed or unreadable marker fails closed, and a zero, negative, or nonnumeric cooldown value also fails closed.

Quota markers are success-cleared, not attempt-cleared. Nonzero `vercel --prod` results are rejected before URL parsing, alias changes, marker clearing, or smoke handoff.

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

## Live-money go/no-go operator map

### Combined runway

Run `npm run status:go-live` for the single read-only runway view, or `npm --silent run status:go-live:json` for schema `tcos.goLiveRunwayStatus.v1`. It reports the go-live readiness state, blocker count, watch item count, blocker action categories, per-blocker action commands, next actionable step, next deploy step, next operator step, local Git `HEAD`/`origin/main`/working-tree cleanliness, Vercel quota status, go-live-readiness, emergency backup schedule health, scheduler proof, freshest backup timestamp, approximate age, current-for-last-scheduled-run status, retention count, backup verification result, production deploy safety, clean production domain, protected deploy sequence, launch command when quota opens, and local live-payment runtime readiness.

Preserve archivable combined runway evidence with `npm run archive:go-live-runway` under `.codex-run/go-live-runway/`. The view and archive operate without starting deploys, uploads, archive creation, Git push, Checkout, postage, payouts, launch approvals, or revocations unless an archive command is explicitly selected.

Live-money blockers point to the one-command operator evidence packet `npm run prepare:go-live-evidence`. Use `npm run verify:go-live-evidence` or `npm --silent run verify:go-live-evidence:json` to verify that the latest local packet has all required runway, backup, and live-money proof and is captured at `HEAD=origin/main` with a clean tree. Preserve verifier proof with `npm run archive:go-live-evidence-verification`. The evidence workflow keeps deploy/money/postage side effects closed.

### Backup runway

Use `npm run status:backup-runway` or `npm --silent run status:backup-runway:json` for schema `tcos.backupRunwayStatus.v1`. Preserve it with `npm run archive:backup-runway`, verify it with `npm run verify:backup-runway` or `npm --silent run verify:backup-runway:json` under schema `tcos.backupRunwayVerification.v1`, or run `npm run prepare:backup-runway` for the one-command archive-plus-verify handoff. Evidence is stored under `.codex-run/backup-runway/` and includes accepted backup posture, scheduler proof mode, and operator-watch requirement.

### Thirty-minute build blocks

Use `npm run status:build-block` or `npm --silent run status:build-block:json` for a concise read-only checkpoint with schema `tcos.buildBlockCheckpoint.v1`; verifier evidence uses `tcos.buildBlockCheckpointVerification.v1`. The packet exposes `localBuildFallback`, selected next half-hour lane, `local_build_fallback`, `refresh_go_live_evidence`, deploy-timeout evidence, configured deploy timeout, and quota retry/remaining/timeout evidence.

Run `npm run prepare:build-block-checkpoint` for the one-command archive-plus-verify handoff. The underlying commands are `npm run archive:build-block-checkpoint`, `npm run verify:build-block-checkpoint`, and `npm --silent run verify:build-block-checkpoint:json`. Evidence is stored under `.codex-run/build-block-checkpoint/`, captured at the current pushed `HEAD=origin/main` with a clean tree. The archive helper only writes the timestamped checkpoint evidence file; the verifier is read-only. This lane is used when the primary blocker needs operator Supabase/env access or the external Vercel quota window.

Use `npm run next:build-block` or `npm --silent run next:build-block:json` for schema `tcos.nextBuildBlockAction.v1`; verification uses `tcos.nextBuildBlockActionVerification.v1`. Archive and verify with `npm run archive:next-build-block-action`, `npm run verify:next-build-block-action`, or `npm --silent run verify:next-build-block-action:json`, or use `npm run prepare:next-build-block-action`. Evidence is stored under `.codex-run/next-build-block-action/`.

Build-block history uses schemas `tcos.buildBlockHistory.v1` and `tcos.buildBlockHistoryVerification.v1`. Run `npm run prepare:build-block-history` to preserve a compact history packet under `.codex-run/build-block-history/` containing the latest go-live runway, build-block checkpoint, and selected next-action archives.

### Live-payment evidence and environment packets

Use `npm run status:live-money` or `npm --silent run status:live-money:json` for status. Use `npm run preflight:live-money` or `npm --silent run preflight:live-money:json` for strict preflight. Archive status with `npm run archive:live-money` and preflight with `npm run archive:live-money:preflight` under `.codex-run/live-money-evidence/`. Evidence includes `liveMoneyEvidence`, accepted go-live states, halt states, archive requirement, Supabase bootstrap environment checklist, final live-payment runtime environment checklist, missing local bootstrap environment, local environment readiness, `verify:production`, and `READY_FOR_RUNTIME_SWITCH`. Read-only guarantee: these status paths do not open live money.

The targeted live-money handoff remains available as `npm run prepare:live-money-bootstrap`, then `npm run status:live-money`.

Generate the no-secret environment packet with `npm run live-money:env-packet` or `npm --silent run live-money:env-packet:json`. Preserve the timestamped no-secret packet plus `.sha256` sidecar with `npm run archive:live-money-env-packet` under `.codex-run/live-money-env-packet/`; its schema is `tcos.liveMoneyEnvPacket.v1`.

Verify it with `npm run verify:live-money-env-packet` or `npm --silent run verify:live-money-env-packet:json` under schema `tcos.liveMoneyEnvPacketVerification.v1`. This performs checksum, no-secret, and local/deployed-boundary verification. Preserve the timestamped verifier evidence file with `npm run archive:live-money-env-packet-verification` under `.codex-run/live-money-env-packet-verification/`.

Operator templates and commands are available through `npm run live-money:bootstrap-template`, `npm run live-money:env-template`, `npm run live-money:vercel-bootstrap-commands`, and `npm run live-money:vercel-commands`. Vercel command helpers reject malformed `VERCEL_SCOPE` values before printing commands and remain pinned to `vercel@56.2.0` through `npm exec`; every command uses `--cwd "$PWD"`.
