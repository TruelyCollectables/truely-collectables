# PR #688 Salvage Manifest

**Milestone:** InstaComp AI local control-plane integration  
**Prepared:** 2026-08-04 Mountain Time  
**Source branch:** `feature/instacomp-ai-local-foundation`  
**Source head:** `2f850246a28ecbf0278a74cda496f824b59adf00`  
**Source PR:** `#688`  
**Integration branch:** `feature/instacomp-local-control-plane-integration`  
**Integration base:** `e06d57d21a22081389887378d77884b6467e1d85`

## Controlling architecture

PR #688 is a salvage source, not a merge candidate.

The unified authority chain is:

```text
Mac-local image evidence and verified learning
  -> authenticated central Checklist Registry
  -> canonical Registry identity ID and fingerprint
  -> verified marketplace research and pricing
  -> KINGMAKER seller review and authorized execution
```

The Mac mini may retain local evidence, images, learning memory, diagnostics, backups, receipts, workers, and a non-authoritative Registry cache or mirror. It may not become a second canonical identity authority.

The following rules are mandatory during salvage:

- Current `main` versions from merged PRs #691 and #693 win for scanner, Ollama, identity, Registry gateway, Next.js bridge, and Pending Listings integration.
- No local SQLite match may authorize trusted pricing without a canonical central Registry identity ID and fingerprint.
- No Mac route may activate inventory, publish a listing, accept an offer, mutate an order, or bypass seller permissions.
- No second authentication system, inventory database, pricing engine, or canonical Registry may be introduced.
- Beta 1.0 remains **NOT PASSED** until the physical Mac acceptance mission succeeds.

## Disposition codes

- **PORT** — port the feature onto current `main`, resolving ordinary integration differences.
- **ADAPT** — retain the capability but rewrite authority, naming, configuration, or contracts.
- **SUPERSEDED** — do not copy the PR #688 implementation; current `main` already owns the capability.
- **ARCHIVE** — preserve as historical handoff evidence, not runtime authority.

## File-level disposition

### PORT — local control plane

These files contain the main salvage value. Port them onto current `main` while preserving the central Registry boundary.

```text
services/instacomp-ai/app/backup.py
services/instacomp-ai/app/backup_routes.py
services/instacomp-ai/app/cockpit_routes.py
services/instacomp-ai/app/local_settings.py
services/instacomp-ai/app/settings_routes.py
services/instacomp-ai/app/system_doctor.py
services/instacomp-ai/assets/README.md
services/instacomp-ai/cockpit/cockpit-doctor.js
services/instacomp-ai/cockpit/cockpit.css
services/instacomp-ai/cockpit/cockpit.js
services/instacomp-ai/cockpit/index.html
services/instacomp-ai/scripts/backup-now.py
services/instacomp-ai/scripts/create-full-backup.sh
services/instacomp-ai/scripts/install-desktop-app.sh
services/instacomp-ai/scripts/install-macos.sh
services/instacomp-ai/scripts/launch-cockpit.sh
services/instacomp-ai/scripts/restart-local-service.sh
services/instacomp-ai/scripts/restore-full-backup.py
services/instacomp-ai/scripts/run_system_doctor.py
services/instacomp-ai/tests/test_backup.py
services/instacomp-ai/tests/test_cockpit.py
services/instacomp-ai/tests/test_desktop_app.py
services/instacomp-ai/tests/test_system_doctor.py
```

Porting notes:

- Router builders must use the existing `require_api_key` dependency.
- All paths must remain constrained to the protected service root or explicitly approved backup roots.
- Settings writes must back up `.env`, use atomic replacement, write a sanitized receipt, and return the HTTP response before service restart.
- The cockpit is owner infrastructure at the local Mac endpoint; it is not a second seller-facing product.
- The approved icon binary is still external and must not be fabricated or committed from an unapproved image.

### ADAPT — retain capability, change authority or integration

