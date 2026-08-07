#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:140]!r}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


def replace_count(path: Path, old: str, new: str, expected: int) -> None:
    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} matches, found {count}: {old[:140]!r}")
    path.write_text(source.replace(old, new), encoding="utf-8")


root = Path(__file__).resolve().parents[1]
service = root / "services" / "instacomp-ai"
models = service / "app" / "models.py"
storage = service / "app" / "storage.py"
main = service / "app" / "main.py"
ollama = service / "app" / "ollama.py"
config = service / "app" / "config.py"
requirements = service / "requirements.txt"

models_marker = '''\n\nclass VisualEvidence(BaseModel):\n'''
models_block = '''\n\nclass OCRBox(BaseModel):\n    x: float = Field(ge=0, le=1)\n    y: float = Field(ge=0, le=1)\n    width: float = Field(ge=0, le=1)\n    height: float = Field(ge=0, le=1)\n\n\nclass OCRObservation(BaseModel):\n    text: str\n    confidence: float = Field(ge=0, le=1)\n    box: OCRBox\n    side: Literal["front", "back", "unknown"]\n    source: str\n\n\nclass ColorEvidence(BaseModel):\n    dominant_colors: list[str] = Field(default_factory=list)\n    proportions: dict[str, float] = Field(default_factory=dict)\n    mean_saturation: float = Field(default=0, ge=0, le=1)\n    mean_brightness: float = Field(default=0, ge=0, le=1)\n    metallic_score: float = Field(default=0, ge=0, le=1)\n\n\nclass PatternEvidence(BaseModel):\n    label: str = "unknown"\n    confidence: float = Field(default=0, ge=0, le=1)\n    scores: dict[str, float] = Field(default_factory=dict)\n    geometry: list[str] = Field(default_factory=list)\n    line_count: int = Field(default=0, ge=0)\n    polygon_count: int = Field(default=0, ge=0)\n    edge_density: float = Field(default=0, ge=0, le=1)\n    dominant_angle: float | None = None\n    angle_concentration: float = Field(default=0, ge=0, le=1)\n    angle_entropy: float = Field(default=0, ge=0, le=1)\n\n\nclass SerialEvidence(BaseModel):\n    stamp_present: bool = False\n    exact_stamp: str | None = None\n    numerator: int | None = Field(default=None, ge=0)\n    visible_denominator: int | None = Field(default=None, ge=1)\n    side: Literal["front", "back", "unknown"] | None = None\n    confidence: float = Field(default=0, ge=0, le=1)\n    source_text: str | None = None\n    box: OCRBox | None = None\n\n\nclass SideVisionEvidence(BaseModel):\n    side: Literal["front", "back"]\n    width: int = Field(ge=1)\n    height: int = Field(ge=1)\n    ocr: list[OCRObservation] = Field(default_factory=list)\n    colors: ColorEvidence = Field(default_factory=ColorEvidence)\n    pattern: PatternEvidence = Field(default_factory=PatternEvidence)\n    errors: list[str] = Field(default_factory=list)\n\n\nclass LocalVisionEvidence(BaseModel):\n    schema_version: Literal["tcos.instacomp-ai.local-vision.v1"] = "tcos.instacomp-ai.local-vision.v1"\n    front: SideVisionEvidence\n    back: SideVisionEvidence | None = None\n    serial: SerialEvidence = Field(default_factory=SerialEvidence)\n    identity_hints: CardIdentity = Field(default_factory=CardIdentity)\n    combined_text: str = ""\n    apple_vision_available: bool = False\n    opencv_available: bool = True\n\n\nclass VisualEvidence(BaseModel):\n'''
replace_once(models, models_marker, models_block)

replace_once(
    models,
    '''    local_suggestion: ModelSuggestion | None = None\n    checklist: ChecklistResult\n''',
    '''    local_suggestion: ModelSuggestion | None = None\n    local_vision: LocalVisionEvidence | None = None\n    checklist: ChecklistResult\n''',
)

