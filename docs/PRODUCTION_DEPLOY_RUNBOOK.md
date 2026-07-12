# TCOS Production Deploy Runbook

Use this when the queued launch work is ready to ship to production.

## Production target

- Clean production URL: `https://truely-collectables.vercel.app`
- Unwanted preview-style alias that must not return: `truely-collectables-tt3b.vercel.app`

Do not point production deploy or smoke overrides at the unwanted alias. The deploy helper refuses a clean-domain configuration that equals the unwanted alias, and the smoke helper refuses `SMOKE_BASE_URL` when it resolves to that alias.

## Before deploying

Confirm the local branch is pushed to GitHub:

```bash
git status --short
git rev-parse --short HEAD
git rev-parse --short origin/main
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

This runs lint, build, and the production preflight without starting a Vercel deployment.

## Deploy

For the normal launch path, run the one-shot command:

```bash
npm run launch:production
```

This runs lint, build, production preflight, production deploy, and production smoke in order.

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

The smoke helper logs in with `SMOKE_ADMIN_PASSWORD`, `ADMIN_PASSWORD`, or the local `.env.local` `ADMIN_PASSWORD`, then checks the production admin/readiness/shipping launch surfaces.

Smoke requests default to a 15-second timeout and report per-check, slowest-check, and total request duration. Override with `SMOKE_REQUEST_TIMEOUT_MS` if production is slow but still healthy. Failed-check snippets redact key-shaped Stripe, webhook, and JWT values before printing.

The smoke helper always targets the clean production URL by default. If `SMOKE_BASE_URL` is overridden to `https://truely-collectables-tt3b.vercel.app`, the helper exits before sending requests.

If the smoke says queued launch features are not visible, production is still behind the GitHub stack. Rerun the production deploy once Vercel accepts deployments, then run the smoke again.

## Expected success path

```bash
git status --short
git rev-parse --short HEAD
git rev-parse --short origin/main
npm run launch:production
```

Separate fallback path:

```bash
npm run preflight:production
npm run deploy:production
npm run smoke:production
```
