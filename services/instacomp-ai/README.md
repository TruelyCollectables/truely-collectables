# InstaComp AI™

**Codename:** InstaComp AI 1.0 Beta  
**Build:** `1.0.0-beta.prechecklist`

InstaComp AI is the private local card-identification, checklist-validation, verified-learning, and recovery system for the Mac mini. It runs on `127.0.0.1`, uses Ollama for local vision analysis, stores scan evidence and verified lessons in SQLite, and blocks exact pricing until the active checklist Registry confirms the identity.

## Unified command cockpit

After the service starts, open:

```text
http://127.0.0.1:8787/control
```

The cockpit is one local page containing:

- live database, Ollama, Registry, and backup status
- front/back Scan Bay connected to `/v1/scans/analyze`
- exact identity, confidence, checklist outcome, and pricing-lock display
- checklist folder sync and Registry rebuild controls
- trusted-memory search
- full disaster-recovery backup controls
- storage telemetry and local service/checklist logs
- API-key input retained only for the current browser session

All interface assets are served from the InstaComp AI folder. The cockpit does not load external scripts, fonts, analytics, or hosted control panels.

## Local folder responsibilities

```text
services/instacomp-ai/
├── app/                 local APIs, AI, Registry, learning, backup, cockpit routes
├── cockpit/             cockpit HTML, CSS, and JavaScript
├── checklists/          templates and approved local checklist material
├── data/                database, images, Registry, receipts, logs, quarantine
├── backups/             default full-recovery archive destination
├── scripts/             install, run, sync, backup, and restore tools
└── tests/               local and CI safety tests
```

## Mac mini installation

From the repository root:

```bash
cd services/instacomp-ai
cp .env.example .env
./scripts/install-macos.sh
```

The installer creates the Python environment, installs dependencies, creates the data folders, installs macOS LaunchAgents, starts the service, and starts the six-hour checklist worker.

Install Ollama and pull the configured local vision model:

```bash
ollama pull qwen2.5vl:7b
```

Manual service start:

```bash
./scripts/run-local.sh
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

## Google Drive checklist folder

Google Drive for Desktop exposes the checklist collection as a normal Mac folder. Set its exact path in `.env`:

```bash
INSTACOMP_AI_CHECKLIST_SOURCE_PATH="/Users/YOU/Library/CloudStorage/GoogleDrive-YOU/My Drive/TCOS Checklists"
```

The local worker mirrors supported files, verifies checksums, records sync receipts, validates Registry-ready CSV/JSON/XLSX files, rebuilds the active SQLite Registry atomically, and reports rejected files without silently trusting them.

## Full recovery backup

The cockpit button **BACK UP EVERYTHING NOW** calls `/v1/backups/full`. It creates:

```text
InstaComp-AI-FULL-YYYYMMDDTHHMMSSZ.zip
InstaComp-AI-FULL-YYYYMMDDTHHMMSSZ.zip.sha256
InstaComp-AI-FULL-YYYYMMDDTHHMMSSZ.zip.manifest.json
```

The archive contains the complete service folder, including the database, images, active Registry, receipts, logs, source code, settings, and recovery tools. Because `.env` may be included, full archives must be stored in encrypted, secured offsite storage.

## Analyze a card directly

```bash
curl -X POST http://127.0.0.1:8787/v1/scans/analyze \
  -H "X-InstaComp-AI-Key: YOUR_KEY_IF_CONFIGURED" \
  -F "front=@/path/to/front.jpg" \
  -F "back=@/path/to/back.jpg"
```

The model suggestion is not permanent truth. Exact pricing remains locked unless the active Registry resolves the identity to one exact checklist row.

## Run tests

```bash
source .venv/bin/activate
python -m compileall app scripts tests
pytest -q
```

## Network safety

Keep the service bound to `127.0.0.1`. Do not expose the cockpit or Ollama directly to the public internet. Configure an API key before deliberately allowing access from another device through a private tunnel or authenticated proxy.

## Beta status

The build remains `1.0.0-beta.prechecklist`. The cockpit code is implemented, but Beta 1.0 is not passed until the Mac installation, real checklist sync, live-card scans, complete backup, restart, and restore acceptance tests succeed.