replace_once(
    models,
    '''    created_at: datetime\n    trusted: bool\n\n\nclass HealthResponse(BaseModel):\n''',
    '''    created_at: datetime\n    trusted: bool\n    training_example_id: str | None = None\n\n\nclass SerialTruth(BaseModel):\n    visible_stamp_present: bool\n    visible_exact_stamp: str | None = None\n    visible_numerator: int | None = None\n    visible_denominator: int | None = None\n    checklist_print_run: int | None = None\n    physical_copy_serial: str | None = None\n    numerator_is_card_specific: bool = True\n    denominator_is_configuration_level: bool = True\n\n\nclass TrainingExample(BaseModel):\n    training_example_id: str\n    lesson_id: str\n    scan_id: str\n    state: LearningState\n    trusted: bool\n    created_at: datetime\n    verification_source: str\n    operator_id: str | None = None\n    notes: str | None = None\n    confirmed_identity: CardIdentity\n    predicted_identity: CardIdentity | None = None\n    rejected_identity: CardIdentity | None = None\n    correction_fields: list[str] = Field(default_factory=list)\n    local_suggestion: ModelSuggestion | None = None\n    local_vision: LocalVisionEvidence | None = None\n    checklist: ChecklistResult\n    registry_identity_id: str | None = None\n    registry_fingerprint_sha256: str | None = None\n    front_sha256: str\n    back_sha256: str | None = None\n    image_pair_sha256: str\n    front_perceptual_hash: str | None = None\n    back_perceptual_hash: str | None = None\n    serial_truth: SerialTruth\n\n\nclass HealthResponse(BaseModel):\n''',
)

replace_once(
    config,
    '''    image_store_path: Path = Path("./data/images")\n    backup_default_destination: Path = Path("./backups")\n''',
    '''    image_store_path: Path = Path("./data/images")\n    training_export_path: Path = Path("./data/training/exports")\n    backup_default_destination: Path = Path("./backups")\n''',
)
replace_once(
    config,
    '''        self.resolve_local_path(self.image_store_path).mkdir(parents=True, exist_ok=True)\n        self.resolve_local_path(self.backup_default_destination).mkdir(\n''',
    '''        self.resolve_local_path(self.image_store_path).mkdir(parents=True, exist_ok=True)\n        self.resolve_local_path(self.training_export_path).mkdir(parents=True, exist_ok=True)\n        self.resolve_local_path(self.backup_default_destination).mkdir(\n''',
)

