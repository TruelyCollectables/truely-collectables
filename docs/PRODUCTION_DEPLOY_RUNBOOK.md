# TCOS Production Deploy Runbook

Use this when the queued launch work is ready to ship to production.

## Production target

- Clean production URL: `https://truely-collectables.vercel.app`
- Unwanted preview-style alias that must not return: `truely-collectables-tt3b.vercel.app`

Do not point production deploy or smoke overrides at the unwanted alias. The deploy helper accepts `VERCEL_CLEAN_DOMAIN` and `VERCEL_UNWANTED_ALIAS` only as valid bare DNS hostnames or root HTTP(S) URLs, refuses credentials, ports, paths, queries, fragments, IPs, single-label names, and malformed DNS labels, and refuses a clean-domain configuration that equals the unwanted alias. Rejected values are not echoed. The smoke helper applies the same strict shape to `SMOKE_BASE_URL` plus `SMOKE_UNWANTED_ALIAS_URL` before any request, then refuses any target that resolves to the unwanted alias. It never silently strips an unsafe suffix and tests a different origin.

## Before deploying

Confirm the local branch is pushed to GitHub:

```bash
git fetch origin main
git status --short
git rev-parse --short HEAD
git rev-parse --short origin/main
git log -5 --oneline
```

`HEAD` and `origin/main` should match before production deploy.

To run the deploy preflight without touching Vercel:

```bash
npm run preflight:production
```

This refreshes `origin/main`, blocks uncommitted deploy-relevant changes, and confirms local `HEAD` matches GitHub without starting a deployment.
The deploy helper also honors `TCOS_PRODUCTION_PREFLIGHT_ONLY=true` as an environment-flag equivalent to `--preflight-only`; production guardrails protect that no-deploy path.

To check the local Vercel quota cooldown without fetching Git, building, uploading, or starting a deployment:

```bash
npm run status:production
```

This prints whether the local cooldown permits a retry, the recorded quota reason, exact blocked/retry timestamps, approximate remaining time, marker path, the configured Vercel deploy timeout, and an explicit `Vercel upload started: no` confirmation. Use `npm --silent run status:production:json` when operators need raw quota evidence with schema `tcos.productionQuotaStatus.v1`; it includes the same retry state, marker path, `deployTimeoutMs`, `deployTimeout`, `deployTimeoutEnv`, `vercelUploadStarted: false`, next action, and read-only guarantee without scraping text. The command is the safe check for recurring development blocks; keep building locally while it reports `state: blocked`. `TCOS_PRODUCTION_QUOTA_STATUS_ONLY=true node scripts/deploy-production.mjs` is the environment-flag equivalent.

A malformed or unreadable marker fails closed as `state: invalid_marker`: the helper starts no Vercel upload and blocks deployment. Inspect or restore the marker before continuing. Use `TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true` or `--force-quota-retry` only after independently confirming that the rolling quota window has reset.

A zero, negative, or nonnumeric cooldown value also fails closed as `state: invalid_configuration`; it cannot disable the deployment guard. Set `TCOS_VERCEL_QUOTA_COOLDOWN_HOURS` to a positive number. The explicit retry override remains the only intentional bypass and should be used only after independently confirming the quota reset.

The quota marker is success-cleared, not attempt-cleared. A failed override retry, unparseable Vercel response, or clean-alias failure preserves the marker. The helper removes it only after Vercel returns a parsed deployment URL and the clean production alias succeeds.

The helper also requires `vercel --prod` to exit successfully before it parses the deployment URL, runs either alias command, or clears the quota marker. A URL printed by a failed Vercel command is diagnostic output, not a deployable result.

The deploy helper command-pins Vercel CLI `56.2.0` through isolated `npm exec --package=vercel@56.2.0`. Its cache lives under the operating system temporary directory, outside the application lockfile and `node_modules`; every Vercel call also receives `--cwd` with the TCOS repository root so the isolated prefix cannot change the deployment target. `VERCEL_SCOPE` must be a simple Vercel team slug using only lowercase letters, numbers, and hyphens. Flag-like, URL-like, whitespace, dotted, slashed, at-sign, uppercase, or secret-shaped scope values fail before quota status, production preflight, Git fetch, or Vercel CLI work. Production preflight runs that exact command, verifies its reported version, and stops before Vercel upload when npm registry access fails or the CLI is mismatched. The project does not rely on an unverified global CLI.

