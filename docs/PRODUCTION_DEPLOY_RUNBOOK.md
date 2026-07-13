# TCOS Production Deploy Runbook

Use this when the queued launch work is ready to ship to production.

## Production target

- Clean production URL: `https://truely-collectables.vercel.app`
- Unwanted preview-style alias that must not return: `truely-collectables-tt3b.vercel.app`

Do not point production deploy or smoke overrides at the unwanted alias. The deploy helper normalizes `VERCEL_CLEAN_DOMAIN` and `VERCEL_UNWANTED_ALIAS` from either hostnames or URLs, refuses a clean-domain configuration that equals the unwanted alias, and the smoke helper normalizes `SMOKE_BASE_URL` plus `SMOKE_UNWANTED_ALIAS_URL` before refusing any target that resolves to that alias.

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

To run the full quota-safe production readiness check:

```bash
npm run verify:production
```

This runs lint, the InstaComp queue and accuracy simulations, the LetterTrack evidence checks, the thirteen-scenario shipping simulation suite, build, and the production preflight without starting a Vercel deployment.
It also runs `npm run check:production-guardrails`, which syntax-checks the production deploy/smoke helpers and shipping simulation runner, verifies the package script chain still includes the required shipping/production/launch commands, verifies the named `shipping simulation API smoke contract`, verifies the named `queued-feature smoke manifest` rejects unknown or duplicate check names, verifies smoke diagnostic redaction, and verifies the clean production domain cannot be confused with the unwanted `tt3b` alias.

## Deploy

For the normal launch path, run the one-shot command:

```bash
npm run launch:production
```

This runs lint, InstaComp regression simulations, LetterTrack evidence checks, the thirteen-scenario shipping simulation suite, build, production guardrail checks, production preflight, production deploy, and production smoke in order.

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
- removes the unwanted `truely-collectables-tt3b.vercel.app` alias if present;
- points `https://truely-collectables.vercel.app` at the new production deployment.

If Vercel reports `api-deployments-free-per-day`, wait for the rolling quota window to reset, then rerun the same command.

## Smoke test

After a successful deploy:

```bash
npm run smoke:production
```

The smoke helper logs in with `SMOKE_ADMIN_PASSWORD`, `ADMIN_PASSWORD`, or the local `.env.local` `ADMIN_PASSWORD`, then checks the production admin/readiness/shipping launch surfaces, including the Shipping Simulation Lab page that renders the thirteen policy/adapter scenarios. It also POSTs `/api/admin/shipping/simulations` and requires the JSON response to report thirteen expected scenarios, passed count/key coverage, no missing or unexpected scenario keys, and the LetterTrack evidence-audit plus dry-run envelope purchase scenarios.

Before reporting commit context, smoke refreshes `origin/main` with `git fetch origin main`. Smoke requests default to a 15-second timeout and report per-check, slowest-check, and total request duration. Override with `SMOKE_REQUEST_TIMEOUT_MS` if production is slow but still healthy. Failed-check response/error snippets redact key-shaped Stripe, webhook, JWT, Resend, auth-header, query-token, and JSON secret values before printing.

The smoke helper always targets the clean production URL by default. If `SMOKE_BASE_URL` is overridden to `https://truely-collectables-tt3b.vercel.app` or the same host without a scheme, the helper normalizes it and exits before sending requests.

If the smoke says queued launch features are not visible, production is still behind the GitHub stack. The helper also prints `Queued launch feature failure(s): ...` with the exact failed check names. This includes failures for the production smoke report page, Shipping Simulation Lab page, shipping simulation API POST, shipping provider exports, shipping exceptions export, LetterTrack CSV export, launch readiness page, or handoff bundle. Rerun the production deploy once Vercel accepts deployments, then run the smoke again.

The downloadable launch handoff bundle from `/api/admin/launch-readiness?format=handoff-bundle` also includes Git Tip Verification and Production Deploy Commands sections with the `git fetch origin main` refresh, HEAD/origin checks, verify, launch, split deploy/smoke, clean-domain, and unwanted-alias reminders so an operator can hand off the production deploy without relying on chat history.

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
