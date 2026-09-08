from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import sys
import unicodedata
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
    # OCR may preserve accents/diacritics that checklist publishers omit.
    # Identity matching is accent-insensitive while stored display text remains untouched.
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return " ".join(text.strip().lower().split())


def normalized_card_number(value: object) -> str:
    return normalized_text(value).replace(" ", "").replace("-", "")


def _strip_player_metadata(value: object) -> str:
    """Remove checklist descriptors that are not part of a printed player name."""
    text = str(value or "").strip()
    if not text:
        return ""
    # Inscription/date + print-run suffixes: Riley Damiani “12/14/21” /50.
    text = re.sub(
        r"\s+[\"'“”]?\d{1,2}/\d{1,2}/\d{2,4}[\"'“”]?(?:\s*/\s*\d{1,6})?(?:\s+(?:RC|ROOKIE|AUTO|AUTOGRAPH))*\s*$",
        "", text, flags=re.I,
    ).strip()
    # Print-run/config suffixes: Riley Damiani /999 AUTO or /999 RC AUTO.
    text = re.sub(
        r"\s*/\s*\d{1,6}(?:\s+(?:RC|ROOKIE|AUTO|AUTOGRAPH))*\s*$",
        "", text, flags=re.I,
    ).strip()
    # Bare trailing config labels are metadata too, not player identity.
    text = re.sub(r"(?:\s+(?:RC|ROOKIE|AUTO|AUTOGRAPH))+$", "", text, flags=re.I).strip()
    return text


def normalized_player_identity(value: object) -> str:
    return normalized_text(_strip_player_metadata(value))


def _prefer_exact_set_family(rows, target_set: object):
    """Prefer an exact legal set family over substring/prefix sibling families.

    Composite product hints still fall back to broader token matching when no
    Registry set_name equals the target. This prevents a proven family such as
    New Grooves from also admitting New Grooves Jersey merely by containment.
    """
    target = normalized_text(target_set)
    if not target:
        return rows
    exact = [row for row in rows if normalized_text(row["set_name"]) == target]
    return exact or rows


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
    # A slash stamp is numerator/denominator; Registry matching needs the
    # denominator (the print run), not the card's copy number. 23/25 => 25.
    match = re.search(r"^(?:\d{1,6})/(\d{1,6})$", normalized)
    if match:
        return int(match.group(1))
    match = re.search(r"(?:^|/)(\d{1,6})\b", normalized)
    return int(match.group(1)) if match else None


def year_start(value: object) -> str:
    match = __import__("re").search(r"\b((?:18|19|20)\d{2})\b", normalized_text(value))
    return match.group(1) if match else ""