```text
.github/workflows/instacomp-ai-local.yml
docs/INSTACOMP_AI_CHECKLIST_HANDOFF.md
docs/INSTACOMP_AI_LOCAL_FOUNDATION.md
services/instacomp-ai/.env.example
services/instacomp-ai/.gitignore
services/instacomp-ai/BACKUP_AND_FOLDER_LAYOUT.md
services/instacomp-ai/BUILD_STATUS.md
services/instacomp-ai/Makefile
services/instacomp-ai/README.md
services/instacomp-ai/app/__init__.py
services/instacomp-ai/app/checklist_routes.py
services/instacomp-ai/app/checklist_schema.py
services/instacomp-ai/app/config.py
services/instacomp-ai/app/registry.py
services/instacomp-ai/checklists/checklist-template.csv
services/instacomp-ai/pyproject.toml
services/instacomp-ai/requirements.txt
services/instacomp-ai/scripts/__init__.py
services/instacomp-ai/scripts/run-checklist-sync.sh
services/instacomp-ai/scripts/run-local.sh
services/instacomp-ai/scripts/sync_checklists.py
services/instacomp-ai/scripts/validate_checklist.py
services/instacomp-ai/tests/test_checklist_schema.py
services/instacomp-ai/tests/test_config.py
services/instacomp-ai/tests/test_registry_activation.py
```

Required adaptations:

- Rename local Registry authority and activation concepts to **cache**, **mirror**, or **offline evidence snapshot**.
- Preserve source receipts, hashing, quarantine, locks, candidate validation, and last-known-good retention.
- A local cache build may never replace or mint a canonical Registry identity ID or fingerprint.
- Central authenticated Registry health must remain distinct from local cache health.
- Pricing authorization remains false unless the current scan contains the complete central Registry receipt.
- Google Drive for Desktop sync is optional local support infrastructure, not Production canonical ingestion.
- Documentation must describe Mac versus cloud responsibilities without claiming Vercel or Supabase are removed from the unified system.
- CI must test the retained local capabilities and the no-second-authority boundary.

### SUPERSEDED — current `main` implementation wins

Do not copy these PR #688 versions over current `main`.

```text
lib/instacomp-ai-local.ts
services/instacomp-ai/app/checklist.py
services/instacomp-ai/app/images.py
services/instacomp-ai/app/main.py
services/instacomp-ai/app/models.py
services/instacomp-ai/app/ollama.py
services/instacomp-ai/app/storage.py
services/instacomp-ai/tests/test_images.py
services/instacomp-ai/tests/test_storage.py
```

Reason:

- Merged PR #691 already provides the current Mac evidence service, central Registry gateway, exact identity receipt requirements, trusted-memory rules, and fail-closed Next.js bridge.
- Merged PR #693 already provides scanner-to-Pending-Listings integration.
- Salvaged routes and control-plane features must be wired into current `main`; current scanner and identity files must not be replaced by older local-authority versions.

### ARCHIVE — preserve handoff evidence

```text
services/instacomp-ai/HANDOFF_CHECKPOINT_2026-08-04.md
services/instacomp-ai/HANDOFF_STATE.json
```

These files remain useful as historical evidence of the PR #688 interruption point. They do not override this manifest or current `main` architecture.

## Explicitly rejected behaviors

The following are rejected even when present implicitly in old documentation or code:

1. Local SQLite exact match acting as canonical identity.
2. Local cache identity authorizing marketplace pricing by itself.
3. A local Registry fingerprint being represented as the central Registry fingerprint.
4. Vercel, Supabase, or the central Registry being removed from the unified architecture.
5. A separate InstaComp seller account, inventory database, publishing route, or seller application.
6. Automatic publication after a scan or settings change.
7. External teacher suggestions becoming trusted memory without canonical or operator verification.
8. Replacing the current `main` scanner, contracts, or Pending Listings flow with the PR #688 versions.

## First implementation slice

The first code slice on this branch is limited to the architecture-safe local control plane:

1. Port backup and restore.
2. Port cockpit and System Doctor.
3. Port desktop app, launcher, recovery, and LaunchAgents.
4. Port Local Setup Console backend.
5. Wire `build_settings_router(require_api_key)` into current `app/main.py`.
6. Add the Local Setup Console cockpit UI.
7. Add route, UI, path-security, receipt, and delayed-restart tests.
8. Expose central Registry health and local cache health as separate values.
9. Keep all seller mutations outside the Mac service.

Local checklist cache/mirror workers are a second slice and may begin only after the first slice is green.

## Merge gate

This branch may merge only when:

- the current scanner and central Registry contract remain intact;
- Python compilation and tests pass;
- shell launchers pass syntax checks;
- local path and backup-root security tests pass;
- TypeScript passes;
- the Production web build passes;
- boundary tests prove the Mac cannot publish or create canonical identity;
- Vercel preview/runtime smoke passes;
- the PR is synchronized with current `main`.

Physical Mac launch, restart, backup destination, and restore acceptance remain post-merge Beta gates and must not be marked complete from CI alone.
