from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from uuid import NAMESPACE_URL, uuid5


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat()


def normalized_text(value: object) -> str:
    return " ".join(str(value or "").strip().lower().split())


def normalized_card_number(value: object) -> str:
    return normalized_text(value).replace(" ", "").replace("-", "")


def serial_denominator(value: object) -> int | None:
    normalized = normalized_text(value)
    if not normalized:
        return None
    normalized = re.sub(r"\bno\.?\s*(\d{1,5})\b", r"\1", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\b#\s*(\d{1,5})\b", r"\1", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\bnumber\s*(\d{1,5})\b", r"\1", normalized, flags=re.IGNORECASE)
    normalized = re.sub(
        r"\b(\d{1,6})\s*[- ]?of[- ]?(\d{1,6})\b",
        r"\1/\2",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = normalized.replace(" ", "")
    if normalized in {"1/1", "1of1"}:
        return 1
    match = re.search(r"(?:^|/)(\d{1,6})\b", normalized)
    return int(match.group(1)) if match else None


def year_start(value: object) -> str:
    match = __import__("re").search(r"\b((?:18|19|20)\d{2})\b", normalized_text(value))
    return match.group(1) if match else ""


def unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        cleaned = str(value or "").strip()
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            ordered.append(cleaned)
    return ordered


class LocalRegistryStore:
    """Durable Mac-side registry index backed by SQLite."""

    def __init__(self, path: Path, service_root: Path) -> None:
        self.path = path
        self.service_root = service_root
        self._seed_lock = Lock()
        self._seeded = False

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            yield db
            db.commit()
        finally:
            db.close()

    def initialize(self) -> None:
        # Schema creation is a startup/import concern. Do it once per store
        # instance; repeated DDL/WAL setup on every lookup caused lock contention
        # with the live Sentinel writer and could stall the entire API.
        if getattr(self, "_initialized", False):
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript(
                """
                PRAGMA journal_mode=WAL;
                PRAGMA foreign_keys=ON;

                CREATE TABLE IF NOT EXISTS checklist_registry_imports (
                    source_sha256 TEXT PRIMARY KEY,
                    source_url TEXT NOT NULL,
                    source_name TEXT NOT NULL,
                    target_key TEXT,
                    source_path TEXT NOT NULL,
                    authority TEXT NOT NULL,
                    content_type TEXT,
                    byte_count INTEGER NOT NULL,
                    registry_receipt TEXT,
                    imported_at TEXT NOT NULL,
                    plan_json TEXT NOT NULL,
                    import_status TEXT NOT NULL,
                    import_error TEXT
                );

                CREATE TABLE IF NOT EXISTS checklist_registry_entries (
                    identity_id TEXT PRIMARY KEY,
                    fingerprint_sha256 TEXT NOT NULL UNIQUE,
                    source_sha256 TEXT NOT NULL,
                    release_id TEXT NOT NULL,
                    version_id TEXT NOT NULL,
                    set_id TEXT NOT NULL,
                    card_id TEXT NOT NULL,
                    normalized_card_number TEXT NOT NULL,
                    manufacturer TEXT,
                    brand TEXT,
                    product TEXT,
                    player TEXT,
                    year TEXT,
                    set_name TEXT,
                    card_number TEXT,
                    parallel TEXT,
                    variation TEXT,
                    serial_run INTEGER,
                    team TEXT,
                    sport TEXT,
                    league TEXT,
                    language_code TEXT,
                    configuration_exclusivity TEXT,
                    is_auto INTEGER NOT NULL DEFAULT 0,
                    is_relic INTEGER NOT NULL DEFAULT 0,
                    source_label TEXT NOT NULL,
                    score INTEGER NOT NULL DEFAULT 100,
                    matched_evidence_json TEXT NOT NULL,
                    active INTEGER NOT NULL DEFAULT 1
                );
                CREATE INDEX IF NOT EXISTS checklist_registry_card_idx
                    ON checklist_registry_entries(normalized_card_number, active);
                CREATE INDEX IF NOT EXISTS checklist_registry_year_idx
                    ON checklist_registry_entries(year, active);
                CREATE INDEX IF NOT EXISTS checklist_registry_brand_idx
                    ON checklist_registry_entries(brand, active);
                CREATE INDEX IF NOT EXISTS checklist_registry_manufacturer_idx
                    ON checklist_registry_entries(manufacturer, active);
                CREATE INDEX IF NOT EXISTS checklist_registry_player_idx
                    ON checklist_registry_entries(player, active);
                CREATE INDEX IF NOT EXISTS checklist_registry_resolve_idx
                    ON checklist_registry_entries(normalized_card_number, year, player, brand, active);
                CREATE INDEX IF NOT EXISTS checklist_registry_resolve_manufacturer_idx
                    ON checklist_registry_entries(normalized_card_number, year, player, manufacturer, active);
                """
            )
        self._initialized = True

    def ready(self) -> bool:
        try:
            self.initialize()
            with self.connection() as db:
                db.execute("SELECT 1").fetchone()
            return True
        except sqlite3.Error:
            return False

    def _registry_source_downloads(self) -> Path:
        return self.service_root / "data" / "checklist-sentinel" / "downloads"

    def _planner_script(self) -> Path:
        return self.service_root / "scripts" / "export-checklist-import-plan.ts"

    def _source_metadata(self, source_path: Path) -> dict[str, str]:
        try:
            relative = source_path.relative_to(self.service_root)
        except ValueError:
            relative = Path(source_path.name)
        source_url = self._recover_source_url(source_path) or f"file://{relative.as_posix()}"
        source_name = source_path.stem[:120]
        content_type = "application/octet-stream"
        suffix = source_path.suffix.lower()
        if suffix == ".html":
            content_type = "text/html"
        elif suffix == ".pdf":
            content_type = "application/pdf"
        elif suffix == ".json":
            content_type = "application/json"
        elif suffix == ".csv":
            content_type = "text/csv"
        elif suffix == ".xlsx":
            content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        elif suffix == ".xls":
            content_type = "application/vnd.ms-excel"
        return {
            "source_url": source_url,
            "source_name": source_name,
            "content_type": content_type,
        }

    def _recover_source_url(self, source_path: Path) -> str | None:
        suffix = source_path.suffix.lower()
        try:
            content = source_path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            content = ""

        if suffix in {".html", ".htm"} and content:
            for pattern in [
                r'<link[^>]+rel=["\']canonical["\'][^>]+href=["\']([^"\']+)["\']',
                r'<meta[^>]+property=["\']og:url["\'][^>]+content=["\']([^"\']+)["\']',
                r'<meta[^>]+name=["\']twitter:url["\'][^>]+content=["\']([^"\']+)["\']',
            ]:
                match = re.search(pattern, content, re.IGNORECASE)
                if match:
                    candidate = match.group(1).strip()
                    if candidate.startswith("http://") or candidate.startswith("https://"):
                        return candidate

        if suffix == ".json" and content:
            try:
                payload = json.loads(content)
            except Exception:
                payload = None
            if isinstance(payload, dict):
                queue: list[object] = [payload]
                seen: set[int] = set()
                while queue:
                    current = queue.pop(0)
                    marker = id(current)
                    if marker in seen:
                        continue
                    seen.add(marker)
                    if isinstance(current, dict):
                        for key, value in current.items():
                            normalized_key = str(key).strip().lower()
                            if normalized_key in {
                                "sourceurl",
                                "source_url",
                                "canonicalurl",
                                "canonical_url",
                                "url",
                            } and isinstance(value, str):
                                candidate = value.strip()
                                if candidate.startswith("http://") or candidate.startswith("https://"):
                                    return candidate
                            if isinstance(value, (dict, list)):
                                queue.append(value)
                    elif isinstance(current, list):
                        queue.extend(current)

        if suffix == ".pdf":
            raw = source_path.read_bytes()
            candidates = [
                match.decode("utf-8", "ignore")
                for match in re.findall(br"https?://[^\s\"'<>]+", raw)
            ]
            for candidate in candidates:
                lowered = candidate.lower()
                if lowered.startswith("http://ns.adobe.com/") or lowered.startswith("http://www.w3.org/"):
                    continue
                return candidate

        return None

    def _parse_plan(self, source_path: Path) -> dict[str, object]:
        metadata = self._source_metadata(source_path)
        planner_path = source_path
        planner_mime = metadata["content_type"]
        converted_path: Path | None = None
        if source_path.suffix.lower() == ".xlsx":
            import tempfile
            converted_path = Path(tempfile.mkstemp(suffix=".json", prefix="checklist-xlsx-")[1])
            conversion = subprocess.run([sys.executable, str(self.service_root / "scripts" / "beckett_xlsx_to_panini_json.py"), str(source_path)], capture_output=True, text=True, check=False)
            if conversion.returncode != 0:
                raise RuntimeError(conversion.stderr.strip() or "XLSX checklist conversion failed.")
            converted_path.write_text(conversion.stdout, encoding="utf-8")
            planner_path = converted_path
            planner_mime = "application/json"
        node_bin = os.environ.get("INSTACOMP_NODE_BIN") or "/opt/homebrew/bin/node"
        if not Path(node_bin).exists():
            import shutil
            node_bin = shutil.which("node") or "node"
        result = subprocess.run(
            [
                node_bin,
                "--import",
                "tsx",
                str(self._planner_script()),
                "--source-file",
                str(planner_path),
                "--source-url",
                metadata["source_url"],
                "--original-filename",
                source_path.name,
                "--mime-type",
                planner_mime,
                "--retrieved-at",
                iso_now(),
                "--authority",
                "approved_reference_dataset",
                "--redistribution-allowed",
                "false",
            ],
            cwd=str(self.service_root.parents[1]),
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(
                result.stderr.strip()
                or result.stdout.strip()
                or "Checklist registry plan export failed."
            )
        payload = json.loads(result.stdout or "{}")
        if not isinstance(payload, dict) or not payload.get("ok"):
            raise RuntimeError(
                str(payload.get("error") or "Checklist registry plan export failed.")
            )
        plan = payload.get("plan")
        if not isinstance(plan, dict):
            raise RuntimeError("Checklist registry export returned no plan.")
        return plan

    def _release_id(self, plan: dict[str, object]) -> str:
        release = plan.get("release") if isinstance(plan, dict) else {}
        if not isinstance(release, dict):
            release = {}
        slug = str(release.get("releaseSlug") or release.get("release_slug") or "").strip()
        if not slug:
            slug = str(plan.get("adapterId") or "registry").strip()
        return f"release:{slug}"

    def _version_id(self, plan: dict[str, object]) -> str:
        release = plan.get("release") if isinstance(plan, dict) else {}
        if not isinstance(release, dict):
            release = {}
        slug = str(release.get("releaseSlug") or release.get("release_slug") or "").strip()
        if not slug:
            slug = str(plan.get("adapterId") or "registry").strip()
        return f"version:{slug}"

    def _set_id(self, card: dict[str, object], release_id: str) -> str:
        source_key = str(card.get("sourceKey") or card.get("source_key") or "").strip()
        return f"{release_id}:set:{source_key or 'unknown'}"

    def _card_id(self, card: dict[str, object], set_id: str) -> str:
        source_key = str(card.get("sourceKey") or card.get("source_key") or "").strip()
        return f"{set_id}:card:{source_key or 'unknown'}"

    def _card_players(self, card: dict[str, object]) -> str | None:
        players = card.get("players")
        if not isinstance(players, list):
            return None
        values = [
            str(player).strip()
            for player in players
            if str(player).strip()
        ]
        return " / ".join(values) if values else None

    def _card_teams(self, card: dict[str, object]) -> str | None:
        teams = card.get("teams")
        if not isinstance(teams, list):
            return None
        values = [
            str(team).strip()
            for team in teams
            if str(team).strip()
        ]
        return " / ".join(values) if values else None

    @staticmethod
    def _truthy_status(value: object) -> int:
        normalized = normalized_text(value)
        if normalized in {"auto", "autograph", "memorabilia", "relic", "true", "yes", "1"}:
            return 1
        return 0

    def _flatten_plan(
        self,
        source_sha256: str,
        source_url: str,
        source_name: str,
        target_key: str,
        plan: dict[str, object],
    ) -> list[dict[str, object]]:
        release = plan.get("release") if isinstance(plan, dict) else {}
        if not isinstance(release, dict):
            release = {}
        release_id = self._release_id(plan)
        version_id = self._version_id(plan)
        entries: list[dict[str, object]] = []
        cards = plan.get("cards") if isinstance(plan, dict) else []
        identities = plan.get("identities") if isinstance(plan, dict) else []
        sets = plan.get("sets") if isinstance(plan, dict) else []
        parallels = plan.get("parallels") if isinstance(plan, dict) else []
        if not isinstance(cards, list) or not isinstance(identities, list):
            return entries
        if not isinstance(sets, list) or not isinstance(parallels, list):
            return entries

        sets_by_source_key: dict[str, dict[str, object]] = {}
        for item in sets:
            if isinstance(item, dict):
                key = str(item.get("sourceKey") or item.get("source_key") or "").strip()
                if key:
                    sets_by_source_key[key] = item

        parallels_by_source_key: dict[str, dict[str, object]] = {}
        for item in parallels:
            if isinstance(item, dict):
                key = str(item.get("sourceKey") or item.get("source_key") or "").strip()
                if key:
                    parallels_by_source_key[key] = item

        identities_by_card: dict[str, list[dict[str, object]]] = {}
        for identity in identities:
            if not isinstance(identity, dict):
                continue
            card_key = str(identity.get("cardSourceKey") or identity.get("card_source_key") or "").strip()
            if not card_key:
                continue
            identities_by_card.setdefault(card_key, []).append(identity)

        for card in cards:
            if not isinstance(card, dict):
                continue
            card_source_key = str(card.get("sourceKey") or card.get("source_key") or "").strip()
            if not card_source_key:
                continue
            set_id = self._set_id(card, release_id)
            card_id = self._card_id(card, set_id)
            card_number = str(card.get("cardNumber") or card.get("card_number") or "").strip()
            normalized_number = normalized_card_number(card_number)
            if not normalized_number:
                continue
            players = self._card_players(card)
            teams = self._card_teams(card)
            set_entry = sets_by_source_key.get(str(card.get("setSourceKey") or card.get("set_source_key") or "").strip(), {})
            for identity in identities_by_card.get(card_source_key, []):
                fingerprint = str(
                    ((identity.get("fingerprint") or {}) if isinstance(identity.get("fingerprint"), dict) else {}).get("fingerprintSha256")
                    or identity.get("fingerprintSha256")
                    or ""
                ).strip().lower()
                if not fingerprint:
                    continue
                parallel_source_key = str(
                    identity.get("parallelSourceKey") or identity.get("parallel_source_key") or ""
                ).strip()
                parallel = parallels_by_source_key.get(parallel_source_key, {})
                parallel_name = str(parallel.get("name") or "").strip() or "Base"
                serial_run = parallel.get("serialRun") or parallel.get("serial_run")
                year = str(
                    release.get("releaseYear")
                    or release.get("release_year")
                    or release.get("season")
                    or ""
                ).strip() or None
                manufacturer = str(release.get("manufacturer") or "").strip() or None
                brand = str(release.get("brand") or "").strip() or None
                product = str(release.get("product") or release.get("product_name") or "").strip() or None
                sport = str(release.get("sport") or "").strip() or None
                league = str(release.get("league") or "").strip() or None
                set_name = str(
                    set_entry.get("name")
                    or card.get("setName")
                    or card.get("set_name")
                    or product
                    or ""
                ).strip() or None
                variation = str(identity.get("variation") or card.get("variation") or "").strip() or None
                autograph_status = self._truthy_status(
                    identity.get("autographStatus")
                    or card.get("autographStatus")
                    or card.get("autograph_status")
                )
                memorabilia_status = self._truthy_status(
                    identity.get("memorabiliaStatus")
                    or card.get("memorabiliaStatus")
                    or card.get("memorabilia_status")
                )
                identity_id = str(
                    uuid5(
                        NAMESPACE_URL,
                        f"{source_url}|{fingerprint}|{card_source_key}|{card_number}",
                    )
                )
                evidence = [
                    f"card number {card_number}",
                    f"player {players or 'unknown'}",
                    f"release {year or 'unknown'}",
                    f"manufacturer {manufacturer or 'unknown'}",
                    f"product {product or 'unknown'}",
                    f"set {set_name or 'unknown'}",
                    f"parallel {parallel_name or 'Base'}",
                ]
                entries.append(
                    {
                        "identity_id": identity_id,
                        "fingerprint_sha256": fingerprint,
                        "source_sha256": source_sha256,
                        "release_id": release_id,
                        "version_id": version_id,
                        "set_id": set_id,
                        "card_id": card_id,
                        "normalized_card_number": normalized_number,
                        "manufacturer": manufacturer,
                        "brand": brand,
                        "product": product,
                        "player": players,
                        "year": year,
                        "set_name": set_name,
                        "card_number": card_number,
                        "parallel": parallel_name,
                        "variation": variation,
                        "serial_run": int(serial_run) if str(serial_run or "").strip().isdigit() else None,
                        "team": teams,
                        "sport": sport,
                        "league": league,
                        "language_code": None,
                        "configuration_exclusivity": None,
                        "is_auto": autograph_status,
                        "is_relic": memorabilia_status,
                        "source_label": "InstaComp Mac Registry",
                        "score": 100,
                        "matched_evidence_json": json.dumps(evidence, sort_keys=True),
                        "active": 1,
                    }
                )
        return entries

    def sync_from_downloads(self) -> dict[str, int]:
        self.initialize()
        downloads_root = self._registry_source_downloads()
        if not downloads_root.is_dir():
            return {"imported": 0, "skipped": 0, "failed": 0}

        imported = 0
        skipped = 0
        failed = 0
        for source_path in sorted(downloads_root.rglob("*")):
            if not source_path.is_file():
                continue
            source_sha = __import__("hashlib").sha256(source_path.read_bytes()).hexdigest()
            with self.connection() as db:
                existing = db.execute(
                    "SELECT source_sha256, import_status FROM checklist_registry_imports WHERE source_sha256 = ?",
                    (source_sha,),
                ).fetchone()
            if existing and str(existing["import_status"]) == "imported":
                skipped += 1
                continue
            metadata = self._source_metadata(source_path)
            try:
                plan = self._parse_plan(source_path)
                flattened = self._flatten_plan(
                    source_sha,
                    metadata["source_url"],
                    metadata["source_name"],
                    source_path.stem[:120],
                    plan,
                )
                with self.connection() as db:
                    db.execute(
                        """
                        INSERT INTO checklist_registry_imports (
                            source_sha256, source_url, source_name, target_key,
                            source_path, authority, content_type, byte_count,
                            registry_receipt, imported_at, plan_json, import_status,
                            import_error
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(source_sha256) DO UPDATE SET
                            source_url = excluded.source_url,
                            source_name = excluded.source_name,
                            target_key = excluded.target_key,
                            source_path = excluded.source_path,
                            authority = excluded.authority,
                            content_type = excluded.content_type,
                            byte_count = excluded.byte_count,
                            registry_receipt = excluded.registry_receipt,
                            imported_at = excluded.imported_at,
                            plan_json = excluded.plan_json,
                            import_status = excluded.import_status,
                            import_error = excluded.import_error
                        """,
                        (
                            source_sha,
                            metadata["source_url"],
                            metadata["source_name"],
                            source_path.stem[:120],
                            str(source_path),
                            "approved_reference_dataset",
                            metadata["content_type"],
                            source_path.stat().st_size,
                            None,
                            iso_now(),
                            json.dumps(plan, sort_keys=True),
                            "imported",
                            None,
                        ),
                    )
                    db.execute(
                        "DELETE FROM checklist_registry_entries WHERE source_sha256 = ?",
                        (source_sha,),
                    )
                    db.executemany(
                        """
                        INSERT INTO checklist_registry_entries (
                            identity_id, fingerprint_sha256, source_sha256, release_id,
                            version_id, set_id, card_id, normalized_card_number,
                            manufacturer, brand, product, player, year, set_name,
                            card_number, parallel, variation, serial_run, team, sport,
                            league, language_code, configuration_exclusivity, is_auto,
                            is_relic, source_label, score, matched_evidence_json, active
                        ) VALUES (
                            :identity_id, :fingerprint_sha256, :source_sha256,
                            :release_id, :version_id, :set_id, :card_id,
                            :normalized_card_number, :manufacturer, :brand, :product,
                            :player, :year, :set_name, :card_number, :parallel,
                            :variation, :serial_run, :team, :sport, :league,
                            :language_code, :configuration_exclusivity, :is_auto,
                            :is_relic, :source_label, :score, :matched_evidence_json,
                            :active
                        )
                        """,
                        flattened,
                    )
                imported += 1
            except Exception as error:
                message = str(error)
                unsupported_adapter = "No Checklist Registry adapter supports" in message
                if unsupported_adapter:
                    skipped += 1
                else:
                    failed += 1
                with self.connection() as db:
                    db.execute(
                        """
                        INSERT INTO checklist_registry_imports (
                            source_sha256, source_url, source_name, target_key,
                            source_path, authority, content_type, byte_count,
                            registry_receipt, imported_at, plan_json, import_status,
                            import_error
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(source_sha256) DO UPDATE SET
                            source_url = excluded.source_url,
                            source_name = excluded.source_name,
                            target_key = excluded.target_key,
                            source_path = excluded.source_path,
                            authority = excluded.authority,
                            content_type = excluded.content_type,
                            byte_count = excluded.byte_count,
                            registry_receipt = excluded.registry_receipt,
                            imported_at = excluded.imported_at,
                            plan_json = excluded.plan_json,
                            import_status = excluded.import_status,
                            import_error = excluded.import_error
                        """,
                        (
                            source_sha,
                            metadata["source_url"],
                            metadata["source_name"],
                            source_path.stem[:120],
                            str(source_path),
                            "approved_reference_dataset",
                            metadata["content_type"],
                            source_path.stat().st_size,
                            None,
                            iso_now(),
                            "{}",
                            "skipped" if unsupported_adapter else "failed",
                            message[:1000],
                        ),
                    )

        return {"imported": imported, "skipped": skipped, "failed": failed}

    def ensure_seeded(self) -> None:
        # The Registry is populated transactionally by Sentinel/import jobs.
        # A scan-time lookup must never rescan/reparse the entire downloads tree;
        # that made the first user lookup block the API for seconds/time out.
        with self._seed_lock:
            if self._seeded:
                return
            self.initialize()
            self._seeded = True

    def _row_to_candidate(self, row: sqlite3.Row) -> dict[str, object]:
        return {
            "identityId": row["identity_id"],
            "fingerprintSha256": row["fingerprint_sha256"],
            "year": row["year"],
            "manufacturer": row["manufacturer"],
            "brand": row["brand"],
            "product": row["product"],
            "setName": row["set_name"],
            "cardNumber": row["card_number"],
            "player": row["player"],
            "serialRun": row["serial_run"],
            "isAuto": bool(row["is_auto"]),
            "isRelic": bool(row["is_relic"]),
            "parallel": row["parallel"],
            "variation": row["variation"],
            "team": row["team"],
            "sport": row["sport"],
            "league": row["league"],
        }

    def _matches_required_set(self, ai: dict[str, object], row: sqlite3.Row) -> bool:
        target_year = year_start(ai.get("year"))
        target_brand = normalized_text(ai.get("brand") or ai.get("manufacturer"))
        target_set = normalized_text(ai.get("setName"))
        if not target_year or not target_brand or not target_set:
            return False
        row_year = year_start(row["year"] or row["card_number"] or "")
        if row_year != target_year:
            return False
        row_brand = normalized_text(" ".join(
            str(value or "") for value in [row["manufacturer"], row["brand"], row["product"]]
        ))
        if not row_brand:
            return False
        if not (
            row_brand == target_brand
            or row_brand in target_brand
            or target_brand in row_brand
        ):
            return False
        # Product/release and subset are independent identity dimensions.
        # Accept the requested set hint if it matches either one; never compare
        # against a synthetic concatenation of subset + product + brand.
        row_set_name = normalized_text(row["set_name"])
        row_product = normalized_text(row["product"])
        row_brand_name = normalized_text(row["brand"])
        return any(
            value and (value == target_set or value in target_set or target_set in value)
            for value in (row_set_name, row_product, row_brand_name)
        )

    def _exact_row_match(self, ai: dict[str, object], row: sqlite3.Row) -> bool:
        target_card = normalized_card_number(ai.get("cardNumber"))
        if target_card != row["normalized_card_number"]:
            return False
        target_serial = serial_denominator(ai.get("serialNumber")); raw_run = ai.get("serialRun"); serial = serial or (int(raw_run) if str(raw_run or "").isdigit() else serial_denominator(raw_run))
        row_serial = row["serial_run"]
        # An explicit visible /N stamp is a hard physical-card fact. A Registry
        # row with no serial run cannot satisfy it; otherwise a numbered card
        # could incorrectly collapse onto an unnumbered Base identity.
        if target_serial is not None:
            if row_serial is None or int(row_serial) != int(target_serial):
                return False
        if normalized_text(ai.get("player")) and normalized_text(ai.get("player")) != normalized_text(row["player"]):
            return False
        if normalized_text(ai.get("parallel")):
            target_parallel = normalized_text(ai.get("parallel"))
            row_parallel = normalized_text(row["parallel"])
            row_set_name = normalized_text(row["set_name"])
            # Normalized publisher layouts sometimes encode tier + parallel in
            # the parallel field ("Set - Premier Level - Silver") while base
            # rows keep the tier in set_name. Accept the visible parallel when
            # it is an exact token/suffix of that canonicalized value.
            if target_parallel != row_parallel:
                parts = [part.strip() for part in row_parallel.split(" - ") if part.strip()]
                # Publishers inconsistently pluralize the family suffix
                # (Silver vs Silver Prizm/Prizms). Treat that suffix as family
                # metadata while preserving the actual color/pattern token.
                def parallel_core(value: str) -> str:
                    return re.sub(r"\s+prizms?$", "", value).strip()
                target_core = parallel_core(target_parallel)
                part_cores = [parallel_core(part) for part in parts]
                row_core = parallel_core(row_parallel)
                if target_core != row_core and target_core not in part_cores:
                    return False
        if normalized_text(ai.get("subset")):
            target_subset = normalized_text(ai.get("subset"))
            row_subset = normalized_text(row["set_name"])
            # Subset/insert text is a separate hard identity dimension from the
            # release product. A visible Fractal/Fireworks/etc. label must narrow
            # the Registry row rather than being ignored after product match.
            if not row_subset or not (
                row_subset == target_subset
                or row_subset.startswith(target_subset + " ")
                or target_subset.startswith(row_subset + " ")
            ):
                return False
        if normalized_text(ai.get("variation")) and normalized_text(ai.get("variation")) != normalized_text(row["variation"]):
            return False
        # Boolean card facts are authoritative when the caller actually supplies them.
        # Previously isAuto/isRelic were ignored, so a visible relic/auto fact could
        # not narrow an otherwise identical checklist identity.
        if isinstance(ai.get("isAuto"), bool) and bool(row["is_auto"]) != ai.get("isAuto"):
            return False
        if isinstance(ai.get("isRelic"), bool) and bool(row["is_relic"]) != ai.get("isRelic"):
            return False
        if normalized_text(ai.get("team")) and normalized_text(ai.get("team")) != normalized_text(row["team"]):
            return False
        if normalized_text(ai.get("sport")) and normalized_text(ai.get("sport")) != normalized_text(row["sport"]):
            return False
        if normalized_text(ai.get("league")) and normalized_text(ai.get("league")) != normalized_text(row["league"]):
            return False
        if normalized_text(ai.get("manufacturer")):
            target = normalized_text(ai.get("manufacturer"))
            row_brand = normalized_text(" ".join(str(value or "") for value in [row["manufacturer"], row["brand"], row["product"]]))
            if not (row_brand == target or row_brand in target or target in row_brand):
                return False
        if normalized_text(ai.get("brand")):
            target = normalized_text(ai.get("brand"))
            row_brand = normalized_text(" ".join(str(value or "") for value in [row["manufacturer"], row["brand"], row["product"]]))
            if not (row_brand == target or row_brand in target or target in row_brand):
                return False
        if normalized_text(ai.get("setName")):
            target = normalized_text(ai.get("setName"))
            # setName may be the release/product (e.g. Select WNBA) OR the
            # checklist subset/tier (e.g. All-Stars / Base Set - Premier Level).
            # Match either field independently; concatenating product+subset made
            # exact subset evidence impossible to satisfy.
            row_set_name = normalized_text(row["set_name"])
            row_product = normalized_text(row["product"])
            row_brand = normalized_text(row["brand"])
            if not any(
                value and (value == target or value in target or target in value)
                for value in (row_set_name, row_product, row_brand)
            ):
                return False
        target_year = year_start(ai.get("year"))
        if target_year and year_start(row["year"] or "") != target_year:
            return False
        return True

    def visible_candidates(self, ai: dict[str, object]) -> list[dict[str, object]]:
        """Return legal Registry rows from hard visible facts before parallel guessing."""
        self.initialize()
        card = normalized_card_number(ai.get("cardNumber")); year = year_start(ai.get("year"))
        player = normalized_text(ai.get("player")); maker = normalized_text(ai.get("brand") or ai.get("manufacturer"))
        if not all([card, year, player, maker]): return []
        with self.connection() as db:
            rows = db.execute("SELECT * FROM checklist_registry_entries WHERE active=1 AND normalized_card_number=? AND year=? AND lower(player)=? AND (lower(brand)=? OR lower(manufacturer)=?)", (card, year, player, maker, maker)).fetchall()
        set_name = normalized_text(ai.get("setName")); subset = normalized_text(ai.get("subset")); serial = serial_denominator(ai.get("serialNumber")); raw_run = ai.get("serialRun"); serial = serial or (int(raw_run) if str(raw_run or "").isdigit() else serial_denominator(raw_run))
        legal = []
        for row in rows:
            if set_name and not self._matches_required_set(ai, row): continue
            if subset and subset not in normalized_text(row["set_name"]) and subset not in normalized_text(row["parallel"]): continue
            if serial is not None and int(row["serial_run"] or 0) != serial: continue
            legal.append(dict(row))
        return legal

    def resolve(self, ai: dict[str, object]) -> dict[str, object]:
        self.ensure_seeded()
        year = year_start(ai.get("year"))
        # Local vision frequently reads the publisher/manufacturer but not a
        # separate brand logo. Manufacturer is valid release-family evidence
        # for Registry narrowing; do not throw away otherwise exact scans.
        brand = normalized_text(ai.get("brand") or ai.get("manufacturer"))
        set_name = normalized_text(ai.get("setName"))
        card_number = normalized_card_number(ai.get("cardNumber"))
        player = normalized_text(ai.get("player"))
        if not year or not brand or not set_name or not card_number or not player:
            return {
                "status": "input_incomplete",
                "match": None,
                "reasons": ["missing_or_uncertain_visible_set_identity_evidence"],
                "candidateCount": 0,
                "coveredReleaseIds": [],
                "coveredVersionIds": [],
                "coveredSetIds": [],
                "sourceTier": "none",
                "externalLookupEligible": False,
                "externalLookupAttempted": False,
            }

        with self.connection() as db:
            # Push high-selectivity visible evidence into SQLite before the
            # Python exact-match pass. Card numbers such as 3/6/13 occur across
            # thousands of identities, so filtering player/brand/year here is
            # dramatically cheaper than materializing every same-number row.
            candidate_rows = db.execute(
                """
                SELECT * FROM checklist_registry_entries
                WHERE active = 1
                  AND normalized_card_number = ?
                  AND year LIKE ?
                  AND lower(coalesce(player, '')) = ?
                  AND (
                    lower(coalesce(brand, '')) = ?
                    OR lower(coalesce(manufacturer, '')) = ?
                    OR lower(coalesce(product, '')) LIKE ?
                  )
                ORDER BY identity_id
                """,
                (card_number, f"{year}%", player, brand, brand, f"%{brand}%"),
            ).fetchall()
            scoped_rows = [row for row in candidate_rows if self._matches_required_set(ai, row)]
            if not scoped_rows:
                has_set_scope = db.execute(
                    """
                    SELECT 1 FROM checklist_registry_entries
                    WHERE active = 1
                      AND lower(coalesce(year, '')) LIKE ?
                      AND (
                        lower(coalesce(manufacturer, '')) LIKE ?
                        OR lower(coalesce(brand, '')) LIKE ?
                        OR lower(coalesce(product, '')) LIKE ?
                      )
                      AND (
                        lower(coalesce(product, '')) LIKE ?
                        OR lower(coalesce(set_name, '')) LIKE ?
                        OR lower(coalesce(brand, '')) LIKE ?
                      )
                    LIMIT 1
                    """,
                    (
                        f"{year}%",
                        f"%{brand}%",
                        f"%{brand}%",
                        f"%{brand}%",
                        f"%{set_name}%",
                        f"%{set_name}%",
                        f"%{set_name}%",
                    ),
                ).fetchone()
                if has_set_scope:
                    return {
                        "status": "internal_set_present_no_exact_match",
                        "match": None,
                        "reasons": ["internal_set_present_but_card_number_not_found"],
                        "candidateCount": 0,
                        "coveredReleaseIds": unique([row["release_id"] for row in candidate_rows]),
                        "coveredVersionIds": unique([row["version_id"] for row in candidate_rows]),
                        "coveredSetIds": unique([row["set_id"] for row in candidate_rows]),
                        "sourceTier": "internal",
                        "externalLookupEligible": False,
                        "externalLookupAttempted": False,
                    }
                return {
                    "status": "internal_set_absent",
                    "match": None,
                    "reasons": ["internal_checklist_does_not_contain_this_particular_set"],
                    "candidateCount": 0,
                    "coveredReleaseIds": [],
                    "coveredVersionIds": [],
                    "coveredSetIds": [],
                    "sourceTier": "none",
                    "externalLookupEligible": False,
                    "externalLookupAttempted": False,
                }

            exact_rows = [row for row in scoped_rows if self._exact_row_match(ai, row)]
            if len(exact_rows) == 1:
                match = self._row_to_candidate(exact_rows[0])
                match["sourceLabel"] = "InstaComp Mac Registry"
                match["score"] = 100
                match["matchedEvidence"] = json.loads(exact_rows[0]["matched_evidence_json"])
                return {
                    "status": "internal_exact_match",
                    "match": match,
                    "reasons": ["one_internal_checklist_identity_matches_all_available_visible_evidence"],
                    "candidateCount": 1,
                    "coveredReleaseIds": unique([row["release_id"] for row in scoped_rows]),
                    "coveredVersionIds": unique([row["version_id"] for row in scoped_rows]),
                    "coveredSetIds": unique([row["set_id"] for row in scoped_rows]),
                    "sourceTier": "internal",
                    "externalLookupEligible": False,
                    "externalLookupAttempted": False,
                }

            return {
                "status": "internal_set_present_no_exact_match",
                "match": None,
                "reasons": [
                    "internal_set_present_but_no_unique_identity_matches_every_visible_fact"
                ],
                "candidateCount": len(scoped_rows),
                "coveredReleaseIds": unique([row["release_id"] for row in scoped_rows]),
                "coveredVersionIds": unique([row["version_id"] for row in scoped_rows]),
                "coveredSetIds": unique([row["set_id"] for row in scoped_rows]),
                "sourceTier": "internal",
                "externalLookupEligible": False,
                "externalLookupAttempted": False,
            }

    def revalidate_receipt(
        self,
        ai: dict[str, object],
        identity_id: str,
        fingerprint_sha256: str,
    ) -> dict[str, object] | None:
        self.ensure_seeded()
        with self.connection() as db:
            row = db.execute(
                "SELECT * FROM checklist_registry_entries WHERE identity_id = ? AND active = 1",
                (identity_id,),
            ).fetchone()
        if row is None:
            return None
        if str(row["fingerprint_sha256"]).lower() != fingerprint_sha256.lower():
            return None
        if not self._exact_row_match(ai, row):
            return None
        match = self._row_to_candidate(row)
        match["sourceLabel"] = "InstaComp Mac Registry"
        match["score"] = 100
        match["matchedEvidence"] = json.loads(row["matched_evidence_json"])
        return {
            "status": "internal_exact_match",
            "match": match,
            "reasons": ["current_registry_revalidated_exact_mac_identity_receipt_against_visible_evidence"],
            "candidateCount": 1,
            "coveredReleaseIds": [row["release_id"]],
            "coveredVersionIds": [row["version_id"]],
            "coveredSetIds": [row["set_id"]],
            "sourceTier": "internal",
            "externalLookupEligible": False,
            "externalLookupAttempted": False,
        }
