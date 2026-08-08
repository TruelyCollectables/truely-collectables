# KINGMAKER — Certified Disaster Recovery Guide

This guide is written so you can restore KINGMAKER without having to remember how Git, Node, Vercel, Supabase, or the KINGMAKER safety gates work.

## DO NOT LOSE THESE GOLDEN FACTS

- Repository: `TruelyCollectables/truely-collectables`
- Exact certified KINGMAKER source: `7f20e5d3d5eb078ae9a6ffff5c19af92f1ab29d9`
- Golden branch: `backup/kingmaker-certified-2026-08-07-golden`
- Recovery branch: `backup/kingmaker-certified-2026-08-07-recovery`
- Production site: `https://truelycollectables.com`
- Certified Production `nanoid`: `3.3.18`
- Independent KINGMAKER FBI audit run: `31239900562`
- Independent FBI audit job: `93059017606`
- Forced exact Production deployment run: `31240355160`
- Forced deployment job: `93060196680`
- At certification time: all 61 KINGMAKER regression suites passed.
- At certification time: Production high/critical dependency audit had zero vulnerabilities.
- At certification time: live Production reported the exact source SHA above and all tested KINGMAKER routes passed smoke.

The golden branch must remain an untouched rollback point. **Do not develop on it. Do not merge into it. Do not force-push it to some newer commit just because newer code exists.** A future certified backup should get its own certification process.

---

# PART 1 — WHAT IS ACTUALLY BACKED UP

KINGMAKER lives inside the Truely Collectables application, so the safest local backup is the complete repository rather than a partial `src/app/kingmaker` ZIP.

The backup has three layers.

## Layer A — GitHub golden source

`backup/kingmaker-certified-2026-08-07-golden`

This points directly to the exact source that passed the KINGMAKER forensic audit and was forced to Production successfully.

## Layer B — local emergency repository archive

`KINGMAKER_BACKUP_NOW.command` uses the repository's built-in:

```bash
npm run backup:nightly
npm run verify:nightly-backup
```

The resulting `.tar.gz` contains the entire `truely-collectables` repository including:

- `.git` history;
- committed source;
- ignored/local root `.env*` files;
- other local files that are not in the excluded rebuildable paths.

It intentionally excludes rebuildable bulk such as:

- `node_modules`;
- `.next` and build output;
- virtual environments and caches;
- coverage/cache files.

Those are reinstalled/rebuilt during recovery.

Every emergency archive receives:

- the `.tar.gz` archive;
- a `.sha256` file;
- a JSON manifest.

The backup is not accepted until the verifier passes.

## Layer C — KINGMAKER recovery helpers

The recovery branch adds only these KINGMAKER-specific files on top of the certified source:

- `KINGMAKER_RECOVERY_MANIFEST.json`
- `KINGMAKER_BACKUP_NOW.command`
- `KINGMAKER_RESTORE.command`
- `KINGMAKER_SIMPLE_BACKUP.txt`
- `KINGMAKER_RECOVERY_GUIDE.md`

The application itself remains anchored to the certified source commit.

---

# PART 2 — IMPORTANT: WHAT IS EXTERNAL TO THE CODE BACKUP

A Git repository cannot magically contain an entire cloud provider.

These are external systems:

- Supabase Production database;
- Supabase Storage;
- Vercel Production environment values and deployment records;
- Stripe account/webhooks/payment state;
- eBay account/tokens/provider-side state;
- Resend account/domain/provider-side state;
- Cloudflare/DNS/tunnel configuration;
- any other third-party provider account.

The local archive preserves local `.env*` files that existed on the Mac at backup time. That helps reconnect the restored code. It does **not** recreate a cloud account that somebody deleted, nor does it contain a full copy of live Supabase data unless that data also existed as a local file.

If only the code breaks, this backup is designed to put the exact code back quickly.

If the database/provider infrastructure is also damaged, restore that external service from its own provider backup/recovery controls before allowing live writes.

KINGMAKER Phase 18 is intentionally fail-closed: if restore/data evidence is not verified, do not guess. Freeze writes, disable payments/shipping, and require owner review.

---

# PART 3 — MAKE THE PHYSICAL GOLDEN BACKUP NOW

## Step 1 — Open Terminal

On the Mac mini:

1. Press `Command + Space`.
2. Type `Terminal`.
3. Press Return.

## Step 2 — Go to the `truely-collectables` folder

If you do not know the path:

1. Type this but do not press Return yet:

```bash
cd 
```

There is a space after `cd`.

2. Open Finder.
3. Find the `truely-collectables` folder.
4. Drag that folder into Terminal.
5. Press Return.

Check that you are in the right place:

```bash
pwd
ls package.json src/app/kingmaker
```

You should see `package.json` and `src/app/kingmaker`. If Terminal says they do not exist, stop and find the correct folder.

