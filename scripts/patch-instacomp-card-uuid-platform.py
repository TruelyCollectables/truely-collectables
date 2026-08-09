#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    source = path.read_text(encoding="utf-8")
    if new in source:
        print(f"already patched {label}: {path}")
        return
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one source block in {path}, found {count}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")
    print(f"patched {label}: {path}")


def replace_all(path: Path, old: str, new: str, expected: int, label: str) -> None:
    source = path.read_text(encoding="utf-8")
    if new in source and old not in source:
        print(f"already patched {label}: {path}")
        return
    count = source.count(old)
    if count != expected:
        raise SystemExit(f"{label}: expected {expected} source blocks in {path}, found {count}")
    path.write_text(source.replace(old, new), encoding="utf-8")
    print(f"patched {label}: {path}")


models = ROOT / "services/instacomp-ai/app/models.py"
storage = ROOT / "services/instacomp-ai/app/storage.py"
training = ROOT / "services/instacomp-ai/app/training.py"
main = ROOT / "services/instacomp-ai/app/main.py"
local_ts = ROOT / "src/lib/instacomp-ai-local.ts"
live_scan = ROOT / "src/app/api/instacomp/live-scan/route.ts"
updater = ROOT / "services/instacomp-ai/scripts/update-live-from-main.sh"

# ---------------------------------------------------------------------------
# Mac API model: scan event UUID + permanent physical card UUID.
# ---------------------------------------------------------------------------
replace_once(
    models,
    '''class AnalyzeResponse(BaseModel):\n    schema_version: Literal["tcos.instacomp-ai.scan.v1"] = "tcos.instacomp-ai.scan.v1"\n    scan_id: str\n    created_at: datetime\n''',
    '''class AnalyzeResponse(BaseModel):\n    schema_version: Literal["tcos.instacomp-ai.scan.v1"] = "tcos.instacomp-ai.scan.v1"\n    scan_id: str\n    # Permanent UUID for this exact physical card. On first ingest this equals\n    # scan_id; later rescans get a new scan_id but keep this card_uuid.\n    card_uuid: str\n    created_at: datetime\n''',
    "AnalyzeResponse.card_uuid",
)
replace_once(
    models,
    '''class TrainingExample(BaseModel):\n    training_example_id: str\n    lesson_id: str\n    scan_id: str\n    state: LearningState\n''',
    '''class TrainingExample(BaseModel):\n    training_example_id: str\n    lesson_id: str\n    scan_id: str\n    # Tracking metadata only. It is never a visual identity target.\n    card_uuid: str | None = None\n    state: LearningState\n''',
    "TrainingExample.card_uuid",
)

