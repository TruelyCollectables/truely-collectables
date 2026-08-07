from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime | None) -> str | None:
    return value.astimezone(timezone.utc).isoformat() if value else None


class DealHunterStore:
    """Durable local state for the Mac-owned Deal Hunter scheduler."""

    def __init__(self, path: Path):
        self.path = path

    @contextmanager
    def connection(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def initialize(self) -> None:
        with self.connection() as db:
            db.executescript(
                """
                PRAGMA journal_mode=WAL;
                PRAGMA foreign_keys=ON;

                CREATE TABLE IF NOT EXISTS deal_hunter_scheduler_state (
                    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
                    enabled INTEGER NOT NULL DEFAULT 1,
                    interval_minutes INTEGER NOT NULL DEFAULT 60,
                    running INTEGER NOT NULL DEFAULT 0,
                    active_run_id TEXT,
                    last_started_at TEXT,
                    last_completed_at TEXT,
                    next_run_at TEXT,
                    last_status TEXT,
                    last_error TEXT,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS deal_hunter_runs (
                    run_id TEXT PRIMARY KEY,
                    trigger TEXT NOT NULL,
                    status TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    completed_at TEXT,
                    discovery_count INTEGER NOT NULL DEFAULT 0,
                    evaluated_count INTEGER NOT NULL DEFAULT 0,
                    actionable_count INTEGER NOT NULL DEFAULT 0,
                    manual_review_count INTEGER NOT NULL DEFAULT 0,
                    failure_count INTEGER NOT NULL DEFAULT 0,
                    summary_json TEXT NOT NULL DEFAULT '{}',
                    error_message TEXT
                );
                CREATE INDEX IF NOT EXISTS deal_hunter_runs_started_idx
                    ON deal_hunter_runs(started_at DESC);

                CREATE TABLE IF NOT EXISTS deal_hunter_candidates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL,
                    candidate_key TEXT NOT NULL,
                    lane TEXT,
                    watched_person TEXT,
                    marketplace TEXT,
                    listing_item_id TEXT,
                    listing_url TEXT NOT NULL,
                    title TEXT NOT NULL,
                    seller_name TEXT,
                    item_price REAL,
                    inbound_shipping REAL,
                    buyer_fees REAL,
                    tax REAL,
                    image_urls_json TEXT NOT NULL DEFAULT '[]',
                    status TEXT NOT NULL,
                    identity_json TEXT,
                    exact_market_json TEXT,
                    delivered_cost REAL,
                    conservative_resale REAL,
                    expected_net_profit REAL,
                    roi_percent REAL,
                    deal_label TEXT,
                    actionable INTEGER NOT NULL DEFAULT 0,
                    alertworthy INTEGER NOT NULL DEFAULT 0,
                    error_code TEXT,
                    error_message TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(run_id) REFERENCES deal_hunter_runs(run_id),
                    UNIQUE(run_id, candidate_key)
                );
                CREATE INDEX IF NOT EXISTS deal_hunter_candidates_run_idx
                    ON deal_hunter_candidates(run_id, actionable DESC, roi_percent DESC);
                CREATE INDEX IF NOT EXISTS deal_hunter_candidates_key_idx
                    ON deal_hunter_candidates(candidate_key, created_at DESC);

                CREATE TABLE IF NOT EXISTS deal_hunter_candidate_history (
                    candidate_key TEXT PRIMARY KEY,
                    listing_url TEXT NOT NULL,
                    last_price REAL,
                    last_status TEXT,
                    last_deal_label TEXT,
                    last_evaluated_at TEXT,
                    evaluation_count INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL
                );
                """
            )
            now = iso(utc_now())
            db.execute(
                """
                INSERT OR IGNORE INTO deal_hunter_scheduler_state (
                    singleton_id, enabled, interval_minutes, running, updated_at
                ) VALUES (1, 1, 60, 0, ?)
                """,
                (now,),
            )

    def configure(self, *, enabled: bool, interval_minutes: int) -> None:
        self.initialize()
        with self.connection() as db:
            db.execute(
                """
                UPDATE deal_hunter_scheduler_state
                SET enabled = ?, interval_minutes = ?, updated_at = ?
                WHERE singleton_id = 1
                """,
                (int(enabled), int(interval_minutes), iso(utc_now())),
            )

    def scheduler_state(self) -> dict[str, Any]:
        self.initialize()
        with self.connection() as db:
            row = db.execute(
                "SELECT * FROM deal_hunter_scheduler_state WHERE singleton_id = 1"
            ).fetchone()
        return dict(row) if row else {}

    def mark_scheduler_started(self, run_id: str, next_run_at: datetime | None) -> None:
        now = utc_now()
        with self.connection() as db:
            db.execute(
                """
                UPDATE deal_hunter_scheduler_state
                SET running = 1, active_run_id = ?, last_started_at = ?,
                    next_run_at = ?, last_status = 'running', last_error = NULL,
                    updated_at = ?
                WHERE singleton_id = 1
                """,
                (run_id, iso(now), iso(next_run_at), iso(now)),
            )

    def mark_scheduler_finished(
        self,
        *,
        status: str,
        next_run_at: datetime | None,
        error_message: str | None = None,
    ) -> None:
        now = utc_now()
        with self.connection() as db:
            db.execute(
                """
                UPDATE deal_hunter_scheduler_state
                SET running = 0, active_run_id = NULL, last_completed_at = ?,
                    next_run_at = ?, last_status = ?, last_error = ?, updated_at = ?
                WHERE singleton_id = 1
                """,
                (iso(now), iso(next_run_at), status, error_message, iso(now)),
            )

    def create_run(self, run_id: str, trigger: str) -> None:
        with self.connection() as db:
            db.execute(
                """
                INSERT INTO deal_hunter_runs (
                    run_id, trigger, status, started_at, summary_json
                ) VALUES (?, ?, 'running', ?, '{}')
                """,
                (run_id, trigger, iso(utc_now())),
            )

    def finish_run(
        self,
        *,
        run_id: str,
        status: str,
        discovery_count: int,
        evaluated_count: int,
        actionable_count: int,
        manual_review_count: int,
        failure_count: int,
        summary: dict[str, Any],
        error_message: str | None = None,
    ) -> None:
        with self.connection() as db:
            db.execute(
                """
                UPDATE deal_hunter_runs
                SET status = ?, completed_at = ?, discovery_count = ?,
                    evaluated_count = ?, actionable_count = ?,
                    manual_review_count = ?, failure_count = ?,
                    summary_json = ?, error_message = ?
                WHERE run_id = ?
                """,
                (
                    status,
                    iso(utc_now()),
                    discovery_count,
                    evaluated_count,
                    actionable_count,
                    manual_review_count,
                    failure_count,
                    json.dumps(summary, sort_keys=True),
                    error_message,
                    run_id,
                ),
            )

    def save_candidate(self, run_id: str, candidate: dict[str, Any]) -> None:
        now = iso(utc_now())
        candidate_key = str(candidate["candidate_key"])
        with self.connection() as db:
            db.execute(
                """
                INSERT INTO deal_hunter_candidates (
                    run_id, candidate_key, lane, watched_person, marketplace,
                    listing_item_id, listing_url, title, seller_name, item_price,
                    inbound_shipping, buyer_fees, tax, image_urls_json, status,
                    identity_json, exact_market_json, delivered_cost,
                    conservative_resale, expected_net_profit, roi_percent,
                    deal_label, actionable, alertworthy, error_code, error_message,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id, candidate_key) DO UPDATE SET
                    status = excluded.status,
                    identity_json = excluded.identity_json,
                    exact_market_json = excluded.exact_market_json,
                    delivered_cost = excluded.delivered_cost,
                    conservative_resale = excluded.conservative_resale,
                    expected_net_profit = excluded.expected_net_profit,
                    roi_percent = excluded.roi_percent,
                    deal_label = excluded.deal_label,
                    actionable = excluded.actionable,
                    alertworthy = excluded.alertworthy,
                    error_code = excluded.error_code,
                    error_message = excluded.error_message
                """,
                (
                    run_id,
                    candidate_key,
                    candidate.get("lane"),
                    candidate.get("watched_person"),
                    candidate.get("marketplace"),
                    candidate.get("listing_item_id"),
                    candidate["listing_url"],
                    candidate.get("title") or "Untitled listing",
                    candidate.get("seller_name"),
                    candidate.get("item_price"),
                    candidate.get("inbound_shipping"),
                    candidate.get("buyer_fees"),
                    candidate.get("tax"),
                    json.dumps(candidate.get("image_urls") or []),
                    candidate.get("status") or "unknown",
                    json.dumps(candidate.get("identity")) if candidate.get("identity") else None,
                    json.dumps(candidate.get("exact_market")) if candidate.get("exact_market") else None,
                    candidate.get("delivered_cost"),
                    candidate.get("conservative_resale"),
                    candidate.get("expected_net_profit"),
                    candidate.get("roi_percent"),
                    candidate.get("deal_label"),
                    int(bool(candidate.get("actionable"))),
                    int(bool(candidate.get("alertworthy"))),
                    candidate.get("error_code"),
                    candidate.get("error_message"),
                    now,
                ),
            )
            db.execute(
                """
                INSERT INTO deal_hunter_candidate_history (
                    candidate_key, listing_url, last_price, last_status,
                    last_deal_label, last_evaluated_at, evaluation_count, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
                ON CONFLICT(candidate_key) DO UPDATE SET
                    listing_url = excluded.listing_url,
                    last_price = excluded.last_price,
                    last_status = excluded.last_status,
                    last_deal_label = excluded.last_deal_label,
                    last_evaluated_at = excluded.last_evaluated_at,
                    evaluation_count = deal_hunter_candidate_history.evaluation_count + 1,
                    updated_at = excluded.updated_at
                """,
                (
                    candidate_key,
                    candidate["listing_url"],
                    candidate.get("item_price"),
                    candidate.get("status"),
                    candidate.get("deal_label"),
                    now,
                    now,
                ),
            )

    def candidate_history(self, candidate_keys: Iterable[str]) -> dict[str, dict[str, Any]]:
        keys = list(dict.fromkeys(str(key) for key in candidate_keys if key))
        if not keys:
            return {}
        placeholders = ",".join("?" for _ in keys)
        with self.connection() as db:
            rows = db.execute(
                f"SELECT * FROM deal_hunter_candidate_history WHERE candidate_key IN ({placeholders})",
                keys,
            ).fetchall()
        return {str(row["candidate_key"]): dict(row) for row in rows}

    @staticmethod
    def is_cooling_down(
        history: dict[str, Any] | None,
        *,
        current_price: float | None,
        cooldown_hours: int,
    ) -> bool:
        if not history or not history.get("last_evaluated_at"):
            return False
        prior_price = history.get("last_price")
        if current_price is not None and prior_price is not None:
            if abs(float(current_price) - float(prior_price)) >= 0.01:
                return False
        try:
            last = datetime.fromisoformat(str(history["last_evaluated_at"]))
        except ValueError:
            return False
        return last >= utc_now() - timedelta(hours=max(1, cooldown_hours))

    def recent_runs(self, limit: int = 20) -> list[dict[str, Any]]:
        self.initialize()
        with self.connection() as db:
            rows = db.execute(
                "SELECT * FROM deal_hunter_runs ORDER BY started_at DESC LIMIT ?",
                (max(1, min(limit, 200)),),
            ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            item["summary"] = json.loads(item.pop("summary_json") or "{}")
            result.append(item)
        return result

    def recent_candidates(
        self,
        *,
        limit: int = 100,
        actionable_only: bool = False,
    ) -> list[dict[str, Any]]:
        self.initialize()
        where = "WHERE actionable = 1" if actionable_only else ""
        with self.connection() as db:
            rows = db.execute(
                f"""
                SELECT * FROM deal_hunter_candidates
                {where}
                ORDER BY actionable DESC, alertworthy DESC,
                         COALESCE(roi_percent, -99999) DESC, created_at DESC
                LIMIT ?
                """,
                (max(1, min(limit, 500)),),
            ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            for key in ["image_urls_json", "identity_json", "exact_market_json"]:
                value = item.pop(key, None)
                item[key.removesuffix("_json")] = json.loads(value) if value else None
            item["actionable"] = bool(item["actionable"])
            item["alertworthy"] = bool(item["alertworthy"])
            result.append(item)
        return result
