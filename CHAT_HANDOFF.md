# TCOS Chat Handoff

Generated for the next Codex session after the live payment/shipping launch-gate hardening pass.

## Current repo state

- Workspace: `C:\Projects\truely-collectables`
- Branch: `main`
- GitHub remote: `https://github.com/TruelyCollectables/truely-collectables.git`
- Latest pushed commit: `b812bf9 Guard live runtime audit tables`
- Production Vercel deployment verified Ready:
  - `https://truely-collectables-nzx0vpaha-truelycollectables-projects.vercel.app`
- Vercel production alias also points at the latest Ready deployment:
  - `https://truely-collectables.vercel.app`
  - `https://truely-collectables-truelycollectables-projects.vercel.app`
  - `https://truely-collectables-git-main-truelycollectables-projects.vercel.app`
- Local working tree was clean except for untracked `.codex-run/`.
  - Leave `.codex-run/` alone unless the user explicitly says to delete it.

## Validation state

The latest pushed work passed:

```powershell
npx tsc --noEmit
npm run lint
npm run build
```

Manual generation status:

```powershell
npm run manual:pdf
```

- The manual HTML is current:
  - `docs/TCOS_OPERATOR_MANUAL_PRINT.html`
- The local PDF export keeps failing because local Chrome/Edge GPU processes crash.
- Existing PDF may be stale:
  - `docs/TCOS_OPERATOR_MANUAL.pdf`
- This PDF issue has been recurring and is not caused by the latest app code.

## Recent commit trail

Most recent commits, newest first:

```text
b812bf9 Guard live runtime audit tables
0b50adc Add live payment launch readiness checks
7321df8 Preflight launch gate audit tables
8e26c35 Harden live payment gate approval
8d81751 Harden live shipping gate approval
e8dc06e Add live shipping readiness checks
849ece9 Enforce live shipping runtime gate
e115314 Add live shipping launch gate
00e109e Add live shipping simulation approval report
8372275 Add live shipping approval checklist
f7fcce8 Guide dry-run cleanup into real shipping proof
a8f6b08 Add dry-run shipping cleanup center
```

## What was just completed

### Live shipping launch gate

Live shipping now has a dual-lock control plane:

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
- Runtime now probes `live_shipping_launch_events` after approval is verified. If the audit table disappears after approval, live shipping fails closed.
- Approval API now refuses approval when either the gate table or event table is unavailable.
- Missing migration errors tell the operator to apply:
  - `supabase/migrations/20260711185500_create_live_shipping_launch_gate.sql`

### Live payment launch gate

Live payments now have matching hardening:

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
- Runtime now probes `live_payment_launch_events` after approval is verified. If the audit table disappears after approval, live Checkout fails closed.
- Approval API now refuses approval when either the gate table or event table is unavailable.
- Missing migration errors tell the operator to apply:
  - `supabase/migrations/20260710185000_create_live_payment_launch_gate.sql`

### Launch readiness

`/admin/launch-readiness` now includes:

- first-class Live Payment Launch Gate row
- first-class Live Shipping Launch Gate row
- database checks for:
  - `live_payment_launch_gates`
  - `live_payment_launch_events`
  - `live_shipping_launch_gates`
  - `live_shipping_launch_events`
- dry-run shipping cleanup gate
- shipping setup/provider readiness
- Stripe, Supabase, webhook, admin, reconciliation, evidence, eBay, and other existing readiness checks

This page is still advisory/readiness surface. The actual runtime gates are in the API/lib code above.

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
- Keep `.codex-run/` untracked and untouched.
- Use `apply_patch` for file edits.
- Use `rg` first for searching.
- Do not use destructive git commands.
- Do not delete local/user files unless the user explicitly approves.
- Keep the manual updated when operational behavior changes.
- The user likes direct, plain language and does not need sugarcoating.

## Current production URLs to know

Latest verified Ready deployment:

```text
https://truely-collectables-nzx0vpaha-truelycollectables-projects.vercel.app
```

Useful admin routes:

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

1. Verify Supabase migrations are applied in the production Supabase project.
   - Critical migrations:
     - `20260710185000_create_live_payment_launch_gate.sql`
     - `20260711185500_create_live_shipping_launch_gate.sql`
   - Then open `/admin/launch-readiness` in production and confirm the four launch-gate tables are Ready.

2. Do a production admin smoke test without enabling live money/postage:
   - `/admin/launch-readiness`
   - `/admin/live-payment-launch`
   - `/admin/live-shipping-launch`
   - `/admin/shipping#dry-run-cleanup`
   - `/admin/shipping/simulations`
   - `/admin/payment-simulations`

3. Keep live payment and shipping switches locked unless intentionally testing:
   - `TCOS_LIVE_PAYMENTS_ENABLED` should remain off unless intentionally approving live Checkout.
   - `TCOS_SHIPPING_PURCHASE_MODE` should remain `dry_run` unless live postage is intentionally approved.
   - `TCOS_LIVE_SHIPPING_ENABLED` should remain off unless live postage is intentionally approved.

4. Next build direction after launch-gate hardening:
   - Build/verify admin-facing smoke-test report for launch gates and runtime locks.
   - Add a no-money “gate drill” that proves approval blocked/unblocked behavior without charging or buying postage.
   - Then return to marketplace/seller inventory export or InstaComp testing, depending on user priority.

5. InstaComp later:
   - User needs to test real batches.
   - Focus next pass on speed, OCR accuracy, serial/parallel detection, and comps quality.
   - eBay sold/listed comps are important because TCOS internal comps are not enough yet.

## Last known local status

Before creating this handoff:

```text
git status --short
?? .codex-run/
```

After this handoff is created, commit/push it if the user wants the handoff preserved in GitHub main.