For a normal deploy, the local quota cooldown check runs before command-pinned npm exec or Git fetch. Active, invalid, and invalidly configured cooldown states therefore stop before any external launch work. Preflight-only deliberately skips the quota gate so it can verify the CLI and Git state without deploying while the cooldown is active.

Unwanted-alias cleanup must succeed or return Vercel CLI's explicit `Alias not found by` result before the helper can move the clean domain. Authentication, scope, network, and all other cleanup failures stop before clean-domain aliasing and preserve the local quota marker.

The shared deploy-safety contract publishes `quotaStatusCommand` and its read-only description through launch-readiness JSON, Markdown, the handoff bundle, the Launch Readiness page, and the Production Smoke Report. Production smoke requires these surfaces to preserve `npm run status:production` before a queued release can pass.

The internal quota cooldown self-test refuses to run against `.codex-run/vercel-quota-block.json`; it requires `TCOS_VERCEL_QUOTA_MARKER_PATH` to name an explicit temporary test file so validation cannot erase the real cooldown record.

To run the full quota-safe production readiness check:

```bash
npm run verify:production
```

This runs lint, the InstaComp queue, accuracy, catalog identity, and 100-card trial scorekeeper simulations, the LetterTrack evidence checks, shipping purchase-attempt audit simulations, the twenty-scenario shipping simulation suite, build, and the production preflight without starting a Vercel deployment.
It also runs `npm run check:production-guardrails`, which syntax-checks the production deploy/smoke helpers and shipping simulation runner, verifies the package script chain still includes the required shipping/production/launch commands, verifies the named smoke contracts for launch readiness, Launch Gate Drill, production smoke, live payment/shipping gates, admin shipping controls, shipping simulations, shipping provider exports, LetterTrack CSV, and shipping exceptions, verifies the named `queued-feature smoke manifest` rejects unknown or duplicate check names, verifies the deploy preflight env-flag path, verifies the live deploy safety contract for Vercel quota messaging, local quota cooldown marker/override handling, unwanted alias removal, clean-domain aliasing, and post-deploy smoke handoff, verifies smoke/deploy/guardrail diagnostic redaction self-tests, and verifies the clean production domain cannot be confused with the unwanted `truely-collectables-tt3b.vercel.app` alias.

Tailwind source detection is bounded to `src/**` by `source(none)` plus the explicit `@source "../**/*.{js,ts,jsx,tsx,mdx}"` rule in `src/app/globals.css`. Keep this boundary intact so cold builds do not recursively scan the FileProvider workspace, generated caches, documentation artifacts, Git metadata, or dependencies.

## Deploy

For the normal launch path, run the one-shot command:

```bash
npm run launch:production
```

This runs lint, InstaComp regression simulations, LetterTrack evidence checks, shipping purchase-attempt audit simulations, the twenty-scenario shipping simulation suite, build, production guardrail checks, production preflight, production deploy, and production smoke in order.

If you need to run the steps separately, deploy first:

```bash
npm run deploy:production
```

The deploy helper:

- prints the local and remote Git commit IDs;
- refreshes `origin/main` before comparing commit IDs;
- blocks if the worktree has uncommitted deploy-relevant changes;
- blocks if local `HEAD` does not match `origin/main`;
- deploys production through Vercel;
- bounds the actual `vercel --prod` process with `TCOS_VERCEL_DEPLOY_TIMEOUT_MS`, defaulting to 15 minutes and accepting only integer milliseconds from `60000` through `3600000`;
- stops with a clear message if Vercel's deployment quota is still capped;
- records `.codex-run/vercel-quota-block.json` after a quota cap so the next attempt can stop before uploading;
- removes the unwanted `truely-collectables-tt3b.vercel.app` alias if present;
- points `https://truely-collectables.vercel.app` at the new production deployment.
- clears the local quota marker only after the deployment URL is parsed and the clean production alias succeeds.
- rejects nonzero `vercel --prod` results before URL parsing or alias changes, even when failure output contains a `.vercel.app` URL.
- requires unwanted-alias removal success or an explicit alias-not-found result before clean-domain aliasing; every other cleanup failure preserves the quota marker and stops.

