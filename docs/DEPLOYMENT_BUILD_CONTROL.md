# TCOS deployment build-control runbook

Last verified locally: July 22, 2026.

This runbook separates build spend from runtime cron usage and defines the single approved production release path for the finished admin dashboard.

## Current build controls

- `vercel.json` intentionally allows Git-triggered Vercel deployments only from `main`:
  - `"*": false`
  - `"main": true`
- `admin-dashboard-work` can stay parked on GitHub without creating a Vercel build from the branch.
- Vercel cron entries invoke production functions. They do not create git deployments or spend build CPU minutes by themselves.
- The live inventory freshness crons are runtime jobs, not build jobs:
  - `/api/cron/ebay-store-fixed-price-sync`
  - `/api/cron/seller-ebay-reconciliation`

## Current remaining build risk

The active GitHub workflow `.github/workflows/tcos-scheduled-production-release.yml` can push to `main` automatically if `market-intel-work` merges cleanly and its checks pass. Any push to `main` can trigger the main-only Vercel production build.

Before releasing the admin dashboard, disable that workflow in GitHub Actions or convert it to manual-only. Keep the inventory freshness crons running unless runtime/function usage, not build CPU minutes, becomes the problem.

## Status command

Run this before any release decision:

```bash
npm run status:deployment-control
```

For machine-readable output:

```bash
npm run status:deployment-control:json
```

For an operator handoff that prints the exact workflow-disable/re-enable instructions:

```bash
npm run status:deployment-control:handoff
```

For a strict gate that fails while scheduled release automation is active or cannot be verified disabled:

```bash
node scripts/status-deployment-control.mjs --strict
```

The command is read-only. It does not push git refs, merge branches, start a Vercel deployment, change aliases, call production cron endpoints, or mutate GitHub workflow state.

For the release-window gate, use:

```bash
npm run preflight:admin-release
```

That command runs the strict deployment-control gate first, then runs the admin-dashboard verifier. It stays blocked until `TCOS Scheduled Production Release` is either disabled in GitHub Actions or converted to manual-only in the workflow file.

## Single intentional admin-dashboard release path

1. Disable `TCOS Scheduled Production Release` in GitHub Actions, or confirm it is manual-only.
2. Keep `admin-dashboard-work` parked until explicit deploy approval is given.
3. Immediately before release, rerun:

   ```bash
   npm run preflight:admin-release
   ```

4. Merge `admin-dashboard-work` into `main` once.
5. Let the main-only Vercel integration create the single production deployment.
6. Run production smoke after the Vercel deployment is live.
7. Re-enable or retune scheduled releases only after build spend is reviewed.

## Vercel dashboard checks

In Vercel Project Settings:

- Confirm the production branch is `main`.
- Confirm Git deployments are disabled for non-main branches, matching `vercel.json`.
- If available in the project/team settings, prefer lower-cost build machine settings and avoid on-demand concurrent builds unless an urgent production release needs it.
- Do not create manual deployments from branch refs unless that is the approved release window.