replace_once(
    storage,
    '''from .models import CardIdentity, LearningState, LessonCreate, LessonRecord, MemoryMatch\n''',
    '''from .models import (\n    CardIdentity,\n    LearningState,\n    LessonCreate,\n    LessonRecord,\n    MemoryMatch,\n    TrainingExample,\n)\nfrom .training import build_training_example\n''',
)
replace_once(
    storage,
    '''                    local_suggestion_json TEXT,\n                    checklist_json TEXT NOT NULL,\n''',
    '''                    local_suggestion_json TEXT,\n                    local_vision_json TEXT,\n                    checklist_json TEXT NOT NULL,\n''',
)
replace_once(
    storage,
    '''                CREATE INDEX IF NOT EXISTS lessons_trusted_idx ON lessons(trusted, state);\n                """\n''',
    '''                CREATE INDEX IF NOT EXISTS lessons_trusted_idx ON lessons(trusted, state);\n                CREATE TABLE IF NOT EXISTS training_examples (\n                    training_example_id TEXT PRIMARY KEY,\n                    lesson_id TEXT NOT NULL UNIQUE,\n                    scan_id TEXT NOT NULL,\n                    trusted INTEGER NOT NULL DEFAULT 0,\n                    example_json TEXT NOT NULL,\n                    created_at TEXT NOT NULL,\n                    FOREIGN KEY(lesson_id) REFERENCES lessons(lesson_id),\n                    FOREIGN KEY(scan_id) REFERENCES scans(scan_id)\n                );\n                CREATE INDEX IF NOT EXISTS training_examples_trusted_idx\n                ON training_examples(trusted, created_at);\n                """\n''',
)
replace_once(
    storage,
    '''                "back_perceptual_hash",\n            ]:\n''',
    '''                "back_perceptual_hash",\n                "local_vision_json",\n            ]:\n''',
)
replace_once(
    storage,
    '''        local_suggestion: dict | None,\n        checklist: dict,\n''',
    '''        local_suggestion: dict | None,\n        local_vision: dict | None,\n        checklist: dict,\n''',
)
replace_once(
    storage,
    '''                    back_perceptual_hash, local_suggestion_json,\n                    checklist_json, status\n                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n''',
    '''                    back_perceptual_hash, local_suggestion_json,\n                    local_vision_json, checklist_json, status\n                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n''',
)
replace_once(
    storage,
    '''                    json.dumps(local_suggestion) if local_suggestion else None,\n                    json.dumps(checklist),\n                    status,\n''',
    '''                    json.dumps(local_suggestion) if local_suggestion else None,\n                    json.dumps(local_vision) if local_vision else None,\n                    json.dumps(checklist),\n                    status,\n''',
)
replace_once(
    storage,
    '''            "local_suggestion": (\n                json.loads(row["local_suggestion_json"])\n                if row["local_suggestion_json"]\n                else None\n            ),\n            "checklist": json.loads(row["checklist_json"]),\n''',
    '''            "local_suggestion": (\n                json.loads(row["local_suggestion_json"])\n                if row["local_suggestion_json"]\n                else None\n            ),\n            "local_vision": (\n                json.loads(row["local_vision_json"])\n                if row["local_vision_json"]\n                else None\n            ),\n            "checklist": json.loads(row["checklist_json"]),\n''',
)
replace_once(
    storage,
    '''    def create_lesson(self, request: LessonCreate) -> LessonRecord:\n        if not self.scan_exists(request.scan_id):\n            raise ValueError("Unknown scan_id")\n        lesson = LessonRecord(\n''',
    '''    def create_lesson(self, request: LessonCreate) -> LessonRecord:\n        scan = self.get_scan(request.scan_id)\n        if scan is None:\n            raise ValueError("Unknown scan_id")\n        lesson = LessonRecord(\n''',
)
replace_once(
    storage,
    '''            trusted=request.state in TRUSTED_STATES,\n        )\n        with self.connection() as db:\n''',
    '''            trusted=request.state in TRUSTED_STATES,\n        )\n        training_example = build_training_example(lesson=lesson, scan=scan)\n        lesson = lesson.model_copy(\n            update={"training_example_id": training_example.training_example_id}\n        )\n        with self.connection() as db:\n''',
)
replace_once(
    storage,
    '''                    lesson.created_at.isoformat(),\n                ),\n            )\n        return lesson\n''',
    '''                    lesson.created_at.isoformat(),\n                ),\n            )\n            db.execute(\n                """\n                INSERT INTO training_examples (\n                    training_example_id, lesson_id, scan_id, trusted,\n                    example_json, created_at\n                ) VALUES (?, ?, ?, ?, ?, ?)\n                """,\n                (\n                    training_example.training_example_id,\n                    lesson.lesson_id,\n                    lesson.scan_id,\n                    int(training_example.trusted),\n                    training_example.model_dump_json(),\n                    training_example.created_at.isoformat(),\n                ),\n            )\n        return lesson\n''',
)
replace_once(
    storage,
    '''        return sorted(matches, key=lambda item: item.score, reverse=True)[:limit]\n''',
    '''        return sorted(matches, key=lambda item: item.score, reverse=True)[:limit]\n\n    def list_training_examples(\n        self,\n        *,\n        trusted_only: bool = True,\n        limit: int = 2000,\n    ) -> list[TrainingExample]:\n        bounded_limit = max(1, min(int(limit), 100_000))\n        sql = "SELECT example_json FROM training_examples"\n        parameters: tuple[object, ...] = ()\n        if trusted_only:\n            sql += " WHERE trusted = 1"\n        sql += " ORDER BY created_at DESC LIMIT ?"\n        parameters = (bounded_limit,)\n        with self.connection() as db:\n            rows = db.execute(sql, parameters).fetchall()\n        return [\n            TrainingExample.model_validate_json(row["example_json"])\n            for row in rows\n        ]\n''',
)

