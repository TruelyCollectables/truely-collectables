# TCOS Market Intel worker — online deployment

This directory keeps the Profit Hunter search worker portable. The same worker can run on the private Mac now and later move to any container host that supports Node.js, environment secrets, and outbound HTTPS.

## What remains on Vercel

Vercel remains the private control plane:

- Market Intel and Profit Hunter admin pages
- identity-review decisions
- candidate promotion and deal scoring
- purchase ledger and reporting

Marketplace searches do not need to execute on Vercel when `MARKET_INTEL_SEARCH_EXECUTION=external` is enabled.

## Build the container

From the repository root:

```bash
docker build -f deploy/market-intel-worker/Dockerfile -t tcos-market-intel-worker .
```

## Always-on online worker

```bash
docker run --rm \
  --env-file .env.market-intel-worker.local \
  -e MARKET_INTEL_WORKER_NAME=online-private-worker \
  tcos-market-intel-worker
```

The service runs one complete cycle, waits for `MARKET_INTEL_WORKER_INTERVAL_MINUTES`, then runs again. Cycles never overlap inside one container.

## Cloud-scheduled one-cycle job

A provider scheduler may run the container every 15 minutes and override the default command:

```bash
node --import tsx scripts/run-market-intel-external-worker.ts
```

Use either the always-on service or a scheduled one-cycle job, not both.

## Required runtime secrets

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`

Store them in the host's secret manager. Never bake them into the image or commit an environment file.

## Worker controls

- `MARKET_INTEL_WORKER_NAME`
- `MARKET_INTEL_WORKER_MAX_SUBJECTS`
- `MARKET_INTEL_WORKER_MAX_IDENTITIES`
- `MARKET_INTEL_WORKER_MAX_QUERIES`
- `MARKET_INTEL_WORKER_RESULTS_PER_QUERY`
- `MARKET_INTEL_WORKER_MINIMUM_CONFIDENCE`
- `MARKET_INTEL_WORKER_INTERVAL_MINUTES`

The same eBay call-budget guard used on the Mac remains active online.

## Mac-to-online cutover

1. Confirm the Identity Proof Gate migration is already applied to the shared Supabase project.
2. Deploy the online worker with the same Supabase project and worker settings.
3. Run one online cycle and confirm new candidates appear in the private Identity Proof Queue.
4. Stop the Mac worker with:

   ```bash
   node scripts/uninstall-market-intel-worker-launchd.mjs
   ```

5. Confirm only one worker is making eBay calls.
6. Keep `MARKET_INTEL_SEARCH_EXECUTION=external` enabled on Vercel.

Candidate fingerprints prevent duplicate rows, but running Mac and online workers together still doubles marketplace API calls. The cutover must leave only one active search executor.

**Operating rule:** use exactly one of the Mac LaunchAgent, online service container, or scheduled online job.

## Provider independence

No provider SDK is used. The worker talks only to approved marketplace APIs and Supabase over HTTPS. It can later move among a Linux server, container platform, scheduled container job, or private infrastructure without changing Profit Hunter's data model.
