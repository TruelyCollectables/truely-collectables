#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REGISTRY_DB = Path(os.getenv(
    "INSTACOMP_AI_REGISTRY_DB_PATH",
    SERVICE_ROOT / "data/database/checklist_registry.sqlite3",
))
MEMORY_DB = SERVICE_ROOT / "data/instacomp_ai.sqlite3"
OUTPUT_ROOT = Path(os.getenv(
    "INSTACOMP_AI_CHECKLIST_LEARNING_ROOT",
    "/Volumes/5TB/Titan/data/training/checklist-knowledge",
))
SCHEMA = "instacomp.checklistKnowledge.v1"


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize(value: object) -> str:
    return " ".join(str(value or "").strip().lower().split())


def safe_name(release_id: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9._-]+", "-", release_id).strip("-")
    return value[-180:] or hashlib.sha256(release_id.encode()).hexdigest()


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def known_visual_parallels() -> Counter[str]:
    counts: Counter[str] = Counter()
    if not MEMORY_DB.exists():
        return counts
    db = sqlite3.connect(f"file:{MEMORY_DB}?mode=ro", uri=True)
    try:
        rows = db.execute(
            "SELECT example_json FROM training_examples WHERE trusted=1"
        )
        for (raw,) in rows:
            try:
                data = json.loads(raw)
            except Exception:
                continue
            identity = data.get("confirmed_identity") or {}
            parallel = normalize(identity.get("parallel"))
            if parallel and data.get("local_vision"):
                counts[parallel] += 1
    finally:
        db.close()
    return counts


def ensure_receipts() -> sqlite3.Connection:
    db = sqlite3.connect(MEMORY_DB)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("""
        CREATE TABLE IF NOT EXISTS checklist_learning_receipts (
            release_id TEXT PRIMARY KEY,
            knowledge_digest TEXT NOT NULL,
            identity_count INTEGER NOT NULL,
            parallel_count INTEGER NOT NULL,
            serial_rule_count INTEGER NOT NULL,
            learned_at TEXT NOT NULL,
            status TEXT NOT NULL,
            knowledge_path TEXT NOT NULL
        )
    """)
    db.commit()
    return db


def existing_receipts(db: sqlite3.Connection) -> dict[str, str]:
    return dict(db.execute(
        "SELECT release_id, knowledge_digest FROM checklist_learning_receipts"
    ).fetchall())


def load_release_summaries(reg: sqlite3.Connection) -> list[sqlite3.Row]:
    reg.row_factory = sqlite3.Row
    return list(reg.execute("""
        SELECT release_id,
               COUNT(*) AS identity_count,
               MAX(COALESCE(year,'')) AS year,
               MAX(COALESCE(manufacturer,'')) AS manufacturer,
               MAX(COALESCE(brand,'')) AS brand,
               MAX(COALESCE(product,'')) AS product,
               MAX(COALESCE(sport,'')) AS sport,
               MAX(COALESCE(league,'')) AS league,
               GROUP_CONCAT(DISTINCT source_sha256) AS source_hashes
        FROM checklist_registry_entries
        WHERE active=1
        GROUP BY release_id
        ORDER BY release_id
    """))


def load_set_names(reg: sqlite3.Connection, release_id: str) -> list[dict]:
    rows = reg.execute("""
        SELECT COALESCE(set_name,''), COUNT(*)
        FROM checklist_registry_entries
        WHERE active=1 AND release_id=? AND COALESCE(set_name,'')<>''
        GROUP BY set_name ORDER BY COUNT(*) DESC, set_name
    """, (release_id,)).fetchall()
    return [{"name": str(name), "entries": int(count)} for name, count in rows]


def load_parallel_rules(reg: sqlite3.Connection, release_id: str) -> list[dict]:
    rows = reg.execute("""
        SELECT COALESCE(NULLIF(TRIM(parallel),''),'Base') AS p,
               serial_run,
               COUNT(*) AS entries,
               SUM(CASE WHEN is_auto=1 THEN 1 ELSE 0 END) AS autos,
               SUM(CASE WHEN is_relic=1 THEN 1 ELSE 0 END) AS relics
        FROM checklist_registry_entries
        WHERE active=1 AND release_id=?
        GROUP BY p, serial_run
        ORDER BY lower(p), serial_run
    """, (release_id,)).fetchall()
    grouped: dict[str, dict] = {}
    for parallel, serial_run, entries, autos, relics in rows:
        item = grouped.setdefault(str(parallel), {
            "parallel": str(parallel), "serial_runs": [],
            "entries": 0, "autos": 0, "relics": 0,
        })
        if serial_run is not None:
            value = int(serial_run)
            if value not in item["serial_runs"]:
                item["serial_runs"].append(value)
        item["entries"] += int(entries or 0)
        item["autos"] += int(autos or 0)
        item["relics"] += int(relics or 0)
    for item in grouped.values():
        item["serial_runs"].sort()
    return list(grouped.values())


