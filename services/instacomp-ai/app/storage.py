from __future__ import annotations

import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from .images import perceptual_hash_distance
from .models import (
    CardIdentity,
    LearningState,
    LessonCreate,
    LessonRecord,
    MemoryMatch,
    TrainingExample,
)
from .training import build_training_example

TRUSTED_STATES = {LearningState.OPERATOR_CONFIRMED, LearningState.CHECKLIST_CONFIRMED}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def normalize(value: object) -> str:
    return " ".join(str(value or "").strip().lower().split())


def identity_fingerprint(identity: CardIdentity) -> str:
    # Copy numbers are deliberately excluded. The print run identifies the card
    # configuration, while 17/99 and 44/99 remain the same learned design.
    canonical = "|".join(
        normalize(value)
        for value in [
            identity.sport,
            identity.year,
            identity.manufacturer,
            identity.brand,
            identity.set_name,
            identity.subset,
            identity.player,
            identity.card_number,
            identity.parallel,
            identity.variation,
            identity.serial_run,
            identity.rookie,
            identity.autograph,
            identity.inscription,
            identity.inscription_text,
            identity.memorabilia,
            identity.memorabilia_type,
        ]
    )
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
            db.executescript(
                """
                PRAGMA journal_mode=WAL;
                PRAGMA foreign_keys=ON;
                CREATE TABLE IF NOT EXISTS scans (
                    scan_id TEXT PRIMARY KEY,
                    card_uuid TEXT,
                    created_at TEXT NOT NULL,
                    front_sha256 TEXT NOT NULL,
                    back_sha256 TEXT,
                    image_pair_sha256 TEXT NOT NULL,
                    front_reference_sha256 TEXT,
                    back_reference_sha256 TEXT,
                    front_perceptual_hash TEXT,
                    back_perceptual_hash TEXT,
                    local_suggestion_json TEXT,
                    local_vision_json TEXT,
                    checklist_json TEXT NOT NULL,
                    status TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS scans_pair_hash_idx ON scans(image_pair_sha256);
                CREATE TABLE IF NOT EXISTS lessons (
                    lesson_id TEXT PRIMARY KEY,
                    scan_id TEXT NOT NULL,
                    state TEXT NOT NULL,
                    identity_json TEXT NOT NULL,
                    rejected_identity_json TEXT,
                    verification_source TEXT NOT NULL,
                    operator_id TEXT,
                    notes TEXT,
                    identity_fingerprint TEXT NOT NULL,
                    trusted INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(scan_id) REFERENCES scans(scan_id)
                );
                CREATE INDEX IF NOT EXISTS lessons_fingerprint_idx ON lessons(identity_fingerprint);
                CREATE INDEX IF NOT EXISTS lessons_trusted_idx ON lessons(trusted, state);
                CREATE TABLE IF NOT EXISTS training_examples (
                    training_example_id TEXT PRIMARY KEY,
                    lesson_id TEXT NOT NULL UNIQUE,
                    scan_id TEXT NOT NULL,
                    trusted INTEGER NOT NULL DEFAULT 0,
                    example_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(lesson_id) REFERENCES lessons(lesson_id),
                    FOREIGN KEY(scan_id) REFERENCES scans(scan_id)
                );
                CREATE INDEX IF NOT EXISTS training_examples_trusted_idx
                ON training_examples(trusted, created_at);
                """
            )
            existing = {
                row["name"] for row in db.execute("PRAGMA table_info(scans)").fetchall()
            }
            for column in [
                "card_uuid",
                "front_reference_sha256",
                "back_reference_sha256",
                "front_perceptual_hash",
                "back_perceptual_hash",
                "local_vision_json",
            ]:
                if column not in existing:
                    db.execute(f"ALTER TABLE scans ADD COLUMN {column} TEXT")
            db.execute(
                "CREATE INDEX IF NOT EXISTS scans_front_phash_idx "
                "ON scans(front_perceptual_hash)"
            )
            db.execute(
                "CREATE INDEX IF NOT EXISTS scans_card_uuid_idx "
                "ON scans(card_uuid)"
            )
            # Legacy scans predate card_uuid. Their historical scan UUID is the
            # safest permanent seed because no physical-card key existed yet.
            db.execute("UPDATE scans SET card_uuid = scan_id WHERE card_uuid IS NULL")

    def ready(self) -> bool:
        try:
            self.initialize()
            with self.connection() as db:
                db.execute("SELECT 1").fetchone()
            return True
        except sqlite3.Error:
            return False

    def save_scan(
        self,
        *,
        scan_id: str,
        card_uuid: str | None = None,
        created_at: datetime,
        front_sha256: str,
        back_sha256: str | None,
        image_pair_sha256: str,
        front_reference_sha256: str | None = None,
        back_reference_sha256: str | None = None,
        front_perceptual_hash: str | None = None,
        back_perceptual_hash: str | None = None,
        local_suggestion: dict | None,
        local_vision: dict | None = None,
        checklist: dict,
        status: str,
    ) -> None:
        resolved_card_uuid = str(card_uuid or scan_id).strip()
        if not resolved_card_uuid:
            raise ValueError("card_uuid or scan_id is required")
        with self.connection() as db:
            db.execute(
                """
                INSERT INTO scans (
                    scan_id, card_uuid, created_at, front_sha256, back_sha256,
                    image_pair_sha256, front_reference_sha256,
                    back_reference_sha256, front_perceptual_hash,
                    back_perceptual_hash, local_suggestion_json,
                    local_vision_json, checklist_json, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    scan_id,
                    resolved_card_uuid,
                    created_at.isoformat(),
                    front_sha256,
                    back_sha256,
                    image_pair_sha256,
                    front_reference_sha256,
                    back_reference_sha256,
                    front_perceptual_hash,
                    back_perceptual_hash,
                    json.dumps(local_suggestion) if local_suggestion else None,
                    json.dumps(local_vision) if local_vision else None,
                    json.dumps(checklist),
                    status,
                ),
            )

    def scan_exists(self, scan_id: str) -> bool:
        with self.connection() as db:
            return (
                db.execute("SELECT 1 FROM scans WHERE scan_id = ?", (scan_id,)).fetchone()
                is not None
            )

    def card_uuid_for_image_pair(self, image_pair_sha256: str) -> str | None:
        """Return only an exact-image-pair physical-card UUID.

        Near-visual memory is deliberately forbidden here because two distinct
        physical copies can share the same card design.
        """
        with self.connection() as db:
            row = db.execute(
                "SELECT card_uuid FROM scans "
                "WHERE image_pair_sha256 = ? AND card_uuid IS NOT NULL "
                "ORDER BY created_at DESC LIMIT 1",
                (image_pair_sha256,),
            ).fetchone()
        if row is None:
            return None
        value = str(row["card_uuid"] or "").strip()
        return value or None

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
            "card_uuid": row["card_uuid"],
            "created_at": row["created_at"],
            "front_sha256": row["front_sha256"],
            "back_sha256": row["back_sha256"],
            "image_pair_sha256": row["image_pair_sha256"],
            "front_reference_sha256": row["front_reference_sha256"],
            "back_reference_sha256": row["back_reference_sha256"],
            "front_perceptual_hash": row["front_perceptual_hash"],
            "back_perceptual_hash": row["back_perceptual_hash"],
            "local_suggestion": (
                json.loads(row["local_suggestion_json"])
                if row["local_suggestion_json"]
                else None
            ),
            "local_vision": (
                json.loads(row["local_vision_json"])
                if row["local_vision_json"]
                else None
            ),
            "checklist": json.loads(row["checklist_json"]),
            "status": row["status"],
        }

    def create_lesson(self, request: LessonCreate) -> LessonRecord:
        scan = self.get_scan(request.scan_id)
        if scan is None:
            raise ValueError("Unknown scan_id")
        lesson = LessonRecord(
            lesson_id=str(uuid4()),
            scan_id=request.scan_id,
            state=request.state,
            identity=request.identity,
            verification_source=request.verification_source,
            operator_id=request.operator_id,
            notes=request.notes,
            rejected_identity=request.rejected_identity,
            identity_fingerprint=identity_fingerprint(request.identity),
            created_at=utc_now(),
            trusted=request.state in TRUSTED_STATES,
        )
        training_example = build_training_example(lesson=lesson, scan=scan)
        lesson = lesson.model_copy(
            update={"training_example_id": training_example.training_example_id}
        )
        with self.connection() as db:
            db.execute(
                """
                INSERT INTO lessons (
                    lesson_id, scan_id, state, identity_json,
                    rejected_identity_json, verification_source, operator_id, notes,
                    identity_fingerprint, trusted, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    lesson.lesson_id,
                    lesson.scan_id,
                    lesson.state.value,
                    lesson.identity.model_dump_json(),
                    (
                        lesson.rejected_identity.model_dump_json()
                        if lesson.rejected_identity
                        else None
                    ),
                    lesson.verification_source,
                    lesson.operator_id,
                    lesson.notes,
                    lesson.identity_fingerprint,
                    int(lesson.trusted),
                    lesson.created_at.isoformat(),
                ),
            )
            db.execute(
                """
                INSERT INTO training_examples (
                    training_example_id, lesson_id, scan_id, trusted,
                    example_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    training_example.training_example_id,
                    lesson.lesson_id,
                    lesson.scan_id,
                    int(training_example.trusted),
                    training_example.model_dump_json(),
                    training_example.created_at.isoformat(),
                ),
            )
        return lesson

    @staticmethod
    def _memory_match(row: sqlite3.Row, score: float, reasons: list[str]) -> MemoryMatch:
        return MemoryMatch(
            lesson_id=row["lesson_id"],
            identity=CardIdentity.model_validate_json(row["identity_json"]),
            score=max(0.0, min(1.0, round(score, 4))),
            verification_state=LearningState(row["state"]),
            reasons=reasons,
        )

    def find_trusted_image_match(
        self,
        *,
        image_pair_sha256: str,
        front_perceptual_hash: str,
        back_perceptual_hash: str | None,
    ) -> MemoryMatch | None:
        with self.connection() as db:
            exact = db.execute(
                """
                SELECT l.*
                FROM lessons l
                JOIN scans s ON s.scan_id = l.scan_id
                WHERE l.trusted = 1 AND s.image_pair_sha256 = ?
                ORDER BY l.created_at DESC
                LIMIT 1
                """,
                (image_pair_sha256,),
            ).fetchone()
            if exact:
                return self._memory_match(exact, 1.0, ["exact_image_pair"])

            rows = db.execute(
                """
                SELECT l.*, s.front_perceptual_hash, s.back_perceptual_hash
                FROM lessons l
                JOIN scans s ON s.scan_id = l.scan_id
                WHERE l.trusted = 1 AND s.front_perceptual_hash IS NOT NULL
                ORDER BY l.created_at DESC
                LIMIT 2000
                """
            ).fetchall()

        # Near-visual automation requires both sides. One-sided or looser
        # matches fall through to the Ollama backup rather than risking a wrong
        # player, parallel, autograph, relic, inscription, or print run.
        if not back_perceptual_hash:
            return None

        best: tuple[float, sqlite3.Row, list[str]] | None = None
        for row in rows:
            front_distance = perceptual_hash_distance(
                front_perceptual_hash,
                row["front_perceptual_hash"],
            )
            if front_distance is None or front_distance > 4:
                continue

            back_distance = perceptual_hash_distance(
                back_perceptual_hash,
                row["back_perceptual_hash"],
            )
            if back_distance is None or back_distance > 4:
                continue

            reasons = [
                f"front_visual_distance:{front_distance}",
                f"back_visual_distance:{back_distance}",
            ]
            distances = [front_distance, back_distance]
            score = 1.0 - (sum(distances) / len(distances)) / 64.0
            if score < 0.9375:
                continue
            reasons.append("trusted_visual_memory")
            if best is None or score > best[0]:
                best = (score, row, reasons)

        return self._memory_match(best[1], best[0], best[2]) if best else None

    def search(self, identity: CardIdentity, limit: int = 10) -> list[MemoryMatch]:
        requested = identity.model_dump()
        with self.connection() as db:
            rows = db.execute(
                "SELECT * FROM lessons WHERE trusted = 1 "
                "ORDER BY created_at DESC LIMIT 1000"
            ).fetchall()
        weights = {
            "player": 0.22,
            "year": 0.10,
            "set_name": 0.16,
            "card_number": 0.18,
            "parallel": 0.10,
            "brand": 0.05,
            "manufacturer": 0.04,
            "sport": 0.03,
            "serial_run": 0.04,
            "autograph": 0.03,
            "inscription": 0.02,
            "memorabilia": 0.03,
        }
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
            if possible and score / possible >= 0.5:
                matches.append(
                    self._memory_match(row, score / possible, evidence)
                )
        return sorted(matches, key=lambda item: item.score, reverse=True)[:limit]

    def list_training_examples(
        self,
        *,
        trusted_only: bool = True,
        limit: int = 2000,
    ) -> list[TrainingExample]:
        bounded_limit = max(1, min(int(limit), 100_000))
        sql = "SELECT example_json FROM training_examples"
        parameters: tuple[object, ...] = ()
        if trusted_only:
            sql += " WHERE trusted = 1"
        sql += " ORDER BY created_at DESC LIMIT ?"
        parameters = (bounded_limit,)
        with self.connection() as db:
            rows = db.execute(sql, parameters).fetchall()
        return [
            TrainingExample.model_validate_json(row["example_json"])
            for row in rows
        ]
