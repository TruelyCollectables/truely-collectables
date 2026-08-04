# InstaComp AI™ Single-Folder Layout and Full Backups

Everything owned by the local AI lives under `services/instacomp-ai/` when installed or copied to its permanent Mac location.

```text
InstaComp AI 1.0 Beta/
├── app/                 Local API, scanner, memory, backup and sync code
├── checklists/          Imported checklist files, schema and Registry inputs
├── data/
│   ├── instacomp_ai.sqlite3   AI scans, lessons and verified memory
│   ├── images/                 Saved front/back card reference images
│   ├── registry/               Activated checklist Registry and indexes
│   ├── receipts/               Sync, import and validation receipts
│   ├── quarantine/             Rejected or conflicting checklist files
│   └── logs/                   Local service and sync logs
├── scripts/             Start, checklist sync, backup and recovery tools
├── tests/               Safety and recovery tests
├── .env                 Local credentials and paths
└── backups/             Default backup output; may point elsewhere
```

## One-click backup

Open the local control page:

```text
http://127.0.0.1:8787/control
```

Choose an approved destination and press **BACK UP EVERYTHING NOW**.

The backup produces three files:

```text
InstaComp-AI-FULL-<timestamp>.zip
InstaComp-AI-FULL-<timestamp>.zip.sha256
InstaComp-AI-FULL-<timestamp>.zip.manifest.json
```

The ZIP contains the entire InstaComp AI folder, including:

- AI SQLite database and verified memory
- all stored card images
- checklist sources, active Registry and indexes
- Drive-sync and validation receipts
- quarantined files and logs
- application source code, scripts and tests
- configuration, including `.env`
- an embedded per-file checksum manifest

A consistent SQLite snapshot is made while the service is running. The original database is never paused, moved or modified by the backup.

## Approved destinations

Set one or more comma-separated locations in `.env`:

```text
INSTACOMP_AI_BACKUP_DEFAULT_DESTINATION=/Volumes/TCOS Backups/InstaComp AI
INSTACOMP_AI_BACKUP_ALLOWED_ROOTS=/Volumes/TCOS Backups,/Users/yourname/Library/CloudStorage
```

The button refuses to write anywhere outside these approved roots. This prevents a mistaken or malicious path from copying sensitive data to an unknown location.

## Security warning

This is a true disaster-recovery backup. It includes `.env` and can therefore contain API keys and credentials. The offsite drive or cloud folder should be encrypted and access-controlled.

## Command-line backup

```bash
cd "InstaComp AI 1.0 Beta"
source .venv/bin/activate
python scripts/backup-now.py --destination "/Volumes/TCOS Backups/InstaComp AI" --label "before-checklist-import"
```

## Recovery

1. Verify the archive checksum against the `.sha256` file.
2. Extract the ZIP into a safe temporary folder.
3. Review `BACKUP-MANIFEST.json`.
4. Restore the complete extracted folder rather than selecting individual database files.
5. Install Python dependencies if the virtual environment is not portable to the restored Mac.
6. Start the local service and verify `/health` before allowing scans or checklist imports.
