# InstaComp AI — Certified Disaster Recovery Guide

This guide is intentionally written for someone who does **not** want to remember Git, Python, Vercel, Ollama, or Mac service details during an emergency.

## Golden facts — do not change these

- Repository: `TruelyCollectables/truely-collectables`
- Exact certified Production application commit: `04d927fe9b845eac3902ce1e88b720eb0fb8cb6e`
- Untouched golden source branch: `backup/instacomp-ai-certified-2026-08-07-golden`
- Recovery-helper branch: `backup/instacomp-ai-certified-2026-08-07-recovery`
- Certified Mac runtime fingerprint: `d1f81dfa0054a5b1ca36f32c0f32c5c03f09a2de507e69041815861385878be3`
- Successful final acceptance branch: `ops/instacomp-final-production-acceptance-v11-20260807`
- Successful final acceptance head: `993c18a334ff6de7d8f1440720dd45c652ca2276`
- Acceptance workflow run: `31237527356`
- Acceptance evidence artifact: `9016085742`
- Acceptance evidence SHA-256: `5595f19ff3c4d683e3b8f3d3c975587a2253bfd780e126b14855189b07aa7e82`
- Acceptance result: two consecutive exact 5/5 passes = **10/10**
- Removed temporary acceptance credential was proven dead with HTTP **401**.

The golden branch is the source anchor. **Do not develop on it. Do not merge into it. Do not force-push it.**

---

# PART 1 — WHAT THE BACKUP ACTUALLY CONTAINS

The emergency system deliberately makes more than one copy.

## Layer A — GitHub golden source

Branch:

```text
backup/instacomp-ai-certified-2026-08-07-golden
```

This points to the exact certified application commit. It protects the source even if `main` later changes.

## Layer B — native InstaComp AI FULL ZIP

The certified service already includes:

```text
services/instacomp-ai/scripts/backup-now.py
services/instacomp-ai/scripts/restore-full-backup.py
```

The native FULL ZIP captures the protected InstaComp service folder including the important local state that is not in Git, such as the service `.env`, local SQLite evidence/learning data, stored images, training exports, receipts, and configuration files. It intentionally excludes disposable things such as `.venv`, caches, and nested backup archives.

Every native backup gets:

- a ZIP archive;
- a JSON manifest;
- a SHA-256 sidecar.

The restore verifier refuses a bad digest, unsafe path traversal, symbolic links, manifest/file-count mismatch, and silent overwrite.

## Layer C — whole-repository emergency archive

The repository already includes:

```text
npm run backup:nightly
npm run verify:nightly-backup
```

That archive captures the repository including `.git` and root/local `.env*` files. It excludes rebuildable bulk such as `node_modules`, `.next`, build output, caches, and virtual environments.

Because the native InstaComp ZIP is created first, the whole-repository archive also contains the native service backup under `services/instacomp-ai/backups`.

## Layer D — external systems

The following are **external runtime services** and are not magically converted into Git files:

- Supabase Production database and Storage;
- central Checklist Registry data stored in Supabase;
- Vercel-managed Production environment variables;
- Cloudflare tunnel/DNS state;
- Ollama application/model installation;
- eBay, Stripe, Resend and other provider-side accounts/credentials.

The disaster archive preserves the local credentials/configuration that existed on the Mac, but if an external provider account itself is deleted, that provider must be restored separately. Do not assume a Git ZIP can recreate a deleted Supabase or Vercel account.

---

# PART 2 — MAKE THE GOLDEN BACKUP NOW

Do this while the known-good InstaComp AI installation is still running.

## Step 1 — Open Terminal

On the Mac mini:

1. Press `Command + Space`.
2. Type `Terminal`.
3. Press Return.

## Step 2 — Go to the repository folder

If you know the path, use it. If you do not:

1. Type this in Terminal but **do not press Return yet**:

```bash
cd 
```

There is a space after `cd`.

2. Open Finder.
3. Find the `truely-collectables` folder.
4. Drag that folder into the Terminal window.
5. Terminal will insert the full path.
6. Press Return.

