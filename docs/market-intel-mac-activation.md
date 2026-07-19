# Activate the private TCOS Market Intel worker on macOS

This is the controlled first deployment path for the portable Profit Hunter search worker. The Mac performs eBay Browse API searches and writes unverified candidates to Supabase. Vercel remains the private dashboard and does not perform routine marketplace searches once external mode is enabled.

## Before starting

- Run this from the `truely-collectables` repository root.
- Use the branch or release containing the Identity Proof Gate and external worker.
- Keep the Mac awake and online.
- Have the Supabase project reference, service-role key, and production eBay API credentials available.
- Do not run another Mac or online worker at the same time.

## One-command activation

```bash
zsh scripts/bootstrap-market-intel-worker-macos.sh
```

The command performs these gates in order:

1. Checks macOS, Node.js, npm, git, worker files, and dependencies.
2. Creates `.env.market-intel-worker.local` with mode `600` if it does not exist.
3. Runs Identity Proof Gate simulations.
4. Initializes and links the Supabase CLI when needed.
5. Shows `supabase db push --dry-run` and requires typing `APPLY` before any database migration is deployed.
6. Applies all pending migrations displayed in that dry run.
7. Validates the Supabase candidate queue and eBay OAuth without making a marketplace-search call.
8. Runs one live Profit Hunter worker cycle.
9. Installs a macOS `launchd` job every 15 minutes.
10. Shows worker state and recent logs.

Supabase documents `db push --dry-run` as the preview step and `db push` as the command that applies pending migrations to the linked remote project. The bootstrap intentionally stops unless the operator explicitly confirms the displayed migration set.

## Common options

Run a validation and one live cycle without installing the recurring service:

```bash
zsh scripts/bootstrap-market-intel-worker-macos.sh --skip-install
```

Use a slower interval:

```bash
zsh scripts/bootstrap-market-intel-worker-macos.sh --minutes 30
```

Skip the migration only when the Identity Proof Gate migration has already been applied:

```bash
zsh scripts/bootstrap-market-intel-worker-macos.sh --skip-migration
```

Supply the Supabase project reference up front:

```bash
zsh scripts/bootstrap-market-intel-worker-macos.sh --project-ref YOUR_PROJECT_REF
```

## Status and logs

```bash
node scripts/status-market-intel-worker-launchd.mjs
```

Worker logs are stored under:

```text
~/Library/Logs/TCOS-Market-Intel/
```

## Stop the Mac worker

```bash
node scripts/uninstall-market-intel-worker-launchd.mjs
```

Uninstalling the scheduler does not delete Supabase candidates, identity proof, Market Intel history, or the protected local environment file.

## Vercel cutover

Only after the Mac worker has completed a live cycle and candidates are visible in the private Identity Proof Queue:

1. Set `MARKET_INTEL_SEARCH_EXECUTION=external` in Vercel.
2. Disable any duplicate cron-job.org request still calling the Vercel Hot Watch route.
3. Keep Vercel as the private UI, proof-review, scoring, alert, and purchase control plane.

The bootstrap does not modify Vercel or deploy the application.

## Move fully online later

The same worker is packaged under `deploy/market-intel-worker/`. To move online:

1. Deploy the provider-neutral container with the same Supabase and eBay secrets.
2. Run one online cycle and confirm candidates appear in the same queue.
3. Uninstall the Mac scheduler.
4. Confirm exactly one search executor remains active.
5. Keep `MARKET_INTEL_SEARCH_EXECUTION=external` enabled.

No Profit Hunter data migration or marketplace-search rewrite is required for that cutover.
