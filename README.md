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

Customer legal page:

- [Terms of Service](src/app/terms/page.tsx)
- [Seller Terms of Service](src/app/seller-terms/page.tsx)

To regenerate the downloadable manual PDF:

```bash
npm run manual:pdf
```

## Nightly emergency backups

The MacBook nightly backup command creates a timestamped local archive in `~/Backups` and then pushes already-committed source to `origin/main`:

```bash
npm run backup:nightly
```

The local archive includes `.git` history and ignored `.env*` files for emergency restore, while excluding rebuildable folders such as `node_modules`, `.next`, `.codex-run`, Paddle caches, and TypeScript build info. Git push only syncs committed source; the command does not auto-add untracked files or commit ignored secrets. The default retention is a seven-backup rolling window: before day 8 is written, the oldest dated backup is removed so the new dated backup replaces day 1; day 9 replaces day 2, and so on.

To install the macOS nightly scheduler at 2:30 AM local time:

```bash
npm run backup:nightly:install
```

Use `npm run backup:nightly -- --local-only` for a no-network local archive, or `npm run backup:nightly -- --backup-dir .codex-run/nightly-backup-test --local-only` for a workspace-local test. On Windows, the matching drive-root folder would be `C:\Backups`. On modern macOS, a true `/Backups` drive-root folder requires admin-created permissions first; after creating it, reinstall with `npm run backup:nightly:install -- --backup-dir /Backups`.

Check the scheduler and seven-backup rotation without creating an archive:

```bash
npm run status:nightly-backup
npm --silent run status:nightly-backup:json
npm run verify:nightly-backup
npm --silent run verify:nightly-backup:json
npm run archive:nightly-backup-status
npm run archive:nightly-backup-verification
```

The status helper reads only the LaunchAgent plist, launchd runtime state, backup folder, and log metadata. It does not create an archive, push Git, deploy, create Checkout, buy postage, release payouts, approve launch, or revoke anything. It also reports the freshest backup timestamp, UTC plus local timestamps for the latest backup and scheduled runs, approximate age, current-for-last-scheduled-run status, retention keep count, and over-retention count; schedule health such as `current`, `pending_first_run`, or `overdue_or_failed`; plus scheduler proof states such as `automatic_unproven`, `automatic_proven`, or `automatic_failed` with launchd loaded/runs/last-exit evidence so a missed 02:30 run or never-fired scheduler is visible. The verifier reads the newest backup archive, manifest, `.sha256` file, and tar listing to prove the local archive is restorable without creating a new archive or pushing Git. The backup runway helper `npm run status:backup-runway` / `npm --silent run status:backup-runway:json` combines status and verification evidence under schema `tcos.backupRunwayStatus.v1`, records the accepted backup posture, scheduler proof mode, operator-watch requirement, seven-backup retention, verified archive, and computed SHA-256 without creating a backup; `npm run archive:backup-runway`, `npm run verify:backup-runway`, `npm --silent run verify:backup-runway:json`, and `npm run prepare:backup-runway` preserve and verify that compact runway under `.codex-run/backup-runway/` with schema `tcos.backupRunwayVerification.v1`. The archive helpers write timestamped status evidence under `.codex-run/nightly-backup-status/` and verification evidence under `.codex-run/nightly-backup-verification/`.

## Production deploy and smoke

Use the production runbook when shipping queued launch work:

```bash
npm run verify:production
npm run launch:production
```

The verify helper runs lint, the non-blocking `npm run status:live-money` runway report, InstaComp queue and accuracy simulations, LetterTrack evidence checks, shipping purchase-attempt audit simulations, the twenty-scenario shipping simulation suite, build, production guardrail checks, and GitHub/clean-worktree preflight without starting a Vercel deploy. The live-shipping launch gate also requires the five-scenario provider purchase-attempt audit suite and visible missing/unexpected purchase-audit key drift checks before approval can become ready. The launch helper runs that same verification first, then deploys production and runs the production smoke if the deploy succeeds. Production smoke now checks the Seller Connections Marketplace Packet Intake page for prep-only export wording, ready/needs-work Seller Inventory handoffs, and guardrails for no external publishing, no postage purchase, no Coverage policy creation, no payout release, no order fulfillment, and no automatic under-$20 protection activation; it also verifies seller inventory, order, and payout workspaces render login gates before exposing seller-owned data. The deploy live safety contract verifies Git state, keeps Vercel quota messaging clear, handles the clean Vercel production alias, removes the unwanted `truely-collectables-tt3b.vercel.app` alias if it appears, prints the deployed and clean URLs, and hands off to `npm run smoke:production`. Production smoke and deploy/guardrail diagnostics redact secret-shaped Stripe, webhook, Resend, auth-header, token, API-key, password, and JWT values before printing failure snippets.