# ---------------------------------------------------------------------------
# SQLite: persist card_uuid with every scan. Legacy rows remain nullable; every
# new scan is required by the API path to supply one.
# ---------------------------------------------------------------------------
replace_once(
    storage,
    '''                CREATE TABLE IF NOT EXISTS scans (\n                    scan_id TEXT PRIMARY KEY,\n                    created_at TEXT NOT NULL,\n''',
    '''                CREATE TABLE IF NOT EXISTS scans (\n                    scan_id TEXT PRIMARY KEY,\n                    card_uuid TEXT,\n                    created_at TEXT NOT NULL,\n''',
    "SQLite scans.card_uuid",
)
replace_once(
    storage,
    '''            for column in [\n                "front_reference_sha256",\n''',
    '''            for column in [\n                "card_uuid",\n                "front_reference_sha256",\n''',
    "SQLite legacy card_uuid migration",
)
replace_once(
    storage,
    '''            db.execute(\n                "CREATE INDEX IF NOT EXISTS scans_front_phash_idx "\n                "ON scans(front_perceptual_hash)"\n            )\n''',
    '''            db.execute(\n                "CREATE INDEX IF NOT EXISTS scans_front_phash_idx "\n                "ON scans(front_perceptual_hash)"\n            )\n            db.execute(\n                "CREATE INDEX IF NOT EXISTS scans_card_uuid_idx "\n                "ON scans(card_uuid)"\n            )\n''',
    "SQLite card_uuid index",
)
replace_once(
    storage,
    '''        *,\n        scan_id: str,\n        created_at: datetime,\n''',
    '''        *,\n        scan_id: str,\n        card_uuid: str,\n        created_at: datetime,\n''',
    "save_scan card_uuid argument",
)
replace_once(
    storage,
    '''                INSERT INTO scans (\n                    scan_id, created_at, front_sha256, back_sha256,\n                    image_pair_sha256, front_reference_sha256,\n                    back_reference_sha256, front_perceptual_hash,\n                    back_perceptual_hash, local_suggestion_json,\n                    local_vision_json, checklist_json, status\n                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n                """,\n                (\n                    scan_id,\n                    created_at.isoformat(),\n''',
    '''                INSERT INTO scans (\n                    scan_id, card_uuid, created_at, front_sha256, back_sha256,\n                    image_pair_sha256, front_reference_sha256,\n                    back_reference_sha256, front_perceptual_hash,\n                    back_perceptual_hash, local_suggestion_json,\n                    local_vision_json, checklist_json, status\n                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n                """,\n                (\n                    scan_id,\n                    card_uuid,\n                    created_at.isoformat(),\n''',
    "save_scan insert card_uuid",
)
replace_once(
    storage,
    '''        return {\n            "scan_id": row["scan_id"],\n            "created_at": row["created_at"],\n''',
    '''        return {\n            "scan_id": row["scan_id"],\n            "card_uuid": row["card_uuid"],\n            "created_at": row["created_at"],\n''',
    "get_scan card_uuid",
)
replace_once(
    storage,
    '''    def get_scan(self, scan_id: str) -> dict | None:\n''',
    '''    def card_uuid_for_image_pair(self, image_pair_sha256: str) -> str | None:\n        """Return only an exact-image-pair physical-card UUID.\n\n        Near-visual memory is deliberately forbidden here because two distinct\n        physical copies can share the same card design.\n        """\n        with self.connection() as db:\n            row = db.execute(\n                "SELECT card_uuid FROM scans "\n                "WHERE image_pair_sha256 = ? AND card_uuid IS NOT NULL "\n                "ORDER BY created_at DESC LIMIT 1",\n                (image_pair_sha256,),\n            ).fetchone()\n        if row is None:\n            return None\n        value = str(row["card_uuid"] or "").strip()\n        return value or None\n\n    def get_scan(self, scan_id: str) -> dict | None:\n''',
    "exact pair card_uuid lookup",
)

# ---------------------------------------------------------------------------
# Training records keep the tracking UUID as metadata, but the VLM answer never
# contains it. Latest truth is keyed by physical card when available.
# ---------------------------------------------------------------------------
replace_once(
    training,
    '''    """Keep only the newest lesson/training truth for each physical scan.\n\n    A corrected operator lesson intentionally supersedes every older lesson for\n    the same front/back scan. This prevents a prior wrong parallel from sharing\n    a training dataset with the later trusted correction.\n    """\n    ordered = sorted(examples, key=lambda example: example.created_at, reverse=True)\n    latest: list[TrainingExample] = []\n    seen_scan_ids: set[str] = set()\n    for example in ordered:\n        if example.scan_id in seen_scan_ids:\n            continue\n        seen_scan_ids.add(example.scan_id)\n        latest.append(example)\n''',
    '''    """Keep only the newest trusted truth for each physical card.\n\n    card_uuid survives rescans, so a later correction supersedes stale labels\n    even if the card was scanned again under a new scan_id. Legacy examples\n    without card_uuid continue to deduplicate by scan_id.\n    """\n    ordered = sorted(examples, key=lambda example: example.created_at, reverse=True)\n    latest: list[TrainingExample] = []\n    seen_card_keys: set[str] = set()\n    for example in ordered:\n        key = example.card_uuid or f"scan:{example.scan_id}"\n        if key in seen_card_keys:\n            continue\n        seen_card_keys.add(key)\n        latest.append(example)\n''',
    "latest truth by card_uuid",
)
replace_once(
    training,
    '''        lesson_id=lesson.lesson_id,\n        scan_id=lesson.scan_id,\n        state=lesson.state,\n''',
    '''        lesson_id=lesson.lesson_id,\n        scan_id=lesson.scan_id,\n        card_uuid=scan.get("card_uuid"),\n        state=lesson.state,\n''',
    "training example card_uuid",
)
replace_once(
    training,
    '''        "metadata": {\n            "scan_id": example.scan_id,\n            "lesson_id": example.lesson_id,\n''',
    '''        "metadata": {\n            "scan_id": example.scan_id,\n            "card_uuid": example.card_uuid,\n            "lesson_id": example.lesson_id,\n''',
    "dataset tracking metadata",
)
replace_once(
    training,
    '''            "latest_teacher_truth_per_scan_only": True,\n            "physical_serial_numerator_separate_from_print_run": True,\n''',
    '''            "latest_teacher_truth_per_scan_only": True,\n            "latest_teacher_truth_per_physical_card_when_uuid_present": True,\n            "card_uuid_is_tracking_metadata_not_visual_label": True,\n            "physical_serial_numerator_separate_from_print_run": True,\n''',
    "training safety card_uuid",
)

