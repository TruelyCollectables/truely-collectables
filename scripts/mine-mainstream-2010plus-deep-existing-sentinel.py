from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import sys
import time
import types
from pathlib import Path

repo_root = Path(__file__).resolve().parents[1]
app_root = repo_root / "services" / "instacomp-ai" / "app"
package = types.ModuleType("app")
package.__path__ = [str(app_root)]
sys.modules["app"] = package

from app.sentinel_sources import DEFAULT_SOURCES, SentinelSourceClient  # noqa: E402

PREVIOUS_DIR = Path(os.environ["PREVIOUS_DIR"])
OUT_DIR = Path(os.environ["OUT_DIR"])
SHARD_INDEX = int(os.environ["SHARD_INDEX"])
SHARD_COUNT = int(os.environ.get("SHARD_COUNT", "64"))
EXPECTED_TOTAL = 4705
EXPECTED_RECEIPTS = 32

SOURCE_BY_ID = {str(source["source_id"]): source for source in DEFAULT_SOURCES}
DEEP_SOURCE_IDS = [
    "bing",
    "sgc",
    "tcdb",
    "keyman",
    "sportscardradio",
    "reddit",
    "blowout",
]


def year_for(key: str) -> int:
    match = re.match(r"^(\d{4})", key.split("|")[1])
    if not match:
        raise ValueError(key)
    return int(match.group(1))


def target_for(key: str) -> dict:
    sport, season, manufacturer_slug, product_slug = key.split("|")
    return {
        "target_key": key,
        "exactSetKey": key,
        "sport": sport,
        "year": year_for(key),
        "season": season,
        "manufacturer": manufacturer_slug.replace("-", " "),
        "product": product_slug.replace("-", " "),
        "scope": "mainstream-2010plus-deep-mining",
        "priority": 1,
    }


def serial_candidate(candidate) -> dict:
    return {
        "url": candidate.url,
        "title": candidate.title,
        "sourceId": candidate.source_id,
        "domain": candidate.domain,
        "trustScore": candidate.trust_score,
        "importPolicy": candidate.import_policy,
        "exactMatch": candidate.exact_match,
        "reason": candidate.reason,
    }


def load_previous() -> tuple[dict[str, dict], dict[str, int]]:
    receipt_paths = sorted(PREVIOUS_DIR.rglob("receipt.json"))
    if len(receipt_paths) != EXPECTED_RECEIPTS:
        raise SystemExit(f"Expected {EXPECTED_RECEIPTS} V2 receipts, found {len(receipt_paths)}")
    rows: dict[str, dict] = {}
    exact = 0
    direct = 0
    for path in receipt_paths:
        receipt = json.loads(path.read_text("utf-8"))
        for row in receipt.get("results") or []:
            key = str(row.get("exactSetKey") or "")
            if not key or key in rows:
                raise SystemExit(f"Bad or duplicate V2 key: {key}")
            rows[key] = row
            if row.get("exactCandidates"):
                exact += 1
            if row.get("savedFile"):
                direct += 1
    if len(rows) != EXPECTED_TOTAL:
        raise SystemExit(f"Expected {EXPECTED_TOTAL} V2 target rows, found {len(rows)}")
    return rows, {"v2ExactCandidateTargets": exact, "v2DirectDocumentTargets": direct}


async def run() -> None:
    previous, previous_counts = load_previous()
    unresolved = [key for key, row in previous.items() if not row.get("savedFile")]
    unresolved.sort(key=lambda key: (-year_for(key), key))
    selected = [key for index, key in enumerate(unresolved) if index % SHARD_COUNT == SHARD_INDEX]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "files").mkdir(exist_ok=True)
    client = SentinelSourceClient(timeout_seconds=35.0, max_download_bytes=50_000_000)
    sources = [SOURCE_BY_ID[source_id] for source_id in DEEP_SOURCE_IDS if source_id in SOURCE_BY_ID]

    results = []
    exact_targets = 0
    trusted_evidence = 0
    lead_only_targets = 0
    started = time.time()

    for position, key in enumerate(selected, 1):
        target = target_for(key)
        exact_candidates = []
        errors = []
        saved_file = None
        exact_seen = False
        lead_seen = False

        for source in sources:
            try:
                candidates = await client.search(source, target)
            except Exception as exc:
                errors.append({"sourceId": source["source_id"], "error": str(exc)[:500]})
                await asyncio.sleep(0.45)
                continue

            exact_here = [candidate for candidate in candidates if candidate.exact_match]
            if exact_here:
                exact_seen = True
            exact_candidates.extend(serial_candidate(candidate) for candidate in exact_here[:8])

            trusted = next(
                (
                    candidate
                    for candidate in exact_here
                    if candidate.import_policy == "auto_import" and candidate.trust_score >= 75
                ),
                None,
            )
            if trusted and saved_file is None:
                try:
                    downloaded = await client.download(trusted.url)
                    digest = hashlib.sha256(key.encode()).hexdigest()[:16]
                    file_path = OUT_DIR / "files" / f"{digest}{downloaded.extension}"
                    file_path.write_bytes(downloaded.content)
                    saved_file = {
                        "path": str(file_path.relative_to(OUT_DIR)),
                        "url": downloaded.url,
                        "sha256": downloaded.sha256,
                        "contentType": downloaded.content_type,
                        "bytes": len(downloaded.content),
                        "sourceId": trusted.source_id,
                        "trustScore": trusted.trust_score,
                    }
                    trusted_evidence += 1
                    break
                except Exception as exc:
                    errors.append({"sourceId": source["source_id"], "downloadError": str(exc)[:500]})

            if any(candidate.import_policy == "lead_only" for candidate in exact_here):
                lead_seen = True
            await asyncio.sleep(0.45)

        if exact_seen:
            exact_targets += 1
        if lead_seen and saved_file is None:
            lead_only_targets += 1
        results.append(
            {
                "exactSetKey": key,
                "target": target,
                "v2HadExactCandidate": bool(previous[key].get("exactCandidates")),
                "exactCandidates": exact_candidates[:30],
                "savedTrustedEvidence": saved_file,
                "errors": errors[:20],
            }
        )
        if position % 10 == 0 or position == len(selected):
            print(
                f"[deep-mining] shard={SHARD_INDEX} completed={position}/{len(selected)} "
                f"exact={exact_targets} trustedEvidence={trusted_evidence} leads={lead_only_targets}",
                flush=True,
            )

    receipt = {
        "schema": "tcos.checklist.mainstream2010plusDeepMiningShard.v1",
        "sourceEngine": "services/instacomp-ai/app/sentinel_sources.py",
        "previousRunId": 31832269843,
        "authoritative2010PlusMissing": EXPECTED_TOTAL,
        "previous": previous_counts,
        "deepQueueWithoutDirectDocument": len(unresolved),
        "shard": {"index": SHARD_INDEX, "count": SHARD_COUNT, "selected": len(selected)},
        "deepSources": DEEP_SOURCE_IDS,
        "exactCandidateTargets": exact_targets,
        "savedTrustedEvidenceTargets": trusted_evidence,
        "leadOnlyTargets": lead_only_targets,
        "elapsedSeconds": round(time.time() - started, 2),
        "results": results,
    }
    (OUT_DIR / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", "utf-8")
    print(json.dumps({key: value for key, value in receipt.items() if key != "results"}, indent=2))


if __name__ == "__main__":
    asyncio.run(run())
