from __future__ import annotations

import asyncio
import hashlib
import html
import json
import os
import re
import sys
import time
import types
from pathlib import Path
from urllib.parse import quote_plus, urlparse

import httpx

repo_root = Path(__file__).resolve().parents[1]
app_root = repo_root / "services" / "instacomp-ai" / "app"
package = types.ModuleType("app")
package.__path__ = [str(app_root)]
sys.modules["app"] = package

from app.sentinel_sources import (  # noqa: E402
    AnchorParser,
    candidate_trust,
    exact_target_match,
    is_public_http_url,
    unwrap_search_url,
)

READBACK_FILE = Path(os.environ["READBACK_FILE"])
V2_DIR = Path(os.environ["V2_DIR"])
OUT_DIR = Path(os.environ["OUT_DIR"])
SHARD_INDEX = int(os.environ["SHARD_INDEX"])
SHARD_COUNT = int(os.environ.get("SHARD_COUNT", "64"))
EXPECTED_2005_PLUS_MISSING = 4735
EXPECTED_V2_RECEIPTS = 32

USER_AGENT = (
    "Mozilla/5.0 (compatible; TCOS-Checklist-Public-Research/1.0; "
    "+https://truelycollectables.com)"
)

# Public discovery sources only. These are evidence/lead lanes; a hit does not
# become Registry truth merely because it appears on one of these sites.
SITE_DOMAINS = [
    "checklistinsider.com",
    "sportscardportal.com",
    "cardboardglory.com",
    "pytchecklists.com",
    "boxbusters.tv",
    "sportscardforum.com",
    "freedomcardboard.com",
    "forums.collectors.com",
    "thebenchtrading.com",
    "net54baseball.com",
    "blowoutforums.com",
    "reddit.com",
]

# Search variants deliberately cover direct files, archived copies, group-break
# lists, forum posts, and ordinary checklist pages. Identity remains fail-closed.
QUERY_VARIANTS = [
    '"{identity}" checklist',
    '"{identity}" "full checklist"',
    '"{identity}" "group break checklist"',
    '"{identity}" checklist filetype:pdf',
    '"{identity}" checklist filetype:xlsx',
    '"{identity}" checklist filetype:xls',
    '"{identity}" checklist filetype:csv',
    '"{identity}" checklist download',
]

DIRECT_EXTENSIONS = (".pdf", ".xlsx", ".xls", ".csv", ".zip")


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
        "scope": "mainstream-2005plus-public-web-exhaustive",
    }


def identity_for(target: dict) -> str:
    return " ".join(
        str(value).strip()
        for value in [
            target.get("season") or target.get("year"),
            target.get("manufacturer"),
            target.get("product"),
            target.get("sport"),
        ]
        if value
    )


def load_v2_saved_keys() -> set[str]:
    receipt_paths = sorted(V2_DIR.rglob("receipt.json"))
    if len(receipt_paths) != EXPECTED_V2_RECEIPTS:
        raise SystemExit(
            f"Expected {EXPECTED_V2_RECEIPTS} V2 receipts, found {len(receipt_paths)}"
        )
    saved: set[str] = set()
    rows = 0
    for path in receipt_paths:
        receipt = json.loads(path.read_text("utf-8"))
        for row in receipt.get("results") or []:
            rows += 1
            key = str(row.get("exactSetKey") or "")
            if row.get("savedFile") and key:
                saved.add(key)
    if rows != 4705:
        raise SystemExit(f"Expected 4705 V2 rows, found {rows}")
    return saved


def load_missing_2005_plus() -> list[str]:
    payload = json.loads(READBACK_FILE.read_text("utf-8"))
    keys = []
    for raw in payload.get("missingExactSetKeys") or []:
        key = str(raw)
        if len(key.split("|")) != 4:
            continue
        try:
            if year_for(key) >= 2005:
                keys.append(key)
        except ValueError:
            continue
    keys = sorted(set(keys), key=lambda value: (-year_for(value), value))
    if len(keys) != EXPECTED_2005_PLUS_MISSING:
        raise SystemExit(
            f"Expected {EXPECTED_2005_PLUS_MISSING} authoritative 2005+ missing keys, got {len(keys)}"
        )
    return keys


def extract_candidates(text: str, base_url: str, target: dict, source_id: str) -> list[dict]:
    parser = AnchorParser()
    parser.feed(text)
    output = []
    seen: set[str] = set()
    for href, title in parser.anchors:
        url = unwrap_search_url(href, base_url)
        if not url or url in seen or not is_public_http_url(url):
            continue
        seen.add(url)
        host = (urlparse(url).hostname or "").lower()
        if host.endswith("google.com") or host.endswith("bing.com"):
            continue
        exact, reason = exact_target_match(target, title, url)
        if not exact:
            continue
        trust, policy = candidate_trust(url)
        output.append(
            {
                "url": url,
                "title": html.unescape(title or url),
                "domain": host,
                "sourceId": source_id,
                "trustScore": trust,
                "importPolicy": policy,
                "exactMatch": True,
                "reason": reason,
            }
        )
        if len(output) >= 20:
            break
    return output


async def search_html(client: httpx.AsyncClient, engine: str, query: str, target: dict, source_id: str) -> list[dict]:
    if engine == "google":
        url = "https://www.google.com/search?q=" + quote_plus(query)
    else:
        url = "https://www.bing.com/search?q=" + quote_plus(query)
    response = await client.get(url)
    response.raise_for_status()
    return extract_candidates(response.text, str(response.url), target, source_id)


