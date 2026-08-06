# InstaComp AI Checklist Sentinel™

InstaComp AI Checklist Sentinel™ is the checklist-discovery and recovery process
owned by the local InstaComp AI service. It is not a ChatGPT reminder.

## Runtime

- Mounts through the existing InstaComp AI settings router on every service startup.
- Starts with the InstaComp AI FastAPI service.
- Checks every 24 hours by default.
- Writes a durable SQLite heartbeat and checkpoint at least every five minutes.
- Resumes pending targets after service restart, crash, timeout, or stale heartbeat.
- Uses WAL-mode SQLite transactions and atomic file replacement.
- Never bypasses logins, paywalls, robots controls, CAPTCHAs, or access controls.

## Sources

The permanent source registry includes Google, Bing, official Topps, Upper Deck,
Panini and Leaf sources, BaseballCardPedia, Beckett, Cardboard Connection,
Break Ninja, GoGTS, Cardboard Checklist, KeyMan Collectibles, Sports Card Radio,
Internet Archive, Reddit, Blowout Forums, and TCDB.

Official and established public sources can be downloaded automatically after
exact season/manufacturer/product verification. Reddit, Blowout, TCDB, Google
Docs, and other community material remains lead-only until provenance and
redistribution permission are confirmed.

## Endpoints

All endpoints require the normal `x-instacomp-ai-key` when configured.

- `GET /v1/checklist-sentinel/status`
- `POST /v1/checklist-sentinel/run`
- `POST /v1/checklist-sentinel/refresh-targets`
- `GET|POST /v1/checklist-sentinel/targets`
- `GET /v1/checklist-sentinel/findings`
- `GET /v1/checklist-sentinel/downloads`
- `GET /v1/checklist-sentinel/sources`

## Configuration

All settings use the existing `INSTACOMP_AI_` environment namespace.

- `INSTACOMP_AI_SENTINEL_ENABLED=true`
- `INSTACOMP_AI_SENTINEL_INTERVAL_SECONDS=86400`
- `INSTACOMP_AI_SENTINEL_CHECKPOINT_SECONDS=300`
- `INSTACOMP_AI_SENTINEL_STALE_SECONDS=720`
- `INSTACOMP_AI_SENTINEL_MAX_TARGETS_PER_RUN=75`
- `INSTACOMP_AI_SENTINEL_MAX_CANDIDATES_PER_TARGET=20`
- `INSTACOMP_AI_SENTINEL_SEARCH_DELAY_SECONDS=1.2`
- `INSTACOMP_AI_SENTINEL_REQUEST_TIMEOUT_SECONDS=45`
- `INSTACOMP_AI_SENTINEL_MAX_DOWNLOAD_BYTES=50000000`
- `INSTACOMP_AI_SENTINEL_TARGETS_PATH=/path/a.json,/path/b.txt`
- `INSTACOMP_AI_SENTINEL_TARGETS_URL=https://...`
- `INSTACOMP_AI_SENTINEL_DOWNLOAD_PATH=./data/checklist-sentinel/downloads`
- `INSTACOMP_AI_SENTINEL_IMPORT_URL=https://.../api/instacomp/checklist-sentinel/import`

When `INSTACOMP_AI_SENTINEL_IMPORT_URL` is not configured, validated files are
stored locally and indexed in `checklist_sentinel_downloads` with status
`downloaded_local_pending_registry_import`. This is fail-closed: no file is
silently claimed as imported.

## Persistent tables

- `checklist_sentinel_jobs`
- `checklist_sentinel_checkpoints`
- `checklist_sentinel_sources`
- `checklist_sentinel_targets`
- `checklist_sentinel_findings`
- `checklist_sentinel_downloads`