def canonical_registry_brand(brand: object, product: object) -> str | None:
    """Prefer the concrete product family over contradictory weak source brand metadata."""
    current = str(brand or "").strip() or None
    product_norm = normalized_text(product)
    families = (
        ("prizm", "Prizm"),
        ("select", "Select"),
        ("donruss", "Donruss"),
        ("optic", "Optic"),
        ("mosaic", "Mosaic"),
        ("score", "Score"),
    )
    for token, display in families:
        if re.search(rf"\b{re.escape(token)}\b", product_norm):
            return display
    return current


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

                CREATE TABLE IF NOT EXISTS checklist_registry_supplements (
                    supplement_id TEXT PRIMARY KEY,
                    identity_id TEXT NOT NULL,
                    target_key TEXT NOT NULL,
                    evidence_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    active INTEGER NOT NULL DEFAULT 1
                );
                CREATE INDEX IF NOT EXISTS checklist_registry_supplement_identity_idx
                    ON checklist_registry_supplements(identity_id, active);
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
        values = []
        for player in players:
            value = str(player).strip()
            if not value:
                continue
            # Event checklists often append roster-side metadata to the player
            # name (e.g. "Kiki Rice - East"). That is not part of the printed
            # player identity and would make exact OCR matching impossible.
            value = re.sub(r"\s+-\s+(?:East|West)\s*$", "", value, flags=re.I).strip()
            value = _strip_player_metadata(value)
            if value:
                values.append(value)
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
                raw_brand = str(release.get("brand") or "").strip() or None
                product = str(release.get("product") or release.get("product_name") or "").strip() or None
                brand = canonical_registry_brand(raw_brand, product)
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


    def insert_supplemental_identity(
        self,
        *,
        template_row: object,
        player: str,
        card_number: str,
        parallel: str,
        serial_run: int | None,
        evidence: list[dict[str, object]],
        target_key: str,
        variation: str | None = None,
        team: str | None = None,
        is_auto: bool = False,
        is_relic: bool = False,
    ) -> dict[str, object]:
        """Add one corroborated card omitted from an otherwise trusted release."""
        self.initialize()
        row = template_row
        normalized_number = normalized_card_number(card_number)
        if not normalized_number or not str(player or "").strip():
            raise ValueError("supplement requires player and card number")
        base_release_id = str(row["release_id"] or "")
        if not base_release_id:
            raise ValueError("supplement template is missing release_id")
        supplement_release_id = base_release_id + ":gap-supplement"
        evidence_payload = {
            "kind": "exact-card-gap",
            "base_release_id": base_release_id,
            "sources": evidence,
            "target_key": target_key,
        }
        evidence_json = json.dumps(evidence_payload, sort_keys=True, ensure_ascii=False)
        hashlib = __import__("hashlib")
        source_sha = hashlib.sha256(evidence_json.encode("utf-8")).hexdigest()
        canonical = {
            "release": base_release_id,
            "set": str(row["set_name"] or ""),
            "card": normalized_number,
            "player": normalized_text(player),
            "parallel": normalized_text(parallel or "Base"),
            "variation": normalized_text(variation),
            "serial_run": serial_run,
        }
        fingerprint = hashlib.sha256(json.dumps(canonical, sort_keys=True).encode("utf-8")).hexdigest()
        identity_id = str(uuid5(NAMESPACE_URL, f"instacomp-gap|{fingerprint}"))
        set_id = str(row["set_id"] or "")
        card_id = str(uuid5(NAMESPACE_URL, f"{set_id}|gap|{normalized_number}|{normalized_text(player)}"))
        supplement_id = str(uuid5(NAMESPACE_URL, f"supplement|{identity_id}|{source_sha}"))
        entry = {
            "identity_id": identity_id, "fingerprint_sha256": fingerprint,
            "source_sha256": source_sha, "release_id": supplement_release_id,
            "version_id": str(row["version_id"] or "") + ":gap",
            "set_id": set_id, "card_id": card_id,
            "normalized_card_number": normalized_number,
            "manufacturer": row["manufacturer"], "brand": row["brand"],
            "product": row["product"], "player": player, "year": row["year"],
            "set_name": row["set_name"], "card_number": card_number,
            "parallel": parallel or "Base", "variation": variation,
            "serial_run": serial_run, "team": team, "sport": row["sport"],
            "league": row["league"], "language_code": None,
            "configuration_exclusivity": None, "is_auto": int(bool(is_auto)),
            "is_relic": int(bool(is_relic)),
            "source_label": "InstaComp Registry Gap Supplement", "score": 96,
            "matched_evidence_json": evidence_json, "active": 1,
        }
        with self.connection() as db:
            official = db.execute(
                """SELECT identity_id FROM checklist_registry_entries WHERE active=1
                AND source_label != 'InstaComp Registry Gap Supplement'
                AND year=? AND normalized_card_number=? AND lower(player)=lower(?)
                AND lower(coalesce(set_name,''))=lower(?) AND lower(coalesce(parallel,'Base'))=lower(?)
                AND lower(coalesce(variation,''))=lower(coalesce(?,''))
                AND coalesce(serial_run,-1)=coalesce(?,-1)
                AND lower(coalesce(league,''))=lower(?) LIMIT 1""",
                (row["year"], normalized_number, player, str(row["set_name"] or ""), parallel or "Base", variation, serial_run, str(row["league"] or "")),
            ).fetchone()
            if official:
                return {"inserted": False, "identity_id": str(official["identity_id"]), "reason": "official_identity_already_present"}
            columns = list(entry.keys())
            db.execute(
                f"INSERT OR IGNORE INTO checklist_registry_entries ({','.join(columns)}) VALUES ({','.join(':'+c for c in columns)})",
                entry,
            )
            db.execute(
                "INSERT OR REPLACE INTO checklist_registry_supplements (supplement_id,identity_id,target_key,evidence_json,created_at,active) VALUES (?,?,?,?,?,1)",
                (supplement_id, identity_id, target_key, evidence_json, iso_now()),
            )
        return {"inserted": True, "identity_id": identity_id, "fingerprint_sha256": fingerprint, "release_id": supplement_release_id}

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
                    # Import rows one at a time so duplicate fingerprints can be
                    # classified safely. Equivalent identities are idempotent; a
                    # fingerprint attached to contradictory identity fields is a
                    # hard integrity failure and the whole source transaction rolls back.
                    for entry in flattened:
                        existing = db.execute(
                            "SELECT * FROM checklist_registry_entries WHERE fingerprint_sha256 = ?",
                            (entry["fingerprint_sha256"],),
                        ).fetchone()
                        if existing is not None:
                            identity_fields = (
                                "normalized_card_number", "manufacturer", "brand", "product",
                                "player", "year", "set_name", "parallel", "variation",
                                "serial_run", "team", "sport", "league", "is_auto", "is_relic",
                            )
                            conflicts = [
                                field for field in identity_fields
                                if normalized_text(existing[field]) != normalized_text(entry.get(field))
                            ]
                            if conflicts:
                                raise RuntimeError(
                                    "Registry fingerprint integrity conflict for "
                                    f"{entry['fingerprint_sha256']}: contradictory fields "
                                    + ",".join(conflicts)
                                )
                            continue
                        db.execute(
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
                        entry,
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
        target_brand = normalized_text(ai.get("brand"))
        target_manufacturer = normalized_text(ai.get("manufacturer"))
        for token in ("prizm", "select", "donruss", "mosaic", "origins", "impeccable", "optic"):
            if token in target_brand.split():
                target_brand = token
                break
        if target_brand in {"panini", "topps", "upper deck", "leaf"} and not target_manufacturer:
            target_manufacturer, target_brand = target_brand, ""
        target_set = normalized_text(ai.get("setName"))
        target_subset = normalized_text(ai.get("subset"))
        if not target_year or not (target_brand or target_manufacturer) or not target_set:
            return False
        row_year = year_start(row["year"] or row["card_number"] or "")
        if row_year != target_year:
            return False
        row_brand = normalized_text(" ".join(
            str(value or "") for value in [row["manufacturer"], row["brand"], row["product"]]
        ))
        if not row_brand:
            return False
        row_manufacturer = normalized_text(row["manufacturer"])
        row_concrete_brand = normalized_text(row["brand"])
        row_product_name = normalized_text(row["product"])
        publisher_names = {"panini", "topps", "upper deck", "leaf"}
        if target_brand and target_brand not in publisher_names:
            # Once a concrete product brand is visible, publisher equality must
            # not broaden the match back to every Panini/Topps product.
            brand_match = row_concrete_brand == target_brand or target_brand in row_product_name
            if not brand_match:
                return False
        else:
            brand_match = bool(target_brand) and (row_brand == target_brand or row_brand in target_brand or target_brand in row_brand)
            manufacturer_match = bool(target_manufacturer) and row_manufacturer == target_manufacturer
            if not (brand_match or manufacturer_match):
                return False
        # Product/release and subset are independent identity dimensions.
        row_set_name = normalized_text(row["set_name"])
        row_product = normalized_text(row["product"])
        row_brand_name = normalized_text(row["brand"])
        # Composite visible hints ("Panini Prizm WNBA") must match the concrete
        # Registry family token ("Prizm") without requiring publisher/league
        # words to be duplicated in product. Token containment remains bounded by
        # the already-proven year/brand/player/card number.
        target_tokens = {t for t in target_set.split() if t not in {"panini", "topps", "upper", "deck", "wnba", "nba", "basketball", "cards", "trading"}}
        if target_brand == "donruss" and target_set not in {"donruss", "donruss wnba", "panini donruss wnba"}:
            # Donruss sibling checklist families (Rated Rookies, Rated Rookies
            # Holo, Rated Rookies Signatures) are distinct identities. A physical
            # family read is exact and must not collapse by token containment.
            release_match = row_set_name == target_set
        elif target_brand == "select" and target_subset and any(t in target_subset for t in ("concourse", "premier", "courtside")):
            # Select tier lives in either set_name (plain Base) or the parallel
            # label (all parallel rows). Product identity + subset tokens below
            # provide the exact logical family.
            release_match = row_brand_name == "select" or "select" in row_product
        else:
            release_match = any(
                value and (
                    value == target_set or value in target_set or target_set in value
                    or (target_tokens and target_tokens.issubset(set(value.split())))
                )
                for value in (row_set_name, row_product, row_brand_name)
            )
        if not release_match:
            return False
        if target_subset:
            row_scope = " ".join(normalized_text(row[field]) for field in ("set_name", "parallel", "variation"))
            subset_tokens = [token for token in target_subset.split() if token not in {"base", "set"}]
            if subset_tokens and not all(token in row_scope for token in subset_tokens):
                return False
        return True

    def _exact_row_match(self, ai: dict[str, object], row: sqlite3.Row) -> bool:
        target_card = normalized_card_number(ai.get("cardNumber"))
        if target_card != row["normalized_card_number"]:
            return False
        # Exact means the already-recovered set/subset must also agree. Without
        # this guard, sibling Select inserts sharing player/card number (for
        # example Color Wheel, Selective Swatches, and Score Throwback #3) all
        # counted as exact and could either block or drift the physical identity.
        if normalized_text(ai.get("setName")) and not self._matches_required_set(ai, row):
            return False
        target_serial = serial_denominator(ai.get("serialNumber")); raw_run = ai.get("serialRun"); target_serial = target_serial or (int(raw_run) if str(raw_run or "").isdigit() else serial_denominator(raw_run))
        row_serial = row["serial_run"]
        # An explicit visible /N stamp is a hard physical-card fact. A Registry
        # row with no serial run cannot satisfy it; otherwise a numbered card
        # could incorrectly collapse onto an unnumbered Base identity.
        if target_serial is not None:
            if row_serial is None or int(row_serial) != int(target_serial):
                return False
        elif row_serial is not None:
            # Numbered parallels require a physically observed denominator.
            # Color/pattern, stale memory, or Registry uniqueness may not invent /N.
            return False
        if normalized_player_identity(ai.get("player")) and normalized_player_identity(ai.get("player")) != normalized_player_identity(row["player"]):
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
                    value = re.sub(r"^prizms?\s+", "", value).strip()
                    return re.sub(r"\s+prizms?$", "", value).strip()
                target_core = parallel_core(target_parallel)
                part_cores = [parallel_core(part) for part in parts]
                row_core = parallel_core(row_parallel)
                if target_core != row_core and target_core not in part_cores:
                    return False
        if normalized_text(ai.get("subset")):
            target_subset = normalized_text(ai.get("subset"))
            row_scope = " ".join(normalized_text(row[field]) for field in ("set_name", "parallel", "variation"))
            # Publisher exports sometimes encode tier/subset in the parallel
            # label (e.g. Set - Concourse - Orange Flash). Use the same token
            # semantics as visible_candidates instead of requiring set_name alone.
            subset_tokens = [token for token in target_subset.split() if token not in {"base", "set"}]
            if subset_tokens and not all(token in row_scope for token in subset_tokens):
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
            for token in ("prizm", "select", "donruss", "mosaic", "origins", "impeccable", "optic"):
                if token in target.split():
                    target = token
                    break
            row_brand = normalized_text(" ".join(str(value or "") for value in [row["manufacturer"], row["brand"], row["product"]]))
            if not (row_brand == target or row_brand in target or target in row_brand):
                return False
        if normalized_text(ai.get("setName")):
            target = normalized_text(ai.get("setName"))
            # setName may be a composite visible release hint (Panini Prizm WNBA)
            # while Registry stores brand/product as simply Prizm. Match bounded
            # significant tokens after year/player/card/brand have already scoped
            # the row; subset remains an independent check above.
            row_set_name = normalized_text(row["set_name"])
            row_product = normalized_text(row["product"])
            row_brand = normalized_text(row["brand"])
            target_tokens = {t for t in target.split() if t not in {"panini", "topps", "upper", "deck", "wnba", "nba", "basketball", "cards", "trading"}}
            if not any(
                value and (
                    value == target or value in target or target in value
                    or (target_tokens and target_tokens.issubset(set(value.split())))
                )
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
        player = normalized_player_identity(ai.get("player")); brand = normalized_text(ai.get("brand")); manufacturer = normalized_text(ai.get("manufacturer"))
        for token in ("prizm", "select", "donruss", "mosaic", "origins", "impeccable", "optic"):
            if token in brand.split():
                brand = token
                break
        if not all([card, year, player]) or not (brand or manufacturer): return []
        # A bare publisher name (Panini/Topps/Upper Deck) is not a product brand.
        # Treat it as manufacturer evidence so Select/Prizm/Origins rows remain
        # eligible for the subsequent set/subset narrowing.
        publisher_names = {"panini", "topps", "upper deck", "leaf"}
        if brand in publisher_names and not manufacturer:
            manufacturer, brand = brand, ""
        # Brand/product OCR and manufacturer are independent narrowing evidence.
        # Do not let a composite product hint ("Panini Prizm WNBA") hide an exact
        # manufacturer match ("Panini"). Set/subset filtering below still keeps
        # this bounded to the visible card family.
        with self.connection() as db:
            rows = db.execute("SELECT * FROM checklist_registry_entries WHERE active=1 AND normalized_card_number=? AND year=? AND ((? <> '' AND lower(brand)=?) OR (? <> '' AND lower(manufacturer)=?) OR (? <> '' AND (lower(product)=? OR lower(product) LIKE ?)))", (card, year, brand, brand, manufacturer, manufacturer, brand, brand, f"%{brand}%" if brand else "")).fetchall()
        # A concrete product brand must beat broad publisher/manufacturer evidence.
        # Previously brand=Select/Prizm plus manufacturer=Panini admitted every
        # Panini product sharing the same card number and polluted player/set repair.
        if brand and brand not in publisher_names:
            branded = [row for row in rows if normalized_text(row["brand"]) == brand or brand in normalized_text(row["product"])]
            if branded:
                rows = branded
        set_name = normalized_text(ai.get("setName")); subset = normalized_text(ai.get("subset")); target_parallel = normalized_text(ai.get("parallel")); serial = serial_denominator(ai.get("serialNumber")); raw_run = ai.get("serialRun"); serial = serial or (int(raw_run) if str(raw_run or "").isdigit() else serial_denominator(raw_run))
        legal = []
        for row in rows:
            # SQLite lower() is ASCII-only. Compare player names in Python with
            # normalized_text() so OCR accents such as KAMİLLA do not miss an
            # otherwise exact Registry row.
            if normalized_player_identity(row["player"]) != player: continue
            # Configuration facts must narrow the legal treatment family before
            # any finish model sees candidates. Otherwise an auto scan can be
            # shown non-auto parallels (and vice versa), producing a legal-looking
            # but physically impossible finish choice.
            if isinstance(ai.get("isAuto"), bool) and bool(row["is_auto"]) != ai.get("isAuto"): continue
            if isinstance(ai.get("isRelic"), bool) and bool(row["is_relic"]) != ai.get("isRelic"): continue
            if set_name:
                row_set = normalized_text(row["set_name"]); row_product = normalized_text(row["product"]); row_brand = normalized_text(row["brand"])
                # Donruss insert names are sibling checklist families. A physical
                # Rated Rookies read must not also admit Rated Rookies Holo or
                # Rated Rookies Signatures just because their tokens overlap.
                if brand == "donruss" and set_name not in {"donruss", "donruss wnba", "panini donruss wnba"}:
                    if row_set != set_name:
                        continue
                # Select base tiers are split across Registry representation:
                # parallels live under set_name=Base while the plain base row is
                # Base Set - Concourse/Premier/Courtside. The subset/tier filter
                # below is the correct discriminator, so do not reject either.
                elif brand == "select" and subset and any(t in subset for t in ("concourse", "premier", "courtside")):
                    pass
                else:
                    target_tokens = {t for t in set_name.split() if t not in {"panini", "topps", "upper", "deck", "wnba", "nba", "basketball", "cards", "trading"}}
                    if not any(v and (v == set_name or v in set_name or set_name in v or (target_tokens and target_tokens.issubset(set(v.split())))) for v in (row_set, row_product, row_brand)): continue
            if subset:
                row_scope = " ".join(normalized_text(row[field]) for field in ("set_name", "parallel", "variation"))
                subset_tokens = [token for token in subset.split() if token not in {"base", "set"}]
                if subset_tokens and not all(token in row_scope for token in subset_tokens): continue
            if target_parallel and normalized_text(row["parallel"]) != target_parallel: continue
            if serial is not None and int(row["serial_run"] or 0) != serial: continue
            legal.append(dict(row))
        return legal

    def visible_treatment_candidates(self, ai: dict[str, object]) -> list[dict[str, object]]:
        """Return the legal pre-finish family without trusting a preliminary parallel.

        Parallel is the fact this stage is trying to prove. Treating an upstream
        Base/default guess as a hard Registry filter creates a circular proof and
        can collapse a real Pink Flash/Green/Silver card to Base before vision
        sees the legal alternatives. Hard facts (year/product/set/tier/player/card,
        auto/relic and visible serial run) remain enforced by visible_candidates.
        """
        probe = dict(ai)
        probe["parallel"] = None
        return self.visible_candidates(probe)

    def resolve(self, ai: dict[str, object]) -> dict[str, object]:
        self.ensure_seeded()
        year = year_start(ai.get("year"))
        # Local vision frequently reads the publisher/manufacturer but not a
        # separate brand logo. Manufacturer is valid release-family evidence
        # for Registry narrowing; do not throw away otherwise exact scans.
        brand = normalized_text(ai.get("brand"))
        manufacturer = normalized_text(ai.get("manufacturer"))
        # Keep SQL brand filtering concrete. Composite product hints belong in
        # setName and would otherwise miss rows whose brand is simply Prizm/Select.
        for token in ("prizm", "select", "donruss", "mosaic", "origins", "impeccable", "optic"):
            if token in brand.split():
                brand = token
                break
        if brand in {"panini", "topps", "upper deck", "leaf"} and not manufacturer:
            manufacturer, brand = brand, ""
        set_name = normalized_text(ai.get("setName"))
        card_number = normalized_card_number(ai.get("cardNumber"))
        player = normalized_player_identity(ai.get("player"))
        if not year or not (brand or manufacturer) or not set_name or not card_number or not player:
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
                  AND (
                    lower(coalesce(brand, '')) = ?
                    OR lower(coalesce(manufacturer, '')) = ?
                    OR lower(coalesce(product, '')) LIKE ?
                  )
                ORDER BY identity_id
                """,
                (card_number, f"{year}%", brand, manufacturer, f"%{brand}%" if brand else ""),
            ).fetchall()
            # SQLite lower() is ASCII-only. Keep the selective card/year/brand
            # query in SQL, then compare player names with the same Unicode and
            # accent normalization used by OCR/visible_candidates.
            candidate_rows = [row for row in candidate_rows if normalized_player_identity(row["player"]) == player]
            if brand and brand not in {"panini", "topps", "upper deck", "leaf"}:
                branded_rows = [row for row in candidate_rows if normalized_text(row["brand"]) == brand or brand in normalized_text(row["product"])]
                if branded_rows:
                    candidate_rows = branded_rows
            candidate_rows = _prefer_exact_set_family(candidate_rows, ai.get("setName"))
            scoped_rows = [row for row in candidate_rows if self._matches_required_set(ai, row)]
            if not scoped_rows:
                # Never scan the 2.6M-row Registry merely to choose an error label.
                # Exact card/year/player rows already prove the release family is
                # present. If none exist, use an indexed brand/manufacturer probe.
                has_set_scope = bool(candidate_rows)
                if not has_set_scope:
                    canonical_brands = {
                        "prizm": "Prizm", "select": "Select", "donruss": "Donruss",
                        "mosaic": "Mosaic", "origins": "Origins", "impeccable": "Impeccable",
                        "optic": "Optic",
                    }
                    canonical_publishers = {
                        "panini": "Panini", "topps": "Topps", "upper deck": "Upper Deck", "leaf": "Leaf",
                    }
                    if brand in canonical_brands:
                        has_set_scope = db.execute(
                            "SELECT 1 FROM checklist_registry_entries WHERE active=1 AND brand=? AND year=? LIMIT 1",
                            (canonical_brands[brand], year),
                        ).fetchone()
                    elif manufacturer in canonical_publishers:
                        has_set_scope = db.execute(
                            "SELECT 1 FROM checklist_registry_entries WHERE active=1 AND manufacturer=? AND year=? LIMIT 1",
                            (canonical_publishers[manufacturer], year),
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
            if len(exact_rows) > 1:
                # Duplicate checklist imports must not turn one semantic card into
                # an ambiguity. First honor a league that is explicit in the
                # Registry product name (Select WNBA / Prizm WNBA). This safely
                # rejects stale imports stamped NBA even though the product itself
                # says WNBA. Then collapse only rows identical on every card fact;
                # provenance/UUID differences alone are not separate identities.
                product_leagues = set()
                for row in exact_rows:
                    product_tokens = set(normalized_text(row["product"]).split())
                    if "wnba" in product_tokens:
                        product_leagues.add("wnba")
                    elif "nba" in product_tokens:
                        product_leagues.add("nba")
                if not normalized_text(ai.get("league")) and len(product_leagues) == 1:
                    desired_league = next(iter(product_leagues))
                    league_rows = [row for row in exact_rows if normalized_text(row["league"]) == desired_league]
                    if league_rows:
                        exact_rows = league_rows
                if len(exact_rows) > 1:
                    def semantic_key(row: sqlite3.Row) -> tuple[object, ...]:
                        return (
                            year_start(row["year"] or ""),
                            normalized_text(row["manufacturer"]), normalized_text(row["brand"]),
                            normalized_text(row["product"]), normalized_text(row["set_name"]),
                            normalized_card_number(row["card_number"]), normalized_text(row["player"]),
                            normalized_text(row["parallel"]), normalized_text(row["variation"]),
                            row["serial_run"], normalized_text(row["team"]), normalized_text(row["sport"]),
                            normalized_text(row["league"]), bool(row["is_auto"]), bool(row["is_relic"]),
                        )
                    if len({semantic_key(row) for row in exact_rows}) == 1:
                        exact_rows = [sorted(exact_rows, key=lambda row: (
                            str(row["source_label"] or "") == "InstaComp Registry Gap Supplement",
                            str(row["release_id"] or ""), str(row["identity_id"] or ""),
                        ))[0]]
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

    def stats(self) -> dict[str, object]:
        """Small read-only authority snapshot for coverage/health UIs.

        This is intentionally derived from the Mac-local Registry itself; cloud
        checklist mirrors are never used to describe authoritative coverage.
        """
        self.ensure_seeded()
        with self.connection() as db:
            active_identities = int(
                db.execute("SELECT count(*) FROM checklist_registry_entries WHERE active = 1").fetchone()[0]
            )
            active_releases = int(
                db.execute("SELECT count(DISTINCT release_id) FROM checklist_registry_entries WHERE active = 1").fetchone()[0]
            )
        return {
            "authority": "mac_local_registry",
            "activeIdentities": active_identities,
            "activeReleases": active_releases,
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