async def save_direct_file(client: httpx.AsyncClient, key: str, candidate: dict) -> dict | None:
    path = urlparse(candidate["url"]).path.lower()
    if not path.endswith(DIRECT_EXTENSIONS):
        return None
    try:
        async with client.stream("GET", candidate["url"]) as response:
            response.raise_for_status()
            chunks = []
            total = 0
            async for chunk in response.aiter_bytes():
                total += len(chunk)
                if total > 50_000_000:
                    raise ValueError("direct checklist file exceeded 50 MB evidence limit")
                chunks.append(chunk)
        content = b"".join(chunks)
        sha = hashlib.sha256(content).hexdigest()
        suffix = next((ext for ext in DIRECT_EXTENSIONS if path.endswith(ext)), ".bin")
        digest = hashlib.sha256(key.encode()).hexdigest()[:16]
        file_path = OUT_DIR / "files" / f"{digest}-{sha[:12]}{suffix}"
        file_path.write_bytes(content)
        return {
            "path": str(file_path.relative_to(OUT_DIR)),
            "url": candidate["url"],
            "sha256": sha,
            "bytes": len(content),
            "domain": candidate["domain"],
            "status": "evidence_only_pending_registry_validation",
        }
    except Exception as exc:
        return {"url": candidate["url"], "downloadError": str(exc)[:500]}


async def run() -> None:
    all_missing = load_missing_2005_plus()
    v2_saved = load_v2_saved_keys()
    # Existing direct documents are already preserved. Spend this pass on the holes.
    unresolved = [key for key in all_missing if key not in v2_saved]
    selected = [key for index, key in enumerate(unresolved) if index % SHARD_COUNT == SHARD_INDEX]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "files").mkdir(exist_ok=True)
    headers = {"user-agent": USER_AGENT, "accept": "text/html,application/xhtml+xml,*/*;q=0.8"}
    limits = httpx.Limits(max_connections=8, max_keepalive_connections=4)

    results = []
    exact_targets = 0
    direct_files = 0
    forum_targets = 0
    source_hits: dict[str, int] = {}
    started = time.time()

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, headers=headers, limits=limits) as client:
        for position, key in enumerate(selected, 1):
            target = target_for(key)
            identity = identity_for(target)
            candidates: list[dict] = []
            errors = []
            saved_files = []
            seen_urls: set[str] = set()

            # 1) Open-web file and checklist hunting through BOTH engines.
            for template in QUERY_VARIANTS:
                query = template.format(identity=identity)
                for engine in ("google", "bing"):
                    try:
                        found = await search_html(client, engine, query, target, f"{engine}-open")
                        for candidate in found:
                            if candidate["url"] in seen_urls:
                                continue
                            seen_urls.add(candidate["url"])
                            candidates.append(candidate)
                    except Exception as exc:
                        errors.append({"sourceId": f"{engine}-open", "error": str(exc)[:500]})
                    await asyncio.sleep(0.20)
                # Stop expensive open-web variants once several exact URLs are known.
                if len(candidates) >= 8:
                    break

            # 2) Targeted checklist sites + forums/message boards. Bing is primary
            # here to reduce duplicate Google pressure; exact identity gate is unchanged.
            for domain in SITE_DOMAINS:
                query = f'site:{domain} "{identity}" checklist'
                try:
                    found = await search_html(client, "bing", query, target, f"site:{domain}")
                    for candidate in found:
                        if candidate["url"] in seen_urls:
                            continue
                        seen_urls.add(candidate["url"])
                        candidates.append(candidate)
                        source_hits[domain] = source_hits.get(domain, 0) + 1
                except Exception as exc:
                    errors.append({"sourceId": f"site:{domain}", "error": str(exc)[:500]})
                await asyncio.sleep(0.20)

            if candidates:
                exact_targets += 1
                if any(candidate["domain"].endswith(domain) for candidate in candidates for domain in [
                    "sportscardforum.com",
                    "freedomcardboard.com",
                    "forums.collectors.com",
                    "thebenchtrading.com",
                    "net54baseball.com",
                    "blowoutforums.com",
                    "reddit.com",
                ]):
                    forum_targets += 1

            for candidate in candidates[:30]:
                saved = await save_direct_file(client, key, candidate)
                if saved:
                    saved_files.append(saved)
                    if saved.get("path"):
                        direct_files += 1

            results.append(
                {
                    "exactSetKey": key,
                    "target": target,
                    "exactCandidates": candidates[:50],
                    "savedDirectEvidence": saved_files[:10],
                    "errors": errors[:30],
                }
            )
            if position % 5 == 0 or position == len(selected):
                print(
                    f"[public-web] shard={SHARD_INDEX} completed={position}/{len(selected)} "
                    f"exactTargets={exact_targets} directFiles={direct_files} forumTargets={forum_targets}",
                    flush=True,
                )

    receipt = {
        "schema": "tcos.checklist.mainstream2005plusPublicWebShard.v1",
        "productionReadbackRunId": 31823530515,
        "previousV2RunId": 31832269843,
        "authoritative2005PlusMissing": len(all_missing),
        "v2DirectDocumentKeysSkipped": len(v2_saved),
        "publicWebQueue": len(unresolved),
        "shard": {"index": SHARD_INDEX, "count": SHARD_COUNT, "selected": len(selected)},
        "siteDomains": SITE_DOMAINS,
        "queryVariants": QUERY_VARIANTS,
        "exactCandidateTargets": exact_targets,
        "forumExactTargets": forum_targets,
        "savedDirectEvidenceFiles": direct_files,
        "sourceHits": source_hits,
        "elapsedSeconds": round(time.time() - started, 2),
        "results": results,
    }
    (OUT_DIR / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", "utf-8")
    print(json.dumps({key: value for key, value in receipt.items() if key != "results"}, indent=2))


if __name__ == "__main__":
    asyncio.run(run())
