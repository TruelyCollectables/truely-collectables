from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile

from .backup_routes import build_backup_router
from .checklist import checklist_gateway
from .checklist_routes import build_checklist_router
from .cockpit_routes import build_cockpit_router
from .config import settings
from .images import pair_hash, persist_image, validate_and_normalize_image
from .models import (
    AnalyzeResponse,
    CardIdentity,
    HealthResponse,
    LearningState,
    LessonCreate,
    LessonRecord,
)
from .ollama import OllamaReader
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
        "Private local card-identification and verified-learning service. "
        "Exact identity and pricing remain blocked until checklist evidence passes."
    ),
)


def require_api_key(x_instacomp_ai_key: str | None = Header(default=None)) -> None:
    if settings.api_key and x_instacomp_ai_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid InstaComp AI key")


app.include_router(build_cockpit_router(require_api_key))
app.include_router(build_backup_router(require_api_key))
app.include_router(build_checklist_router(require_api_key))


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    database_ready = store.ready()
    ollama_ready = await reader.health()
    checklist_ready = await checklist_gateway.health()
    return HealthResponse(
        ok=database_ready,
        app=settings.app_name,
        codename=settings.codename,
        version=settings.version,
        database="ready" if database_ready else "error",
        ollama="ready" if ollama_ready else "unavailable",
        ollama_model=settings.ollama_model,
        checklist="ready" if checklist_ready else "not_configured",
    )


@app.post(
    "/v1/scans/analyze",
    response_model=AnalyzeResponse,
    dependencies=[Depends(require_api_key)],
)
async def analyze_scan(
    front: UploadFile = File(...),
    back: UploadFile | None = File(default=None),
) -> AnalyzeResponse:
    front_content = await front.read()
    back_content = await back.read() if back else None
    total_bytes = len(front_content) + len(back_content or b"")
    if total_bytes > settings.max_total_image_bytes:
        raise HTTPException(status_code=413, detail="Combined images are too large")

    try:
        front_image = validate_and_normalize_image(front_content, settings.max_image_bytes)
        back_image = (
            validate_and_normalize_image(back_content, settings.max_image_bytes)
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
    combined_hash = pair_hash(front_image.sha256, back_image.sha256 if back_image else None)

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
    checklist_result = await checklist_gateway.match(proposed_identity)

    trusted_identity = None
    pricing_allowed = False
    learning_allowed = False
    if checklist_result.outcome.value == "exact_match" and checklist_result.identity:
        trusted_identity = checklist_result.identity
        pricing_allowed = True
        learning_allowed = True
        status = "trusted_memory_match"
        next_action = "Exact checklist identity passed. Continue to comp search."
    elif memory_matches and memory_matches[0].score >= 0.98:
        trusted_identity = memory_matches[0].identity
        status = "trusted_memory_match"
        next_action = (
            "Trusted memory found, but exact pricing remains blocked until the checklist confirms it."
        )
    elif model_error:
        status = "model_unavailable"
        next_action = "Start Ollama or correct its model configuration, then retry."
    elif checklist_result.outcome.value == "not_configured":
        status = "needs_checklist"
        next_action = "Sync an approved checklist file and rebuild the local registry."
    else:
        status = "needs_review"
        next_action = "Review the visual evidence and provide a verified correction or clearer images."

    result = AnalyzeResponse(
        scan_id=scan_id,
        created_at=created_at,
        status=status,
        front_sha256=front_image.sha256,
        back_sha256=back_image.sha256 if back_image else None,
        image_pair_sha256=combined_hash,
        memory_matches=memory_matches,
        local_suggestion=suggestion,
        checklist=checklist_result,
        trusted_identity=trusted_identity,
        pricing_allowed=pricing_allowed,
        learning_allowed=learning_allowed,
        next_action=next_action,
    )
    store.save_scan(
        scan_id=scan_id,
        created_at=created_at,
        front_sha256=front_image.sha256,
        back_sha256=back_image.sha256 if back_image else None,
        image_pair_sha256=combined_hash,
        local_suggestion=suggestion.model_dump(mode="json") if suggestion else None,
        checklist=checklist_result.model_dump(mode="json"),
        status=status,
    )
    return result


@app.post(
    "/v1/lessons",
    response_model=LessonRecord,
    dependencies=[Depends(require_api_key)],
)
async def create_lesson(request: LessonCreate) -> LessonRecord:
    if request.state == LearningState.OBSERVED:
        raise HTTPException(
            status_code=400,
            detail="Observed evidence belongs to a scan, not trusted lesson memory.",
        )
    if request.state == LearningState.CHECKLIST_CONFIRMED:
        raise HTTPException(
            status_code=409,
            detail="Checklist-confirmed lessons may only be created by the checklist integration.",
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
        raise HTTPException(status_code=400, detail="At least one identity field is required")
    return {
        "schema_version": "tcos.instacomp-ai.memory-search.v1",
        "matches": [match.model_dump(mode="json") for match in store.search(identity, limit)],
    }
