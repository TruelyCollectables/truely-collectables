from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class LearningState(str, Enum):
    OBSERVED = "observed"
    TEACHER_SUGGESTED = "teacher_suggested"
    OPERATOR_CONFIRMED = "operator_confirmed"
    CHECKLIST_CONFIRMED = "checklist_confirmed"
    REJECTED = "rejected"
    QUARANTINED = "quarantined"


class CardIdentity(BaseModel):
    sport: str | None = None
    league: str | None = None
    year: str | None = None
    manufacturer: str | None = None
    brand: str | None = None
    set_name: str | None = None
    subset: str | None = None
    player: str | None = None
    team: str | None = None
    card_number: str | None = None
    parallel: str | None = None
    variation: str | None = None
    serial_number: str | None = None
    serial_run: int | None = None
    rookie: bool | None = None
    autograph: bool | None = None
    inscription: bool | None = None
    inscription_text: str | None = None
    memorabilia: bool | None = None
    memorabilia_type: str | None = None

    @field_validator("serial_run")
    @classmethod
    def validate_serial_run(cls, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise ValueError("serial_run must be positive")
        return value


class VisualEvidence(BaseModel):
    visible_text: list[str] = Field(default_factory=list)
    logos: list[str] = Field(default_factory=list)
    colors: list[str] = Field(default_factory=list)
    foil_or_pattern: list[str] = Field(default_factory=list)
    front_notes: list[str] = Field(default_factory=list)
    back_notes: list[str] = Field(default_factory=list)
    uncertainty: list[str] = Field(default_factory=list)


class ModelSuggestion(BaseModel):
    provider: str
    model: str
    identity: CardIdentity
    evidence: VisualEvidence = Field(default_factory=VisualEvidence)
    confidence: float = Field(ge=0, le=1)
    explanation: str
    raw: dict[str, Any] = Field(default_factory=dict)


class ChecklistOutcome(str, Enum):
    NOT_CONFIGURED = "not_configured"
    INPUT_INCOMPLETE = "input_incomplete"
    SET_ABSENT = "set_absent"
    SET_PRESENT_NO_EXACT_MATCH = "set_present_no_exact_match"
    EXACT_MATCH = "exact_match"


class ChecklistResult(BaseModel):
    outcome: ChecklistOutcome
    identity_id: str | None = None
    identity: CardIdentity | None = None
    candidate_count: int = 0
    reasons: list[str] = Field(default_factory=list)
    source_receipts: list[str] = Field(default_factory=list)


class MemoryMatch(BaseModel):
    lesson_id: str
    identity: CardIdentity
    score: float = Field(ge=0, le=1)
    verification_state: LearningState
    verification_source: str | None = None
    reasons: list[str] = Field(default_factory=list)


class AnalyzeResponse(BaseModel):
    schema_version: Literal["tcos.instacomp-ai.scan.v1"] = "tcos.instacomp-ai.scan.v1"
    scan_id: str
    created_at: datetime
    status: Literal[
        "trusted_memory_match",
        "needs_checklist",
        "needs_review",
        "model_unavailable",
    ]
    front_sha256: str
    back_sha256: str | None = None
    image_pair_sha256: str
    front_reference_sha256: str | None = None
    back_reference_sha256: str | None = None
    front_perceptual_hash: str | None = None
    back_perceptual_hash: str | None = None
    memory_matches: list[MemoryMatch] = Field(default_factory=list)
    local_suggestion: ModelSuggestion | None = None
    checklist: ChecklistResult
    trusted_identity: CardIdentity | None = None
    match_source: Literal[
        "exact_image_pair",
        "visual_memory",
        "trusted_text_memory",
        "checklist_registry",
        "ollama_backup",
        "none",
    ] = "none"
    visual_match_score: float | None = Field(default=None, ge=0, le=1)
    canonical_filename: str | None = None
    pricing_allowed: bool = False
    learning_allowed: bool = False
    next_action: str


class LessonCreate(BaseModel):
    scan_id: str
    state: LearningState
    identity: CardIdentity
    verification_source: str = Field(min_length=2, max_length=200)
    operator_id: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=4000)
    rejected_identity: CardIdentity | None = None


class LessonRecord(BaseModel):
    lesson_id: str
    scan_id: str
    state: LearningState
    identity: CardIdentity
    verification_source: str
    operator_id: str | None
    notes: str | None
    rejected_identity: CardIdentity | None
    identity_fingerprint: str
    created_at: datetime
    trusted: bool


class HealthResponse(BaseModel):
    ok: bool
    app: str
    codename: str
    version: str
    database: Literal["ready", "error"]
    ollama: Literal["ready", "unavailable", "unchecked"]
    ollama_model: str
    checklist: Literal["not_configured", "ready"]