replace_once(
    main,
    '''from .models import (\n''',
    '''from .local_vision import analyze_local_vision\nfrom .models import (\n''',
)
replace_once(
    main,
    '''from .storage import MemoryStore\n''',
    '''from .storage import MemoryStore\nfrom .training_routes import build_training_router\n''',
)
replace_once(
    main,
    '''image_store_path = settings.resolve_local_path(settings.image_store_path)\nstore = MemoryStore(database_path)\n''',
    '''image_store_path = settings.resolve_local_path(settings.image_store_path)\ntraining_export_path = settings.resolve_local_path(settings.training_export_path)\nstore = MemoryStore(database_path)\n''',
)
replace_once(
    main,
    '''app.include_router(\n    build_cockpit_router(\n        require_api_key,\n        store,\n        reader,\n        checklist_gateway,\n    )\n)\n''',
    '''app.include_router(\n    build_cockpit_router(\n        require_api_key,\n        store,\n        reader,\n        checklist_gateway,\n    )\n)\napp.include_router(\n    build_training_router(\n        require_api_key,\n        store,\n        image_store_path=image_store_path,\n        training_export_path=training_export_path,\n    )\n)\n''',
)
replace_once(
    main,
    '''def _memory_source(match: MemoryMatch) -> str:\n''',
    '''def _merge_identity(primary: CardIdentity, fallback: CardIdentity) -> CardIdentity:\n    values = primary.model_dump()\n    for field, value in fallback.model_dump().items():\n        if values.get(field) in {None, ""} and value not in {None, ""}:\n            values[field] = value\n    return CardIdentity.model_validate(values)\n\n\ndef _memory_source(match: MemoryMatch) -> str:\n''',
)
replace_once(
    main,
    '''    suggestion,\n    checklist_result: ChecklistResult,\n''',
    '''    suggestion,\n    local_vision,\n    checklist_result: ChecklistResult,\n''',
)
replace_once(
    main,
    '''        local_suggestion=(\n            suggestion.model_dump(mode="json") if suggestion else None\n        ),\n        checklist=checklist_result.model_dump(mode="json"),\n''',
    '''        local_suggestion=(\n            suggestion.model_dump(mode="json") if suggestion else None\n        ),\n        local_vision=(\n            local_vision.model_dump(mode="json") if local_vision else None\n        ),\n        checklist=checklist_result.model_dump(mode="json"),\n''',
)
replace_count(
    main,
    '''            suggestion=None,\n            checklist_result=''',
    '''            suggestion=None,\n            local_vision=None,\n            checklist_result=''',
    1,
)
replace_once(
    main,
    '''            local_suggestion=None,\n            checklist=checklist_result,\n''',
    '''            local_suggestion=None,\n            local_vision=None,\n            checklist=checklist_result,\n''',
)
replace_once(
    main,
    '''    # PRIMARY ENGINE STEP TWO: bounded printed text and the Checklist\n''',
    '''    local_vision = await analyze_local_vision(\n        front_image.content,\n        back_image.content if back_image else None,\n        settings,\n    )\n    printed_identity = _merge_identity(printed_identity, local_vision.identity_hints)\n    printed_text = "\\n".join(\n        value\n        for value in [printed_text, local_vision.combined_text]\n        if value\n    ) or None\n\n    # PRIMARY ENGINE STEP TWO: bounded printed text and the Checklist\n''',
)
replace_count(
    main,
    '''            suggestion=None,\n            checklist_result=printed_registry,''',
    '''            suggestion=None,\n            local_vision=local_vision,\n            checklist_result=printed_registry,''',
    1,
)
replace_once(
    main,
    '''            local_suggestion=None,\n            checklist=printed_registry,\n''',
    '''            local_suggestion=None,\n            local_vision=local_vision,\n            checklist=printed_registry,\n''',
)
replace_once(
    main,
    '''        suggestion = await reader.analyze(\n            front_image.content,\n            back_image.content if back_image else None,\n        )\n''',
    '''        suggestion = await reader.analyze(\n            front_image.content,\n            back_image.content if back_image else None,\n            local_vision=local_vision,\n        )\n''',
)
replace_once(
    main,
    '''        local_suggestion=suggestion,\n        checklist=checklist_result,\n''',
    '''        local_suggestion=suggestion,\n        local_vision=local_vision,\n        checklist=checklist_result,\n''',
)
replace_once(
    main,
    '''        suggestion=suggestion,\n        checklist_result=checklist_result,\n''',
    '''        suggestion=suggestion,\n        local_vision=local_vision,\n        checklist_result=checklist_result,\n''',
)