Production uses `next build --webpack`. Tailwind 4 automatic source discovery is disabled with `source(none)` and replaced by an explicit `src/**` source rule, keeping cold builds from recursively scanning the macOS FileProvider workspace while retaining complete application-class coverage.

Production launch command-pins Vercel CLI `56.2.0` through isolated `npm exec --package=vercel@56.2.0`. Preflight verifies that exact CLI before upload, while its operating-system temporary cache stays outside application `node_modules` and the lockfile. Every Vercel call receives `--cwd` with the repository root, so tool isolation cannot change the deployment target. `VERCEL_SCOPE` must be a simple Vercel team slug using only lowercase letters, numbers, and hyphens; flag-like, URL-like, whitespace, dotted, slashed, at-sign, uppercase, or secret-shaped values fail before quota status, preflight, Git fetch, or Vercel CLI work. A clean checkout can therefore deploy reproducibly without a machine-global `vercel` command.

Production deploy and smoke target overrides accept only valid DNS hostnames or root HTTP(S) URLs. Credentials, ports, paths, queries, fragments, IPs, single-label names, and malformed DNS labels fail without echoing the rejected value. Smoke therefore cannot silently discard an unsafe suffix and validate a different origin than the operator supplied. Smoke request timeout overrides must be integer milliseconds from `1000` through `120000`; malformed, infinite, fractional, zero, negative, or too-large values fail before admin auth, Git fetch, or network requests. Normal deploys also enforce the local quota cooldown before npm exec or Git fetch; quota-independent preflight remains available while waiting.

The protected live deploy sequence removes the unwanted `truely-collectables-tt3b.vercel.app` alias, sets the clean production alias, clears the local quota marker only after that alias succeeds, prints `DEPLOYED_PRODUCTION=`, prints `CLEAN_PRODUCTION=https://`, then prints the smoke handoff command.

The production go/no-go ladder is: verify the pushed stack with `npm run verify:production`, launch only when quota is open with `npm run launch:production`, halt if Vercel reports `api-deployments-free-per-day`, avoid rapid-fire deploy retries because Vercel can still upload files before returning the quota error, let `.codex-run/vercel-quota-block.json` stop later attempts before upload unless `TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true` or `--force-quota-retry` is used intentionally, use split `npm run deploy:production` plus `npm run smoke:production` only intentionally, and ship only after smoke passes the clean production domain.

