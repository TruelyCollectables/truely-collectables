from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat()


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


class SentinelStore:
    """Durable state for InstaComp AI Checklist Sentinel™.

    The Sentinel uses the same SQLite database file as InstaComp AI, but keeps
    its data in isolated tables. WAL mode and short transactions allow scan and
    Sentinel traffic to coexist safely.
    """

    def __init__(self, path: Path):
        self.path = path

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
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript(
                """
                PRAGMA journal_mode=WAL;
                PRAGMA foreign_keys=ON;

                CREATE TABLE IF NOT EXISTS checklist_sentinel_jobs (
                    job_id TEXT PRIMARY KEY,
                    trigger TEXT NOT NULL,
                    status TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    completed_at TEXT,
                    heartbeat_at TEXT NOT NULL,
                    total_targets INTEGER NOT NULL DEFAULT 0,
                    processed_targets INTEGER NOT NULL DEFAULT 0,
                    found_count INTEGER NOT NULL DEFAULT 0,
                    downloaded_count INTEGER NOT NULL DEFAULT 0,
                    imported_count INTEGER NOT NULL DEFAULT 0,
                    duplicate_count INTEGER NOT NULL DEFAULT 0,
                    failed_count INTEGER NOT NULL DEFAULT 0,
                    current_target_key TEXT,
                    progress_percent REAL NOT NULL DEFAULT 0,
                    error TEXT,
                    checkpoint_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE INDEX IF NOT EXISTS checklist_sentinel_jobs_status_idx
                    ON checklist_sentinel_jobs(status, started_at);

                CREATE TABLE IF NOT EXISTS checklist_sentinel_checkpoints (
                    checkpoint_id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    phase TEXT NOT NULL,
                    progress_percent REAL NOT NULL,
                    payload_json TEXT NOT NULL,
                    FOREIGN KEY(job_id) REFERENCES checklist_sentinel_jobs(job_id)
                );
                CREATE INDEX IF NOT EXISTS checklist_sentinel_checkpoints_job_idx
                    ON checklist_sentinel_checkpoints(job_id, created_at);

                CREATE TABLE IF NOT EXISTS checklist_sentinel_sources (
                    source_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    trust_score INTEGER NOT NULL,
                    import_policy TEXT NOT NULL,
                    search_url_template TEXT NOT NULL,
                    domains_json TEXT NOT NULL,
                    last_checked_at TEXT,
                    last_status TEXT,
                    last_error TEXT,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS checklist_sentinel_targets (
                    target_key TEXT PRIMARY KEY,
                    sport TEXT,
                    year INTEGER,
                    season TEXT,
                    manufacturer TEXT,
                    product TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    priority INTEGER NOT NULL DEFAULT 50,
                    status TEXT NOT NULL DEFAULT 'pending',
                    attempts INTEGER NOT NULL DEFAULT 0,
                    last_searched_at TEXT,
                    next_search_at TEXT,
                    recovered_download_id TEXT,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS checklist_sentinel_targets_due_idx
                    ON checklist_sentinel_targets(status, next_search_at, priority);

                CREATE TABLE IF NOT EXISTS checklist_sentinel_findings (
                    finding_id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL,
                    target_key TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    url TEXT NOT NULL,
                    title TEXT,
                    domain TEXT,
                    trust_score INTEGER NOT NULL,
                    exact_match INTEGER NOT NULL DEFAULT 0,
                    content_type TEXT,
                    status TEXT NOT NULL,
                    reason TEXT,
                    created_at TEXT NOT NULL,
                    UNIQUE(target_key, url),
                    FOREIGN KEY(job_id) REFERENCES checklist_sentinel_jobs(job_id),
                    FOREIGN KEY(target_key) REFERENCES checklist_sentinel_targets(target_key),
                    FOREIGN KEY(source_id) REFERENCES checklist_sentinel_sources(source_id)
                );
                CREATE INDEX IF NOT EXISTS checklist_sentinel_findings_status_idx
                    ON checklist_sentinel_findings(status, created_at);

                CREATE TABLE IF NOT EXISTS checklist_sentinel_downloads (
                    download_id TEXT PRIMARY KEY,
                    finding_id TEXT NOT NULL,
                    target_key TEXT NOT NULL,
                    source_url TEXT NOT NULL,
                    local_path TEXT NOT NULL,
                    sha256 TEXT NOT NULL UNIQUE,
                    content_type TEXT,
                    byte_count INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    registry_receipt TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(finding_id) REFERENCES checklist_sentinel_findings(finding_id),
                    FOREIGN KEY(target_key) REFERENCES checklist_sentinel_targets(target_key)
                );
                CREATE INDEX IF NOT EXISTS checklist_sentinel_downloads_target_idx
                    ON checklist_sentinel_downloads(target_key, created_at);
                """
            )

    def seed_sources(self, sources: list[dict[str, Any]]) -> None:
        now = iso_now()
        with self.connection() as db:
            for source in sources:
                db.execute(
                    """
                    INSERT INTO checklist_sentinel_sources (
                        source_id, name, kind, enabled, trust_score,
                        import_policy, search_url_template, domains_json, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(source_id) DO UPDATE SET
                        name = excluded.name,
                        kind = excluded.kind,
                        trust_score = excluded.trust_score,
                        import_policy = excluded.import_policy,
                        search_url_template = excluded.search_url_template,
                        domains_json = excluded.domains_json,
                        updated_at = excluded.updated_at
                    """,
                    (
                        source["source_id"],
                        source["name"],
                        source["kind"],
                        int(source.get("enabled", True)),
                        int(source["trust_score"]),
                        source["import_policy"],
                        source["search_url_template"],
                        json.dumps(source.get("domains", []), sort_keys=True),
                        now,
                    ),
                )

    def list_sources(self, enabled_only: bool = False) -> list[dict[str, Any]]:
        where = "WHERE enabled = 1" if enabled_only else ""
        with self.connection() as db:
            rows = db.execute(
                f"SELECT * FROM checklist_sentinel_sources {where} ORDER BY trust_score DESC, name"
            ).fetchall()
        return [self._source_row(row) for row in rows]

    def source_checked(self, source_id: str, status: str, error: str | None = None) -> None:
        with self.connection() as db:
            db.execute(
                """
                UPDATE checklist_sentinel_sources
                SET last_checked_at = ?, last_status = ?, last_error = ?, updated_at = ?
                WHERE source_id = ?
                """,
                (iso_now(), status, error, iso_now(), source_id),
            )

    def upsert_targets(self, targets: list[dict[str, Any]]) -> int:
        now = iso_now()
        changed = 0
        with self.connection() as db:
            for target in targets:
                key = str(target.get("target_key") or target.get("exactSetKey") or "").strip()
                product = str(target.get("product") or "").strip()
                if not key or not product:
                    continue
                before = db.total_changes
                db.execute(
                    """
                    INSERT INTO checklist_sentinel_targets (
                        target_key, sport, year, season, manufacturer, product,
                        scope, priority, status, next_search_at, metadata_json,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
                    ON CONFLICT(target_key) DO UPDATE SET
                        sport = excluded.sport,
                        year = excluded.year,
                        season = excluded.season,
                        manufacturer = excluded.manufacturer,
                        product = excluded.product,
                        scope = excluded.scope,
                        priority = excluded.priority,
                        metadata_json = excluded.metadata_json,
                        updated_at = excluded.updated_at
                    """,
                    (
                        key,
                        target.get("sport"),
                        target.get("year"),
                        target.get("season"),
                        target.get("manufacturer"),
                        product,
                        target.get("scope") or "exact-gap",
                        int(target.get("priority") or 50),
                        target.get("next_search_at") or now,
                        json.dumps(target.get("metadata") or {}, sort_keys=True),
                        now,
                        now,
                    ),
                )
                changed += db.total_changes - before
        return changed

    def due_targets(self, limit: int) -> list[dict[str, Any]]:
        now = iso_now()
        with self.connection() as db:
            rows = db.execute(
                """
                SELECT * FROM checklist_sentinel_targets
                WHERE status IN ('pending', 'no_result', 'lead_only', 'failed')
                  AND (next_search_at IS NULL OR next_search_at <= ?)
                ORDER BY priority ASC, COALESCE(year, 9999) DESC, attempts ASC, target_key
                LIMIT ?
                """,
                (now, limit),
            ).fetchall()
        return [self._target_row(row) for row in rows]

    def list_targets(self, limit: int = 500, status: str | None = None) -> list[dict[str, Any]]:
        with self.connection() as db:
            if status:
                rows = db.execute(
                    """
                    SELECT * FROM checklist_sentinel_targets
                    WHERE status = ?
                    ORDER BY priority, COALESCE(year, 9999) DESC, target_key
                    LIMIT ?
                    """,
                    (status, limit),
                ).fetchall()
            else:
                rows = db.execute(
                    """
                    SELECT * FROM checklist_sentinel_targets
                    ORDER BY priority, COALESCE(year, 9999) DESC, target_key
                    LIMIT ?
                    """,
                    (limit,),
                ).fetchall()
        return [self._target_row(row) for row in rows]

    def target_counts(self) -> dict[str, int]:
        with self.connection() as db:
            rows = db.execute(
                "SELECT status, COUNT(*) AS count FROM checklist_sentinel_targets GROUP BY status"
            ).fetchall()
            total = db.execute(
                "SELECT COUNT(*) AS count FROM checklist_sentinel_targets"
            ).fetchone()["count"]
        counts = {row["status"]: int(row["count"]) for row in rows}
        counts["total"] = int(total)
        return counts

    def acquire_job(self, trigger: str, stale_seconds: int) -> tuple[str | None, dict[str, Any] | None]:
        now = utc_now()
        stale_before = (now - timedelta(seconds=stale_seconds)).isoformat()
        with self.connection() as db:
            db.execute(
                """
                UPDATE checklist_sentinel_jobs
                SET status = 'interrupted', completed_at = ?, error = COALESCE(error, 'Stale heartbeat; safe resume required.')
                WHERE status = 'running' AND heartbeat_at < ?
                """,
                (now.isoformat(), stale_before),
            )
            running = db.execute(
                """
                SELECT * FROM checklist_sentinel_jobs
                WHERE status = 'running'
                ORDER BY started_at DESC LIMIT 1
                """
            ).fetchone()
            if running is not None:
                return None, self._job_row(running)

            job_id = str(uuid4())
            db.execute(
                """
                INSERT INTO checklist_sentinel_jobs (
                    job_id, trigger, status, started_at, heartbeat_at
                ) VALUES (?, ?, 'running', ?, ?)
                """,
                (job_id, trigger, now.isoformat(), now.isoformat()),
            )
        return job_id, None

    def heartbeat(
        self,
        job_id: str,
        *,
        current_target_key: str | None = None,
        processed_targets: int | None = None,
        total_targets: int | None = None,
        found_count: int | None = None,
        downloaded_count: int | None = None,
        imported_count: int | None = None,
        duplicate_count: int | None = None,
        failed_count: int | None = None,
        checkpoint: dict[str, Any] | None = None,
    ) -> None:
        fields: list[str] = ["heartbeat_at = ?"]
        values: list[Any] = [iso_now()]
        mapping = {
            "current_target_key": current_target_key,
            "processed_targets": processed_targets,
            "total_targets": total_targets,
            "found_count": found_count,
            "downloaded_count": downloaded_count,
            "imported_count": imported_count,
            "duplicate_count": duplicate_count,
            "failed_count": failed_count,
        }
        for key, value in mapping.items():
            if value is not None:
                fields.append(f"{key} = ?")
                values.append(value)
        if checkpoint is not None:
            fields.append("checkpoint_json = ?")
            values.append(json.dumps(checkpoint, sort_keys=True))
        if processed_targets is not None and total_targets:
            fields.append("progress_percent = ?")
            values.append(round(min(100.0, processed_targets * 100.0 / total_targets), 4))
        values.append(job_id)
        with self.connection() as db:
            db.execute(
                f"UPDATE checklist_sentinel_jobs SET {', '.join(fields)} WHERE job_id = ?",
                values,
            )

    def checkpoint(
        self,
        job_id: str,
        phase: str,
        progress_percent: float,
        payload: dict[str, Any],
    ) -> None:
        checkpoint_id = str(uuid4())
        serialized = json.dumps(payload, sort_keys=True)
        with self.connection() as db:
            db.execute(
                """
                INSERT INTO checklist_sentinel_checkpoints (
                    checkpoint_id, job_id, created_at, phase, progress_percent, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    checkpoint_id,
                    job_id,
                    iso_now(),
                    phase,
                    round(max(0.0, min(100.0, progress_percent)), 4),
                    serialized,
                ),
            )
            db.execute(
                """
                UPDATE checklist_sentinel_jobs
                SET heartbeat_at = ?, progress_percent = ?, checkpoint_json = ?
                WHERE job_id = ?
                """,
                (iso_now(), progress_percent, serialized, job_id),
            )

    def finish_job(self, job_id: str, status: str, error: str | None = None) -> None:
        with self.connection() as db:
            db.execute(
                """
                UPDATE checklist_sentinel_jobs
                SET status = ?, completed_at = ?, heartbeat_at = ?,
                    current_target_key = NULL,
                    progress_percent = CASE WHEN ? = 'completed' THEN 100 ELSE progress_percent END,
                    error = ?
                WHERE job_id = ?
                """,
                (status, iso_now(), iso_now(), status, error, job_id),
            )

    def latest_job(self) -> dict[str, Any] | None:
        with self.connection() as db:
            row = db.execute(
                "SELECT * FROM checklist_sentinel_jobs ORDER BY started_at DESC LIMIT 1"
            ).fetchone()
        return self._job_row(row) if row else None

    def due_for_run(self, interval_seconds: int) -> bool:
        with self.connection() as db:
            running = db.execute(
                "SELECT 1 FROM checklist_sentinel_jobs WHERE status = 'running' LIMIT 1"
            ).fetchone()
            if running:
                return False
            row = db.execute(
                """
                SELECT completed_at FROM checklist_sentinel_jobs
                WHERE status IN ('completed', 'completed_with_errors')
                ORDER BY completed_at DESC LIMIT 1
                """
            ).fetchone()
        if row is None:
            return True
        completed = parse_time(row["completed_at"])
        return completed is None or utc_now() - completed >= timedelta(seconds=interval_seconds)

    def record_finding(
        self,
        *,
        job_id: str,
        target_key: str,
        source_id: str,
        url: str,
        title: str | None,
        domain: str | None,
        trust_score: int,
        exact_match: bool,
        content_type: str | None,
        status: str,
        reason: str | None,
    ) -> str:
        finding_id = str(uuid4())
        with self.connection() as db:
            existing = db.execute(
                """
                SELECT finding_id FROM checklist_sentinel_findings
                WHERE target_key = ? AND url = ?
                """,
                (target_key, url),
            ).fetchone()
            if existing:
                return str(existing["finding_id"])
            db.execute(
                """
                INSERT INTO checklist_sentinel_findings (
                    finding_id, job_id, target_key, source_id, url, title,
                    domain, trust_score, exact_match, content_type, status,
                    reason, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    finding_id,
                    job_id,
                    target_key,
                    source_id,
                    url,
                    title,
                    domain,
                    int(trust_score),
                    int(exact_match),
                    content_type,
                    status,
                    reason,
                    iso_now(),
                ),
            )
        return finding_id

    def sha_exists(self, sha256: str) -> dict[str, Any] | None:
        with self.connection() as db:
            row = db.execute(
                "SELECT * FROM checklist_sentinel_downloads WHERE sha256 = ?",
                (sha256,),
            ).fetchone()
        return dict(row) if row else None

    def record_download(
        self,
        *,
        finding_id: str,
        target_key: str,
        source_url: str,
        local_path: str,
        sha256: str,
        content_type: str | None,
        byte_count: int,
        status: str,
        registry_receipt: str | None = None,
    ) -> str:
        download_id = str(uuid4())
        with self.connection() as db:
            db.execute(
                """
                INSERT INTO checklist_sentinel_downloads (
                    download_id, finding_id, target_key, source_url, local_path,
                    sha256, content_type, byte_count, status, registry_receipt,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    download_id,
                    finding_id,
                    target_key,
                    source_url,
                    local_path,
                    sha256,
                    content_type,
                    int(byte_count),
                    status,
                    registry_receipt,
                    iso_now(),
                ),
            )
        return download_id

    def mark_target(
        self,
        target_key: str,
        status: str,
        *,
        retry_after_seconds: int,
        recovered_download_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        next_search = (utc_now() + timedelta(seconds=retry_after_seconds)).isoformat()
        with self.connection() as db:
            db.execute(
                """
                UPDATE checklist_sentinel_targets
                SET status = ?, attempts = attempts + 1,
                    last_searched_at = ?, next_search_at = ?,
                    recovered_download_id = COALESCE(?, recovered_download_id),
                    metadata_json = COALESCE(?, metadata_json),
                    updated_at = ?
                WHERE target_key = ?
                """,
                (
                    status,
                    iso_now(),
                    next_search,
                    recovered_download_id,
                    json.dumps(metadata, sort_keys=True) if metadata is not None else None,
                    iso_now(),
                    target_key,
                ),
            )

    def list_findings(
        self, limit: int = 200, status: str | None = None
    ) -> list[dict[str, Any]]:
        with self.connection() as db:
            if status:
                rows = db.execute(
                    """
                    SELECT * FROM checklist_sentinel_findings
                    WHERE status = ?
                    ORDER BY created_at DESC LIMIT ?
                    """,
                    (status, limit),
                ).fetchall()
            else:
                rows = db.execute(
                    """
                    SELECT * FROM checklist_sentinel_findings
                    ORDER BY created_at DESC LIMIT ?
                    """,
                    (limit,),
                ).fetchall()
        return [dict(row) for row in rows]

    def list_downloads(self, limit: int = 200) -> list[dict[str, Any]]:
        with self.connection() as db:
            rows = db.execute(
                """
                SELECT * FROM checklist_sentinel_downloads
                ORDER BY created_at DESC LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    @staticmethod
    def _source_row(row: sqlite3.Row) -> dict[str, Any]:
        value = dict(row)
        value["enabled"] = bool(value["enabled"])
        value["domains"] = json.loads(value.pop("domains_json") or "[]")
        return value

    @staticmethod
    def _target_row(row: sqlite3.Row) -> dict[str, Any]:
        value = dict(row)
        value["metadata"] = json.loads(value.pop("metadata_json") or "{}")
        return value

    @staticmethod
    def _job_row(row: sqlite3.Row) -> dict[str, Any]:
        value = dict(row)
        value["checkpoint"] = json.loads(value.pop("checkpoint_json") or "{}")
        return value
