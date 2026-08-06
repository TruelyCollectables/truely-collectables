from __future__ import annotations

import re
from datetime import datetime, timezone
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from .backup_routes import build_backup_router
from .checklist import checklist_gateway
from .cockpit_routes import build_cockpit_router
from .config import settings
from .images import (
    pair_hash,
    persist_image,
    persisted_image_path,
    validate_and_normalize_image,
)
from .models import (
    AnalyzeResponse,
    CardIdentity,
    ChecklistOutcome,
    ChecklistResult,
    HealthResponse,
    LearningState,
    LessonCreate,
    LessonRecord,
    MemoryMatch,
)
from .ollama import OllamaReader
from .printed_evidence import (
    identity_from_printed_evidence,
    parse_printed_evidence,
)
from .settings_routes import build_settings_router
from .storage import MemoryStore

settings.ensure_directories()
database_path = settings.resolve_local_path(settings.database_path)
image_store_path = settings.resolve_local_path(settings.image_store_path)
store = MemoryStore(database_path)
store.initialize()
reader = OllamaReader(settings)

app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description=(
        "Private InstaComp internal memory engine with Checklist Registry locking, "
        "Ollama backup vision, and no direct OpenAI dependency."
    ),
)


def require_api_key(
    x_instacomp_ai_key: str | None = Header(default=None),
) -> None:
    if settings.api_key and x_instacomp_ai_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid InstaComp AI key")


app.include_router(build_settings_router(require_api_key))
app.include_router(build_backup_router(require_api_key))
app.include_router(
    build_cockpit_router(
        require_api_key,
        store,
        reader,
        checklist_gateway,
    )
)


def _slug(value: object) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower())
    return normalized.strip("-")


def canonical_filename(identity: CardIdentity | None) -> str | None:
    if not identity:
        return None
    parts: list[str] = []
    for value in [
        identity.year,
        identity.manufacturer or identity.brand,
        identity.set_name,
        identity.subset,
        identity.player,
    ]:
        if _slug(value):
            parts.append(_slug(value))
    if identity.card_number:
        parts.append(f"card-{_slug(identity.card_number)}")
    if identity.parallel:
        parts.append(_slug(identity.parallel))
    if identity.rookie:
        parts.append("rookie")
    if identity.autograph:
        parts.append("autograph")
    if identity.inscription:
        parts.append("inscription")
        if identity.inscription_text:
            parts.append(_slug(identity.inscription_text)[:80])
    if identity.memorabilia:
        parts.append("memorabilia")
        if identity.memorabilia_type:
            parts.append(_slug(identity.memorabilia_type)[:80])
    # The copy number is intentionally excluded. Only the print run belongs in
    # the canonical card identity and filename.
    if identity.serial_run:
        parts.append(f"print-run-{identity.serial_run}")
    return "-".join(part for part in parts if part) or None


def _memory_source(match: MemoryMatch) -> str:
    return (
        "exact_image_pair"
        if "exact_image_pair" in match.reasons
        else "visual_memory"
    )


def _memory_checklist_result(match: MemoryMatch) -> ChecklistResult:
    return ChecklistResult(
        outcome=ChecklistOutcome.SET_PRESENT_NO_EXACT_MATCH,
        identity=match.identity,
        candidate_count=1,
        reasons=[
            "Trusted InstaComp memory identified this card before any backup model ran.",
            *match.reasons,
        ],
        source_receipts=[f"trusted_memory_lesson:{match.lesson_id}"],
    )