During recurring development blocks, `npm run status:production` is the read-only quota check. It prints the exact UTC blocked/retry timestamps, local operator blocked/retry timestamps, approximate remaining cooldown, marker path, and `Vercel upload started: no` without fetching Git or starting a deployment. Use `npm --silent run status:production:json` for raw quota evidence with schema `tcos.productionQuotaStatus.v1`; it includes the same retry state, marker path, `vercelUploadStarted: false`, next action, and read-only guarantee without scraping text. Use `npm run status:go-live` when you want the single read-only runway view: local Git `HEAD`/`origin/main`/working-tree cleanliness, go-live readiness state, blocker count, watch item count, blocker action categories, per-blocker action commands, next actionable step, next deploy step, next operator step, Vercel quota status with UTC plus local retry time and approximate remaining cooldown, production deploy safety with clean production domain, unwanted alias, protected deploy sequence, and launch command when quota opens, emergency backup schedule health, scheduler proof, freshest backup UTC/local timestamp, next scheduled backup UTC/local timestamp, approximate age, current-for-last-scheduled-run status, retention count, backup verification result, live-money state, missing bootstrap environment, local live-payment runtime readiness, and safe next commands, including `npm run status:backup-runway`, `npm run archive:backup-runway`, `npm run verify:backup-runway`, `npm run prepare:backup-runway`, the 30-minute `npm run next:build-block` / `npm run prepare:next-build-block-action` handoff helpers, `npm run archive:nightly-backup-status`, and `npm run archive:nightly-backup-verification`, without starting deploys, uploads, archive creation, Git push, Checkout, postage, payouts, launch approvals, or revocations. Live-money blockers point to the one-command operator evidence packet `npm run prepare:go-live-evidence`, which archives runway proof, archives nightly-backup status and verification proof, archives/verifies the compact backup runway proof, prints the no-secret live-money packet, archives it with a `.sha256` sidecar, verifies the packet, archives verifier evidence, prints bootstrap-only Vercel commands, prints the Supabase-only local template, reruns `npm run status:live-money`, archives the go-live evidence verifier result after the packet proves clean, and refreshes runway proof again so the final runway archive can show the current verifier proof. Run `npm run verify:go-live-evidence` or `npm --silent run verify:go-live-evidence:json` after a clean pushed packet to confirm the latest runway, backup, and live-money evidence was captured at `HEAD=origin/main` with a clean tree; run `npm run archive:go-live-evidence-verification` to preserve that verifier result under `.codex-run/go-live-evidence-verification/`. The targeted live-money handoff remains available as `npm run prepare:live-money-bootstrap`, and the expanded command chain remains available as `npm run live-money:env-packet`, `npm run archive:live-money-env-packet`, `npm run verify:live-money-env-packet`, `npm run archive:live-money-env-packet-verification`, `npm run live-money:vercel-bootstrap-commands`, `npm run live-money:bootstrap-template`, then `npm run status:live-money`. Use `npm --silent run status:go-live:json` for archivable combined runway evidence, or `npm run archive:go-live-runway` for a timestamped file under `.codex-run/go-live-runway/`; the JSON schema is `tcos.goLiveRunwayStatus.v1` and includes the same Git, go-live-readiness, quota retry/remaining, production-deploy-safety, emergency-backup, live-money, safe-next-command, and read-only-guarantee fields without scraping the text output.

For fast 30-minute blocks, run `npm run status:build-block` for a concise read-only checkpoint derived from `status:go-live:json` plus backup-runway JSON: current Git alignment, go-live state, blocker/watch counts, clean/current go-live evidence status, block focus, next safe command sequence, deploy quota retry time plus approximate remaining cooldown, backup proof, backup runway accepted posture, scheduler proof mode, operator-watch requirement, exact next scheduled local backup run, verified backup archive/SHA-256, live-money bootstrap gaps, and a `localBuildFallback` lane for Codex when the primary blocker needs operator Supabase/env access or the external Vercel quota window. Use `npm run next:build-block` or `npm --silent run next:build-block:json` for schema `tcos.nextBuildBlockAction.v1` when you only want the selected next half-hour lane: it chooses `local_build_fallback` while operator/env/quota gates block the primary path, otherwise it prints the primary recommendation, and it now carries and prints the primary unblock next step/commands alongside the selected lane, quota retry/remaining evidence, go-live evidence clean/current flags, and backup runway accepted posture, scheduler proof mode, operator-watch requirement, exact next scheduled local backup run, next action, verified archive, and SHA-256 from the checkpoint. Use `npm run status:build-block-history` or `npm --silent run status:build-block-history:json` for schema `tcos.buildBlockHistory.v1` to confirm the latest go-live runway, build-block checkpoint, and selected next-action archives were captured at the current pushed `HEAD=origin/main`, that their quota remaining/retry evidence and go-live evidence flags remain ok/current, that the compact history preserves the selected next-action primary unblock step/commands, and that checkpoint/next-action backup runway posture remains visible. Use `npm --silent run status:build-block:json` for schema `tcos.buildBlockCheckpoint.v1`, or `npm run prepare:build-block-checkpoint` when you want the one-command archive-plus-verify handoff for the current block; that handoff now also archives and verifies the checkpoint under `.codex-run/build-block-checkpoint/` and the selected next-action lane under `.codex-run/next-build-block-action/` with schema `tcos.nextBuildBlockActionVerification.v1`, including the backup runway next scheduled local run, next action, verified backup archive path, computed SHA-256, and missing Supabase bootstrap environment names in the human summaries, then archives and verifies the compact history packet under `.codex-run/build-block-history/` with schema `tcos.buildBlockHistoryVerification.v1`. Individual steps remain available as `npm run archive:build-block-checkpoint` to preserve the same checkpoint under `.codex-run/build-block-checkpoint/`, `npm run verify:build-block-checkpoint` or `npm --silent run verify:build-block-checkpoint:json` for schema `tcos.buildBlockCheckpointVerification.v1`, `npm run prepare:next-build-block-action` for the selected-lane archive-plus-verify pair, `npm run archive:next-build-block-action`, `npm run verify:next-build-block-action`, or `npm --silent run verify:next-build-block-action:json`, plus `npm run archive:build-block-history`, `npm run verify:build-block-history`, or `npm --silent run verify:build-block-history:json` for proof that the latest runway, checkpoint, next-action, and compact history archives were captured at the current pushed `HEAD=origin/main` with a clean tree. The status, history, and next-action checkpoints start no deploy, upload, archive creation, Git push, Checkout, postage, payout, launch approval, revocation, or backup creation; the checkpoint archive helper only writes the timestamped checkpoint evidence file, the next-action archive helper only writes the timestamped selected-lane evidence file, the history archive helper only writes the timestamped compact history evidence file, the verifier is read-only, and the added verifiers are read-only.