The production guardrail suite locks this live deploy behavior in place: quota blocks must mention `api-deployments-free-per-day` and tell the operator to wait for the rolling 24-hour reset, the helper must write the local quota cooldown marker and stop future attempts before upload unless `TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true` or `--force-quota-retry` is set, the unwanted alias removal command must stay wired, the clean production alias command must stay wired, and the helper must keep printing the deployed/clean URLs before handing off to `npm run smoke:production`. The protected live deploy sequence is: remove the unwanted `truely-collectables-tt3b.vercel.app` alias, set the clean production alias, clear the local quota marker only after that alias succeeds, print `DEPLOYED_PRODUCTION=`, print `CLEAN_PRODUCTION=https://`, then print the smoke handoff command.

If Vercel reports `api-deployments-free-per-day`, wait for the rolling quota window to reset, then rerun the same command. Do not rapid-fire retries while capped; Vercel can still accept the upload stream before returning the quota error, so repeated attempts waste operator time without producing a deploy. If a recent quota marker exists, the deploy helper exits before calling `vercel --prod`; override only when you intentionally want to test whether the rolling window reopened early.

If `vercel --prod` stalls, the helper terminates that deploy process at the configured timeout, rejects any URL printed by the timed-out command, starts no alias commands, clears no quota marker, and hands the operator a diagnostic instead of hanging indefinitely. Before retrying after a timeout, inspect Vercel deployments and aliases so a late-arriving deployment is not mistaken for a clean launch.

Use `npm run status:production` between development blocks to see the exact UTC and local retry timestamp without consuming deployment quota, or `npm --silent run status:production:json` for schema `tcos.productionQuotaStatus.v1` quota evidence. Use `npm run status:go-live` when you want the single read-only runway view: local Git `HEAD`/`origin/main`/working-tree cleanliness, go-live readiness state, blocker count, watch item count, blocker action categories, per-blocker action commands, next actionable step, next deploy step, next operator step, Vercel quota status with UTC plus local retry time, approximate remaining cooldown, configured deploy timeout, production deploy safety with clean production domain, unwanted alias, protected deploy sequence, and launch command when quota opens, emergency backup schedule health, scheduler proof, freshest backup timestamp, approximate age, current-for-last-scheduled-run status, retention count, backup verification result, live-money state, missing bootstrap environment, local live-payment runtime readiness, and safe next commands, including `npm run status:backup-runway`, `npm run archive:backup-runway`, `npm run verify:backup-runway`, `npm run prepare:backup-runway`, the 30-minute `npm run next:build-block` / `npm run prepare:next-build-block-action` handoff helpers, `npm run archive:nightly-backup-status`, and `npm run archive:nightly-backup-verification`, without starting deploys, uploads, archive creation, Git push, Checkout, postage, payouts, launch approvals, or revocations. Live-money blockers point to the one-command operator evidence packet `npm run prepare:go-live-evidence`, which archives runway proof, archives nightly-backup status and verification proof, archives/verifies the compact backup runway proof, prints the no-secret live-money packet, archives it with a `.sha256` sidecar, verifies the packet, archives verifier evidence, prints bootstrap-only Vercel commands, prints the Supabase-only local template, reruns `npm run status:live-money`, archives the go-live evidence verifier result after the packet proves clean, and refreshes runway proof again so the final runway archive can show the current verifier proof. Run `npm run verify:go-live-evidence` or `npm --silent run verify:go-live-evidence:json` after a clean pushed packet to confirm the latest runway, backup, and live-money evidence was captured at `HEAD=origin/main` with a clean tree; run `npm run archive:go-live-evidence-verification` to preserve that verifier result under `.codex-run/go-live-evidence-verification/`. The targeted live-money handoff remains available as `npm run prepare:live-money-bootstrap`, and the expanded command chain remains available as `npm run live-money:env-packet`, `npm run archive:live-money-env-packet`, `npm run verify:live-money-env-packet`, `npm run archive:live-money-env-packet-verification`, `npm run live-money:vercel-bootstrap-commands`, `npm run live-money:bootstrap-template`, then `npm run status:live-money`. Use `npm --silent run status:go-live:json` when the combined runway status needs raw archivable evidence, or `npm run archive:go-live-runway` for a timestamped file under `.codex-run/go-live-runway/`; the JSON schema is `tcos.goLiveRunwayStatus.v1` and includes Git, go-live-readiness, quota retry/remaining, deploy-timeout evidence, production-deploy-safety, emergency-backup, live-money, safe-next-command, and read-only-guarantee fields without scraping the text output. Use `npm run status:backup-runway` or `npm --silent run status:backup-runway:json` for schema `tcos.backupRunwayStatus.v1` when the backup lane needs its own compact handoff: accepted backup posture, scheduler proof mode, operator-watch requirement, seven-backup retention, verified archive path, and computed SHA-256. Preserve it with `npm run archive:backup-runway`, verify it with `npm run verify:backup-runway` or `npm --silent run verify:backup-runway:json` under schema `tcos.backupRunwayVerification.v1`, or run `npm run prepare:backup-runway` for the archive-plus-verify pair.