def _trusted_memory_back_evidence(
    match: MemoryMatch,
    has_back_image: bool,
) -> list[str]:
    if not has_back_image:
        return []
    evidence: list[str] = []
    parallel = str(match.identity.parallel or "").strip()
    if "prizm" in parallel.lower():
        evidence.append(
            "PRIZM verified by trusted operator/checklist-confirmed back-image memory"
        )
    if match.identity.serial_run:
        evidence.append(
            f"PRINT RUN /{match.identity.serial_run} verified by trusted back-image memory"
        )
    evidence.append(
        f"TRUSTED BACK IMAGE MATCH ({', '.join(match.reasons)})"
    )
    return evidence


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    database_ready = store.ready()
    ollama_ready = await reader.health()
    checklist_ready = await checklist_gateway.health()
    # Ollama is a backup reader. Its outage must not mark the internal memory
    # engine unhealthy.
    return HealthResponse(
        ok=database_ready and checklist_ready,
        app=settings.app_name,
        codename=settings.codename,
        version=settings.version,
        database="ready" if database_ready else "error",
        ollama="ready" if ollama_ready else "unavailable",
        ollama_model=settings.ollama_model,
        checklist="ready" if checklist_ready else "not_configured",
    )


@app.get(
    "/v1/scans/{scan_id}/archive",
    dependencies=[Depends(require_api_key)],
)
async def archived_scan(scan_id: str):
    normalized_scan_id = scan_id.strip()
    if not normalized_scan_id or len(normalized_scan_id) > 100:
        raise HTTPException(status_code=400, detail="Invalid scan_id")
    scan = store.get_scan(normalized_scan_id)
    if scan is None:
        raise HTTPException(status_code=404, detail="Archived scan was not found")
    return {
        "schema_version": "tcos.instacomp-ai.scan-archive.v1",
        **scan,
        "has_front_image": persisted_image_path(
            image_store_path,
            scan["front_sha256"],
            "front",
        ).is_file(),
        "has_back_image": bool(
            scan["back_sha256"]
            and persisted_image_path(
                image_store_path,
                scan["back_sha256"],
                "back",
            ).is_file()
        ),
    }


@app.get(
    "/v1/scans/{scan_id}/images/{side}",
    dependencies=[Depends(require_api_key)],
)
async def archived_scan_image(scan_id: str, side: str):
    normalized_scan_id = scan_id.strip()
    normalized_side = side.strip().lower()
    if not normalized_scan_id or len(normalized_scan_id) > 100:
        raise HTTPException(status_code=400, detail="Invalid scan_id")
    if normalized_side not in {"front", "back"}:
        raise HTTPException(status_code=400, detail="Image side must be front or back")

    scan = store.get_scan(normalized_scan_id)
    if scan is None:
        raise HTTPException(status_code=404, detail="Archived scan was not found")
    image_sha256 = scan[f"{normalized_side}_sha256"]
    if not image_sha256:
        raise HTTPException(
            status_code=404,
            detail=f"Archived scan has no {normalized_side} image",
        )

    image_path = persisted_image_path(
        image_store_path,
        image_sha256,
        normalized_side,
    )
    if not image_path.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"Archived {normalized_side} image file was not found",
        )
    return FileResponse(
        image_path,
        media_type="image/jpeg",
        filename=f"{normalized_scan_id}-{normalized_side}.jpg",
        headers={
            "Cache-Control": "private, no-store",
            "X-InstaComp-Image-SHA256": image_sha256,
        },
    )


def _save_scan(
    *,
    scan_id: str,
    created_at: datetime,
    front_image,
    back_image,
    combined_hash: str,
    suggestion,
    checklist_result: ChecklistResult,
    status: str,
) -> None:
    store.save_scan(
        scan_id=scan_id,
        created_at=created_at,
        front_sha256=front_image.sha256,
        back_sha256=back_image.sha256 if back_image else None,
        image_pair_sha256=combined_hash,
        front_reference_sha256=front_image.reference_sha256,
        back_reference_sha256=(
            back_image.reference_sha256 if back_image else None
        ),
        front_perceptual_hash=front_image.perceptual_hash,
        back_perceptual_hash=(back_image.perceptual_hash if back_image else None),
        local_suggestion=(
            suggestion.model_dump(mode="json") if suggestion else None
        ),
        checklist=checklist_result.model_dump(mode="json"),
        status=status,
    )