The compact build-block history also records the selected fallback lane next step and command sequence, so resumed 30-minute blocks can continue launch-safe local work without re-opening the full next-action archive.
It also carries the backup runway next action while scheduler proof is still pending, so the overnight MacBook watch step stays visible beside the selected build lane.
The backup proof in the compact history includes the verified archive path and computed SHA-256, keeping the local-emergency-backup evidence auditable without opening the full backup runway archive.
While live money is blocked, the same compact history preserves the missing Supabase bootstrap environment names so the operator handoff does not have to scrape the full live-money report.

When the latest go-live evidence is already clean at `HEAD=origin/main`, `npm run status:go-live` advances the live-money blocker from “rerun the full packet” to the actual Supabase bootstrap handoff: run `npm run live-money:vercel-bootstrap-commands`, stage the Supabase values in Vercel, use `npm run live-money:bootstrap-template` to mirror the same values locally without mixing in final Stripe/live-payment runtime fields, and rerun `npm run status:live-money`.

For the live-money runway, use `npm run status:live-money` during build blocks and `npm run preflight:live-money` during the final go-live window. `npm run verify:production` also runs the non-blocking status command so every production verification prints the current live-money posture before deploy work. Use `npm run prepare:go-live-evidence` when you want the launch-safe operator packet for the current runway; it chains `npm run archive:go-live-runway`, `npm run archive:nightly-backup-status`, `npm run archive:nightly-backup-verification`, and `npm run prepare:live-money-bootstrap` without deploying, reading secrets, creating Checkout, buying postage, releasing payouts, or changing runtime switches. Use `npm run verify:go-live-evidence` or `npm --silent run verify:go-live-evidence:json` to verify that the latest local packet has all required runway, backup, and live-money proof, was captured at the pushed Git tip, has clean working-tree evidence, preserves seven-backup retention proof, and keeps deploy/money/postage side effects closed. Use `npm run archive:go-live-evidence-verification` to write the clean verifier proof under `.codex-run/go-live-evidence-verification/`; `npm run prepare:go-live-evidence` includes that archive step after the live-money bootstrap evidence chain, then refreshes runway proof so `status:go-live` and the latest runway archive agree on the current verifier proof. Use `npm run prepare:live-money-bootstrap` when the missing blocker is only the Supabase bootstrap environment; it chains the no-secret checklist, timestamped packet archive, checksum/no-secret verification, verifier evidence archive, bootstrap-only Vercel command printout, Supabase-only local template printout, and live-money status check without reading secrets, deploying, calling Stripe/Supabase, buying postage, creating Checkout, or flipping runtime switches. Vercel env commands stage deployed runtime values only; local `npm run status:live-money` reads local `.env` or shell variables, so mirror the same values locally before expecting local status to clear, then redeploy only when quota is open and verify deployed runtime with smoke/live-money evidence. Use `npm run live-money:env-packet` for the no-secret checklist, `npm --silent run live-money:env-packet:json` for schema `tcos.liveMoneyEnvPacket.v1` raw packet evidence, `npm run archive:live-money-env-packet` for a timestamped no-secret packet plus `.sha256` sidecar under `.codex-run/live-money-env-packet/`, `npm run verify:live-money-env-packet` or `npm --silent run verify:live-money-env-packet:json` for schema `tcos.liveMoneyEnvPacketVerification.v1` checksum, no-secret, and local/deployed-boundary verification, `npm run archive:live-money-env-packet-verification` for a timestamped verifier evidence file under `.codex-run/live-money-env-packet-verification/`, `npm run live-money:bootstrap-template` for Supabase-only local placeholders, `npm run live-money:env-template` for full copy/paste-safe placeholders, `npm run live-money:vercel-bootstrap-commands` for prompt-based Vercel commands that include only Supabase bootstrap keys, and `npm run live-money:vercel-commands` for the full Supabase plus final live-payment runtime command set; those helpers do not read secrets, call Stripe or Supabase, deploy, buy postage, or create Checkout, and the Vercel command helpers reject malformed `VERCEL_SCOPE` values before printing commands. Their command output is also pinned to `vercel@56.2.0` through `npm exec` and passes `--cwd "$PWD"` so operators do not rely on an unverified global Vercel CLI. For raw JSON evidence, use `npm --silent run status:live-money:json` or final-window `npm --silent run preflight:live-money:json`; the JSON schema is `tcos.liveMoneyGoNoGo.v1` and the payload includes `liveMoneyEvidence` with the accepted go-live states, halt states, archive requirement, companion status/preflight commands, Supabase bootstrap environment checklist, final live-payment runtime environment checklist, and `localEnvironmentStatus` for local environment readiness. For the archivable timestamped files operators should preserve, run `npm run archive:live-money` after production smoke passes and `npm run archive:live-money:preflight` during the final go-live window; files are written under `.codex-run/live-money-evidence/` and include archive metadata for timestamp, command, local `HEAD`, local `origin/main`, and working-tree cleanliness. These commands reuse the Live Payment Launch Gate evaluator and print approval-blocker, launch-lock, warning, database-approval, runtime-switch, live Checkout state, missing local bootstrap environment, local Supabase bootstrap status, local final live-payment runtime status, and a `Read-only guarantee` that they do not create Checkout Sessions, Customers, PaymentIntents, refunds, disputes, payouts, labels, postage purchases, Coverage policies, launch approvals, or revocations. `status:live-money` is non-failing so it can answer “how much more until full live money?” while blocked. `preflight:live-money` fails until the state is `READY_FOR_RUNTIME_SWITCH` or `LIVE_MONEY_OPEN`.

