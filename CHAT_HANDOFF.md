# TCOS Chat Handoff

Generated for the next Codex session during the production launch stacking pass.

## Current repo state

- Workspace: `C:\Projects\truely-collectables`
- Branch: `main`
- GitHub remote: `https://github.com/TruelyCollectables/truely-collectables.git`
- Latest pushed commit before this handoff refresh: `dcb3bf4 Smoke one-shot launch command visibility`
- Local `HEAD` and `origin/main` matched at `dcb3bf4` after the last push.
- Local working tree was clean except for untracked `.codex-run/`.
  - Leave `.codex-run/` alone unless the user explicitly says to delete it.

## Production/Vercel state

- Clean production URL: `https://truely-collectables.vercel.app`
- The unwanted preview-style alias `truely-collectables-tt3b.vercel.app` must not return.
- Vercel production deploys were blocked by the free deployment quota:
  - `api-deployments-free-per-day`
- The latest GitHub commits are queued and pushed, but production may not include them until the quota window resets and `npm run launch:production` succeeds.
- Do not treat missing queued launch exports on production as code loss. They are expected until the next successful Vercel production deploy.

## Production deploy flow

Use the runbook:

- `docs/PRODUCTION_DEPLOY_RUNBOOK.md`

Expected command sequence once Vercel accepts deployments:

```powershell
git status --short
git rev-parse --short HEAD
git rev-parse --short origin/main
npm run deploy:production
npm run smoke:production
```

Preferred one-shot command:

```powershell
npm run launch:production
```

The deploy helper:

- checks local Git state against `origin/main`;
- deploys production through Vercel;
- fails clearly if Vercel quota is still capped;
- removes the unwanted `truely-collectables-tt3b.vercel.app` alias if present;
- points `https://truely-collectables.vercel.app` at the new production deployment.

The smoke helper:

- logs in using `SMOKE_ADMIN_PASSWORD`, `ADMIN_PASSWORD`, or `.env.local` `ADMIN_PASSWORD`;
- checks admin, launch readiness, the one-shot launch command visibility, live payment/shipping gates, and shipping provider export surfaces;
- fails if the unwanted `truely-collectables-tt3b.vercel.app` alias returns a successful response;
- prints failed-check HTTP status, content type, and a short safe response snippet;
- prints local/remote commit context;
- clearly calls out queued feature failures when production is simply behind GitHub.

## Validation state

Recent pushed work passed:

```powershell
npm run lint
npm run build
```

Manual generation status from the earlier handoff still applies:

```powershell
npm run manual:pdf
```

- The manual HTML existed:
  - `docs/TCOS_OPERATOR_MANUAL_PRINT.html`
- Local PDF export had been failing because local Chrome/Edge GPU processes crash.
- Existing PDF may be stale:
  - `docs/TCOS_OPERATOR_MANUAL.pdf`
- This PDF issue has been recurring and is not caused by the latest app code.

## Recent commit trail

Most recent commits, newest first:

```text
dcb3bf4 Smoke one-shot launch command visibility
79955ce Add one-shot production launch script
be20fcb Guard unwanted Vercel alias in production smoke
ccf27ba Add production smoke failure diagnostics
a0cbb78 Smoke production deploy queue surface
5e2de83 Surface production deploy queue in readiness
d33c6f5 Refresh launch handoff for queued deploy
9319d4b Document production deploy runbook
0928f64 Clarify queued feature smoke failures
0cbcc3b Harden production deploy preflight
abcebae Add one-shot production deploy helper
cd21fab Add production launch smoke script
d6670fa Link launch handoff bundle from dashboard
bd623ee Add launch handoff bundle export
54d7361 Show credential groups on shipping gate
```

## What was just completed

### Launch deployment/runbook stack

Added and pushed:

- `scripts/deploy-production.mjs`
- `scripts/smoke-production.mjs`
- `docs/PRODUCTION_DEPLOY_RUNBOOK.md`
- README link to the production deploy runbook

Package scripts:

```json
{
  "deploy:production": "node scripts/deploy-production.mjs",
  "smoke:production": "node scripts/smoke-production.mjs",
  "launch:production": "npm run deploy:production && npm run smoke:production"
}
```

### Launch handoff and shipping provider exports

Recent queued work also added admin/export surfaces for:

- launch handoff bundle;
- shipping provider setup JSON;
- shipping provider env template;
- shipping provider Vercel env command export;
- shipping provider operator checklist;
- provider credential groups displayed in the shipping gate/setup flow.

These may fail production smoke until a successful Vercel deploy lands the queued commits.

### Live shipping launch gate

Live shipping has a dual-lock control plane:

- Admin page:
  - `/admin/live-shipping-launch`
- API:
  - `/api/admin/live-shipping-launch`
- Runtime enforcement:
  - `src/lib/live-shipping-launch.ts`
  - `src/app/api/admin/orders/[id]/shipping-labels/route.ts`
- Supabase migration:
  - `supabase/migrations/20260711185500_create_live_shipping_launch_gate.sql`
- Tables:
  - `live_shipping_launch_gates`
  - `live_shipping_launch_events`

Important behavior:

- Live postage purchase is blocked unless:
  - `TCOS_SHIPPING_PURCHASE_MODE=live`
  - `TCOS_LIVE_SHIPPING_ENABLED=true`
  - current database gate approval exists
  - immutable live-shipping event table is reachable
  - provider live requirements pass
  - dry-run shipping cleanup is clean
  - shipping simulations/live approval report pass
