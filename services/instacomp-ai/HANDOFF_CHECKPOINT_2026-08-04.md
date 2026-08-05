# InstaComp AI 1.0 Beta — Project Handoff Checkpoint

**Checkpoint date:** 2026-08-04  
**Repository:** `TruelyCollectables/truely-collectables`  
**Branch:** `feature/instacomp-ai-local-foundation`  
**Pull request:** `#688`  
**Build:** `1.0.0-beta.prechecklist`  
**Beta 1.0 status:** NOT PASSED

This file freezes the exact project state before InstaComp AI is merged or coordinated with another project. Do not rename the codename **InstaComp AI 1.0 Beta** or advance the build number until the physical Mac acceptance mission passes.

## Product direction locked in

InstaComp AI is a private, local-first sports-card identification and verified-learning system running from one protected folder on the owner's Mac mini.

The authoritative runtime chain is:

```text
Google Drive for Desktop checklist source
  → Mac launchd six-hour sync worker
  → checksum-verified local mirror
  → validation and quarantine
  → atomic SQLite checklist Registry
  → local Ollama card analysis
  → exact checklist match
  → verified memory and pricing authorization
  → complete local/offsite backup
```

Vercel is not the InstaComp checklist scheduler or AI runtime. The obsolete Vercel checklist cron endpoint, cloud Drive worker, and Supabase cloud checklist-sync ledger were removed from this branch.

## Completed and committed

- Local FastAPI service bound to `127.0.0.1`
- Ollama vision-reader integration
- Front/back image validation, normalization, hashing, and content-addressed storage
- SQLite scan receipts and verified lesson memory
- Trusted/untrusted learning-state rules
- Operator-confirmed corrections
- Exact checklist matching gateway
- CSV, JSON, XLSX, and XLSM Registry import
- Checksum-based Google Drive for Desktop folder mirror
- Non-overlapping sync lock
- Six-hour macOS `launchd` checklist worker
- Invalid checklist quarantine with SHA-256 error receipts
- Safe candidate Registry activation
- Previous working Registry retention when a candidate build fails
- Unified local spaceship-style command cockpit at `/control`
- Scan Bay, Registry controls, learning search, backup vault, telemetry, logs, and System Doctor
- Full-folder ZIP backup with SHA-256 and manifest
- Restore verification tools
- Central protected-folder path resolution
- macOS background service installer
- Canonical `desktop/InstaComp AI.app` bundle generator
- Desktop symlink launcher
- Desktop launcher health check, Ollama startup attempt, service recovery, readiness wait, and macOS failure alert
- CI shell-syntax validation and Python test coverage additions
- Mac System Doctor API, cockpit console, CLI report, and receipts

## Official desktop icon design

The approved icon is locked as:

- dark metallic rounded-square macOS application icon
- electric-blue glow
- scanned sports-card visual
- `IC` / InstaComp AI identity
- dashboard/control-center elements
- sync and backup/security cues

The actual approved image binary was not available to commit through the GitHub text interface. Before Mac installation, place the approved image at one of:

```text
services/instacomp-ai/assets/instacomp-ai-approved-icon.png
services/instacomp-ai/assets/instacomp-ai-approved-icon.jpg
```

Use a square image of at least 512 × 512 pixels. The installer converts it to `.icns`.

## Exact in-progress interruption point

The next feature being built was a **Local Setup Console** inside the cockpit so the owner would not need to edit `.env` manually.

The following files were created and committed:

```text
app/local_settings.py
app/settings_routes.py
scripts/restart-local-service.sh
```

They provide:

- safe editing of the Google Drive checklist source
- default backup destination
- approved backup roots
- Ollama model
- `.env` backup before changes
- settings-change receipts
- delayed Mac-service restart

**Important:** this feature is intentionally recorded as partially integrated at this checkpoint.

Remaining wiring:

1. Import `build_settings_router` in `app/main.py`.
2. Add `app.include_router(build_settings_router(require_api_key))`.
3. Add the Local Setup Console UI and JavaScript to the unified cockpit.
4. Add route and UI tests.
5. Confirm the delayed restart response reaches the browser before `launchctl` restarts the service.

Do not assume the settings endpoints are live until those steps are complete.

## Important files

```text
services/instacomp-ai/app/main.py                 FastAPI assembly and scanner endpoints
services/instacomp-ai/app/config.py               central settings and protected-path resolution
services/instacomp-ai/app/cockpit_routes.py       cockpit assets, telemetry, logs, System Doctor
services/instacomp-ai/cockpit/                    unified local command interface
services/instacomp-ai/app/registry.py             validation, quarantine, atomic Registry activation
services/instacomp-ai/scripts/sync_checklists.py  locked Drive-folder mirror and Registry rebuild
services/instacomp-ai/app/backup.py                complete-folder backup implementation
services/instacomp-ai/scripts/install-macos.sh     full Mac installer and LaunchAgents
services/instacomp-ai/scripts/install-desktop-app.sh macOS `.app` bundle and desktop launcher
services/instacomp-ai/scripts/launch-cockpit.sh    service recovery and cockpit launch
services/instacomp-ai/app/system_doctor.py         Mac mission-readiness diagnostics
services/instacomp-ai/BUILD_STATUS.md              current acceptance boundary
```

## Merge guidance for the partner project

The partner project should treat InstaComp AI as a local service with stable boundaries rather than moving its database or AI core into a hosted web process.

Preferred integration points:

- local HTTP API on `127.0.0.1:8787`
- the unified cockpit as the owner control surface
- typed request/response contracts
- immutable scan and sync receipts
- explicit exact-checklist authorization before pricing
- optional website/admin orchestration that never becomes the checklist authority

Do not:

- expose Ollama publicly
- make Vercel the checklist worker
- let an external model write trusted memory directly
- replace a valid Registry after any rejected candidate file
- move the local AI database outside the protected InstaComp folder
- mark Beta 1.0 passed merely because code merged

## Physical Mac acceptance still required

- install this branch on the actual M4 Pro Mac mini
- install Ollama and pull the selected vision model
- place the approved icon asset
- configure the exact Google Drive for Desktop source
- run the first clean Registry activation
- click the desktop app and confirm automatic recovery
- scan representative real cards
- verify exact checklist outcomes and pricing locks
- record a verified correction
- create and verify a complete backup at an approved offsite destination
- restart the Mac and confirm automatic startup
- perform a restore drill

Only after every item passes should the project explicitly declare:

> **InstaComp AI 1.0 Beta has passed.**

## Checkpoint rule

All work through this document is committed on `feature/instacomp-ai-local-foundation` and preserved in PR `#688`. Continue from the branch head, not from memory or an older exported folder.