def release_digest(summary: sqlite3.Row, sets: list[dict], rules: list[dict]) -> str:
    payload = {
        "release_id": summary["release_id"],
        "identity_count": int(summary["identity_count"]),
        "source_hashes": sorted(filter(None, str(summary["source_hashes"] or "").split(","))),
        "sets": sets,
        "parallel_rules": rules,
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_record(summary: sqlite3.Row, sets: list[dict], rules: list[dict], visual: Counter[str]) -> dict:
    learned_at = utcnow()
    for rule in rules:
        support = int(visual.get(normalize(rule["parallel"]), 0))
        rule["verified_visual_examples"] = support
        rule["visual_status"] = (
            "verified_visual_memory" if support > 0 else "needs_verified_image_examples"
        )
    return {
        "schema": SCHEMA,
        "learned_at": learned_at,
        "release_id": summary["release_id"],
        "year": summary["year"],
        "manufacturer": summary["manufacturer"],
        "brand": summary["brand"],
        "product": summary["product"],
        "sport": summary["sport"],
        "league": summary["league"],
        "identity_count": int(summary["identity_count"]),
        "source_sha256s": sorted(filter(None, str(summary["source_hashes"] or "").split(","))),
        "sets": sets,
        "parallel_rules": rules,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backfill", action="store_true")
    args = parser.parse_args()
    if not REGISTRY_DB.exists():
        raise SystemExit(f"registry missing: {REGISTRY_DB}")
    if not Path("/Volumes/5TB").exists():
        raise SystemExit("5TB learning volume is not mounted")

    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    visual = known_visual_parallels()
    memory = ensure_receipts()
    receipts = existing_receipts(memory)
    registry = sqlite3.connect(f"file:{REGISTRY_DB}?mode=ro", uri=True, timeout=30.0)
    registry.row_factory = sqlite3.Row
    summaries = load_release_summaries(registry)

    records: list[dict] = []
    changed = 0
    skipped = 0
    visual_targets: dict[str, dict] = {}
    total_identities = 0

    for summary in summaries:
        release_id = str(summary["release_id"])
        sets = load_set_names(registry, release_id)
        rules = load_parallel_rules(registry, release_id)
        digest = release_digest(summary, sets, rules)
        record = build_record(summary, sets, rules, visual)
        record["knowledge_digest"] = digest
        records.append(record)
        total_identities += int(summary["identity_count"])
        for rule in rules:
            if rule["visual_status"] == "needs_verified_image_examples" and normalize(rule["parallel"]) != "base":
                key = normalize(rule["parallel"])
                target = visual_targets.setdefault(key, {
                    "parallel": rule["parallel"], "releases": [], "serial_runs": set(), "entries": 0,
                })
                target["releases"].append(release_id)
                target["serial_runs"].update(rule["serial_runs"])
                target["entries"] += int(rule["entries"])

        learned_path = OUTPUT_ROOT / "releases" / f"{safe_name(release_id)}.json"
        if args.backfill or receipts.get(release_id) != digest:
            atomic_write(learned_path, json.dumps(record, indent=2, sort_keys=True) + "\n")
            memory.execute("""
                INSERT INTO checklist_learning_receipts
                (release_id, knowledge_digest, identity_count, parallel_count, serial_rule_count, learned_at, status, knowledge_path)
                VALUES (?,?,?,?,?,?,?,?)
                ON CONFLICT(release_id) DO UPDATE SET
                    knowledge_digest=excluded.knowledge_digest,
                    identity_count=excluded.identity_count,
                    parallel_count=excluded.parallel_count,
                    serial_rule_count=excluded.serial_rule_count,
                    learned_at=excluded.learned_at,
                    status=excluded.status,
                    knowledge_path=excluded.knowledge_path
            """, (
                release_id, digest, int(summary["identity_count"]), len(rules),
                sum(len(r["serial_runs"]) for r in rules), utcnow(), "learned", str(learned_path),
            ))
            changed += 1
        else:
            skipped += 1
    memory.commit()
    registry.close()
    memory.close()

    master = OUTPUT_ROOT / "checklist-knowledge.jsonl"
    atomic_write(master, "".join(json.dumps(r, sort_keys=True) + "\n" for r in records))

    visual_rows = []
    for item in visual_targets.values():
        visual_rows.append({
            "parallel": item["parallel"],
            "release_count": len(set(item["releases"])),
            "release_ids": sorted(set(item["releases"]))[:100],
            "serial_runs": sorted(item["serial_runs"]),
            "registry_entries": item["entries"],
            "status": "needs_verified_image_examples",
        })
    visual_rows.sort(key=lambda r: (-r["registry_entries"], normalize(r["parallel"])))
    atomic_write(
        OUTPUT_ROOT / "visual-learning-targets.jsonl",
        "".join(json.dumps(r, sort_keys=True) + "\n" for r in visual_rows),
    )

    summary = {
        "schema": "instacomp.checklistLearningRun.v1",
        "completed_at": utcnow(),
        "mode": "backfill" if args.backfill else "incremental",
        "registry_releases": len(records),
        "registry_identities": total_identities,
        "learned_or_updated_releases": changed,
        "unchanged_releases": skipped,
        "known_visual_parallel_labels": len(visual),
        "visual_parallel_targets_needing_images": len(visual_rows),
        "knowledge_root": str(OUTPUT_ROOT),
        "runtime_truth": "authoritative Mac-local registry remains the exact identity source",
    }
    atomic_write(OUTPUT_ROOT / "latest-summary.json", json.dumps(summary, indent=2, sort_keys=True) + "\n")
    print(json.dumps(summary, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
