from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class LearningState(str, Enum):
    OBSERVED = "OBSERVED"
    OPERATOR_CONFIRMED = "OPERATOR_CONFIRMED"
    CHECKLIST_CONFIRMED = "CHECKLIST_CONFIRMED"
    REJECTED = "REJECTED"


class ChecklistOutcome(str, Enum):
    NOT_CONFIGURED = "NOT_CONFIGURED"
    NO_SET_MATCH = "NO_SET_MATCH"
    SET_PRESENT_NO_EXACT_MATCH = "SET_PRESENT_NO_EXACT_MATCH"
    EXACT_MATCH = "EXACT_MATCH"
    AMBIGUOUS = "AMBIGUOUS"


class CardIdentity(BaseModel):
    year: str | None = None
    manufacturer: str | None = None
    brand: str | None = None
    set_name: str | None = None
    subset: str | None = None
    card_number: str | None = None
    player: str | None = None
    team: str | None = None
    parallel: str | None = None
    serial_run: int | None = None
    rookie: bool | None = None
    autograph: bool | None = None
    memorabilia: bool | None = None
    memorabilia_type: str | None = None
    inscription: bool | None = None
    inscription_text: str | None = None


class VisualEvidence(BaseModel):
    front_visible_text: list[str] = Field(default_factory=list)
    back_visible_text: list[str] = Field(default_factory=list)
    front_notes: list[str] = Field(default_factory=list)
    back_notes: list[str] = Field(default_factory=list)
    serial_markings: list[str] = Field(default_factory=list)
    rookie_markers: list[str] = Field(default_factory=list)
    autograph_markers: list[str] = Field(default_factory=list)
    memorabilia_markers: list[str] = Field(default_factory=list)
    inscription_markers: list[str] = Field(default_factory=list)


class ModelSuggestion(BaseModel):
    provider: str
    model: str
    identity: CardIdentity
    evidence: VisualEvidence = Field(default_factory=VisualEvidence)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    explanation: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class LocalVisionEvidence(BaseModel):
    schema_version: str
    front_width: int | None = None
    front_height: int | None = None
    back_width: int | None = None
    back_height: int | None = None
    front_visible_text: list[str] = Field(default_factory=list)
    back_visible_text: list[str] = Field(default_factory=list)
    front_text_confidence: float | None = None
    back_text_confidence: float | None = None
    extracted_card_number: str | None = None
    extracted_year: str | None = None
    extracted_player: str | None = None
    extracted_manufacturer: str | None = None
    extracted_set_name: str | None = None
    extracted_parallel: str | None = None
    extracted_team: str | None = None
    rookie: bool | None = None
    autograph: bool | None = None
    memorabilia: bool | None = None
    memorabilia_type: str | None = None
    inscription: bool | None = None
    inscription_text: str | None = None
    visible_exact_serial: str | None = None
    visible_serial_numerator: int | None = None
    visible_serial_denominator: int | None = None
    serial_markings: list[str] = Field(default_factory=list)
    rookie_markers: list[str] = Field(default_factory=list)
    autograph_markers: list[str] = Field(default_factory=list)
    memorabilia_markers: list[str] = Field(default_factory=list)
    inscription_markers: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class ChecklistResult(BaseModel):
    outcome: ChecklistOutcome
    identity: CardIdentity | None = None
    candidate_count: int = 0
    reasons: list[str] = Field(default_factory=list)
    source_receipts: list[str] = Field(default_factory=list)
    identity_id: str | None = None
    identity_fingerprint: str | None = None


class MemoryMatch(BaseModel):
    lesson_id: str
    scan_id: str
    identity: CardIdentity
    state: LearningState
    trusted: bool
    score: float = Field(ge=0.0, le=1.0)
    reasons: list[str] = Field(default_factory=list)
    image_pair_sha256: str | None = None
    front_sha256: str | None = None
    back_sha256: str | None = None
    front_perceptual_hash: str | None = None
    back_perceptual_hash: str | None = None


class AnalyzeResponse(BaseModel):
    scan_id: str
    card_uuid: str
    created_at: datetime
    status: str
    front_sha256: str
    back_sha256: str | None = None
    image_pair_sha256: str
    front_reference_sha256: str | None = None
    back_reference_sha256: str | None = None
    front_perceptual_hash: str | None = None
    back_perceptual_hash: str | None = None
    back_evidence: list[str] = Field(default_factory=list)
    memory_matches: list[MemoryMatch] = Field(default_factory=list)
    local_suggestion: ModelSuggestion | None = None
    local_vision: LocalVisionEvidence | None = None
    checklist: ChecklistResult
    trusted_identity: CardIdentity | None = None
    match_source: str | None = None
    visual_match_score: float | None = None
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
    training_example_id: str | None = None


class SerialTruth(BaseModel):
    visible_stamp_present: bool
    visible_exact_stamp: str | None = None
    visible_numerator: int | None = None
    visible_denominator: int | None = None
    checklist_print_run: int | None = None
    physical_copy_serial: str | None = None
    numerator_is_card_specific: bool = True
    denominator_is_configuration_level: bool = True


class TrainingExample(BaseModel):
    training_example_id: str
    lesson_id: str
    scan_id: str
    # Tracking metadata only. It is never a visual identity target.
    card_uuid: str | None = None
    state: LearningState
    trusted: bool
    created_at: datetime
    verification_source: str
    operator_id: str | None = None
    notes: str | None = None
    confirmed_identity: CardIdentity
    predicted_identity: CardIdentity | None = None
    rejected_identity: CardIdentity | None = None
    correction_fields: list[str] = Field(default_factory=list)
    local_suggestion: ModelSuggestion | None = None
    local_vision: LocalVisionEvidence | None = None
    checklist: ChecklistResult
    registry_identity_id: str | None = None
    registry_fingerprint_sha256: str | None = None
    front_sha256: str
    back_sha256: str | None = None
    image_pair_sha256: str
    front_perceptual_hash: str | None = None
    back_perceptual_hash: str | None = None
    serial_truth: SerialTruth


class HealthResponse(BaseModel):
    ok: bool
    app: str
    codename: str
    version: str
    database: Literal["ready", "error"]
    ollama: Literal["ready", "unavailable", "unchecked"]
    ollama_model: str
    checklist: Literal["not_configured", "ready"]
    lora_candidate: Literal["enabled", "disabled"] = "disabled"
    lora_candidate_url: str | None = None