Check you are in the correct folder:

```bash
pwd
ls package.json services/instacomp-ai
```

You should see `package.json` and `services/instacomp-ai` without an error.

## Step 3 — Download the recovery helper branch

Run one command at a time:

```bash
git fetch origin
```

Then:

```bash
git checkout backup/instacomp-ai-certified-2026-08-07-recovery
```

If Git refuses because you have local tracked source changes, **stop**. Do not force-checkout over them. The golden backup script is designed to reject modified source.

## Step 4 — Make the backup command executable

```bash
chmod +x INSTACOMP_AI_BACKUP_NOW.command
```

## Step 5 — Run it

```bash
./INSTACOMP_AI_BACKUP_NOW.command
```

The script refuses to label the backup golden unless:

- no unexpected application source changed after the certified commit;
- no tracked/untracked application source drift is present in the important source paths;
- the Mac runtime fingerprint exactly equals the certified fingerprint;
- the existing InstaComp Python environment is present;
- the native FULL ZIP is created and verified;
- the whole-repository archive is created and verified.

## Step 6 — What SUCCESS looks like

Do not call the job finished unless the last section says:

```text
SUCCESS - InstaComp AI golden backup is VERIFIED.
```

The backup location is:

```text
~/Backups/InstaComp-AI-GOLDEN-2026-08-07
```

## Step 7 — Copy it to a physical external drive

In Finder:

1. Press `Command + Shift + G`.
2. Enter:

```text
~/Backups
```

3. Open `InstaComp-AI-GOLDEN-2026-08-07`.
4. Connect an external SSD or USB drive.
5. Copy the **entire** `InstaComp-AI-GOLDEN-2026-08-07` folder to that drive.
6. Wait until Finder finishes copying.
7. Eject the drive normally.

Do not put this folder in a public Dropbox link, public Google Drive link, public GitHub repository, public file host, or send it casually by email. Local `.env` files may contain secrets.

## Step 8 — Return your normal repo to main

After the backup finishes:

```bash
git checkout main
```

---

# PART 3 — QUICK RECOVERY WHEN ONLY THE CODE GOT BROKEN

Use this when the Mac still works, the database/provider accounts still exist, and someone changed/broke the code.

## Step 1 — Do not delete the broken folder

Rename it if necessary. Keep it until the recovery copy passes.

## Step 2 — Make a fresh clone from the golden branch

Choose a safe parent folder, for example your home folder:

```bash
cd ~
```

Clone the repository:

```bash
git clone --branch backup/instacomp-ai-certified-2026-08-07-golden https://github.com/TruelyCollectables/truely-collectables.git InstaComp-AI-GOLDEN-RESTORE
```

If GitHub asks you to authenticate, use the same GitHub account/access method you normally use for the private repository.

## Step 3 — Put the local InstaComp `.env` back

The GitHub golden branch intentionally does **not** contain secrets.

Use the local emergency archive or native FULL ZIP to recover the original:

```text
services/instacomp-ai/.env
```

Do not use `.env.example` as if it contained the real credentials.

## Step 4 — Confirm the source fingerprint

From the new repository:

```bash
cd ~/InstaComp-AI-GOLDEN-RESTORE
python3 - <<'PY'
from hashlib import sha256
from pathlib import Path
root=Path('services/instacomp-ai')
d=sha256()
for rel in ('app/main.py','app/local_vision.py','app/ollama.py'):
    d.update(rel.encode()); d.update(b'\0'); d.update((root/rel).read_bytes()); d.update(b'\0')
print(d.hexdigest())
PY
```

It must print exactly:

```text
d1f81dfa0054a5b1ca36f32c0f32c5c03f09a2de507e69041815861385878be3
```

If it does not match, **stop**. Do not deploy.

## Step 5 — Install website dependencies

```bash
npm ci
```

## Step 6 — Ensure Ollama is running

Check:

```bash
ollama list
```

You need the certified model:

```text
qwen2.5vl:7b
```