@app.post(
    "/v1/scans/analyze",
    response_model=AnalyzeResponse,
    dependencies=[Depends(require_api_key)],
)
async def analyze_scan(
    front: UploadFile = File(...),
    back: UploadFile | None = File(default=None),
    printed_evidence_json: str | None = Form(default=None),
) -> AnalyzeResponse:
    front_content = await front.read()
    back_content = await back.read() if back else None
    if len(front_content) + len(back_content or b"") > settings.max_total_image_bytes:
        raise HTTPException(status_code=413, detail="Combined images are too large")
    try:
        front_image = validate_and_normalize_image(
            front_content,
            settings.max_image_bytes,
        )
        back_image = (
            validate_and_normalize_image(
                back_content,
                settings.max_image_bytes,
            )
            if back_content
            else None
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    persist_image(front_image, image_store_path, "front")
    if back_image:
        persist_image(back_image, image_store_path, "back")

    scan_id = str(uuid4())
    created_at = datetime.now(timezone.utc)
    combined_hash = pair_hash(
        front_image.sha256,
        back_image.sha256 if back_image else None,
    )
    printed_evidence = parse_printed_evidence(printed_evidence_json)
    printed_identity = identity_from_printed_evidence(printed_evidence)
    printed_text = printed_evidence.text if printed_evidence else None

    # PRIMARY ENGINE: exact and near-visual trusted InstaComp memory. This path
    # does not call Ollama or OpenAI.
    image_memory = store.find_trusted_image_match(
        image_pair_sha256=combined_hash,
        front_perceptual_hash=front_image.perceptual_hash,
        back_perceptual_hash=(back_image.perceptual_hash if back_image else None),
    )
    if image_memory:
        trusted_identity = image_memory.identity
        registry_result = await checklist_gateway.match(trusted_identity)
        checklist_result = (
            registry_result
            if registry_result.outcome == ChecklistOutcome.EXACT_MATCH
            else _memory_checklist_result(image_memory)
        )
        pricing_allowed = registry_result.outcome == ChecklistOutcome.EXACT_MATCH
        status = "trusted_memory_match"
        _save_scan(
            scan_id=scan_id,
            created_at=created_at,
            front_image=front_image,
            back_image=back_image,
            combined_hash=combined_hash,
            suggestion=None,
            checklist_result=checklist_result,
            status=status,
        )
        return AnalyzeResponse(
            scan_id=scan_id,
            created_at=created_at,
            status=status,
            front_sha256=front_image.sha256,
            back_sha256=back_image.sha256 if back_image else None,
            image_pair_sha256=combined_hash,
            front_reference_sha256=front_image.reference_sha256,
            back_reference_sha256=(
                back_image.reference_sha256 if back_image else None
            ),
            front_perceptual_hash=front_image.perceptual_hash,
            back_perceptual_hash=(
                back_image.perceptual_hash if back_image else None
            ),
            back_evidence=_trusted_memory_back_evidence(
                image_memory,
                back_image is not None,
            ),
            memory_matches=[image_memory],
            local_suggestion=None,
            checklist=checklist_result,
            trusted_identity=trusted_identity,
            match_source=_memory_source(image_memory),
            visual_match_score=image_memory.score,
            canonical_filename=canonical_filename(trusted_identity),
            pricing_allowed=pricing_allowed,
            learning_allowed=True,
            next_action=(
                "Known card identified internally. Continue to verified comps."
                if pricing_allowed
                else "Known card identified internally; Registry verification is still required for pricing."
            ),
        )

    # PRIMARY ENGINE STEP TWO: bounded printed text and the Checklist
    # Registry. A checklist-known card does not need Ollama or OpenAI.
    printed_registry = (
        await checklist_gateway.match(printed_identity, printed_text)
        if printed_identity.card_number
        else ChecklistResult(
            outcome=ChecklistOutcome.INPUT_INCOMPLETE,
            reasons=["Printed evidence did not contain a labeled card number."],
        )
    )
    if (
        printed_registry.outcome == ChecklistOutcome.EXACT_MATCH
        and printed_registry.identity
        and printed_registry.identity_id
    ):
        trusted_identity = printed_registry.identity
        status = "trusted_memory_match"
        _save_scan(
            scan_id=scan_id,
            created_at=created_at,
            front_image=front_image,
            back_image=back_image,
            combined_hash=combined_hash,
            suggestion=None,
            checklist_result=printed_registry,
            status=status,
        )
        store.create_lesson(
            LessonCreate(
                scan_id=scan_id,
                state=LearningState.CHECKLIST_CONFIRMED,
                identity=trusted_identity,
                verification_source=f"registry:{printed_registry.identity_id}",
                notes=(
                    "Resolved by bounded printed evidence and the Checklist "
                    "Registry before Ollama."
                ),
            )
        )
        return AnalyzeResponse(
            scan_id=scan_id,
            created_at=created_at,
            status=status,
            front_sha256=front_image.sha256,
            back_sha256=back_image.sha256 if back_image else None,
            image_pair_sha256=combined_hash,
            front_reference_sha256=front_image.reference_sha256,
            back_reference_sha256=(
                back_image.reference_sha256 if back_image else None
            ),
            front_perceptual_hash=front_image.perceptual_hash,
            back_perceptual_hash=(
                back_image.perceptual_hash if back_image else None
            ),
            back_evidence=[],
            memory_matches=[],
            local_suggestion=None,
            checklist=printed_registry,
            trusted_identity=trusted_identity,
            match_source="checklist_registry",
            visual_match_score=None,
            canonical_filename=canonical_filename(trusted_identity),
            pricing_allowed=True,
            learning_allowed=True,
            next_action=(
                "Checklist identity resolved internally from printed card "
                "evidence. Continue to verified comps."
            ),
        )

    # BACKUP READER: Ollama is called only when trusted image memory and
    # bounded OCR/Checklist Registry resolution did not identify the card.
    suggestion = None
    model_error = None
    try:
        suggestion = await reader.analyze(
            front_image.content,
            back_image.content if back_image else None,
        )
    except (httpx.HTTPError, ValueError) as exc:
        model_error = str(exc)

    proposed_identity = suggestion.identity if suggestion else CardIdentity()
    memory_matches = store.search(proposed_identity)
    trusted_text_match = next(
        (
            match
            for match in memory_matches
            if match.score >= 0.98
            and match.identity.player
            and match.identity.card_number
            and match.identity.set_name
        ),
        None,
    )

    if trusted_text_match:
        trusted_identity = trusted_text_match.identity
        checklist_result = await checklist_gateway.match(trusted_identity)
        pricing_allowed = checklist_result.outcome == ChecklistOutcome.EXACT_MATCH
        status = "trusted_memory_match"
        match_source = "trusted_text_memory"
        next_action = (
            "Known card identified from internal text memory. Continue to verified comps."
            if pricing_allowed
            else "Known card identified from internal text memory; Registry verification is required for pricing."
        )
    else:
        checklist_result = await checklist_gateway.match(
            proposed_identity,
            printed_text,
        )
        if (
            checklist_result.outcome == ChecklistOutcome.EXACT_MATCH
            and checklist_result.identity
            and checklist_result.identity_id
        ):
            trusted_identity = checklist_result.identity
            pricing_allowed = True
            status = "trusted_memory_match"
            match_source = "checklist_registry"
            next_action = (
                "Exact Registry identity locked. Teach InstaComp and continue to verified comps."
            )
        elif model_error:
            trusted_identity = None
            pricing_allowed = False
            status = "model_unavailable"
            match_source = "none"
            next_action = (
                "InstaComp AI could not identify this unknown card because the local Ollama reader "
                "was unavailable. No external identity provider was called. Restore the local "
                "reader and retry, or send the card to private manual review."
            )
        elif checklist_result.outcome == ChecklistOutcome.NOT_CONFIGURED:
            trusted_identity = None
            pricing_allowed = False
            status = "needs_checklist"
            match_source = "ollama_backup" if suggestion else "none"
            next_action = (
                "Ollama supplied backup evidence, but the Checklist Registry is not connected."
            )
        else:
            trusted_identity = None
            pricing_allowed = False
            status = "needs_review"
            match_source = "ollama_backup" if suggestion else "none"
            next_action = (
                "Review the backup evidence or confirm the card manually. The confirmed result will become trusted InstaComp memory."
            )

    suggestion_back_evidence = (
        list(
            dict.fromkeys(
                [
                    *suggestion.evidence.back_visible_text,
                    *suggestion.evidence.back_notes,
                ]
            )
        )
        if suggestion
        else []
    )

    result = AnalyzeResponse(
        scan_id=scan_id,
        created_at=created_at,
        status=status,
        front_sha256=front_image.sha256,
        back_sha256=back_image.sha256 if back_image else None,
        image_pair_sha256=combined_hash,
        front_reference_sha256=front_image.reference_sha256,
        back_reference_sha256=(
            back_image.reference_sha256 if back_image else None
        ),
        front_perceptual_hash=front_image.perceptual_hash,
        back_perceptual_hash=(back_image.perceptual_hash if back_image else None),
        back_evidence=suggestion_back_evidence,
        memory_matches=memory_matches,
        local_suggestion=suggestion,
        checklist=checklist_result,
        trusted_identity=trusted_identity,
        match_source=match_source,
        visual_match_score=(trusted_text_match.score if trusted_text_match else None),
        canonical_filename=canonical_filename(trusted_identity or proposed_identity),
        pricing_allowed=pricing_allowed,
        learning_allowed=bool(trusted_identity),
        next_action=next_action,
    )
    _save_scan(
        scan_id=scan_id,
        created_at=created_at,
        front_image=front_image,
        back_image=back_image,
        combined_hash=combined_hash,
        suggestion=suggestion,
        checklist_result=checklist_result,
        status=status,
    )
    if pricing_allowed and trusted_identity:
        store.create_lesson(
            LessonCreate(
                scan_id=scan_id,
                state=LearningState.CHECKLIST_CONFIRMED,
                identity=trusted_identity,
                verification_source=f"registry:{checklist_result.identity_id}",
                notes=(
                    "Promoted only after exact Registry lock. Future matching checks internal memory before Ollama."
                ),
            )
        )
    return result


@app.post(
    "/v1/lessons",
    response_model=LessonRecord,
    dependencies=[Depends(require_api_key)],
)
async def create_lesson(request: LessonCreate) -> LessonRecord:
    if request.state in {
        LearningState.OBSERVED,
        LearningState.CHECKLIST_CONFIRMED,
    }:
        raise HTTPException(
            status_code=409,
            detail="This learning state may only be created by the scan pipeline.",
        )
    if request.state == LearningState.OPERATOR_CONFIRMED and not request.operator_id:
        raise HTTPException(
            status_code=400,
            detail="operator_id is required for operator-confirmed lessons.",
        )
    try:
        return store.create_lesson(request)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get(
    "/v1/lessons/search",
    dependencies=[Depends(require_api_key)],
)
async def search_lessons(
    player: str | None = Query(default=None),
    year: str | None = Query(default=None),
    set_name: str | None = Query(default=None),
    card_number: str | None = Query(default=None),
    parallel: str | None = Query(default=None),
    limit: int = Query(default=10, ge=1, le=50),
):
    identity = CardIdentity(
        player=player,
        year=year,
        set_name=set_name,
        card_number=card_number,
        parallel=parallel,
    )
    if not any(identity.model_dump().values()):
        raise HTTPException(
            status_code=400,
            detail="At least one identity field is required",
        )
    return {
        "schema_version": "tcos.instacomp-ai.memory-search.v1",
        "matches": [
            match.model_dump(mode="json")
            for match in store.search(identity, limit)
        ],
    }