# ---------------------------------------------------------------------------
# Mac scanner: first scan UUID becomes permanent card UUID. Existing cards may
# supply card_uuid; exact byte-for-byte image-pair retries reuse it automatically.
# Near-visual matches NEVER assign a physical-card UUID.
# ---------------------------------------------------------------------------
replace_once(
    main,
    '''from uuid import uuid4\n''',
    '''from uuid import UUID, uuid4\n''',
    "UUID parser import",
)
replace_once(
    main,
    '''def _memory_source(match: MemoryMatch) -> str:\n''',
    '''def _normalize_card_uuid(value: str | None) -> str | None:\n    normalized = str(value or "").strip()\n    if not normalized:\n        return None\n    try:\n        return str(UUID(normalized))\n    except (ValueError, AttributeError) as exc:\n        raise HTTPException(status_code=400, detail="card_uuid must be a valid UUID") from exc\n\n\ndef _resolve_card_uuid(\n    *,\n    requested: str | None,\n    image_pair_sha256: str,\n    first_scan_id: str,\n) -> str:\n    requested_uuid = _normalize_card_uuid(requested)\n    exact_pair_uuid = store.card_uuid_for_image_pair(image_pair_sha256)\n    if requested_uuid and exact_pair_uuid and requested_uuid != exact_pair_uuid:\n        raise HTTPException(\n            status_code=409,\n            detail=(\n                "The exact front/back image pair is already bound to another "\n                "physical-card UUID."\n            ),\n        )\n    # First ingest intentionally uses the first scan UUID as the permanent card\n    # UUID. Rescans keep it while receiving their own new scan event UUID.\n    return requested_uuid or exact_pair_uuid or first_scan_id\n\n\ndef _memory_source(match: MemoryMatch) -> str:\n''',
    "card_uuid resolver",
)
replace_once(
    main,
    '''def _save_scan(\n    *,\n    scan_id: str,\n    created_at: datetime,\n''',
    '''def _save_scan(\n    *,\n    scan_id: str,\n    card_uuid: str,\n    created_at: datetime,\n''',
    "_save_scan card_uuid argument",
)
replace_once(
    main,
    '''    store.save_scan(\n        scan_id=scan_id,\n        created_at=created_at,\n''',
    '''    store.save_scan(\n        scan_id=scan_id,\n        card_uuid=card_uuid,\n        created_at=created_at,\n''',
    "_save_scan forwards card_uuid",
)
replace_once(
    main,
    '''async def analyze_scan(\n    front: UploadFile = File(...),\n    back: UploadFile | None = File(default=None),\n    printed_evidence_json: str | None = Form(default=None),\n) -> AnalyzeResponse:\n''',
    '''async def analyze_scan(\n    front: UploadFile = File(...),\n    back: UploadFile | None = File(default=None),\n    printed_evidence_json: str | None = Form(default=None),\n    card_uuid: str | None = Form(default=None),\n) -> AnalyzeResponse:\n''',
    "analyze optional card_uuid",
)
replace_once(
    main,
    '''    combined_hash = pair_hash(\n        front_image.sha256,\n        back_image.sha256 if back_image else None,\n    )\n    printed_evidence = parse_printed_evidence(printed_evidence_json)\n''',
    '''    combined_hash = pair_hash(\n        front_image.sha256,\n        back_image.sha256 if back_image else None,\n    )\n    physical_card_uuid = _resolve_card_uuid(\n        requested=card_uuid,\n        image_pair_sha256=combined_hash,\n        first_scan_id=scan_id,\n    )\n    printed_evidence = parse_printed_evidence(printed_evidence_json)\n''',
    "resolve physical card UUID",
)
replace_all(
    main,
    '''        _save_scan(\n            scan_id=scan_id,\n            created_at=created_at,\n''',
    '''        _save_scan(\n            scan_id=scan_id,\n            card_uuid=physical_card_uuid,\n            created_at=created_at,\n''',
    2,
    "nested _save_scan card_uuid",
)
replace_once(
    main,
    '''    _save_scan(\n        scan_id=scan_id,\n        created_at=created_at,\n''',
    '''    _save_scan(\n        scan_id=scan_id,\n        card_uuid=physical_card_uuid,\n        created_at=created_at,\n''',
    "final _save_scan card_uuid",
)
replace_all(
    main,
    '''        return AnalyzeResponse(\n            scan_id=scan_id,\n            created_at=created_at,\n''',
    '''        return AnalyzeResponse(\n            scan_id=scan_id,\n            card_uuid=physical_card_uuid,\n            created_at=created_at,\n''',
    2,
    "nested AnalyzeResponse card_uuid",
)
replace_once(
    main,
    '''    result = AnalyzeResponse(\n        scan_id=scan_id,\n        created_at=created_at,\n''',
    '''    result = AnalyzeResponse(\n        scan_id=scan_id,\n        card_uuid=physical_card_uuid,\n        created_at=created_at,\n''',
    "final AnalyzeResponse card_uuid",
)