replace_once(
    ollama,
    '''from .models import CardIdentity, ModelSuggestion, VisualEvidence\n''',
    '''from .models import CardIdentity, LocalVisionEvidence, ModelSuggestion, VisualEvidence\n''',
)
replace_once(
    ollama,
    '''- For Panini Prizm WNBA and Panini Select WNBA, the word PRIZM in back_visible_text is the printed proof that a Prizm parallel exists. If the back does not say PRIZM, return parallel Base even when the front has a colored design. Do not remove Prizm or Select from the product/set name.\n- A colored Prizm name such as Green Prizm, Silver Prizm, Blue Prizm, or Red Prizm requires visible color/finish evidence plus PRIZM in back_visible_text.\n''',
    '''- The word PRIZM on the back is useful positive evidence, but its absence is not proof of Base. Never force Base solely because OCR missed PRIZM.\n- Use deterministic Apple Vision OCR, OpenCV color/pattern measurements, visible serial evidence, and Checklist Registry candidates together.\n- A colored Prizm name such as Green Prizm, Silver Prizm, Blue Prizm, or Red Prizm requires visible color/finish evidence and must ultimately be locked by the Registry.\n''',
)
replace_once(
    ollama,
    '''class OllamaReader:\n''',
    '''def local_vision_prompt_payload(local_vision: LocalVisionEvidence | None) -> dict | None:\n    if local_vision is None:\n        return None\n    return {\n        "identity_hints": local_vision.identity_hints.model_dump(mode="json"),\n        "serial": local_vision.serial.model_dump(mode="json"),\n        "front": {\n            "ocr": [value.model_dump(mode="json") for value in local_vision.front.ocr[:100]],\n            "colors": local_vision.front.colors.model_dump(mode="json"),\n            "pattern": local_vision.front.pattern.model_dump(mode="json"),\n        },\n        "back": (\n            {\n                "ocr": [value.model_dump(mode="json") for value in local_vision.back.ocr[:100]],\n                "colors": local_vision.back.colors.model_dump(mode="json"),\n                "pattern": local_vision.back.pattern.model_dump(mode="json"),\n            }\n            if local_vision.back\n            else None\n        ),\n    }\n\n\ndef merge_local_vision_payload(payload: dict, local_vision: LocalVisionEvidence | None) -> dict:\n    if local_vision is None:\n        return payload\n    root = dict(payload)\n    identity = dict(root.get("identity") or {})\n    hints = local_vision.identity_hints.model_dump(mode="json")\n    for field, value in hints.items():\n        if identity.get(field) in {None, ""} and value not in {None, ""}:\n            identity[field] = value\n    if local_vision.serial.stamp_present and local_vision.serial.exact_stamp:\n        identity["serial_number"] = local_vision.serial.exact_stamp\n        identity["serial_run"] = local_vision.serial.visible_denominator\n    evidence = dict(root.get("evidence") or {})\n    front_text = [value.text for value in local_vision.front.ocr]\n    back_text = [value.text for value in local_vision.back.ocr] if local_vision.back else []\n    evidence["front_visible_text"] = list(dict.fromkeys([*(evidence.get("front_visible_text") or []), *front_text]))\n    evidence["back_visible_text"] = list(dict.fromkeys([*(evidence.get("back_visible_text") or []), *back_text]))\n    evidence["visible_text"] = list(dict.fromkeys([*(evidence.get("visible_text") or []), *front_text, *back_text]))\n    evidence["colors"] = list(dict.fromkeys([\n        *(evidence.get("colors") or []),\n        *local_vision.front.colors.dominant_colors,\n        *(local_vision.back.colors.dominant_colors if local_vision.back else []),\n    ]))\n    evidence["foil_or_pattern"] = list(dict.fromkeys([\n        *(evidence.get("foil_or_pattern") or []),\n        local_vision.front.pattern.label,\n        *local_vision.front.pattern.geometry,\n    ]))\n    root["identity"] = identity\n    root["evidence"] = evidence\n    return root\n\n\nclass OllamaReader:\n''',
)
replace_once(
    ollama,
    '''    async def analyze(self, front: bytes, back: bytes | None) -> ModelSuggestion:\n''',
    '''    async def analyze(\n        self,\n        front: bytes,\n        back: bytes | None,\n        *,\n        local_vision: LocalVisionEvidence | None = None,\n    ) -> ModelSuggestion:\n''',
)
replace_once(
    ollama,
    '''            + json.dumps(OLLAMA_OUTPUT_SCHEMA, separators=(",", ":"))\n        )\n''',
    '''            + json.dumps(OLLAMA_OUTPUT_SCHEMA, separators=(",", ":"))\n            + "\\nDeterministic local evidence (trust exact OCR boxes, serial parsing, and measured geometry over visual guessing):\\n"\n            + json.dumps(local_vision_prompt_payload(local_vision), separators=(",", ":"), ensure_ascii=False)\n        )\n''',
)
replace_once(
    ollama,
    '''        parsed = normalize_identity_payload(\n            extract_json(str(message.get("content") or ""))\n        )\n''',
    '''        parsed = normalize_identity_payload(\n            merge_local_vision_payload(\n                extract_json(str(message.get("content") or "")),\n                local_vision,\n            )\n        )\n''',
)
replace_once(
    ollama,
    '''                "prepared_image_bytes": [len(image) for image in prepared_images],\n            },\n''',
    '''                "prepared_image_bytes": [len(image) for image in prepared_images],\n                "deterministic_local_evidence": local_vision is not None,\n            },\n''',
)

requirements_text = requirements.read_text(encoding="utf-8")
for line in ["numpy==2.2.6", "opencv-python-headless==4.12.0.88"]:
    if line not in requirements_text:
        requirements_text += line + "\n"
requirements.write_text(requirements_text, encoding="utf-8")

for path in [models, storage, main, ollama, config, requirements]:
    print(f"patched {path.relative_to(root)}")
