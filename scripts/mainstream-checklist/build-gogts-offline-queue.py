#!/usr/bin/env python3
import csv
import hashlib
import json
import os
import tarfile
from collections import defaultdict
from pathlib import Path

ARCHIVE_ROOT = Path(os.environ["ARCHIVE_ROOT"])
STATUS_ROOT = Path(os.environ["STATUS_ROOT"])
QUEUE_OUT = Path(os.environ["QUEUE_OUT"])
ALLOWED = {".xlsx", ".csv", ".xls", ".pdf"}
PREF = {".xlsx": 0, ".csv": 1, ".xls": 2, ".pdf": 3}

source_csv = STATUS_ROOT / ".public-checklist-organized" / "gogts" / "source-items.csv"
source_manifest = STATUS_ROOT / ".public-checklist-source-archive" / "gogts" / "manifest.json"

if not source_csv.is_file():
    matches = list(STATUS_ROOT.rglob("source-items.csv"))
    if len(matches) != 1:
        raise SystemExit(f"Expected one GoGTS source-items.csv, found {len(matches)}")
    source_csv = matches[0]

if not source_manifest.is_file():
    manifests = []
    for p in STATUS_ROOT.rglob("manifest.json"):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        if d.get("schema") == "tcos.publicChecklistSourceArchive.v1" and d.get("source") == "gogts":
            manifests.append(p)
    if len(manifests) != 1:
        raise SystemExit(f"Expected one GoGTS source archive manifest, found {len(manifests)}")
    source_manifest = manifests[0]

manifest = json.loads(source_manifest.read_text(encoding="utf-8"))
by_article = {str(i.get("sourceUrl", "")): i for i in manifest.get("items", [])}

# GitHub's artifact contains the preserved archive as a nested tar.gz. Extract it
# locally first, then ignore physical directory names and join by preserved hash.
scan_root = ARCHIVE_ROOT
nested_archives = sorted(
    [p for p in ARCHIVE_ROOT.rglob("*") if p.is_file() and p.name.lower().endswith((".tar.gz", ".tgz"))],
    key=lambda p: str(p),
)
if nested_archives:
    if len(nested_archives) != 1:
        raise SystemExit(f"Expected one preserved master tarball, found {len(nested_archives)}")
    tar_path = nested_archives[0]
    extracted = ARCHIVE_ROOT / "_extracted_master_archive"
    extracted.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tar_path, "r:gz") as tf:
        root_resolved = extracted.resolve()
        safe_members = []
        for member in tf.getmembers():
            target = (extracted / member.name).resolve()
            if target != root_resolved and root_resolved not in target.parents:
                raise SystemExit(f"Unsafe archive member path: {member.name}")
            if member.issym() or member.islnk():
                continue
            safe_members.append(member)
        tf.extractall(extracted, members=safe_members)
    scan_root = extracted

sha_to_paths = defaultdict(list)
scanned_files = 0
scanned_bytes = 0
for p in scan_root.rglob("*"):
    if not p.is_file() or p.suffix.lower() not in ALLOWED:
        continue
    scanned_files += 1
    try:
        size = p.stat().st_size
    except OSError:
        continue
    scanned_bytes += size
    h = hashlib.sha256()
    try:
        with p.open("rb") as fh:
            while True:
                chunk = fh.read(1024 * 1024)
                if not chunk:
                    break
                h.update(chunk)
    except OSError:
        continue
    sha_to_paths[h.hexdigest()].append(p)

if scanned_files < 100:
    sample = [str(p.relative_to(scan_root)) for p in scan_root.rglob("*") if p.is_file()][:100]
    raise SystemExit(
        "Preserved archive exposed unexpectedly few structured files after extraction: "
        f"{scanned_files}. Sample files: {json.dumps(sample)}"
    )

rows = []
with source_csv.open(encoding="utf-8-sig", newline="") as f:
    for row in csv.DictReader(f):
        key = str(row.get("exactSetKey") or "").strip().lower()
        if key and key.count("|") == 3:
            rows.append(row)

queue = []
seen = set()
missing_manifest_item = 0
missing_source_download = 0
missing_archived_hash = 0
ambiguous_hash = 0

for row in rows:
    exact_key = str(row.get("exactSetKey") or "").strip().lower()
    if exact_key in seen:
        continue
    article = str(row.get("sourceUrl") or "")
    item = by_article.get(article)
    if not item:
        missing_manifest_item += 1
        continue

    metas = []
    for meta in item.get("files", []):
        name = str(meta.get("name") or "")
        ext = Path(name).suffix.lower()
        if meta.get("role") == "source-download" and ext in ALLOWED and meta.get("sha256"):
            metas.append(meta)
    metas.sort(key=lambda m: (PREF.get(Path(str(m.get("name") or "")).suffix.lower(), 9), str(m.get("name") or "").lower()))
    if not metas:
        missing_source_download += 1
        continue

    chosen_meta = None
    chosen_path = None
    for meta in metas:
        paths = sha_to_paths.get(str(meta.get("sha256") or "").lower(), [])
        if not paths:
            continue
        if len(paths) > 1:
            ambiguous_hash += 1
            paths = sorted(paths, key=lambda p: str(p))
        chosen_meta = meta
        chosen_path = paths[0]
        break

    if chosen_meta is None or chosen_path is None:
        missing_archived_hash += 1
        continue

    queue.append({
        "exactSetKey": exact_key,
        "localPath": str(chosen_path),
        "sourceUrl": str(chosen_meta.get("sourceUrl") or article),
        "articleUrl": article,
        "season": row.get("season"),
        "archivedBytes": chosen_path.stat().st_size,
        "sourceSha256": str(chosen_meta.get("sha256") or ""),
    })
    seen.add(exact_key)

# Newest first, preserving exact-set identity as deterministic tie-breaker.
def year_sort(candidate):
    import re
    match = re.search(r"(?:19|20)\d{2}", str(candidate.get("season") or ""))
    return int(match.group(0)) if match else 0

queue.sort(key=lambda x: (-year_sort(x), x["exactSetKey"]))

payload = {
    "schema": "tcos.checklist.gogtsOfflineArchiveQueue.v3",
    "sourceRunId": "31100986894",
    "candidates": queue,
    "counts": {
        "nestedArchiveExtracted": bool(nested_archives),
        "exactSetRows": len(rows),
        "manifestItems": len(by_article),
        "archiveStructuredFilesScanned": scanned_files,
        "archiveStructuredBytesScanned": scanned_bytes,
        "uniqueArchivedHashes": len(sha_to_paths),
        "candidates": len(queue),
        "missingManifestItem": missing_manifest_item,
        "missingSourceDownload": missing_source_download,
        "missingArchivedHash": missing_archived_hash,
        "ambiguousHash": ambiguous_hash,
    },
}
QUEUE_OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
print(json.dumps(payload["counts"], indent=2))

if len(queue) < 1000:
    raise SystemExit(f"Archive queue unexpectedly small after extracted hash join: {len(queue)}")
