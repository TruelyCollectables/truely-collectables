from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile
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
    HealthResponse,
    LearningState,
    LessonCreate,
    LessonRecord,
)
from .ollama import OllamaReader
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
        "Private local evidence reader with central Checklist Registry identity "
        "locking and an owner-only local control plane."
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


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    database_ready = store.ready()
    ollama_ready = await reader.health()
    checklist_ready = await checklist_gateway.health()
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
    if (
        checklist_result.outcome.value == "exact_match"
        and checklist_result.identity
        and checklist_result.identity_id
    ):
        trusted_identity = checklist_result.identity
        pricing_allowed = True
        learning_allowed = True
        status = "trusted_memory_match"
        next_action = (
            "Exact Registry identity locked. Continue to verified marketplace comps."
        )
    elif model_error:
        status = "model_unavailable"
        next_action = "Start Ollama or correct its model configuration, then retry."
    elif checklist_result.outcome.value == "not_configured":
        status = "needs_checklist"
        next_action = (
            "Connect the Mac service to the authenticated central Checklist Registry."
        )
    else:
        status = "needs_review"
        next_action = (
            "Review evidence or provide clearer front and back images; "
            "pricing remains blocked."
        )

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
        local_suggestion=(
            suggestion.model_dump(mode="json") if suggestion else None
        ),
        checklist=checklist_result.model_dump(mode="json"),
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
                    "Automatically promoted only after exact central Registry lock."
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
