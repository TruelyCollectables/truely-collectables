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

The verify helper runs lint, InstaComp queue and accuracy simulations, LetterTrack evidence checks, shipping purchase-attempt audit simulations, the nineteen-scenario shipping simulation suite, build, production guardrail checks, and GitHub/clean-worktree preflight without starting a Vercel deploy. The live-shipping launch gate also requires the five-scenario provider purchase-attempt audit suite and visible missing/unexpected purchase-audit key drift checks before approval can become ready. The launch helper runs that same verification first, then deploys production and runs the production smoke if the deploy succeeds. The deploy live safety contract verifies Git state, keeps Vercel quota messaging clear, handles the clean Vercel production alias, removes the unwanted `truely-collectables-tt3b.vercel.app` alias if it appears, prints the deployed and clean URLs, and hands off to `npm run smoke:production`. Production smoke and deploy/guardrail diagnostics redact secret-shaped Stripe, webhook, Resend, auth-header, token, API-key, password, and JWT values before printing failure snippets.

The protected live deploy sequence removes the unwanted `truely-collectables-tt3b.vercel.app` alias, sets the clean production alias, prints `DEPLOYED_PRODUCTION=`, prints `CLEAN_PRODUCTION=https://`, then prints the smoke handoff command.

For operator handoff, `/api/admin/launch-readiness` exposes `brief.deploySafety` in JSON, including `brief.deploySafety.sequence`, and `/api/admin/launch-readiness?format=markdown` includes the same `Production Deploy Safety` reminders.

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

That command is deploy-safe: it runs lint, InstaComp regressions, LetterTrack evidence checks, shipping purchase-attempt audit simulations, the nineteen-scenario shipping simulation suite, build, production guardrail checks, and production Git preflight without consuming a Vercel deployment.

## Production safety rules

- Keep `https://truely-collectables.vercel.app` as the clean production domain.
- Do not restore or rely on `truely-collectables-tt3b.vercel.app`.
- Do not override `SMOKE_BASE_URL` to `truely-collectables-tt3b.vercel.app`; production smoke refuses that host.
- Commit and push all launch-bound work before production deploy.
- Use `npm run launch:production` only when Vercel deploy quota is available and a real production deploy is intended.
- If Vercel reports `api-deployments-free-per-day`, wait for the rolling 24-hour quota reset before retrying the launch helper.

## Production deployment

Do not use the generic Vercel template flow for TCOS production.

Use the checked production launch helper:

```bash
npm run launch:production
```

That command runs lint, InstaComp regressions, LetterTrack evidence checks, shipping purchase-attempt audit simulations, the nineteen-scenario shipping simulation suite, build, production guardrail checks, GitHub/clean-worktree preflight, production deploy, clean-domain aliasing, unwanted `truely-collectables-tt3b.vercel.app` alias removal, deployed/clean URL output, and production smoke in order.

See [Production Deploy Runbook](docs/PRODUCTION_DEPLOY_RUNBOOK.md) for details.
