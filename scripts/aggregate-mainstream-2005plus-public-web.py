from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlparse

EXPECTED_SHARDS = 64
EXPECTED_TARGETS = 4735
EXPECTED_SCHEMA = "tcos.checklist.mainstream2005plusPublicWebShard.v1"
FORUM_DOMAINS = {
    "sportscardforum.com",
    "freedomcardboard.com",
    "forums.collectors.com",
    "thebenchtrading.com",
    "net54baseball.com",
    "blowoutforums.com",
    "reddit.com",
}


def year_for(key: str) -> int:
    parts = key.split("|")
    if len(parts) != 4:
        return 0
    match = re.match(r"^(\d{4})", parts[1])
    return int(match.group(1)) if match else 0


def host_for(url: str) -> str:
    return (urlparse(str(url or "")).hostname or "").lower()


def is_forum_host(host: str) -> bool:
    return any(host == domain or host.endswith(f".{domain}") for domain in FORUM_DOMAINS)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(
            "usage: aggregate-mainstream-2005plus-public-web.py <download-root> <out-dir>"
        )

    root = Path(sys.argv[1]).resolve()
    out_dir = Path(sys.argv[2]).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    receipt_paths = sorted(root.rglob("receipt.json"))
    if len(receipt_paths) != EXPECTED_SHARDS:
        raise SystemExit(
            f"Expected {EXPECTED_SHARDS} public-web receipts, found {len(receipt_paths)}"
        )

    shard_indexes: set[int] = set()
    result_keys: set[str] = set()
    selected_sum = 0
    candidate_targets: list[dict] = []
    direct_queue: list[dict] = []
    no_candidate_keys: list[str] = []
    candidate_url_seen: set[tuple[str, str]] = set()
    direct_sha_seen: set[tuple[str, str]] = set()

    domain_target_keys: dict[str, set[str]] = defaultdict(set)
    domain_url_counts: dict[str, int] = defaultdict(int)
    domain_direct_counts: dict[str, int] = defaultdict(int)
    source_target_keys: dict[str, set[str]] = defaultdict(set)
    year_candidate_counts: dict[int, int] = defaultdict(int)
    sport_candidate_counts: dict[str, int] = defaultdict(int)

    targets_with_trusted_auto = 0
    targets_with_direct = 0
    targets_with_forum = 0
    direct_file_count = 0
    download_error_count = 0

    invariant_values: dict[str, set[object]] = {
        "productionReadbackRunId": set(),
        "previousV2RunId": set(),
        "authoritative2005PlusMissing": set(),
        "v2DirectDocumentKeysSkipped": set(),
        "publicWebQueue": set(),
    }

    for receipt_path in receipt_paths:
        receipt = json.loads(receipt_path.read_text("utf-8"))
        if receipt.get("schema") != EXPECTED_SCHEMA:
            raise SystemExit(f"Unexpected schema in {receipt_path}")

        for field in invariant_values:
            invariant_values[field].add(receipt.get(field))

        shard = receipt.get("shard") or {}
        shard_index = int(shard.get("index"))
        shard_count = int(shard.get("count"))
        selected = int(shard.get("selected") or 0)
        if shard_count != EXPECTED_SHARDS:
            raise SystemExit(
                f"Shard {shard_index} reported shard count {shard_count}, expected {EXPECTED_SHARDS}"
            )
        if shard_index in shard_indexes:
            raise SystemExit(f"Duplicate shard receipt: {shard_index}")
        shard_indexes.add(shard_index)
        selected_sum += selected

        artifact_name = receipt_path.parent.name
        results = receipt.get("results") or []
        if len(results) != selected:
            raise SystemExit(
                f"Shard {shard_index} selected {selected} but receipt has {len(results)} result rows"
            )

        for row in results:
            key = str(row.get("exactSetKey") or "").strip()
            if not key or len(key.split("|")) != 4:
                raise SystemExit(f"Invalid exactSetKey in shard {shard_index}: {key!r}")
            if key in result_keys:
                raise SystemExit(f"Duplicate exactSetKey across shards: {key}")
            result_keys.add(key)

            candidates = []
            per_target_urls: set[str] = set()
            for candidate in row.get("exactCandidates") or []:
                url = str(candidate.get("url") or "").strip()
                if not url or url in per_target_urls:
                    continue
                per_target_urls.add(url)
                host = str(candidate.get("domain") or host_for(url)).lower()
                source_id = str(candidate.get("sourceId") or "")
                normalized = {
                    "url": url,
                    "title": str(candidate.get("title") or ""),
                    "domain": host,
                    "sourceId": source_id,
                    "trustScore": int(candidate.get("trustScore") or 0),
                    "importPolicy": str(candidate.get("importPolicy") or "lead_only"),
                    "reason": str(candidate.get("reason") or ""),
                }
                candidates.append(normalized)
                pair = (key, url)
                if pair not in candidate_url_seen:
                    candidate_url_seen.add(pair)
                    domain_target_keys[host].add(key)
                    domain_url_counts[host] += 1
                    source_target_keys[source_id].add(key)

            saved_direct = []
            for saved in row.get("savedDirectEvidence") or []:
                if saved.get("path"):
                    sha = str(saved.get("sha256") or "").strip().lower()
                    source_url = str(saved.get("url") or "").strip()
                    dedupe_key = (key, sha or source_url)
                    if dedupe_key in direct_sha_seen:
                        continue
                    direct_sha_seen.add(dedupe_key)
                    host = str(saved.get("domain") or host_for(source_url)).lower()
                    entry = {
                        "exactSetKey": key,
                        "year": year_for(key),
                        "sport": key.split("|")[0],
                        "sourceArtifact": artifact_name,
                        "sourcePath": str(saved.get("path")),
                        "sourceUrl": source_url,
                        "domain": host,
                        "sha256": sha,
                        "bytes": int(saved.get("bytes") or 0),
                        "status": "evidence_only_pending_registry_validation",
                    }
                    saved_direct.append(entry)
                    direct_queue.append(entry)
                    direct_file_count += 1
                    domain_direct_counts[host] += 1
                elif saved.get("downloadError"):
                    download_error_count += 1

            if not candidates:
                no_candidate_keys.append(key)
                continue

            trusted_auto = [
                candidate
                for candidate in candidates
                if candidate["importPolicy"] == "auto_import"
                and candidate["trustScore"] >= 75
            ]
            forum_candidates = [
                candidate for candidate in candidates if is_forum_host(candidate["domain"])
            ]

            if trusted_auto:
                targets_with_trusted_auto += 1
            if saved_direct:
                targets_with_direct += 1
            if forum_candidates:
                targets_with_forum += 1

            sport = key.split("|")[0]
            year = year_for(key)
            year_candidate_counts[year] += 1
            sport_candidate_counts[sport] += 1

            candidate_targets.append(
                {
                    "exactSetKey": key,
                    "year": year,
                    "sport": sport,
                    "shard": shard_index,
                    "sourceArtifact": artifact_name,
                    "exactCandidateCount": len(candidates),
                    "trustedAutoImportCandidateCount": len(trusted_auto),
                    "forumCandidateCount": len(forum_candidates),
                    "savedDirectEvidenceCount": len(saved_direct),
                    "candidates": sorted(
                        candidates,
                        key=lambda value: (
                            -int(value["importPolicy"] == "auto_import"),
                            -value["trustScore"],
                            value["domain"],
                            value["url"],
                        ),
                    ),
                    "directEvidence": saved_direct,
                }
            )

    if shard_indexes != set(range(EXPECTED_SHARDS)):
        missing = sorted(set(range(EXPECTED_SHARDS)) - shard_indexes)
        raise SystemExit(f"Missing shard indexes: {missing}")

    for field, values in invariant_values.items():
        if len(values) != 1:
            raise SystemExit(f"Inconsistent {field} across receipts: {sorted(values, key=str)}")

    if invariant_values["authoritative2005PlusMissing"] != {EXPECTED_TARGETS}:
        raise SystemExit(
            "Receipts are not anchored to the authoritative 4,735-target 2005+ queue"
        )
    if invariant_values["publicWebQueue"] != {EXPECTED_TARGETS}:
        raise SystemExit(
            f"Expected publicWebQueue={EXPECTED_TARGETS}, got {invariant_values['publicWebQueue']}"
        )
    if selected_sum != EXPECTED_TARGETS:
        raise SystemExit(
            f"Shard selected total {selected_sum} does not equal authoritative queue {EXPECTED_TARGETS}"
        )
    if len(result_keys) != EXPECTED_TARGETS:
        raise SystemExit(
            f"Unique result count {len(result_keys)} does not equal authoritative queue {EXPECTED_TARGETS}"
        )

    candidate_targets.sort(key=lambda value: (-value["year"], value["exactSetKey"]))
    direct_queue.sort(key=lambda value: (-value["year"], value["exactSetKey"], value["sourceUrl"]))
    no_candidate_keys.sort(key=lambda value: (-year_for(value), value))

    domain_summary = {
        domain: {
            "targetCount": len(domain_target_keys[domain]),
            "candidateUrlCount": domain_url_counts[domain],
            "savedDirectEvidenceCount": domain_direct_counts[domain],
        }
        for domain in sorted(domain_target_keys)
    }
    source_summary = {
        source: len(keys)
        for source, keys in sorted(
            source_target_keys.items(), key=lambda item: (-len(item[1]), item[0])
        )
    }

    summary = {
        "schema": "tcos.checklist.mainstream2005plusPublicWebAggregate.v1",
        "sourceRunId": 31843569171,
        "productionReadbackRunId": next(iter(invariant_values["productionReadbackRunId"])),
        "previousV2RunId": next(iter(invariant_values["previousV2RunId"])),
        "authoritative2005PlusMissing": EXPECTED_TARGETS,
        "receipts": len(receipt_paths),
        "selectedRows": selected_sum,
        "uniqueExactSetKeys": len(result_keys),
        "targetsWithExactCandidates": len(candidate_targets),
        "targetsWithTrustedAutoImportCandidates": targets_with_trusted_auto,
        "targetsWithForumCandidates": targets_with_forum,
        "targetsWithSavedDirectEvidence": targets_with_direct,
        "savedDirectEvidenceFiles": direct_file_count,
        "directEvidenceDownloadErrors": download_error_count,
        "candidateUrlCount": len(candidate_url_seen),
        "targetsWithNoExactCandidate": len(no_candidate_keys),
        "importantNote": (
            "Discovery evidence is not Registry truth. No target is counted as recovered or live "
            "until the existing Checklist Registry validator/importer accepts it and Production "
            "readback confirms an active normalized version."
        ),
        "candidateTargetsByYear": {
            str(year): count for year, count in sorted(year_candidate_counts.items(), reverse=True)
        },
        "candidateTargetsBySport": dict(
            sorted(sport_candidate_counts.items(), key=lambda item: (-item[1], item[0]))
        ),
        "candidateDomains": domain_summary,
        "candidateSources": source_summary,
    }

    (out_dir / "aggregate.json").write_text(
        json.dumps(summary, indent=2) + "\n", "utf-8"
    )
    (out_dir / "candidate-validation-queue.json").write_text(
        json.dumps(
            {
                "schema": "tcos.checklist.mainstream2005plusCandidateValidationQueue.v1",
                "sourceRunId": 31843569171,
                "count": len(candidate_targets),
                "targets": candidate_targets,
            },
            indent=2,
        )
        + "\n",
        "utf-8",
    )
    (out_dir / "direct-evidence-validation-queue.json").write_text(
        json.dumps(
            {
                "schema": "tcos.checklist.mainstream2005plusDirectEvidenceValidationQueue.v1",
                "sourceRunId": 31843569171,
                "count": len(direct_queue),
                "evidence": direct_queue,
            },
            indent=2,
        )
        + "\n",
        "utf-8",
    )
    (out_dir / "no-exact-candidate-targets.txt").write_text(
        "\n".join(no_candidate_keys) + ("\n" if no_candidate_keys else ""),
        "utf-8",
    )
    (out_dir / "exact-candidate-targets.txt").write_text(
        "\n".join(value["exactSetKey"] for value in candidate_targets)
        + ("\n" if candidate_targets else ""),
        "utf-8",
    )

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
