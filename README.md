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

## Production deploy and smoke

Use the production runbook when shipping queued launch work:

```bash
npm run verify:production
npm run launch:production
```

The verify helper runs lint, InstaComp queue and accuracy simulations, LetterTrack evidence checks, shipping purchase-attempt audit simulations, the twenty-scenario shipping simulation suite, build, production guardrail checks, and GitHub/clean-worktree preflight without starting a Vercel deploy. The live-shipping launch gate also requires the five-scenario provider purchase-attempt audit suite and visible missing/unexpected purchase-audit key drift checks before approval can become ready. The launch helper runs that same verification first, then deploys production and runs the production smoke if the deploy succeeds. Production smoke now checks the Seller Connections Marketplace Packet Intake page for prep-only export wording, ready/needs-work Seller Inventory handoffs, and guardrails for no external publishing, no postage purchase, no Coverage policy creation, no payout release, no order fulfillment, and no automatic under-$20 protection activation; it also verifies seller inventory, order, and payout workspaces render login gates before exposing seller-owned data. The deploy live safety contract verifies Git state, keeps Vercel quota messaging clear, handles the clean Vercel production alias, removes the unwanted `truely-collectables-tt3b.vercel.app` alias if it appears, prints the deployed and clean URLs, and hands off to `npm run smoke:production`. Production smoke and deploy/guardrail diagnostics redact secret-shaped Stripe, webhook, Resend, auth-header, token, API-key, password, and JWT values before printing failure snippets.

Production uses `next build --webpack`. Tailwind 4 automatic source discovery is disabled with `source(none)` and replaced by an explicit `src/**` source rule, keeping cold builds from recursively scanning the macOS FileProvider workspace while retaining complete application-class coverage.

Production launch command-pins Vercel CLI `56.2.0` through isolated `npm exec --package=vercel@56.2.0`. Preflight verifies that exact CLI before upload, while its operating-system temporary cache stays outside application `node_modules` and the lockfile. Every Vercel call receives `--cwd` with the repository root, so tool isolation cannot change the deployment target. `VERCEL_SCOPE` must be a simple Vercel team slug using only lowercase letters, numbers, and hyphens; flag-like, URL-like, whitespace, dotted, slashed, at-sign, uppercase, or secret-shaped values fail before quota status, preflight, Git fetch, or Vercel CLI work. A clean checkout can therefore deploy reproducibly without a machine-global `vercel` command.

Production deploy and smoke target overrides accept only valid DNS hostnames or root HTTP(S) URLs. Credentials, ports, paths, queries, fragments, IPs, single-label names, and malformed DNS labels fail without echoing the rejected value. Smoke therefore cannot silently discard an unsafe suffix and validate a different origin than the operator supplied. Smoke request timeout overrides must be integer milliseconds from `1000` through `120000`; malformed, infinite, fractional, zero, negative, or too-large values fail before admin auth, Git fetch, or network requests. Normal deploys also enforce the local quota cooldown before npm exec or Git fetch; quota-independent preflight remains available while waiting.

The protected live deploy sequence removes the unwanted `truely-collectables-tt3b.vercel.app` alias, sets the clean production alias, clears the local quota marker only after that alias succeeds, prints `DEPLOYED_PRODUCTION=`, prints `CLEAN_PRODUCTION=https://`, then prints the smoke handoff command.

The production go/no-go ladder is: verify the pushed stack with `npm run verify:production`, launch only when quota is open with `npm run launch:production`, halt if Vercel reports `api-deployments-free-per-day`, avoid rapid-fire deploy retries because Vercel can still upload files before returning the quota error, let `.codex-run/vercel-quota-block.json` stop later attempts before upload unless `TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true` or `--force-quota-retry` is used intentionally, use split `npm run deploy:production` plus `npm run smoke:production` only intentionally, and ship only after smoke passes the clean production domain.

During recurring development blocks, `npm run status:production` is the read-only quota check. It prints the exact blocked/retry timestamps, approximate remaining cooldown, marker path, and `Vercel upload started: no` without fetching Git or starting a deployment.

A malformed or unreadable marker fails closed: status reports `state: invalid_marker`, deployment remains blocked, and no Vercel upload starts. Inspect or restore the marker; override only after independently confirming the quota reset.

A zero, negative, or nonnumeric cooldown value also fails closed as `state: invalid_configuration`; it cannot disable the guard. Correct `TCOS_VERCEL_QUOTA_COOLDOWN_HOURS`, or use the explicit retry override only after independently confirming the quota reset.

Quota markers are success-cleared, not attempt-cleared. Failed override retries, unparseable Vercel responses, and clean-alias failures preserve the marker; it is removed only after a parsed deployment URL and successful clean alias.

Nonzero `vercel --prod` results are rejected before URL parsing, alias changes, or marker clearing. A `.vercel.app` URL printed in failed command output is never accepted as a deployment.

Unwanted-alias cleanup must succeed or return Vercel CLI's explicit alias-not-found result before clean-domain aliasing. Authentication, scope, network, or other cleanup failures stop the launch and preserve the quota marker.

Launch-readiness JSON/Markdown, the handoff bundle, the Launch Readiness page, and the Production Smoke Report all publish the shared read-only quota command and description. Production smoke protects that operator handoff from drifting.

For operator handoff, `/api/admin/launch-readiness` exposes `brief.deploySafety` in JSON, including `brief.deploySafety.sequence`, local quota cooldown marker path, and intentional retry override env/flag. It also exposes `brief.sellerMarketplaceReceiptHandoff` with the Seller Connections proof route, proof text, required receipt controls, covered operations, and safe-use boundary. `/api/admin/launch-readiness?format=markdown` plus `/api/admin/launch-readiness?format=handoff-bundle` include the same `Production Deploy Safety`, Seller Marketplace Receipt Handoff, and go/no-go reminders.

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