For fast 30-minute blocks, run `npm run status:build-block` for a concise read-only checkpoint derived from `status:go-live:json` plus backup-runway JSON: current Git alignment, go-live state, blocker/watch counts, clean/current go-live evidence status, block focus, next safe command sequence, deploy quota retry time plus approximate remaining cooldown, configured deploy timeout, backup proof, backup runway accepted posture, scheduler proof mode, operator-watch requirement, exact next scheduled local backup run, verified backup archive/SHA-256, live-money bootstrap gaps, and a `localBuildFallback` lane for Codex when the primary blocker needs operator Supabase/env access or the external Vercel quota window. Use `npm run next:build-block` or `npm --silent run next:build-block:json` for schema `tcos.nextBuildBlockAction.v1` when you only want the selected next half-hour lane: it chooses `refresh_go_live_evidence` first when clean/pushed Git has missing, failing, or stale go-live proof, chooses `local_build_fallback` while operator/env/quota gates block the primary path, otherwise prints the primary recommendation, and carries/prints the primary unblock next step/commands alongside the selected lane, quota retry/remaining/timeout evidence, go-live evidence clean/current flags, go-live evidence refresh-required flag, and backup runway accepted posture, scheduler proof mode, operator-watch requirement, exact next scheduled local backup run, next action, verified archive, and SHA-256 from the checkpoint. Use `npm run status:build-block-history` or `npm --silent run status:build-block-history:json` for schema `tcos.buildBlockHistory.v1` to confirm the latest go-live runway, build-block checkpoint, and selected next-action archives were captured at the current pushed `HEAD=origin/main`, that their quota remaining/retry/timeout evidence and go-live evidence flags remain ok/current, that the compact history preserves the selected next-action primary unblock step/commands, and that checkpoint/next-action backup runway posture remains visible. Use `npm --silent run status:build-block:json` for schema `tcos.buildBlockCheckpoint.v1`, or `npm run prepare:build-block-checkpoint` when you want the one-command archive-plus-verify handoff for the current block; that handoff now also archives and verifies the checkpoint under `.codex-run/build-block-checkpoint/` and the selected next-action lane under `.codex-run/next-build-block-action/` with schema `tcos.nextBuildBlockActionVerification.v1`, including deploy-timeout evidence, the backup runway next scheduled local run, next action, verified backup archive path, computed SHA-256, and missing Supabase bootstrap environment names in the human summaries, then archives and verifies the compact history packet under `.codex-run/build-block-history/` with schema `tcos.buildBlockHistoryVerification.v1`. Individual steps remain available as `npm run archive:build-block-checkpoint` to preserve the same checkpoint under `.codex-run/build-block-checkpoint/`, `npm run verify:build-block-checkpoint` or `npm --silent run verify:build-block-checkpoint:json` for schema `tcos.buildBlockCheckpointVerification.v1`, `npm run prepare:next-build-block-action` for the selected-lane archive-plus-verify pair, `npm run archive:next-build-block-action`, `npm run verify:next-build-block-action`, or `npm --silent run verify:next-build-block-action:json`, plus `npm run prepare:build-block-history` for the compact-history archive-plus-verify pair, `npm run archive:build-block-history`, `npm run verify:build-block-history`, or `npm --silent run verify:build-block-history:json` for proof that the latest runway, checkpoint, next-action, and compact history archives were captured at the current pushed `HEAD=origin/main` with a clean tree. The status, history, and next-action checkpoints start no deploy, upload, archive creation, Git push, Checkout, postage, payout, launch approval, revocation, or backup creation; the checkpoint archive helper only writes the timestamped checkpoint evidence file, the next-action archive helper only writes the timestamped selected-lane evidence file, the history archive helper only writes the timestamped compact history evidence file, the verifier is read-only, and the added verifiers are read-only.

