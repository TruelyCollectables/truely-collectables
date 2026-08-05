# InstaComp AI™

**Codename:** InstaComp AI 1.0 Beta  
**Build:** `1.0.0-beta.prechecklist`

InstaComp AI is the private local card-identification, checklist-validation, verified-learning, and disaster-recovery system for the Mac mini. It runs from one protected folder on `127.0.0.1`, uses Ollama for local vision analysis, stores scan evidence and verified lessons in SQLite, and blocks exact pricing until the active checklist Registry confirms the identity.

## Unified command cockpit

After the service starts, open:

```text
http://127.0.0.1:8787/control
```

The cockpit is one local page containing:

- live database, Ollama, Registry, backup, uptime, and storage status
- front/back Scan Bay connected to `/v1/scans/analyze`
- exact identity, confidence, checklist outcome, and pricing-lock display
- checklist-folder sync and Registry rebuild controls
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
├── assets/              approved desktop icon source
├── desktop/             canonical InstaComp AI.app created during installation
├── checklists/          templates and approved local checklist material
├── data/                database, images, Registry, receipts, logs, quarantine
├── backups/             default full-recovery archive destination
├── scripts/             install, run, sync, backup, restore, and launcher tools
└── tests/               local and CI safety tests
```

## Mac mini installation

Place the approved square desktop icon, at least 512 × 512 pixels, at one of these paths:

```text
assets/instacomp-ai-approved-icon.png
assets/instacomp-ai-approved-icon.jpg
```

Then run:

```bash
cd services/instacomp-ai
cp .env.example .env
./scripts/install-macos.sh
```

The installer:

1. Creates the private Python environment and installs dependencies.
2. Creates the database, image, Registry, receipt, quarantine, log, and backup folders.
3. Installs the macOS background service and six-hour checklist worker.
4. Builds the canonical `desktop/InstaComp AI.app` inside the protected folder.
5. Places a desktop link at `~/Desktop/InstaComp AI.app`.
6. Starts the service and checks the local health endpoint.

Clicking the desktop app checks local health, starts Ollama when available, recovers the service when necessary, waits up to 30 seconds for readiness, opens the unified cockpit, and shows a macOS error dialog with an **Open Logs** option when launch recovery fails.

Install Ollama and pull the configured local vision model:

```bash
ollama pull qwen2.5vl:7b
```

Manual cockpit launch:

```bash
./scripts/launch-cockpit.sh
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

The local worker mirrors supported files, verifies checksums, records sync receipts, validates Registry-ready CSV, JSON, XLSX, and XLSM files, rebuilds the active SQLite Registry atomically, and reports rejected files without silently trusting them.

## Full recovery backup

The cockpit button **BACK UP EVERYTHING NOW** calls `/v1/backups/full`. It creates:

```text
InstaComp-AI-FULL-YYYYMMDDTHHMMSSZ.zip
InstaComp-AI-FULL-YYYYMMDDTHHMMSSZ.zip.sha256
InstaComp-AI-FULL-YYYYMMDDTHHMMSSZ.zip.manifest.json
```

The archive contains the complete service folder, including the database, images, active Registry, receipts, logs, source code, settings, recovery tools, and canonical desktop app. Because `.env` may be included, full archives must be stored in encrypted, secured offsite storage.

## Run tests

```bash
source .venv/bin/activate
bash -n scripts/*.sh
python -m compileall app scripts tests
pytest -q
```

## Network safety

Keep the service bound to `127.0.0.1`. Do not expose the cockpit or Ollama directly to the public internet. Configure an API key before deliberately allowing access from another device through a private tunnel or authenticated proxy.

## Beta status

The build remains `1.0.0-beta.prechecklist`. The cockpit and desktop-launcher code are implemented, but Beta 1.0 is not passed until the Mac installation, real checklist sync, live-card scans, complete backup, restart, and restore acceptance tests succeed.