# ---------------------------------------------------------------------------
# Vercel bridge exposes the permanent UUID and lets callers provide it on a
# rescan. This keeps the identifier stable across the website and Mac runtime.
# ---------------------------------------------------------------------------
replace_once(
    local_ts,
    '''  scan_id: string;\n  created_at?: string;\n''',
    '''  scan_id: string;\n  card_uuid: string;\n  created_at?: string;\n''',
    "local scan type card_uuid",
)
replace_once(
    local_ts,
    '''  scan_id: string;\n  created_at: string;\n  front_sha256: string;\n''',
    '''  scan_id: string;\n  card_uuid: string | null;\n  created_at: string;\n  front_sha256: string;\n''',
    "archive type card_uuid",
)
replace_once(
    local_ts,
    '''export type InstaCompAiResultWithInternalReceipt = InstaCompAiResult & {\n  internalScanId: string;\n''',
    '''export type InstaCompAiResultWithInternalReceipt = InstaCompAiResult & {\n  internalScanId: string;\n  internalCardUuid: string;\n''',
    "internal receipt card UUID",
)
replace_once(
    local_ts,
    '''function safeScanId(scanId: string) {\n  const value = scanId.trim();\n  if (!/^[0-9a-z-]{1,100}$/i.test(value)) {\n    throw new Error("Invalid InstaComp scan ID.");\n  }\n  return value;\n}\n''',
    '''function safeScanId(scanId: string) {\n  const value = scanId.trim();\n  if (!/^[0-9a-z-]{1,100}$/i.test(value)) {\n    throw new Error("Invalid InstaComp scan ID.");\n  }\n  return value;\n}\n\nfunction safeCardUuid(value: unknown) {\n  const normalized = String(value || "").trim().toLowerCase();\n  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {\n    throw new Error("Invalid InstaComp physical card UUID.");\n  }\n  return normalized;\n}\n''',
    "safeCardUuid",
)
replace_all(
    local_ts,
    '''      internalScanId: safeScanId(scan.scan_id),\n      internalStatus: scan.status,\n''',
    '''      internalScanId: safeScanId(scan.scan_id),\n      internalCardUuid: safeCardUuid(scan.card_uuid),\n      internalStatus: scan.status,\n''',
    1,
    "empty-identity internal card UUID",
)
replace_once(
    local_ts,
    '''    internalScanId: safeScanId(scan.scan_id),\n    internalStatus: scan.status,\n''',
    '''    internalScanId: safeScanId(scan.scan_id),\n    internalCardUuid: safeCardUuid(scan.card_uuid),\n    internalStatus: scan.status,\n''',
    "trusted identity internal card UUID",
)
replace_once(
    local_ts,
    '''export async function analyzeWithInstaCompAiLocal(params: {\n  front: Blob;\n  back?: Blob | null;\n  printedEvidence?: {\n''',
    '''export async function analyzeWithInstaCompAiLocal(params: {\n  front: Blob;\n  back?: Blob | null;\n  cardUuid?: string | null;\n  printedEvidence?: {\n''',
    "analyze bridge cardUuid param",
)
replace_once(
    local_ts,
    '''  body.append("front", params.front, "front.jpg");\n  if (params.back) body.append("back", params.back, "back.jpg");\n  if (params.printedEvidence?.text) {\n''',
    '''  body.append("front", params.front, "front.jpg");\n  if (params.back) body.append("back", params.back, "back.jpg");\n  if (params.cardUuid) body.append("card_uuid", safeCardUuid(params.cardUuid));\n  if (params.printedEvidence?.text) {\n''',
    "bridge forwards card UUID",
)

