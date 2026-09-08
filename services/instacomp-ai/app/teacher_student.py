from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

CRITICAL_FIELDS = (
    "year", "manufacturer", "brand", "set_name", "player", "card_number",
    "parallel", "serial_run", "rookie", "autograph",
)


def _norm(value: Any) -> Any:
    if isinstance(value, str):
        return " ".join(value.strip().lower().split()) or None
    return value


def score_verified_fields(truth: dict[str, Any], candidate: dict[str, Any] | None) -> tuple[int, int]:
    """Score only operator/checklist-confirmed non-null fields; unknown truth is not evidence."""
    candidate = candidate or {}
    verified = [field for field in CRITICAL_FIELDS if truth.get(field) is not None]
    correct = sum(_norm(candidate.get(field)) == _norm(truth.get(field)) for field in verified)
    return correct, len(verified)


def arbitrate_teacher_student(
    *, truth: dict[str, Any], teacher: dict[str, Any] | None, student: dict[str, Any] | None,
) -> dict[str, Any]:
    teacher_correct, verified = score_verified_fields(truth, teacher)
    student_correct, _ = score_verified_fields(truth, student)
    if verified == 0:
        outcome = "ambiguous"
    elif teacher_correct > student_correct:
        outcome = "teacher_win"
    elif student_correct > teacher_correct:
        outcome = "student_win"
    else:
        outcome = "tie"
    return {
        "outcome": outcome,
        "verified_fields": verified,
        "teacher_correct": teacher_correct,
        "student_correct": student_correct,
        "truth_authority": "operator_or_checklist",
    }


def load_frozen_ids(path: Path) -> set[str]:
    if not path.is_file():
        return set()
    payload = json.loads(path.read_text("utf-8"))
    values: Iterable[Any] = payload.get("ids", []) if isinstance(payload, dict) else payload
    return {str(value) for value in values if str(value).strip()}


def curriculum_readiness(*, train_examples: int, hard_examples: int, min_train: int, min_hard: int) -> dict[str, Any]:
    ready = train_examples >= min_train and hard_examples >= min_hard
    return {
        "ready": ready,
        "train_examples": train_examples,
        "hard_examples": hard_examples,
        "minimum_train_examples": min_train,
        "minimum_hard_examples": min_hard,
        "missing_train_examples": max(0, min_train - train_examples),
        "missing_hard_examples": max(0, min_hard - hard_examples),
    }