The compact build-block history also records the selected fallback lane next step and command sequence, so resumed 30-minute blocks can continue launch-safe local work without re-opening the full next-action archive.
It also carries the backup runway next action while scheduler proof is still pending, so the overnight MacBook watch step stays visible beside the selected build lane.
The backup proof in the compact history includes the verified archive path and computed SHA-256, keeping the local-emergency-backup evidence auditable without opening the full backup runway archive.
While live money is blocked, the same compact history preserves the missing Supabase bootstrap environment names so the operator handoff does not have to scrape the full live-money report.

When the latest go-live evidence is already clean at `HEAD=origin/main`, `npm run status:go-live` advances the live-money blocker from “rerun the full packet” to the actual Supabase bootstrap handoff: run `npm run live-money:bootstrap-handoff` to print the bootstrap-only Vercel commands, print the Supabase-only local template, and rerun `npm run status:live-money` after the same values are staged in Vercel and mirrored locally.

`/admin/launch-readiness`, `/api/admin/launch-readiness`, the Markdown brief, the handoff bundle, and `/admin/production-smoke` publish the same Emergency Backup Evidence contract. Before treating the backup lane as go-live ready, preserve `npm run archive:go-live-runway` evidence plus the direct `npm run archive:nightly-backup-status` and `npm run archive:nightly-backup-verification` files when drilling the lane. Accepted proof is current schedule health, freshest backup UTC/local timestamp, next scheduled backup UTC/local timestamp, approximate age, current-for-last-scheduled-run status, seven-backup retention evidence with an explicit over-retention count of zero, backup verification ok, a verified archive path, computed SHA-256, launchd loaded/runs/last-exit evidence, and either `schedulerProof: automatic_proven` or a documented first-run/manual-backup exception while launchd is loaded. These evidence helpers must not deploy, upload, create Checkout, buy postage, release payouts, approve launch, revoke anything, create a new backup archive, or push Git.

## Production go/no-go ladder

