# TCOS Chat Handoff

Generated for the next Codex session during the production launch stacking pass.

## Current repo state

- Workspace: `/Users/davidbakanas/Documents/GitHub/truely-collectables`
- Branch: `main`
- GitHub remote: `https://github.com/TruelyCollectables/truely-collectables.git`
- Recent verified production-safe stack includes `1fc532d Validate production deploy targets`, `b11d853 Harden Vercel CLI launch path`, and `3b3d64b Harden deploy result validation`.
- Local `HEAD` and `origin/main` matched after the latest post-push `npm run preflight:production`.
- Working tree was clean after that preflight.
- `.codex-run/` is ignored in `.gitignore`; leave the folder contents alone unless the user explicitly says to delete them.

Always refresh the exact Git state before deploy work:

```bash
git fetch origin main
git status --short
git rev-parse --short HEAD
git rev-parse --short origin/main
git log -6 --oneline
```

Treat those commands as the source of truth for the current Git tip. This handoff may be followed by handoff-only commits that do not change the deploy sequence.

## Production/Vercel state

- Clean production URL: `https://truely-collectables.vercel.app`
- The unwanted preview-style alias `truely-collectables-tt3b.vercel.app` must not return.
- Vercel production deploys were recently blocked by the free deployment quota:
  - `api-deployments-free-per-day`
- The deploy helper records `.codex-run/vercel-quota-block.json` after a quota cap so later attempts can stop before upload unless the retry is intentional.
- Latest GitHub commits are queued and pushed, but production may not include them until the quota window resets and `npm run launch:production` succeeds.
- Do not treat missing queued launch exports on production as code loss. They are expected until the next successful Vercel production deploy.

## Production deploy flow

Use the runbook:

- `docs/PRODUCTION_DEPLOY_RUNBOOK.md`

Expected command sequence once Vercel accepts deployments:

```bash
npm run launch:production
```

Separate fallback commands:

```bash
npm run deploy:production
npm run smoke:production
```

The deploy helper:

- refreshes `origin/main`;
- blocks uncommitted deploy-relevant local changes;
- checks local Git state against `origin/main`;
- verifies command-pinned Vercel CLI `56.2.0` through isolated `npm exec --package=vercel@56.2.0` before any possible upload; the CLI cache stays under the OS temporary directory, outside application `node_modules` and the lockfile, and every Vercel call receives `--cwd` with the repository root;
- validates `VERCEL_SCOPE` as a simple lowercase Vercel team slug before quota status, preflight, Git fetch, or Vercel CLI work;
- normalizes `VERCEL_CLEAN_DOMAIN` and `VERCEL_UNWANTED_ALIAS` from hostnames or URLs;
- rejects credentials, ports, paths, queries, fragments, IPs, single-label names, and malformed DNS labels without echoing rejected target values;
- bounds `SMOKE_REQUEST_TIMEOUT_MS` to integer milliseconds from `1000` through `120000` and fails malformed, infinite, fractional, zero, negative, or too-large values before admin auth, Git fetch, or network requests;
- stops early when the local Vercel quota cooldown marker is still active;
- checks that cooldown before command-pinned npm exec or Git fetch on normal deploys, while preflight-only remains quota-independent;
- deploys production through Vercel only when the checks pass;
- fails clearly if Vercel quota is still capped;
- removes the unwanted `truely-collectables-tt3b.vercel.app` alias if present;
- stops before clean-domain aliasing unless unwanted-alias removal succeeds or Vercel CLI explicitly reports that alias already absent;
- points `https://truely-collectables.vercel.app` at the new production deployment;
- prints deployed/clean URL output and the `npm run smoke:production` handoff.

The read-only quota status helper:

- runs through `npm run status:production`;
- reads only the local quota marker and starts no Git fetch, build, Vercel upload, or deployment;
- prints the exact blocked/retry timestamps, approximate remaining cooldown, marker path, local retry verdict, and `Vercel upload started: no`;
- is the safe quota check between recurring development blocks.
- fails closed when the marker is malformed or unreadable: it reports `state: invalid_marker`, starts no Vercel upload, and requires inspection/restoration or an intentional override after independent quota-reset confirmation.
- fails closed when `TCOS_VERCEL_QUOTA_COOLDOWN_HOURS` is zero, negative, or nonnumeric: it reports `state: invalid_configuration` and cannot silently disable the deployment guard.
- preserves the marker across failed override retries, unparseable Vercel responses, and clean-alias failures; removal happens only after a parsed deployment URL and successful clean alias.
- requires `vercel --prod` exit status 0 before URL parsing, alias commands, or marker clearing; failure output cannot become a deployment merely because it contains a `.vercel.app` URL.
- preserves the marker and clean-domain target when unwanted-alias cleanup fails for authentication, scope, network, or any result other than explicit alias-not-found.
- protects the real `.codex-run/vercel-quota-block.json` marker by refusing cooldown self-tests unless `TCOS_VERCEL_QUOTA_MARKER_PATH` names an explicit temporary file.
- publishes the shared `quotaStatusCommand` and read-only description through launch-readiness JSON/Markdown, the handoff bundle, Launch Readiness, and Production Smoke Report surfaces; production smoke guards the handoff.