# ---------------------------------------------------------------------------
# Live scan response/persistence carries cardUuid. Existing schema-safe JSON is
# used immediately; a migration adds first-class columns separately.
# ---------------------------------------------------------------------------
replace_once(
    live_scan,
    '''async function persistExactMarketSummary(params: {\n  scanId: string | null;\n  query: string;\n''',
    '''async function persistExactMarketSummary(params: {\n  scanId: string | null;\n  cardUuid: string | null;\n  query: string;\n''',
    "live persistence cardUuid param",
)
replace_once(
    live_scan,
    '''      raw_comp_results: {\n        ...previousRaw,\n        exactMarket: params.exactMarketEvidence || null,\n''',
    '''      raw_comp_results: {\n        ...previousRaw,\n        cardUuid: params.cardUuid,\n        exactMarket: params.exactMarketEvidence || null,\n''',
    "raw comp cardUuid persistence",
)
replace_once(
    live_scan,
    '''  const ai = base.ai;\n  const missingIdentity = missingExactIdentityFields(ai);\n''',
    '''  const ai = base.ai;\n  const cardUuid = String((ai as any).internalCardUuid || "").trim() || null;\n  const missingIdentity = missingExactIdentityFields(ai);\n''',
    "live scan extracts cardUuid",
)
replace_all(
    live_scan,
    '''    const persistence = await persistExactMarketSummary({\n      scanId: base.scanId ? String(base.scanId) : null,\n      query: exactTitle,\n''',
    '''    const persistence = await persistExactMarketSummary({\n      scanId: base.scanId ? String(base.scanId) : null,\n      cardUuid,\n      query: exactTitle,\n''',
    1,
    "review-path persistence cardUuid",
)
replace_once(
    live_scan,
    '''  const persistence = await persistExactMarketSummary({\n    scanId: base.scanId ? String(base.scanId) : null,\n    query: exactTitle,\n''',
    '''  const persistence = await persistExactMarketSummary({\n    scanId: base.scanId ? String(base.scanId) : null,\n    cardUuid,\n    query: exactTitle,\n''',
    "complete-path persistence cardUuid",
)
replace_all(
    live_scan,
    '''      ...base,\n      ok: true,\n      simulated: false,\n''',
    '''      ...base,\n      ok: true,\n      cardUuid,\n      simulated: false,\n''',
    1,
    "review response cardUuid",
)
replace_once(
    live_scan,
    '''    ...base,\n    ok: true,\n    simulated: false,\n''',
    '''    ...base,\n    ok: true,\n    cardUuid,\n    simulated: false,\n''',
    "complete response cardUuid",
)

# ---------------------------------------------------------------------------
# Mac updater bug seen in the supplied terminal output: Vercel env commands were
# running from the shell's cwd instead of the linked repository. Always target
# repo_root, and self-link once when .vercel/project.json is absent.
# ---------------------------------------------------------------------------
replace_once(
    updater,
    '''tunnel_url="https://${tunnel_hostname}"\n''',
    '''tunnel_url="https://${tunnel_hostname}"\nvercel_project="${INSTACOMP_VERCEL_PROJECT:-truely-collectables}"\nvercel_scope="${INSTACOMP_VERCEL_SCOPE:-truelycollectables-projects}"\n''',
    "Vercel project constants",
)
replace_once(
    updater,
    '''set_vercel_env() {\n  local name="$1"\n''',
    '''ensure_vercel_link() {\n  if [[ -f "$repo_root/.vercel/project.json" ]]; then\n    return 0\n  fi\n  echo "Linking the repository root to the existing Vercel project."\n  npx vercel link --yes --project "$vercel_project" --scope "$vercel_scope" --cwd "$repo_root" >/dev/null\n}\n\nset_vercel_env() {\n  local name="$1"\n''',
    "Vercel self-link helper",
)
replace_once(
    updater,
    '''    printf '%s' "$value" | npx vercel env add "$name" "$environment" --force --sensitive >/dev/null\n  else\n    printf '%s' "$value" | npx vercel env add "$name" "$environment" --force >/dev/null\n''',
    '''    printf '%s' "$value" | npx vercel env add "$name" "$environment" --force --sensitive --cwd "$repo_root" >/dev/null\n  else\n    printf '%s' "$value" | npx vercel env add "$name" "$environment" --force --cwd "$repo_root" >/dev/null\n''',
    "Vercel env cwd",
)
replace_once(
    updater,
    '''echo "Synchronizing the existing Mac key to Vercel Production without rotating it."\nset_vercel_env INSTACOMP_AI_LOCAL_URL "$tunnel_url" production plain\n''',
    '''echo "Synchronizing the existing Mac key to Vercel Production without rotating it."\nensure_vercel_link\nset_vercel_env INSTACOMP_AI_LOCAL_URL "$tunnel_url" production plain\n''',
    "Vercel link before env sync",
)

print("InstaComp permanent physical card UUID platform patch complete.")