## Step 3 — Fetch the certified recovery branch

Run:

```bash
git fetch origin
```

Then:

```bash
git checkout backup/kingmaker-certified-2026-08-07-recovery
```

If Git refuses because you have tracked local changes, **do not use `git reset --hard` just to get past it**. Those changes may be valuable. Preserve them first.

## Step 4 — Make the two `.command` files executable

```bash
chmod +x KINGMAKER_BACKUP_NOW.command KINGMAKER_RESTORE.command
```

## Step 5 — Run the golden backup

```bash
./KINGMAKER_BACKUP_NOW.command
```

The script will refuse the backup if any of these are wrong:

- application source differs from the certified commit except for the approved recovery helper files;
- tracked local files are dirty;
- KINGMAKER source has local drift;
- `nanoid` is not the certified 3.3.18;
- the certified audit-effect repair is missing;
- KINGMAKER architecture contract fails;
- global work-order contract fails;
- live Production does not report exact certified SHA `7f20e5d3...`;
- repository backup creation fails;
- archive verification fails.

That refusal is a safety feature. Do not edit the script to remove a failed gate.

## Step 6 — Know what success looks like

Do not call the backup finished unless the end says:

```text
SUCCESS - KINGMAKER GOLDEN BACKUP VERIFIED
```

The local backup folder is:

```text
~/Backups/KINGMAKER-GOLDEN-2026-08-07
```

## Step 7 — Copy it to an external drive

1. Open Finder.
2. Press `Command + Shift + G`.
3. Enter:

```text
~/Backups/KINGMAKER-GOLDEN-2026-08-07
```

4. Connect an external SSD/USB drive.
5. Copy the **entire** `KINGMAKER-GOLDEN-2026-08-07` folder to the drive.
6. Do not pull the drive out while Finder is still copying.
7. Eject the drive normally.

Treat the archive like a password-containing backup because local `.env` files can be inside it. Do not make it public.

## Step 8 — Return the normal working repository to main

```bash
git checkout main
```

---

# PART 4 — FASTEST RECOVERY IF ONLY THE CODE GOT MESSED UP

Use this when Supabase/provider accounts are healthy and you only need the known-good KINGMAKER application source again.

## Step 1 — Do not delete the broken folder

Rename it if needed. Keep it until the recovery copy is proven.

## Step 2 — Clone the untouched golden branch into a NEW folder

```bash
cd ~
```

Then:

```bash
git clone --branch backup/kingmaker-certified-2026-08-07-golden https://github.com/TruelyCollectables/truely-collectables.git KINGMAKER-GOLDEN-RESTORE
```

For a private repository, GitHub may ask you to authenticate using your normal GitHub access method.

Go into it:

```bash
cd ~/KINGMAKER-GOLDEN-RESTORE
```

## Step 3 — Prove the exact source

```bash
git rev-parse HEAD
```

It must print exactly:

```text
7f20e5d3d5eb078ae9a6ffff5c19af92f1ab29d9
```

If not, stop.

## Step 4 — Recover local `.env` files

The GitHub golden branch intentionally does not expose ignored secrets.

Use the verified physical backup to recover the same local `.env*` files into the corresponding repository locations. Do not paste secrets into a public GitHub issue or public chat.

If you use `KINGMAKER_RESTORE.command` instead of a manual clone, this is handled by restoring the complete local archive first.

## Step 5 — Reinstall dependencies

Certified environment uses Node 22.

Check:

```bash
node --version
```

The major version should be `22`.

Then:

```bash
npm ci
```

## Step 6 — Run Production dependency security audit

```bash
npm audit --omit=dev --audit-level=high
```

Do not proceed with a new high/critical Production vulnerability.

## Step 7 — Run KINGMAKER authority contracts

```bash
node scripts/certify-kingmaker-instacomp-architecture.mjs
```

Then:

```bash
node scripts/certify-kingmaker-global-execution-query.mjs
```

Both must pass.

## Step 8 — Run all KINGMAKER regression suites

```bash
for suite in scripts/run-kingmaker-*-regressions.ts; do npx tsx "$suite" || break; done
```

The certified snapshot contained 61 KINGMAKER regression suites and all 61 passed.

## Step 9 — TypeScript

```bash
npx tsc --noEmit
```

Must pass.

## Step 10 — Production build

```bash
TCOS_RELEASE_COMMIT=7f20e5d3d5eb078ae9a6ffff5c19af92f1ab29d9 npm run build
```

Must pass.

Only after these checks should you consider putting the restored source back into Production.

---

# PART 5 — FULL RESTORE FROM THE PHYSICAL BACKUP

This is the preferred disaster path because it also restores the local repository state and local `.env*` files captured by the backup.

## Step 1 — Put the backup folder back in the expected location

Copy the complete folder from your external drive to:

```text
~/Backups/KINGMAKER-GOLDEN-2026-08-07
```

Do not rename individual archive/manifest/SHA files.

## Step 2 — Open Terminal

Press `Command + Space`, type `Terminal`, press Return.

## Step 3 — Go to the backup folder

```bash
cd ~/Backups/KINGMAKER-GOLDEN-2026-08-07
```

## Step 4 — Make restore executable

```bash
chmod +x KINGMAKER_RESTORE.command
```

## Step 5 — Run restore

```bash
./KINGMAKER_RESTORE.command
```

It creates a completely NEW folder similar to:

```text
~/KINGMAKER-Recovery-20260807-224500
```

It never overwrites the existing working/broken repository.

## Step 6 — What the restore does automatically

It will:

1. require Git, Node, npm, tar, shasum and curl;
2. require Node major version 22;
3. find the newest KINGMAKER emergency `.tar.gz`;
4. verify the archive SHA-256 before extracting;
5. extract into a new recovery directory;
6. require `.git` and `package.json`;
7. require the certified commit to exist in Git history;
8. refuse tracked dirty state;
9. detach the recovery working tree to exact certified commit `7f20e5d3...`;
10. verify `nanoid 3.3.18`;
11. verify the KINGMAKER audit-effect repair;
12. run `npm ci`;
13. run the Production dependency security audit;
14. run both KINGMAKER authority/execution contracts;
15. run all 61 KINGMAKER regression suites;
16. run focused KINGMAKER lint;
17. run full TypeScript;
18. run a full Production build pinned to the certified commit.

## Step 7 — Do not continue unless this appears

```text
LOCAL KINGMAKER RECOVERY SUCCESS
```

If any previous step failed, fix that failure instead of skipping it.

---

# PART 6 — NEW MAC / WIPED MAC PREREQUISITES

Before running the restore on a replacement Mac, you need working command-line prerequisites.

Check them individually:

```bash
git --version
```

```bash
node --version
```

```bash
npm --version
```

```bash
tar --version
```

Node must be major version 22 for the certified recovery path.

After those exist, copy the physical backup to `~/Backups/KINGMAKER-GOLDEN-2026-08-07` and run the restore command from Part 5.

Do not throw away the old Mac/disk until the recovered system and Production both pass final verification.

---

# PART 7 — FINAL PRODUCTION RECOVERY

Do this **only after** local recovery ends with `LOCAL KINGMAKER RECOVERY SUCCESS`.

## Step 1 — Decide whether this is CODE-ONLY damage or INFRASTRUCTURE/DATA damage

### If Supabase, Vercel configuration, payment/shipping providers and other cloud systems are healthy

Continue with the code deployment steps below.

### If database/provider state is uncertain, corrupted, deleted, or out of sync

Do not blindly deploy and turn writes back on.

Use the KINGMAKER Phase 18 safety position:

- freeze writes;
- disable payments/shipping;
- require owner review;
- verify the backup/restore source;
- require zero unintended data loss;
- require zero duplicate effects;
- verify RTO/RPO evidence;
- restore the damaged external provider/database from its own recovery system;
- only re-enable live operations after those checks are satisfied.

The code archive is not a substitute for a deleted cloud database.

## Step 2 — Audit Vercel Production environment

From the recovered repository:

```bash
npm run audit:vercel-production-env
```

If it fails, stop. Repair the reported Vercel environment problem first.

## Step 3 — Run Production preflight

```bash
npm run preflight:production
```

If it fails, stop.

## Step 4 — Re-run the exact KINGMAKER safety checks before deployment

```bash
npm audit --omit=dev --audit-level=high
```

```bash
node scripts/certify-kingmaker-instacomp-architecture.mjs
```

```bash
node scripts/certify-kingmaker-global-execution-query.mjs
```

```bash
npx tsc --noEmit
```

```bash
TCOS_RELEASE_COMMIT=7f20e5d3d5eb078ae9a6ffff5c19af92f1ab29d9 npm run build
```

All must pass.

## Step 5 — Deploy through the repository's guarded Production deployer

```bash
npm run deploy:production
```

Do not substitute a random manual upload or untracked build folder.

## Step 6 — Run Production smoke

```bash
npm run smoke:production
```

Must pass.

## Step 7 — Prove Production is serving the exact certified SHA

Run:

```bash
curl -sS -H 'Cache-Control: no-cache' 'https://truelycollectables.com/instacomp-release.json?recovery-check=1'
```

Find `sourceCommit` in the JSON.

It must be:

```text
7f20e5d3d5eb078ae9a6ffff5c19af92f1ab29d9
```

You can make the check automatic with:

```bash
curl -sS -H 'Cache-Control: no-cache' 'https://truelycollectables.com/instacomp-release.json?recovery-check=2' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const b=JSON.parse(s);if(b.sourceCommit!=="7f20e5d3d5eb078ae9a6ffff5c19af92f1ab29d9")process.exit(1);console.log("PASS exact certified Production SHA",b.sourceCommit);})'
```

If that command exits without the PASS line, Production is not the golden source. Stop.

## Step 8 — Smoke all KINGMAKER public routes

```bash
for path in /kingmaker /kingmaker/scan /kingmaker/pending /kingmaker/inventory /kingmaker/intelligence /kingmaker/sourcing /kingmaker/offers /kingmaker/orders /kingmaker/marketplaces /kingmaker/payouts /kingmaker/settings /kingmaker/instacomp-audit; do echo "CHECK $path"; curl -fsS "https://truelycollectables.com$path" | grep -qi KINGMAKER || exit 1; done
```

If it stops on any route, that route needs investigation before recovery is declared complete.

## Step 9 — Check protected admin boundaries manually

Open the private KINGMAKER admin areas while logged out and verify they require admin authentication rather than exposing admin content.

Then log in normally and verify the KINGMAKER admin/Capital Ledger pages load as expected.

## Step 10 — Only now declare Production recovered

You want all of these true at the same time:

- exact source SHA proven;
- Production dependency security clean at high/critical severity;
- all KINGMAKER regressions pass;
- authority/work-order contracts pass;
- TypeScript passes;
- Production build passes;
- Production smoke passes;
- public KINGMAKER routes pass;
- protected admin boundaries still protect admin content;
- database/provider state is verified safe;
- no duplicate/unintended business effects occurred during recovery.

---

# PART 8 — COMMON PROBLEMS

## `Backup folder not found`

Expected:

```text
~/Backups/KINGMAKER-GOLDEN-2026-08-07
```

Copy the complete folder from the external drive to that exact location.

## `BACKUP CHECKSUM FAILED`

Do not use that archive. It is damaged or does not match the verified backup bytes. Use another physical copy.

## `Node major is not 22`

Switch/install Node 22, then rerun the restore. Do not change the recovery script to allow a different major just to get past the check.

## `Expected nanoid 3.3.18`

You are not on the certified dependency lock. Restore the exact golden commit again.

## KINGMAKER architecture contract fails

Do not deploy. Something changed in the authority boundary or required KINGMAKER page behavior.

## One of the 61 regression suites fails

Do not deploy. Read the first failed suite; repair the real issue or return to a clean golden copy.

## `npm audit` reports a new high/critical Production vulnerability

Do not silently ignore it. Reassess before restoring live Production.

## Vercel environment audit fails

Do not deploy. Production credentials/configuration need repair.

## Production SHA does not equal `7f20e5d3...`

Production is serving a different deployment. Do not call recovery complete until the live manifest reports the certified SHA.

## Supabase data is missing/corrupt

The Git code archive cannot reconstruct cloud data it never contained. Keep writes/payments/shipping disabled and use the provider's database backup/recovery path. Verify data before reopening operations.

---

# PART 9 — THINGS YOU SHOULD NOT DO

Do not:

- delete your only broken copy before the recovery copy passes;
- edit the golden branch;
- force-push the golden branch to newer untested code;
- bypass the exact SHA check;
- bypass the dependency security check;
- bypass KINGMAKER authority or work-order gates;
- skip failing regressions;
- turn blank/ambiguous identity into Base just to make a workflow proceed;
- enable writes/payments/shipping when database continuity is uncertain;
- publicly upload the local backup containing `.env` secrets;
- assume a code archive is a full cloud-database backup;
- restore over the top of the only existing repository.

---

# PART 10 — AFTER A SUCCESSFUL DISASTER RECOVERY

After Production is fully green again:

1. Verify real KINGMAKER pages manually.
2. Verify admin protection manually.
3. Verify a safe read-only or non-destructive operating path before any high-impact action.
4. Re-run the KINGMAKER FBI/audit suite if available.
5. Make a NEW verified physical backup.
6. Copy that new backup to the external drive.
7. Keep this August 7 golden snapshot as a historical rollback point.
8. Only then clean up obsolete/broken recovery folders.

---

# EMERGENCY SHORT VERSION

If everything is on fire and you remember nothing else:

```text
1. Do NOT delete the old folder.
2. Put KINGMAKER-GOLDEN-2026-08-07 back under ~/Backups.
3. Run KINGMAKER_RESTORE.command.
4. Require LOCAL KINGMAKER RECOVERY SUCCESS.
5. Audit Vercel + run Production preflight.
6. Deploy through npm run deploy:production.
7. Run smoke:production.
8. Require live sourceCommit = 7f20e5d3d5eb078ae9a6ffff5c19af92f1ab29d9.
9. Require all KINGMAKER routes green.
10. If data is uncertain: freeze writes and disable payments/shipping until verified.
```