The preflight helper:

- runs the same Git/clean-worktree checks through `npm run preflight:production`;
- exits before starting any Vercel deployment.

The verify helper:

- runs lint, InstaComp queue/accuracy simulations, LetterTrack evidence checks, shipping purchase-attempt audit simulations, the twenty-scenario shipping simulation suite, build, production guardrail checks, and production preflight;
- is quota-safe because it does not start a Vercel deployment.

The launch helper:

- runs `npm run verify:production`, then `npm run deploy:production`, then `npm run smoke:production`;
- should be the only command needed when Vercel quota opens.

The smoke helper:

- logs in using `SMOKE_ADMIN_PASSWORD`, `ADMIN_PASSWORD`, or `.env.local` `ADMIN_PASSWORD`;
- checks admin, launch readiness, Launch Gate Drill, live payment/shipping gates, production smoke page, shipping simulation surfaces, shipping provider exports, shipping exceptions export, LetterTrack CSV export, Seller Connections Marketplace Packet Intake, seller receipt handoff controls, and seller inventory/order/payout auth gates;
- normalizes `SMOKE_BASE_URL` and `SMOKE_UNWANTED_ALIAS_URL` from valid bare DNS hostnames or root HTTP(S) URLs;
- rejects smoke targets containing credentials, ports, paths, queries, fragments, IPs, single-label names, or malformed DNS labels before admin authentication, Git fetch, or HTTP requests, without echoing rejected values;
- refuses to run when `SMOKE_BASE_URL` resolves to `truely-collectables-tt3b.vercel.app`;
- fails if the unwanted `truely-collectables-tt3b.vercel.app` alias returns a successful response;
- prints failed-check HTTP status, content type, request duration, and short response/error snippets redacted for Stripe, webhook, JWT, Resend, auth-header, query-token, API-key, password, and JSON secret values;
- prints per-check, slowest-check, and total request timing;
- refreshes `origin/main` before printing local/remote commit context;
- clearly calls out queued feature failures when production is simply behind GitHub.

## Recent validation state

Recent pushed work passed:

```bash
npm run verify:production
npm run check:production-guardrails
npm run lint
npx tsc --noEmit --pretty false
npm run build
npm run manual:pdf
npm run preflight:production
```

Most recent notable validation:

- Current dependency-security block:
  - Updated Next.js and `eslint-config-next` from 16.2.9 to 16.2.10.
  - Overrode Next's vulnerable PostCSS 8.4.31 dependency with PostCSS 8.5.15 for GHSA-qx2v-qp2m-jg93.
  - Pinned production builds to the supported `next build --webpack` path after Turbopack 16.2.10 stalled with the fixed PostCSS override; `next dev` still uses Turbopack.
  - `npm audit --omit=dev` reports zero vulnerabilities after the override.
  - Production guardrails pin the aligned Next.js versions and PostCSS override until a later verified Next.js release carries the fix directly.
- Current 30-minute build block:
  - Made `SMOKE_BASE_URL` and `SMOKE_UNWANTED_ALIAS_URL` fail closed on credentials, explicit ports (including `:443` and `:80`), paths, queries, fragments, IPs, single-label names, and malformed DNS labels before authentication or network requests.
  - Closed the same explicit-default-port parser edge in deploy target validation.
  - Added deterministic target self-tests, direct failure fixtures, shared launch-readiness contracts, smoke coverage, and operator documentation.
  - Lint, InstaComp verification, shipping verification, production build, production guardrails, both dependency audits, and regenerated manual HTML/PDF passed; the pre-commit preflight stopped only on the expected dirty worktree without starting a deployment.
- `cc36a5b Harden marketplace packet intake guardrails`
  - Added visible `/seller/marketplaces` no-op chips for no payout release, no order fulfillment, and no automatic under-$20 protection activation.
  - Updated production smoke and guardrails.
  - `npm run verify:production` passed after push.
- `2400ce8 Guard README launch contract wording`
  - README now matches the hardened packet-intake contract.
  - README now correctly describes `verify:instacomp` as focused instead of full production verification.
  - Guardrails protect those README statements.
  - `npm run verify:production` passed after push.
- `44a49a4 Harden operator manual PDF generation`
  - `scripts/build-manual-pdf.mjs` now supports macOS/Linux browser paths, `TCOS_MANUAL_BROWSER_PATH`, proper `pathToFileURL` file URLs, browser timeout via `TCOS_MANUAL_PDF_BROWSER_TIMEOUT_MS`, and fresh-PDF success detection.
  - `docs/TCOS_OPERATOR_MANUAL.pdf` was regenerated successfully.
  - `npm run manual:pdf`, `npm run check:production-guardrails`, `npm run lint`, `node --check scripts/build-manual-pdf.mjs`, `git diff --check`, and `npm run preflight:production` passed.