If Ollama is installed but the model is missing:

```bash
ollama pull qwen2.5vl:7b
```

## Step 7 — Install/restart the Mac service

From the repository root:

```bash
bash services/instacomp-ai/scripts/install-macos.sh
```

The installer uses Python 3.11 through 3.13. Python 3.14 is not accepted by the certified package.

If the Mac does not have a supported Python and Homebrew is installed:

```bash
brew install python@3.13
```

Then run the installer again.

## Step 8 — Check local health

```bash
curl http://127.0.0.1:8787/health
```

The JSON must contain:

```json
"ok": true
```

The central Registry must also be ready. If the Registry is missing, identity/pricing remains blocked by design.

---

# PART 4 — FULL MAC DISASTER / NEW MAC RECOVERY

Use this if the old Mac is dead, wiped, or you are moving the system to a replacement Mac.

## Step 1 — Keep the backup drive disconnected until the replacement Mac is ready

Do not alter the backup files.

## Step 2 — Install the basic prerequisites

You need:

- Git;
- Node.js 22;
- Python 3.11, 3.12, or 3.13 (3.13 preferred);
- Ollama.

Check versions:

```bash
git --version
node --version
python3 --version
ollama --version
```

Node should be version 22 for the certified build/test environment.

## Step 3 — Copy the backup folder to the replacement Mac

The final local path must be:

```text
~/Backups/InstaComp-AI-GOLDEN-2026-08-07
```

If it is on an external drive, create `~/Backups` and copy the complete folder there.

## Step 4 — Get the recovery helper branch

```bash
cd ~
git clone --branch backup/instacomp-ai-certified-2026-08-07-recovery https://github.com/TruelyCollectables/truely-collectables.git InstaComp-AI-RECOVERY-TOOLS
cd InstaComp-AI-RECOVERY-TOOLS
```

## Step 5 — Run the one-command restore

```bash
chmod +x INSTACOMP_AI_RESTORE.command
./INSTACOMP_AI_RESTORE.command
```

The restore intentionally creates a brand-new folder with a timestamp. It does not overwrite another repository.

It will:

1. locate the newest repository emergency archive;
2. verify its SHA-256;
3. extract it into a new folder;
4. verify the certified runtime fingerprint;
5. verify the independent native FULL ZIP;
6. run `npm ci`;
7. verify/start Ollama;
8. download `qwen2.5vl:7b` if needed;
9. install the Mac LaunchAgent using the certified installer;
10. run the System Doctor;
11. require local `/health` to report `ok=true`.

Do not proceed to Production until it ends with:

```text
LOCAL RECOVERY SUCCESS
```

## Step 6 — Do not delete the old/broken copy

Keep it until Production is healthy again and you have performed a new backup.

---

# PART 5 — IF THE NATIVE INSTAComp ZIP IS THE ONLY GOOD COPY

The native ZIP can restore the complete `services/instacomp-ai` contents into a **new** folder.

Example verification only:

```bash
python3 services/instacomp-ai/scripts/restore-full-backup.py \
  /path/to/InstaComp-AI-FULL-xxxxxxxx.zip
```

Actual no-overwrite restore:

```bash
python3 services/instacomp-ai/scripts/restore-full-backup.py \
  /path/to/InstaComp-AI-FULL-xxxxxxxx.zip \
  --apply \
  --destination ~/InstaComp-AI-Service-Restore
```

If the destination already exists, the restore refuses to overwrite it. That is intentional.

After restoring the native service folder, obtain website/repository source from the GitHub golden branch and place the restored service state back under `services/instacomp-ai` only after verifying both copies.

---

# PART 6 — FINAL PRODUCTION RECOVERY

**Do this only after local recovery says SUCCESS.**

## Step 1 — Verify the website source can install

From the recovered repository:

```bash
npm ci
```

## Step 2 — Run the Production environment audit

```bash
npm run audit:vercel-production-env
```

If this fails, **stop**. Do not deploy until the Vercel Production environment is repaired.

## Step 3 — Build the recovered source

