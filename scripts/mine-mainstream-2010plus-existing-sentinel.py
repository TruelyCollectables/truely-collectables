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
from urllib.parse import urlparse

# Load only the existing Sentinel source engine without executing the heavy
# InstaComp app package initializer (vision/ML dependencies are irrelevant here).
repo_root = Path(__file__).resolve().parents[1]
app_root = repo_root / "services" / "instacomp-ai" / "app"
package = types.ModuleType("app")
package.__path__ = [str(app_root)]
sys.modules["app"] = package

from app.sentinel_sources import DEFAULT_SOURCES, SentinelSourceClient  # noqa: E402

READBACK_FILE = Path(os.environ["READBACK_FILE"])
OUT_DIR = Path(os.environ["OUT_DIR"])
SHARD_INDEX = int(os.environ["SHARD_INDEX"])
SHARD_COUNT = int(os.environ.get("SHARD_COUNT", "32"))
EXPECTED_TOTAL = 4705

SOURCE_BY_ID = {str(source["source_id"]): source for source in DEFAULT_SOURCES}
REFERENCE_IDS = [
    "beckett",
    "cardboardconnection",
    "breakninja",
    "gogts",
    "cardboardchecklist",
    "internet_archive",
]


def start_year(key: str) -> int:
    match = re.match(r"^(\d{4})", key.split("|")[1])
    if not match:
        raise ValueError(f"No start year in {key}")
    return int(match.group(1))


def target_for(key: str) -> dict:
    sport, season, manufacturer_slug, product_slug = key.split("|")
    return {
        "target_key": key,
        "exactSetKey": key,
        "sport": sport,
        "year": start_year(key),
        "season": season,
        "manufacturer": manufacturer_slug.replace("-", " "),
        "product": product_slug.replace("-", " "),
        "scope": "mainstream-2010plus-mining",
        "priority": 1,
    }


def source_ids_for(target: dict) -> list[dict]:
    manufacturer = str(target["manufacturer"]).lower()
    ids = ["psa"]
    if any(token in manufacturer for token in ["topps", "bowman"]):
        ids.append("topps")
    elif any(token in manufacturer for token in ["upper deck", "o pee chee", "parkhurst", "fleer"]):
        ids.append("upperdeck")
    elif any(token in manufacturer for token in ["panini", "donruss", "playoff", "score"]):
        ids.append("panini")
    elif "leaf" in manufacturer:
        ids.append("leaf")
    if target["sport"] == "baseball":
        ids.append("baseballcardpedia")
    ids.extend(REFERENCE_IDS)
    ids.append("google")
    seen: set[str] = set()
    output = []
    for source_id in ids:
        if source_id in seen or source_id not in SOURCE_BY_ID:
            continue
        seen.add(source_id)
        output.append(SOURCE_BY_ID[source_id])
    return output


def serialize_candidate(candidate) -> dict:
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


def document_like(url: str) -> bool:
    path = urlparse(url).path.lower()
    return any(path.endswith(ext) for ext in (".pdf", ".xlsx", ".xls", ".csv", ".zip"))


async def run() -> None:
    readback = json.loads(READBACK_FILE.read_text("utf-8"))
    keys = []
    for raw in readback.get("missingExactSetKeys") or []:
        key = str(raw)
        parts = key.split("|")
        if len(parts) != 4:
            continue
        try:
            year = start_year(key)
        except ValueError:
            continue
        if year >= 2010:
            keys.append(key)
    keys.sort(key=lambda value: (-start_year(value), value))
    if len(keys) != EXPECTED_TOTAL:
        raise SystemExit(f"Expected {EXPECTED_TOTAL} authoritative 2010+ missing keys, got {len(keys)}")

    selected = [key for index, key in enumerate(keys) if index % SHARD_COUNT == SHARD_INDEX]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "files").mkdir(exist_ok=True)

    client = SentinelSourceClient(timeout_seconds=35.0, max_download_bytes=50_000_000)
    results = []
    exact_count = 0
    downloaded_count = 0
    started = time.time()

    for position, key in enumerate(selected, 1):
        target = target_for(key)
        exact = []
        errors = []
        searched = []
        saved_file = None
        for source in source_ids_for(target):
            searched.append(source["source_id"])
            try:
                candidates = await client.search(source, target)
            except Exception as exc:  # bounded source failure; keep mining
                errors.append({"sourceId": source["source_id"], "error": str(exc)[:500]})
                await asyncio.sleep(0.35)
                continue

            exact_here = [candidate for candidate in candidates if candidate.exact_match]
            exact.extend(serialize_candidate(candidate) for candidate in exact_here[:5])
            auto = next(
                (
                    candidate
                    for candidate in exact_here
                    if candidate.import_policy == "auto_import" and candidate.trust_score >= 75
                ),
                None,
            )
            if auto:
                exact_count += 1
                if document_like(auto.url):
                    try:
                        downloaded = await client.download(auto.url)
                        digest = hashlib.sha256(key.encode()).hexdigest()[:16]
                        file_path = OUT_DIR / "files" / f"{digest}{downloaded.extension}"
                        file_path.write_bytes(downloaded.content)
                        saved_file = {
                            "path": str(file_path.relative_to(OUT_DIR)),
                            "url": downloaded.url,
                            "sha256": downloaded.sha256,
                            "contentType": downloaded.content_type,
                            "bytes": len(downloaded.content),
                        }
                        downloaded_count += 1
                    except Exception as exc:
                        errors.append({"sourceId": source["source_id"], "downloadError": str(exc)[:500]})
                break
            await asyncio.sleep(0.35)

        results.append(
            {
                "exactSetKey": key,
                "target": target,
                "searchedSources": searched,
                "exactCandidates": exact[:20],
                "savedFile": saved_file,
                "errors": errors[:20],
            }
        )
        if position % 10 == 0 or position == len(selected):
            print(
                f"[mining] shard={SHARD_INDEX} completed={position}/{len(selected)} "
                f"exact={exact_count} documents={downloaded_count}",
                flush=True,
            )

    receipt = {
        "schema": "tcos.checklist.mainstream2010plusMiningShard.v1",
        "productionReadbackRunId": 31823530515,
        "authoritative2010PlusMissing": len(keys),
        "shard": {"index": SHARD_INDEX, "count": SHARD_COUNT, "selected": len(selected)},
        "sourceEngine": "services/instacomp-ai/app/sentinel_sources.py",
        "sourcePolicy": "PSA -> matching official manufacturer -> trusted references -> Google; existing exact identity gate unchanged",
        "exactCandidateTargets": exact_count,
        "downloadedDirectDocuments": downloaded_count,
        "elapsedSeconds": round(time.time() - started, 2),
        "results": results,
    }
    (OUT_DIR / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", "utf-8")
    print(json.dumps({key: value for key, value in receipt.items() if key != "results"}, indent=2))


if __name__ == "__main__":
    asyncio.run(run())
