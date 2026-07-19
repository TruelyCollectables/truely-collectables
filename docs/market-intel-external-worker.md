# TCOS Market Intel external search worker

## Purpose

Run Profit Hunter marketplace searches outside Vercel while keeping the existing private Market Intel dashboard, Supabase data model, exact-card identities, scoring, alerts, and purchase ledger.

The worker is intentionally private and operator-controlled. It does not auto-buy, auto-list, or promote a candidate into the Profit Hunter deal desk.

## Architecture

1. **Portable worker** reads active Profit Hunter subjects and exact-card identities from Supabase.
2. It calls approved marketplace APIs, beginning with the eBay Browse API.
3. It writes unverified results into `tcos_mi_search_candidates`.
4. Vercel only renders the private review queue.
5. The owner reviews images and identity evidence.
6. Only a **VERIFIED EXACT** decision promotes the candidate into `tcos_mi_listings` and allows normal Profit Hunter scoring.
7. Database triggers suppress actionable deal scores and block purchase creation when exact identity proof is missing.

This removes repeated marketplace searching from Vercel. Vercel is the control plane and dashboard, not the search engine.

## Required environment variables on the worker machine

Create `.env.market-intel-worker.local` in the repository root. It is already excluded by `.gitignore`.

```bash
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
EBAY_CLIENT_ID=...
EBAY_CLIENT_SECRET=...

MARKET_INTEL_WORKER_NAME=mac-private-worker
MARKET_INTEL_WORKER_MAX_SUBJECTS=3
MARKET_INTEL_WORKER_MAX_IDENTITIES=4
MARKET_INTEL_WORKER_MAX_QUERIES=8
MARKET_INTEL_WORKER_RESULTS_PER_QUERY=5
MARKET_INTEL_WORKER_MINIMUM_CONFIDENCE=55
MARKET_INTEL_WORKER_INTERVAL_MINUTES=15
```

Protect it:

```bash
chmod 600 .env.market-intel-worker.local
```

Never put the Supabase service-role key or eBay secret in browser code, a plist, a container image, or Git.

## Run one search cycle manually

From the repository root:

```bash
/bin/zsh scripts/run-market-intel-worker-cycle.sh
```

The script loads the private env file, runs one cycle, writes candidates to Supabase, and exits.

## Install on the always-on Mac

The Mac installer records only file paths and the Node executable in the LaunchAgent. Secrets remain in the protected local env file.

```bash
node scripts/install-market-intel-worker-launchd.mjs --minutes 15
```

Check it:

```bash
node scripts/status-market-intel-worker-launchd.mjs
node scripts/status-market-intel-worker-launchd.mjs --json
```

Remove it without deleting the env file or Supabase data:

```bash
node scripts/uninstall-market-intel-worker-launchd.mjs
```

Logs are stored under:

```text
~/Library/Logs/TCOS-Market-Intel/
```

The Mac must remain awake, connected to the internet, and signed into the user account that owns the LaunchAgent. A powered-on but sleeping Mac will not search on schedule.

## Online worker later

The marketplace worker is not tied to macOS. A provider-neutral container is available under:

```text
deploy/market-intel-worker/
```

It supports either:

- an always-on service loop, or
- a cloud-scheduled one-cycle container job.

The online host receives the same runtime secrets and writes to the same Supabase queue. Profit Hunter does not need to change when the worker moves online.

During cutover, confirm the online worker stages candidates successfully and then uninstall the Mac LaunchAgent. Candidate deduplication prevents duplicate rows, but two simultaneous workers still waste marketplace API quota.

**Operating rule:** only one marketplace-search executor may be active at a time: Mac LaunchAgent, online always-on container, or cloud-scheduled container job.

See `deploy/market-intel-worker/README.md` for the container commands and cutover checklist.

## Disable Vercel marketplace execution

Set this environment variable in Vercel after the external worker is installed and tested:

```bash
MARKET_INTEL_SEARCH_EXECUTION=external
```

The Vercel Hot Watch route will then return a safe skipped response instead of calling eBay.

## Search budget

Default maximum per cycle:

- 4 exact identities
- up to 8 query families each
- up to 32 eBay Browse API calls per cycle

At a 15-minute interval, the theoretical ceiling is 3,072 calls per day. The worker refuses to start when its configuration estimates more than 4,500 calls per day, preserving room under the default eBay Browse API daily limit for manual tests and other scans.

This is not unlimited marketplace access. Search frequency remains constrained by each source's approved API quotas and terms, even though Vercel is no longer the execution bottleneck.

## Identity Proof Gate

A candidate cannot become actionable or purchasable until the private owner confirms:

- front image
- back image or slab label
- checklist/catalog match
- card number
- exact parallel/variation
- no conflicting evidence

Serial-number and autograph/relic confirmations are also stored when applicable.

The proof decision and evidence are recorded in `tcos_mi_identity_proof_reviews`.

## Deployment order

1. Apply `20260719153000_market_intel_identity_proof_gate.sql` to Supabase.
2. Create and protect `.env.market-intel-worker.local`.
3. Run the worker manually once.
4. Review staged candidates inside Profit Hunter.
5. Confirm candidate promotion and purchase blocking.
6. Install the Mac schedule, or deploy the online container—not both.
7. Set `MARKET_INTEL_SEARCH_EXECUTION=external` on Vercel.
8. Disable any duplicate cron-job.org call that still targets the Vercel Hot Watch route.

Do not enable an aggressive schedule until eBay call counts, duplicate suppression, candidate quality, and worker logs have been reviewed.