```bash
npm run build
```

If build fails, **stop**.

## Step 4 — Run the repository Production preflight

```bash
npm run preflight:production
```

If preflight fails, **stop**. The system is designed to fail closed.

## Step 5 — Deploy only after the checks above pass

```bash
npm run deploy:production
```

## Step 6 — Run Production smoke

```bash
npm run smoke:production
```

Do not call Production restored until the smoke test passes.

## Step 7 — Recheck the Mac

```bash
curl http://127.0.0.1:8787/health
```

You want `ok=true`.

## Step 8 — Recheck Production InstaComp readiness

Use the repository's Production smoke/readiness tooling. Do not bypass Registry or authentication gates merely to make a health check green.

## Step 9 — Before processing a real batch

Run the strict acceptance gate again against the known frozen acceptance cards. The recovery target is the same standard that certified this snapshot: two consecutive exact 5/5 passes with exact Registry UUID/fingerprint and at least 95% identity confidence.

---

# PART 7 — COMMON FAILURE MESSAGES AND WHAT TO DO

## “Backup folder not found”

Expected folder:

```text
~/Backups/InstaComp-AI-GOLDEN-2026-08-07
```

Fix: connect the external drive and copy the complete folder back to that path.

## “Backup checksum FAILED”

Do **not** use that archive. Use the second copy from the external drive or another known-good copy. A checksum failure means the bytes are not the bytes that were certified when backed up.

## “Runtime fingerprint does not match”

Do **not** deploy. Re-clone:

```text
backup/instacomp-ai-certified-2026-08-07-golden
```

Expected fingerprint:

```text
d1f81dfa0054a5b1ca36f32c0f32c5c03f09a2de507e69041815861385878be3
```

## “Python 3.14 is not supported”

Install Python 3.13 and rerun the installer.

```bash
brew install python@3.13
```

## “Ollama is unavailable”

Open the Ollama app, then check:

```bash
ollama list
```

If the model is missing:

```bash
ollama pull qwen2.5vl:7b
```

## “Central Checklist Registry is not configured”

The local service `.env` is missing, incomplete, or the central Registry is unavailable.

The restored service `.env` must contain the real configured values, including the Registry URL/token and Mac API key. Do not copy secret values into a public issue or chat.

## Mac service will not start

Check:

```text
services/instacomp-ai/data/logs/service-error.log
```

Then run:

```bash
cd services/instacomp-ai
.venv/bin/python scripts/run-system-doctor.py
```

## Production preflight fails

Do not bypass it. Repair the reported Vercel/Supabase/provider condition first.

---

# PART 8 — WHAT NOT TO DO DURING A RECOVERY

Do not:

- delete the old installation before the recovery copy passes;
- force-push or edit the golden branch;
- run `git reset --hard` on the only copy of a broken-but-valuable working directory;
- overwrite a backup ZIP whose SHA-256 failed;
- invent or regenerate Registry identity data from model guesses;
- use `.env.example` as though it contained the real secrets;
- make a temporary acceptance credential permanent;
- bypass the 95% identity gate;
- bypass the Registry UUID/fingerprint requirement;
- auto-publish cards merely because the service restarted;
- upload local backups publicly.

---

# PART 9 — AFTER A SUCCESSFUL RECOVERY

Once the replacement/recovered system is healthy:

1. Make one real test scan and verify the expected fail-closed identity behavior.
2. Run the frozen-card acceptance gate again.
3. Create a **new** verified emergency backup.
4. Copy the new backup to the external drive.
5. Keep the August 7 certified golden backup as a historical rollback point.
6. Only after all of that should you remove obsolete broken recovery folders.

---

# EMERGENCY ONE-LINE SUMMARY

If you remember nothing else:

```text
Use backup/instacomp-ai-certified-2026-08-07-recovery -> run INSTACOMP_AI_RESTORE.command -> require LOCAL RECOVERY SUCCESS -> run Production preflight/build/deploy/smoke -> rerun frozen acceptance -> never overwrite the golden branch.
```
