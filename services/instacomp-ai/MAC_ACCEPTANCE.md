# InstaComp AI 1.0 Beta — Mac Installation and Acceptance

**Beta status:** NOT PASSED

This package installs the private Mac evidence service and owner control plane. It does not create a second canonical Checklist Registry and it does not authorize seller mutations.

## Authority chain

```text
Mac-local evidence and verified learning
  -> authenticated central Checklist Registry
  -> Registry identity ID and fingerprint
  -> verified marketplace pricing
  -> KINGMAKER seller review and execution
```

The optional local checklist source is a cache/mirror input only. It cannot mint canonical identity or authorize pricing by itself.

## Before installation

1. Use the permanent protected `services/instacomp-ai` folder on the Mac mini.
2. Copy `.env.example` to `.env` when the installer has not already done so.
3. Configure:
   - `INSTACOMP_AI_REGISTRY_URL`
   - `INSTACOMP_AI_REGISTRY_TOKEN`
   - `INSTACOMP_AI_API_KEY`
   - the approved Ollama model
   - approved backup roots
4. Place the approved square icon, when available, at:
   - `assets/instacomp-ai-approved-icon.png`, or
   - `assets/instacomp-ai-approved-icon.jpg`

Never commit `.env`, the approved private icon binary, local databases, card images, or backup archives.

## Install

```bash
cd services/instacomp-ai
bash scripts/install-macos.sh
```

The installer:

- creates the Python virtual environment;
- installs pinned dependencies;
- creates a user LaunchAgent;
- starts and supervises the local service;
- builds `desktop/InstaComp AI.app`;
- creates a safe Desktop symlink;
- waits for the local health route.

The service remains bound to `127.0.0.1` unless an operator deliberately changes the host and configures an API key. `run-local.sh` refuses a non-local bind without the API key.

## Owner control plane

Open the Desktop app or visit:

```text
http://127.0.0.1:8787/control
```

Use the control plane to:

- inspect central Registry, Ollama, database, and backup readiness;
- edit safe local settings;
- create a complete backup;
- run System Doctor.

The settings restart is scheduled only after the HTTP response has been returned.

## Command-line receipts

Run System Doctor:

```bash
.venv/bin/python scripts/run-system-doctor.py
```

Create a backup in the configured default destination:

```bash
.venv/bin/python scripts/backup-now.py
```

Verify a backup without restoring:

```bash
.venv/bin/python scripts/restore-full-backup.py /path/to/InstaComp-AI-FULL-....zip
```

Perform a no-overwrite restore drill into a new destination:

```bash
.venv/bin/python scripts/restore-full-backup.py \
  /path/to/InstaComp-AI-FULL-....zip \
  --apply \
  --destination /path/to/new-restore-folder
```

Restore rejects:

- SHA-256 mismatch;
- path traversal;
- symbolic-link archive entries;
- manifest file-count mismatch;
- an existing destination;
- silent overwrite.

## Physical acceptance mission

Beta 1.0 may be declared passed only after all of these succeed on the actual M4 Pro Mac mini:

- [ ] Approved icon is installed or its absence is explicitly recorded.
- [ ] Ollama and the selected model are installed and reachable.
- [ ] Desktop app opens the local control plane.
- [ ] LaunchAgent starts the service after login.
- [ ] Desktop launcher recovers a stopped service.
- [ ] Settings save returns before restart begins.
- [ ] Central Checklist Registry authentication passes.
- [ ] Normal base card scans correctly.
- [ ] Serial-numbered parallel preserves the exact copy number and denominator.
- [ ] Autograph, relic, inscription, graded, and multi-subject cases behave correctly.
- [ ] Intentionally unclear identity fails closed.
- [ ] Duplicate image-pair scan points to existing inventory.
- [ ] Trusted pricing remains blocked without Registry ID and fingerprint.
- [ ] Full backup is created in an approved offsite root.
- [ ] Backup SHA-256 and manifest verify.
- [ ] Mac restart preserves automatic service startup.
- [ ] No-overwrite restore drill succeeds into a new folder.
- [ ] Production scan-to-list seller review and publish firewall pass.

Only after every required item is evidenced should the project state:

> **InstaComp AI 1.0 Beta has passed.**