1. Verify the pushed stack with `npm run verify:production`. This must pass lint, simulations, build, production guardrails, and GitHub preflight without touching Vercel; it also prints the non-blocking `npm run status:live-money` runway report so operators see live-money posture before deploy work.
2. Before staging Supabase or Stripe live values, run `npm run prepare:go-live-evidence` when operators need the full launch-safe evidence packet for the current runway; it chains `npm run archive:go-live-runway`, `npm run archive:nightly-backup-status`, `npm run archive:nightly-backup-verification`, and `npm run prepare:live-money-bootstrap` without deploying, reading secrets, creating Checkout, buying postage, releasing payouts, or changing runtime switches. Then run `npm run verify:go-live-evidence` or `npm --silent run verify:go-live-evidence:json` to verify that the latest local packet has all required runway, backup, and live-money proof, was captured at the pushed Git tip, has clean working-tree evidence, preserves seven-backup retention proof, and keeps deploy/money/postage side effects closed. Run `npm run archive:go-live-evidence-verification` when you need a timestamped verifier proof under `.codex-run/go-live-evidence-verification/`; `npm run prepare:go-live-evidence` now includes that archive step after the packet verifies cleanly, then refreshes runway proof so the latest runway archive carries the current verifier proof. Run `npm run prepare:live-money-bootstrap` when the blocker is only the missing Supabase bootstrap environment; it chains the no-secret checklist, timestamped packet archive, checksum/no-secret verification, verifier evidence archive, bootstrap-only Vercel command printout, Supabase-only local template printout, and live-money status check without reading secrets, deploying, calling Stripe/Supabase, buying postage, creating Checkout, or flipping runtime switches. Run `npm run live-money:bootstrap-handoff` when evidence is already current and operators only need the bootstrap-only Vercel command checklist, Supabase-only local template, and follow-up `status:live-money` check. Vercel env commands stage deployed runtime values only; local `npm run status:live-money` reads local `.env` or shell variables, so mirror the same values locally before expecting local status to clear, then redeploy only when quota is open and verify deployed runtime with smoke/live-money evidence. For individual steps, run `npm run live-money:env-packet` for the no-secret checklist, `npm --silent run live-money:env-packet:json` for schema `tcos.liveMoneyEnvPacket.v1` raw packet evidence, `npm run archive:live-money-env-packet` for a timestamped no-secret packet plus `.sha256` sidecar under `.codex-run/live-money-env-packet/`, `npm run verify:live-money-env-packet` or `npm --silent run verify:live-money-env-packet:json` for schema `tcos.liveMoneyEnvPacketVerification.v1` checksum, no-secret, and local/deployed-boundary verification, `npm run archive:live-money-env-packet-verification` for a timestamped verifier evidence file under `.codex-run/live-money-env-packet-verification/`, `npm run live-money:bootstrap-template` for Supabase-only local placeholders, `npm run live-money:env-template` for full placeholder values, `npm run live-money:vercel-bootstrap-commands` for prompt-based Vercel commands that include only Supabase bootstrap keys, or `npm run live-money:vercel-commands` for the full Supabase plus final live-payment runtime command set. These helpers do not read secrets, call Stripe or Supabase, deploy, buy postage, create Checkout, or flip `TCOS_LIVE_PAYMENTS_ENABLED`; the Vercel command helper safety path rejects malformed `VERCEL_SCOPE` values before printing commands and pins command output to `vercel@56.2.0` through `npm exec` with `--cwd "$PWD"` instead of relying on a global Vercel CLI.
3. Launch only when quota is open with `npm run launch:production`. This should deploy production, set the clean alias, remove the unwanted alias, and run smoke in order.
4. After smoke passes, archive the live-money status evidence with `npm run archive:live-money`; during the final go-live window, archive the stricter preflight evidence with `npm run archive:live-money:preflight` and require `READY_FOR_RUNTIME_SWITCH` or `LIVE_MONEY_OPEN` before changing runtime switches. Both helpers write timestamped JSON under `.codex-run/live-money-evidence/` with archive metadata for timestamp, command, local `HEAD`, local `origin/main`, and working-tree cleanliness.
5. Halt on Vercel quota. If the deploy reports `api-deployments-free-per-day`, do not force alternate deploy paths or rapid-fire retries; Vercel can still upload files before returning the quota error, so wait for the rolling 24-hour reset and rerun the launch helper.
6. Split the run only after a successful deploy or when intentionally rerunning steps: `npm run deploy:production` then `npm run smoke:production`.
7. Ship only after smoke passes `https://truely-collectables.vercel.app` and confirms the unwanted `truely-collectables-tt3b.vercel.app` alias does not respond.

## Smoke test

After a successful deploy:

```bash
npm run smoke:production
```

The smoke helper logs in with `SMOKE_ADMIN_PASSWORD`, `ADMIN_PASSWORD`, or the local `.env.local` `ADMIN_PASSWORD`, then checks the production admin/readiness/shipping launch surfaces, including the Launch Gate Drill and Live Shipping Launch Gate surfaces that expose the five-scenario provider purchase-attempt audit suite and its missing/unexpected key drift, plus the Shipping Simulation Lab page that renders the twenty policy/adapter scenarios and five provider purchase-audit scenarios. It also requires the production smoke report page to name the Seller Connections Marketplace Packet Intake guardrail, directly checks `/seller/marketplaces` for Marketplace Packet Intake guidance, and checks unauthenticated `/seller/inventory`, `/seller/orders`, and `/seller/payouts` for login gates before seller-owned data can render. Marketplace packets are cross-list prep only and do not publish externally, buy postage, create Coverage policies, release payouts, fulfill orders, create insurance, or automatically activate under-$20 seller protection. It also POSTs `/api/admin/shipping/simulations` and requires the JSON response to report twenty expected shipping scenarios, five expected purchase-audit scenarios, passed count/key coverage, no missing or unexpected scenario keys, no missing/unexpected purchase-audit keys, and the under-$20 cap/allocation/refund-gate math, seller order protection visibility, provider setup evidence contract, LetterTrack seller-protection CSV contract, evidence-audit, dry-run envelope purchase scenarios, live-gate blocker audit text, provider-setup blocker audit text, and packet audit lines.

