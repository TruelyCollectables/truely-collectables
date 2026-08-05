# InstaComp AI™ Checklist Runtime

**Codename:** InstaComp AI 1.0 Beta  
**Build:** `1.0.0-beta.prechecklist`

The checklist boundary is now implemented in code. The remaining dependency is the real Google Drive for Desktop folder and its actual checklist files on the Mac mini.

## Single authority

Checklist ownership follows one local path:

```text
Google Drive for Desktop source folder
  → six-hour Mac launchd worker
  → checksum-verified local mirror
  → schema validation
  → quarantine for rejected sources
  → atomic active SQLite Registry
  → exact-match gateway
```

Vercel does not schedule, download, validate, or activate InstaComp checklist files. Supabase is not required to run the local checklist Registry.

## Accepted Registry sources

Preferred: UTF-8 CSV using `services/instacomp-ai/checklists/checklist-template.csv`.

The local Registry builder also accepts JSON, XLSX, and XLSM when their columns conform to the checklist schema. PDF and TXT source files may be mirrored and preserved as evidence, but they are not silently converted into trusted Registry rows.

One row represents one exact card configuration. Base, parallel, variation, autograph, memorabilia, and serial-run differences must be separate rows.

## Required fields

- source_name
- source_release_id
- source_version
- source_receipt
- sport
- year
- brand
- set_name
- player
- card_number
- parallel

All schema columns remain present even when optional values are blank.

## Source receipt rule

Every row identifies where its checklist came from. `source_receipt` may be an official URL, original filename plus checksum, or another durable source reference. Data with no source receipt cannot activate as trusted checklist truth.

## Activation safety

A candidate Registry replaces the current active Registry only when:

1. At least one valid row imports.
2. No source file is rejected.
3. The candidate SQLite database returns `ok` from its integrity check.
4. The complete candidate is committed and atomically moved into the active Registry location.

Rejected source files are copied into the local quarantine folder with an error receipt and SHA-256 checksum. When a candidate build fails, the last working active Registry remains in place.

## Local configuration

Set the exact Google Drive for Desktop path in `services/instacomp-ai/.env`:

```bash
INSTACOMP_AI_CHECKLIST_SOURCE_PATH="/Users/YOU/Library/CloudStorage/GoogleDrive-YOU/My Drive/TCOS Checklist Registry - 2025-26 Hockey Consolidated"
```

Run manually from the Mac:

```bash
cd services/instacomp-ai
./scripts/run-checklist-sync.sh
```

Or use **SYNC + REBUILD NOW** inside the cockpit at:

```text
http://127.0.0.1:8787/control#checklists
```

The same worker runs automatically every six hours after `scripts/install-macos.sh` installs the macOS LaunchAgent.

## Beta boundary

Code implementation is complete through local checklist synchronization and exact Registry matching. Beta 1.0 is not passed until the real Mac performs a successful Drive sync, activates the live checklist Registry, scans representative cards, completes full backup and restore validation, and survives a restart mission.
