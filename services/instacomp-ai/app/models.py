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


class OCRBox(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(ge=0, le=1)
    height: float = Field(ge=0, le=1)


class OCRObservation(BaseModel):
    text: str
    confidence: float = Field(ge=0, le=1)
    box: OCRBox
    side: Literal["front", "back", "unknown"]
    source: str


class ColorEvidence(BaseModel):
    dominant_colors: list[str] = Field(default_factory=list)
    proportions: dict[str, float] = Field(default_factory=dict)
    mean_saturation: float = Field(default=0, ge=0, le=1)
    mean_brightness: float = Field(default=0, ge=0, le=1)
    metallic_score: float = Field(default=0, ge=0, le=1)


class PatternEvidence(BaseModel):
    label: str = "unknown"
    confidence: float = Field(default=0, ge=0, le=1)
    scores: dict[str, float] = Field(default_factory=dict)
    geometry: list[str] = Field(default_factory=list)
    line_count: int = Field(default=0, ge=0)
    polygon_count: int = Field(default=0, ge=0)
    edge_density: float = Field(default=0, ge=0, le=1)
    dominant_angle: float | None = None
    angle_concentration: float = Field(default=0, ge=0, le=1)
    angle_entropy: float = Field(default=0, ge=0, le=1)


class SerialEvidence(BaseModel):
    stamp_present: bool = False
    exact_stamp: str | None = None
    numerator: int | None = Field(default=None, ge=0)
    visible_denominator: int | None = Field(default=None, ge=1)
    side: Literal["front", "back", "unknown"] | None = None
    confidence: float = Field(default=0, ge=0, le=1)
    source_text: str | None = None
    box: OCRBox | None = None


class SideVisionEvidence(BaseModel):
    side: Literal["front", "back"]
    width: int = Field(ge=1)
    height: int = Field(ge=1)
    ocr: list[OCRObservation] = Field(default_factory=list)
    colors: ColorEvidence = Field(default_factory=ColorEvidence)
    pattern: PatternEvidence = Field(default_factory=PatternEvidence)
    errors: list[str] = Field(default_factory=list)


class LocalVisionEvidence(BaseModel):
    schema_version: Literal["tcos.instacomp-ai.local-vision.v1"] = "tcos.instacomp-ai.local-vision.v1"
    front: SideVisionEvidence
    back: SideVisionEvidence | None = None
    serial: SerialEvidence = Field(default_factory=SerialEvidence)
    identity_hints: CardIdentity = Field(default_factory=CardIdentity)
    combined_text: str = ""
    apple_vision_available: bool = False
    opencv_available: bool = True


class VisualEvidence(BaseModel):
    visible_text: list[str] = Field(default_factory=list)
    front_visible_text: list[str] = Field(default_factory=list)
    back_visible_text: list[str] = Field(default_factory=list)
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
    # Permanent UUID for this exact physical card. On first ingest this equals
    # scan_id; later rescans get a new scan_id but keep this card_uuid.
    card_uuid: str | None = None
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
    back_evidence: list[str] = Field(default_factory=list)
    memory_matches: list[MemoryMatch] = Field(default_factory=list)
    local_suggestion: ModelSuggestion | None = None
    local_vision: LocalVisionEvidence | None = None
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