A malformed or unreadable marker fails closed: status reports `state: invalid_marker`, deployment remains blocked, and no Vercel upload starts. Inspect or restore the marker; override only after independently confirming the quota reset.

A zero, negative, or nonnumeric cooldown value also fails closed as `state: invalid_configuration`; it cannot disable the guard. Correct `TCOS_VERCEL_QUOTA_COOLDOWN_HOURS`, or use the explicit retry override only after independently confirming the quota reset.

Quota markers are success-cleared, not attempt-cleared. Failed override retries, unparseable Vercel responses, and clean-alias failures preserve the marker; it is removed only after a parsed deployment URL and successful clean alias.

Nonzero `vercel --prod` results are rejected before URL parsing, alias changes, or marker clearing. A `.vercel.app` URL printed in failed command output is never accepted as a deployment.

Unwanted-alias cleanup must succeed or return Vercel CLI's explicit alias-not-found result before clean-domain aliasing. Authentication, scope, network, or other cleanup failures stop the launch and preserve the quota marker.

Launch-readiness JSON/Markdown, the handoff bundle, the Launch Readiness page, and the Production Smoke Report all publish the shared read-only quota command and description. They also publish the Emergency Backup Evidence contract so operators preserve nightly backup status, verification, runway archive, scheduler proof, and SHA-256 proof before go-live. Production smoke protects those operator handoffs from drifting.