- Manual external label recording still works.
- Runtime probes `live_shipping_launch_events` after approval is verified. If the audit table disappears after approval, live shipping fails closed.
- Approval API refuses approval when either the gate table or event table is unavailable.

### Live payment launch gate

Live payments have matching hardening:

- Admin page:
  - `/admin/live-payment-launch`
- API:
  - `/api/admin/live-payment-launch`
- Runtime enforcement:
  - `src/lib/live-payment-launch.ts`
- Supabase migration:
  - `supabase/migrations/20260710185000_create_live_payment_launch_gate.sql`
- Tables:
  - `live_payment_launch_gates`
  - `live_payment_launch_events`

Important behavior:

- Live Checkout is blocked unless:
  - live Stripe keys are configured
  - `TCOS_LIVE_PAYMENTS_ENABLED=true`
  - current database gate approval exists
  - immutable live-payment event table is reachable
  - dry-run shipping cleanup is clean
  - reconciliation/test residue/payment simulation checks pass
  - live webhook/refund/dispute verification checks pass
- Runtime probes `live_payment_launch_events` after approval is verified. If the audit table disappears after approval, live Checkout fails closed.
- Approval API refuses approval when either the gate table or event table is unavailable.

### Launch readiness

`/admin/launch-readiness` includes:

- first-class Live Payment Launch Gate row;
- first-class Live Shipping Launch Gate row;
- database checks for:
  - `live_payment_launch_gates`
  - `live_payment_launch_events`
  - `live_shipping_launch_gates`
  - `live_shipping_launch_events`
- dry-run shipping cleanup gate;
- shipping setup/provider readiness;
- Stripe, Supabase, webhook, admin, reconciliation, evidence, eBay, and other existing readiness checks.

This page is advisory/readiness surface. The runtime gates live in the API/lib code above.

### Dry-run shipping safety

The system has a dry-run cleanup center and fail-closed launch checks:

- Admin cleanup page anchor:
  - `/admin/shipping#dry-run-cleanup`
- Cleanup API:
  - `/api/admin/shipping/dry-run-cleanup`
- Shared scanner:
  - `src/lib/shipping-dry-run-cleanup.ts`

Live payment and live shipping approval/runtime checks both recheck dry-run shipping residue.

### Shipping roadmap already baked in

Prior work in this thread added/advanced:

- Standard Envelope routing for collectible cards under the configured threshold.
- Ground Advantage fallback for higher-value/over-weight shipments.
- Coverage/seller protection tracking fields and claim packet surfaces.
- Dry-run provider setup/export/readiness.
- Shipping simulation suite and live adapter approval checklist.

Keep live postage in dry-run until a real provider adapter, credentials, quote/buy/void tests, Coverage purchase tests, webhook reconciliation, and admin approval are all clean.

### InstaComp state

InstaComp has been improved, but the user wants to test later. Current remembered state:

- PaddleOCR was chosen for OCR improvement.
- Serial detection improved enough that serial ranges like `/25` are being found.
- Listing display should prefer the serial range like `/25`, not the exact serial number like `15/25`, except `1/1` stays `1/1`.
- Comps still need real-world testing and likely more work.
- User wants InstaComp to become a simple one-button workflow:
  - upload up to 500 card images
  - pair fronts/backs
  - identify exact card/year/player/set/parallel/serial range/auto
  - pull comps, including eBay
  - create TCOS draft listings
  - later publish/export to eBay, Whatnot, and other storefronts
- Do not assume InstaComp is final. It is parked for later testing.

## Important user preferences / operating rules

- User wants rapid forward motion. If they say `next`, pick the next high-value roadmap/safety item and execute.
- User has already approved pushing commits to GitHub main when needed.
- User expects pushed commits to deploy on Vercel and be verified.
- While Vercel quota is capped, keep stacking safe commits on GitHub.
- Keep `.codex-run/` untracked and untouched.
- Use `apply_patch` for file edits.
- Use `rg` first for searching.
- Do not use destructive git commands.
- Do not delete local/user files unless the user explicitly approves.
- Keep the manual/docs updated when operational behavior changes.
- The user likes direct, plain language and does not need sugarcoating.

## Useful admin routes

```text
/admin
/admin/launch-readiness
/admin/live-payment-launch
/admin/live-shipping-launch
/admin/shipping
/admin/shipping#dry-run-cleanup
/admin/shipping/simulations
/admin/payment-simulations
/admin/financial-reconciliation
/admin/instacomp
/admin/products
/admin/orders
```

## Recommended next work queue

Best next steps, in order:

1. Keep stacking Vercel-ready launch improvements in small commits while quota is capped.
2. When quota opens, run:
   - `npm run launch:production`
   - If needed, run the fallback pair manually:
     - `npm run deploy:production`
     - `npm run smoke:production`
3. If smoke passes, verify production admin manually:
   - `/admin/launch-readiness`
   - `/admin/live-payment-launch`
   - `/admin/live-shipping-launch`
   - `/admin/shipping#dry-run-cleanup`
4. Keep live shipping locked unless intentionally testing:
   - `TCOS_SHIPPING_PURCHASE_MODE=dry_run`
   - `TCOS_LIVE_SHIPPING_ENABLED=false`
5. If continuing feature work before deploy, good targets are:
   - admin-facing production smoke report page;
   - no-money/no-postage gate drill;
   - marketplace/seller inventory export;
   - InstaComp real-batch testing and accuracy pass.

## Last known local status

Before this handoff rewrite:

```text
git status --short
?? .codex-run/
```
