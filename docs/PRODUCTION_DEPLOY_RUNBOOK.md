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

This prints whether the local cooldown permits a retry, the recorded quota reason, exact blocked/retry timestamps, approximate remaining time, marker path, and an explicit `Vercel upload started: no` confirmation. The command is the safe check for recurring development blocks; keep building locally while it reports `state: blocked`. `TCOS_PRODUCTION_QUOTA_STATUS_ONLY=true node scripts/deploy-production.mjs` is the environment-flag equivalent.

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

This runs lint, the InstaComp queue and accuracy simulations, the LetterTrack evidence checks, shipping purchase-attempt audit simulations, the twenty-scenario shipping simulation suite, build, and the production preflight without starting a Vercel deployment.
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
- stops with a clear message if Vercel's deployment quota is still capped;
- records `.codex-run/vercel-quota-block.json` after a quota cap so the next attempt can stop before uploading;
- removes the unwanted `truely-collectables-tt3b.vercel.app` alias if present;
- points `https://truely-collectables.vercel.app` at the new production deployment.
- clears the local quota marker only after the deployment URL is parsed and the clean production alias succeeds.
- rejects nonzero `vercel --prod` results before URL parsing or alias changes, even when failure output contains a `.vercel.app` URL.
- requires unwanted-alias removal success or an explicit alias-not-found result before clean-domain aliasing; every other cleanup failure preserves the quota marker and stops.

The production guardrail suite locks this live deploy behavior in place: quota blocks must mention `api-deployments-free-per-day` and tell the operator to wait for the rolling 24-hour reset, the helper must write the local quota cooldown marker and stop future attempts before upload unless `TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true` or `--force-quota-retry` is set, the unwanted alias removal command must stay wired, the clean production alias command must stay wired, and the helper must keep printing the deployed/clean URLs before handing off to `npm run smoke:production`. The protected live deploy sequence is: remove the unwanted `truely-collectables-tt3b.vercel.app` alias, set the clean production alias, clear the local quota marker only after that alias succeeds, print `DEPLOYED_PRODUCTION=`, print `CLEAN_PRODUCTION=https://`, then print the smoke handoff command.

If Vercel reports `api-deployments-free-per-day`, wait for the rolling quota window to reset, then rerun the same command. Do not rapid-fire retries while capped; Vercel can still accept the upload stream before returning the quota error, so repeated attempts waste operator time without producing a deploy. If a recent quota marker exists, the deploy helper exits before calling `vercel --prod`; override only when you intentionally want to test whether the rolling window reopened early.

Use `npm run status:production` between development blocks to see the exact retry timestamp without consuming deployment quota. Use `npm run status:go-live` for the single read-only runway view: local Git `HEAD`/`origin/main`/working-tree cleanliness, Vercel quota status, live-money state, missing bootstrap environment, local live-payment runtime readiness, and safe next commands without starting deploys, uploads, Checkout, postage, payouts, launch approvals, or revocations.

## Production go/no-go ladder

1. Verify the pushed stack with `npm run verify:production`. This must pass lint, simulations, build, production guardrails, and GitHub preflight without touching Vercel; it also prints the non-blocking `npm run status:live-money` runway report so operators see live-money posture before deploy work.
2. Before staging Supabase or Stripe live values, run `npm run live-money:env-packet` for the no-secret checklist, `npm run live-money:env-template` for placeholder values, or `npm run live-money:vercel-commands` for prompt-based Vercel environment commands. These helpers do not read secrets, call Stripe or Supabase, deploy, buy postage, create Checkout, or flip `TCOS_LIVE_PAYMENTS_ENABLED`; the Vercel command helper also rejects malformed `VERCEL_SCOPE` values before printing commands and pins command output to `vercel@56.2.0` through `npm exec` with `--cwd "$PWD"` instead of relying on a global Vercel CLI.
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