Before reporting commit context, smoke refreshes `origin/main` with `git fetch origin main`. Smoke requests default to a 15-second timeout and report per-check, slowest-check, and total request duration. Override with `SMOKE_REQUEST_TIMEOUT_MS` if production is slow but still healthy; it must be integer milliseconds from `1000` through `120000`. Malformed, infinite, fractional, zero, negative, or too-large timeout values fail before admin authentication, Git fetch, or network requests. Failed-check response/error snippets redact key-shaped Stripe, webhook, JWT, Resend, auth-header, query-token, and JSON secret values before printing. The deploy and production guardrail helpers run the same diagnostic-redaction self-test family so command-output failures also avoid leaking secret-shaped values.

The smoke helper always targets the clean production URL by default. `SMOKE_BASE_URL` and `SMOKE_UNWANTED_ALIAS_URL` accept only a valid bare DNS hostname or root HTTP(S) URL. Credentials, ports, paths, queries, fragments, IP addresses, localhost/single-label names, empty labels, underscores, and leading/trailing hyphens fail before admin authentication, Git fetch, or network requests, and errors do not echo rejected values. If `SMOKE_BASE_URL` is overridden to `https://truely-collectables-tt3b.vercel.app` or the same host without a scheme, the helper normalizes it and exits before sending requests.

If the smoke says queued launch features are not visible, production is still behind the GitHub stack. The helper also prints `Queued launch feature failure(s): ...` with the failed check name, path, HTTP status, missing required text, diagnostic, and redacted snippet for each queued feature failure. This now includes failures for the admin dashboard, launch readiness page/JSON/Markdown, Launch Gate Drill page/JSON/Markdown, production smoke report page, seller marketplace packet intake page, seller inventory/order/payout auth gates, launch handoff bundle, live payment gate, live shipping gate, admin shipping LetterTrack controls, Shipping Simulation Lab page, shipping simulation API POST including purchase-audit coverage, shipping provider exports, shipping exceptions export, and LetterTrack CSV export. Rerun the production deploy once Vercel accepts deployments, then run the smoke again.

The compact launch readiness JSON from `/api/admin/launch-readiness` includes `brief.deploySafety` with the clean production domain, unwanted `truely-collectables-tt3b.vercel.app` alias, Vercel quota block code, rolling 24-hour quota reset instruction, local quota cooldown marker path, simple Vercel team slug requirement for `VERCEL_SCOPE`, intentional retry override env/flag, deployed/clean URL output contract, `brief.deploySafety.sequence` protected deploy order, and smoke handoff command for automation. It also includes `brief.sellerMarketplaceReceiptHandoff` with the Seller Connections proof route, proof text, required receipt controls, covered operations, and safe-use boundary. The downloadable launch readiness Markdown brief from `/api/admin/launch-readiness?format=markdown` includes a `Production Deploy Safety` section with the quota reset, local cooldown marker, retry override, clean-domain, unwanted-alias, Vercel scope rule, deployed/clean URL output, and smoke handoff reminders. The deeper launch handoff bundle from `/api/admin/launch-readiness?format=handoff-bundle` also includes Git Tip Verification, Production Deploy Commands, Production Go/No-Go Ladder, Seller Marketplace Receipt Handoff, and post-deploy purchase-audit key-drift reminders with the `git fetch origin main` refresh, HEAD/origin checks, verify, launch, split deploy/smoke, clean-domain, Vercel scope, and unwanted-alias reminders so an operator can hand off the production deploy without relying on chat history.

## Expected success path

```bash
git fetch origin main
git status --short
git rev-parse --short HEAD
git rev-parse --short origin/main
git log -5 --oneline
npm run launch:production
```

Separate fallback path:

```bash
npm run preflight:production
npm run deploy:production
npm run smoke:production
```