Manual generation status:

```bash
npm run manual:pdf
```

- The manual HTML and PDF were regenerated for the current launch-safety stack.
- Local PDF generation previously failed on this Mac workspace because the script only knew Windows browser paths and could hang after Chrome wrote the PDF.
- That recurring stale-PDF issue is fixed and guarded.

## Recent commit trail

Most recent commits, newest first:

```text
1fc532d Validate production deploy targets
b11d853 Harden Vercel CLI launch path
3b3d64b Harden deploy result validation
38a752d Refresh launch handoff state
44a49a4 Harden operator manual PDF generation
2400ce8 Guard README launch contract wording
cc36a5b Harden marketplace packet intake guardrails
008ce18 Surface seller protection allocation contract
9e86c87 Guard under-20 seller protection allocation
4a1cb02 Ignore quarantined Next build artifacts
84f7528 Document queued smoke diagnostics
2acb107 Add queued smoke path snippets
4c754fd Clarify queued smoke failure details
9cf77be Centralize receipt handoff smoke checks
```

## Current queued production-safe work

Recent queued work added or hardened:

- under-$20 Seller Protection allocation simulations and visible admin simulation contract;
- item-only reimbursement, shipping exclusion, and non-opted-in seller liability guardrails;
- Seller Connections Marketplace Packet Intake guardrails:
  - cross-list prep only;
  - no external publishing;
  - no postage purchase;
  - no Coverage policy creation;
  - no payout release;
  - no order fulfillment;
  - no automatic under-$20 protection activation;
- Seller Marketplace Receipt Handoff proof route and controls;
- launch handoff bundle;
- shipping provider setup JSON;
- shipping provider env template;
- shipping provider Vercel env command export;
- shipping provider operator checklist;
- provider credential groups displayed in the shipping gate/setup flow;
- portable operator manual PDF generation.
- network-independent local Geist font loading and a direct `tsx` verification dependency.
- bounded Tailwind 4 source detection across `src/**`, preventing cold production builds from recursively scanning FileProvider workspace metadata, generated caches, documentation artifacts, and dependencies.
- command-pinned Vercel CLI `56.2.0` preflight and fail-closed unwanted-alias cleanup before clean-domain aliasing.
- strict production target-host validation and a pre-CLI/pre-Git normal-deploy quota stop.
- strict production smoke-target validation before any authentication or network request.

These may fail production smoke until a successful Vercel deploy lands the queued commits.

## Next safe steps

- EXTREMELY HOT top priority after the current InstaComp accuracy pass: build the `TCOS Card Knowledge Base MVP`.
  - Gate: do not start this until the operator is satisfied the current scanner test pass is ready to preserve.
  - Goal: make InstaComp faster and more accurate by checking TCOS-owned verified card truth before paying/waiting for outside AI or source search.
  - MVP scope: add TCOS-owned card catalog, variant, identity-evidence, correction, and source-cache storage; check the local knowledge base first during InstaComp scans; save confirmed/corrected rows back into it; cache checklist evidence from Sportlots, Upper Deck, Panini, Cardboard Connection, TCDB/Trading Card DB, and approved free/cheap sources; show `TCOS verified`, `external verified`, or `needs review`; and keep exact comps/pricing blocked unless identity evidence is strong enough.
  - Trust rule: corrected cards enter as `learning`; the same card identity becomes `tcos_trusted` only after the third distinct operator-confirmed sighting. Reprocessing the same saved scan item must not double-count.
  - Expected build size: about 6–9 focused build hours for the MVP backbone; 2–3 days for polished duplicate merging, image fingerprinting, admin review queues, bulk imports, and full catalog management.
- Next priority after the Card Knowledge Base MVP: build the “Vicodin” InstaComp speed MVP.
  - Goal: make scans feel dramatically faster without sacrificing accuracy.
  - MVP scope: move scan work off the browser into true server-side/background workers, return fast identity first, enrich comps/pricing second, cache checklist/catalog lookups, keep provider calls split into fast-path versus slow-path, and show live progress from durable job state.
  - Expected build size: about 6–10 focused build hours for MVP; 2–4 days for production-scale hardening with worker deployment, monitoring, budgets, rate limits, and load testing.
- If Vercel quota is still capped, do not rapid-fire deploy retries. Keep stacking small production-safe code/docs/guardrail commits.
- Prefer work that improves smoke coverage, launch docs, operator handoffs, or fail-closed shipping/seller-protection contracts.
- When quota opens, run `npm run launch:production` and ship only after smoke passes the clean production domain while the unwanted alias stays absent.
