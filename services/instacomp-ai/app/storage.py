from __future__ import annotations

import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from .models import CardIdentity, LearningState, LessonCreate, LessonRecord, MemoryMatch

TRUSTED_STATES = {LearningState.OPERATOR_CONFIRMED, LearningState.CHECKLIST_CONFIRMED}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def normalize(value: str | None) -> str:
    return " ".join((value or "").strip().lower().split())


def identity_fingerprint(identity: CardIdentity) -> str:
    canonical = "|".join(normalize(value) for value in [
        identity.sport, identity.year, identity.manufacturer, identity.brand,
        identity.set_name, identity.subset, identity.player, identity.card_number,
        identity.parallel, identity.variation, identity.serial_number,
    ])
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class MemoryStore:
    def __init__(self, path: Path):
        self.path = path

    @contextmanager
    def connection(self):
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                PRAGMA foreign_keys=ON;
                CREATE TABLE IF NOT EXISTS scans (
                    scan_id TEXT PRIMARY KEY, created_at TEXT NOT NULL,
                    front_sha256 TEXT NOT NULL, back_sha256 TEXT,
                    image_pair_sha256 TEXT NOT NULL, local_suggestion_json TEXT,
                    checklist_json TEXT NOT NULL, status TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS scans_pair_hash_idx ON scans(image_pair_sha256);
                CREATE TABLE IF NOT EXISTS lessons (
                    lesson_id TEXT PRIMARY KEY, scan_id TEXT NOT NULL,
                    state TEXT NOT NULL, identity_json TEXT NOT NULL,
                    rejected_identity_json TEXT, verification_source TEXT NOT NULL,
                    operator_id TEXT, notes TEXT, identity_fingerprint TEXT NOT NULL,
                    trusted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
                    FOREIGN KEY(scan_id) REFERENCES scans(scan_id)
                );
                CREATE INDEX IF NOT EXISTS lessons_fingerprint_idx ON lessons(identity_fingerprint);
                CREATE INDEX IF NOT EXISTS lessons_trusted_idx ON lessons(trusted, state);
            """)

    def ready(self) -> bool:
        try:
            self.initialize()
            with self.connection() as db:
                db.execute("SELECT 1").fetchone()
            return True
        except sqlite3.Error:
            return False

    def save_scan(self, *, scan_id: str, created_at: datetime, front_sha256: str,
                  back_sha256: str | None, image_pair_sha256: str,
                  local_suggestion: dict | None, checklist: dict, status: str) -> None:
        with self.connection() as db:
            db.execute("""
                INSERT INTO scans (scan_id, created_at, front_sha256, back_sha256,
                image_pair_sha256, local_suggestion_json, checklist_json, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (scan_id, created_at.isoformat(), front_sha256, back_sha256,
                  image_pair_sha256, json.dumps(local_suggestion) if local_suggestion else None,
                  json.dumps(checklist), status))

    def scan_exists(self, scan_id: str) -> bool:
        with self.connection() as db:
            return db.execute("SELECT 1 FROM scans WHERE scan_id = ?", (scan_id,)).fetchone() is not None

    def get_scan(self, scan_id: str) -> dict | None:
        with self.connection() as db:
            row = db.execute(
                "SELECT * FROM scans WHERE scan_id = ?",
                (scan_id,),
            ).fetchone()
        if row is None:
            return None
        return {
            "scan_id": row["scan_id"],
            "created_at": row["created_at"],
            "front_sha256": row["front_sha256"],
            "back_sha256": row["back_sha256"],
            "image_pair_sha256": row["image_pair_sha256"],
            "local_suggestion": (
                json.loads(row["local_suggestion_json"])
                if row["local_suggestion_json"]
                else None
            ),
            "checklist": json.loads(row["checklist_json"]),
            "status": row["status"],
        }

    def create_lesson(self, request: LessonCreate) -> LessonRecord:
        if not self.scan_exists(request.scan_id):
            raise ValueError("Unknown scan_id")
        lesson = LessonRecord(
            lesson_id=str(uuid4()), scan_id=request.scan_id, state=request.state,
            identity=request.identity, verification_source=request.verification_source,
            operator_id=request.operator_id, notes=request.notes,
            rejected_identity=request.rejected_identity,
            identity_fingerprint=identity_fingerprint(request.identity),
            created_at=utc_now(), trusted=request.state in TRUSTED_STATES,
        )
        with self.connection() as db:
            db.execute("""
                INSERT INTO lessons (lesson_id, scan_id, state, identity_json,
                rejected_identity_json, verification_source, operator_id, notes,
                identity_fingerprint, trusted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (lesson.lesson_id, lesson.scan_id, lesson.state.value,
                  lesson.identity.model_dump_json(),
                  lesson.rejected_identity.model_dump_json() if lesson.rejected_identity else None,
                  lesson.verification_source, lesson.operator_id, lesson.notes,
                  lesson.identity_fingerprint, int(lesson.trusted), lesson.created_at.isoformat()))
        return lesson

    def search(self, identity: CardIdentity, limit: int = 10) -> list[MemoryMatch]:
        requested = identity.model_dump()
        with self.connection() as db:
            rows = db.execute("SELECT * FROM lessons WHERE trusted = 1 ORDER BY created_at DESC LIMIT 500").fetchall()
        weights = {"player": .24, "year": .12, "set_name": .18, "card_number": .20,
                   "parallel": .12, "brand": .06, "manufacturer": .04, "sport": .04}
        matches: list[MemoryMatch] = []
        for row in rows:
            candidate = CardIdentity.model_validate_json(row["identity_json"])
            score = possible = 0.0
            evidence: list[str] = []
            for field, weight in weights.items():
                target = normalize(requested.get(field))
                if not target:
                    continue
                possible += weight
                if target == normalize(getattr(candidate, field)):
                    score += weight
                    evidence.append(f"{field}_exact")
            if possible and score / possible >= .5:
                matches.append(MemoryMatch(lesson_id=row["lesson_id"], identity=candidate,
                    score=round(score / possible, 4), verification_state=LearningState(row["state"]),
                    reasons=evidence))
        return sorted(matches, key=lambda item: item.score, reverse=True)[:limit]