For operator handoff, the admin dashboard Launch Locks card, `/admin/live-payment-launch`, `/api/admin/live-payment-launch`, and `/api/admin/launch-readiness` all expose the live-money JSON evidence contract: `liveMoneyEvidence` / `brief.payment.liveMoneyEvidence` with the `tcos.liveMoneyGoNoGo.v1` schema, `npm --silent run status:live-money:json` post-smoke raw JSON command, `npm --silent run preflight:live-money:json` final-window raw preflight command, `npm run archive:live-money` and `npm run archive:live-money:preflight` timestamped archive helpers, Supabase bootstrap and final live-payment runtime environment checklists, accepted `READY_FOR_RUNTIME_SWITCH` / `LIVE_MONEY_OPEN` states, halt states, and read-only no-money/no-postage guarantee. The admin dashboard Launch Locks card and launch-readiness JSON also expose Emergency Backup Evidence with `brief.emergencyBackupEvidence`, `tcos.nightlyBackupStatus.v1`, `tcos.nightlyEmergencyBackupVerification.v1`, `tcos.goLiveRunwayStatus.v1`, `npm run status:nightly-backup`, `npm run verify:nightly-backup`, `npm run archive:nightly-backup-status`, `npm run archive:nightly-backup-verification`, and `npm run archive:go-live-runway` so the backup lane carries current schedule health, scheduler proof, launchd runtime, verification ok, archive path, and computed SHA-256 proof without creating a backup or pushing Git. The launch-readiness JSON also exposes `brief.deploySafety`, including `brief.deploySafety.sequence`, local quota cooldown marker path, simple Vercel team slug requirement for `VERCEL_SCOPE`, and intentional retry override env/flag. It also exposes `brief.sellerMarketplaceReceiptHandoff` with the Seller Connections proof route, proof text, required receipt controls, covered operations, and safe-use boundary. `/api/admin/launch-readiness?format=markdown` plus `/api/admin/launch-readiness?format=handoff-bundle` include the same Live Money JSON Evidence, Emergency Backup Evidence, `Production Deploy Safety`, Seller Marketplace Receipt Handoff, and go/no-go reminders.

## Local development

Install dependencies once, then run the local development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Keep local-only secrets in `.env.local`. Do not commit real Stripe, Supabase, Resend, shipping-provider, eBay, or admin password values.

Before stacking production-bound work, run:

```bash
npm run verify:production
```

For a fast InstaComp-only regression check, run:

```bash
npm run verify:instacomp
```

That command is deploy-safe and focused: it runs only the InstaComp queue and accuracy simulations without consuming a Vercel deployment. Use `npm run verify:production` for the full lint, shipping, build, guardrail, and GitHub preflight stack.

## Production safety rules

- Keep `https://truely-collectables.vercel.app` as the clean production domain.
- Do not restore or rely on `truely-collectables-tt3b.vercel.app`.
- Do not override `SMOKE_BASE_URL` to `truely-collectables-tt3b.vercel.app`; production smoke refuses that host.
- Keep `SMOKE_BASE_URL` and `SMOKE_UNWANTED_ALIAS_URL` to bare DNS hostnames or root HTTP(S) URLs; smoke rejects credentials, ports, paths, queries, fragments, IPs, and single-label names before any request.
- Commit and push all launch-bound work before production deploy.
- Use `npm run launch:production` only when Vercel deploy quota is available and a real production deploy is intended.
- If Vercel reports `api-deployments-free-per-day`, wait for the rolling 24-hour quota reset before retrying the launch helper; repeated retries can still upload files before Vercel returns the quota error. The deploy helper records `.codex-run/vercel-quota-block.json` and stops later attempts before upload unless `TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true` or `--force-quota-retry` is used intentionally.

## Production deployment

Do not use the generic Vercel template flow for TCOS production.

Use the checked production launch helper:

```bash
npm run launch:production
```

That command runs lint, InstaComp regressions, LetterTrack evidence checks, shipping purchase-attempt audit simulations, the twenty-scenario shipping simulation suite, build, production guardrail checks, GitHub/clean-worktree preflight, production deploy, clean-domain aliasing, unwanted `truely-collectables-tt3b.vercel.app` alias removal, deployed/clean URL output, and production smoke in order.

See [Production Deploy Runbook](docs/PRODUCTION_DEPLOY_RUNBOOK.md) for details.
