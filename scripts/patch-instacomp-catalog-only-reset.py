from __future__ import annotations

from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"{label}: expected anchor was not found")
    return text.replace(old, new, 1)


# --- Mac service: remove the generative model from the scan path. ---
main_path = Path("services/instacomp-ai/app/main.py")
main = main_path.read_text()
main = main.replace("import httpx\n", "")
main = main.replace("from .ollama import OllamaReader\n", "")
main = main.replace("reader = OllamaReader(settings)\n", "")
main = main.replace(
    '        "Private InstaComp internal memory engine with Checklist Registry locking, "\n'
    '        "Ollama backup vision, and no direct OpenAI dependency."\n',
    '        "Private InstaComp catalog-only identity engine with trusted memory, "\n'
    '        "deterministic printed evidence, and Checklist Registry locking."\n',
)
main = replace_once(
    main,
    """app.include_router(
    build_cockpit_router(
        require_api_key,
        store,
        reader,
        checklist_gateway,
    )
)
""",
    """app.include_router(
    build_cockpit_router(
        require_api_key,
        store,
        checklist_gateway,
    )
)
""",
    "cockpit router",
)

health_start = main.index('@app.get("/health", response_model=HealthResponse)')
health_end = main.index('\n\n@app.get(\n    "/v1/scans/{scan_id}/archive"', health_start)
main = (
    main[:health_start]
    + '''@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    database_ready = store.ready()
    checklist_ready = await checklist_gateway.health()
    return HealthResponse(
        ok=database_ready and checklist_ready,
        app=settings.app_name,
        codename=settings.codename,
        version=settings.version,
        database="ready" if database_ready else "error",
        ollama="disabled",
        ollama_model="disabled",
        checklist="ready" if checklist_ready else "not_configured",
        engine_mode="catalog_only",
    )


@app.post(
    "/v1/scans/reset",
    dependencies=[Depends(require_api_key)],
)
async def reset_scans(payload: dict):
    raw_scan_ids = payload.get("scan_ids") if isinstance(payload, dict) else None
    scan_ids = [
        str(value).strip()
        for value in (raw_scan_ids if isinstance(raw_scan_ids, list) else [])
        if str(value).strip()
    ]
    if not scan_ids:
        raise HTTPException(status_code=400, detail="At least one scan_id is required")
    if len(scan_ids) > 500:
        raise HTTPException(status_code=413, detail="Reset no more than 500 scans at once")
    result = store.reset_scans(scan_ids)
    return {
        "ok": True,
        "engine_mode": "catalog_only",
        "images_preserved": True,
        **result,
    }
'''
    + main[health_end:]
)

fallback_start = main.index("    # BACKUP READER: Ollama is called only when trusted image memory")
fallback_end = main.index('\n\n\n@app.post(\n    "/v1/lessons"', fallback_start)
main = (
    main[:fallback_start]
    + '''    # CATALOG-ONLY FALLBACK: the engine does not guess. It archives the
    # deterministic printed identity and returns a normal review state when the
    # Checklist Registry cannot prove one exact card.
    checklist_result = printed_registry
    status = (
        "needs_checklist"
        if checklist_result.outcome == ChecklistOutcome.NOT_CONFIGURED
        else "needs_review"
    )
    next_action = (
        "The Checklist Registry is not configured. No model reader was called."
        if status == "needs_checklist"
        else "No exact catalog identity was proven. Review the preserved front/back images manually; no model reader was called."
    )
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
        back_perceptual_hash=(back_image.perceptual_hash if back_image else None),
        back_evidence=[],
        memory_matches=[],
        local_suggestion=None,
        printed_identity=printed_identity,
        checklist=checklist_result,
        trusted_identity=None,
        match_source="none",
        visual_match_score=None,
        canonical_filename=canonical_filename(printed_identity),
        pricing_allowed=False,
        learning_allowed=False,
        next_action=next_action,
    )
'''
    + main[fallback_end:]
)
main_path.write_text(main)

# --- Models expose catalog-only readiness and deterministic printed identity. ---
models_path = Path("services/instacomp-ai/app/models.py")
models = models_path.read_text()
models = replace_once(
    models,
    """    trusted_identity: CardIdentity | None = None
    local_suggestion: ModelSuggestion | None = None
    checklist: ChecklistResult
""",
    """    trusted_identity: CardIdentity | None = None
    local_suggestion: ModelSuggestion | None = None
    printed_identity: CardIdentity | None = None
    checklist: ChecklistResult
""",
    "printed identity model",
)
models = replace_once(
    models,
    '    ollama: Literal["ready", "unavailable", "unchecked"]\n    ollama_model: str\n    checklist: Literal["not_configured", "ready"]\n',
    '    ollama: Literal["ready", "unavailable", "unchecked", "disabled"]\n    ollama_model: str\n    checklist: Literal["not_configured", "ready"]\n    engine_mode: Literal["catalog_only"] = "catalog_only"\n',
    "catalog-only health model",
)
models_path.write_text(models)

# --- Local evidence database: remove only selected pending scan receipts/lessons. ---
storage_path = Path("services/instacomp-ai/app/storage.py")
storage = storage_path.read_text()
marker = "    def scan_exists(self, scan_id: str) -> bool:\n"
reset_method = '''    def reset_scans(self, scan_ids: list[str]) -> dict[str, int]:
        normalized = list(
            dict.fromkeys(
                str(scan_id).strip()
                for scan_id in scan_ids
                if str(scan_id).strip()
            )
        )
        if not normalized:
            return {"requested": 0, "deleted_scans": 0, "deleted_lessons": 0}
        placeholders = ",".join("?" for _ in normalized)
        with self.connection() as db:
            lesson_count = db.execute(
                f"SELECT COUNT(*) FROM lessons WHERE scan_id IN ({placeholders})",
                normalized,
            ).fetchone()[0]
            scan_count = db.execute(
                f"SELECT COUNT(*) FROM scans WHERE scan_id IN ({placeholders})",
                normalized,
            ).fetchone()[0]
            db.execute(
                f"DELETE FROM lessons WHERE scan_id IN ({placeholders})",
                normalized,
            )
            db.execute(
                f"DELETE FROM scans WHERE scan_id IN ({placeholders})",
                normalized,
            )
        return {
            "requested": len(normalized),
            "deleted_scans": int(scan_count),
            "deleted_lessons": int(lesson_count),
        }

'''
if "def reset_scans(self, scan_ids" not in storage:
    if marker not in storage:
        raise SystemExit("storage reset insertion anchor missing")
    storage = storage.replace(marker, reset_method + marker, 1)
storage = storage.replace(
    "# matches fall through to the Ollama backup rather than risking a wrong",
    "# matches fall through to catalog/manual review rather than risking a wrong",
)
storage_path.write_text(storage)

# --- Control plane and doctor no longer probe or advertise Ollama. ---
cockpit_path = Path("services/instacomp-ai/app/cockpit_routes.py")
cockpit = cockpit_path.read_text()
cockpit = cockpit.replace(
    "def build_cockpit_router(require_api_key, store, reader, checklist_gateway) -> APIRouter:",
    "def build_cockpit_router(require_api_key, store, checklist_gateway) -> APIRouter:",
)
cockpit = cockpit.replace("        ollama_ready = await reader.health()\n", "")
cockpit = cockpit.replace(
    '            "ollama": "ready" if ollama_ready else "unavailable",\n            "ollama_model": settings.ollama_model,\n',
    '            "engine_mode": "catalog_only",\n            "generative_readers": "disabled",\n',
)
cockpit = cockpit.replace(
    "            reader,\n            checklist_gateway,",
    "            checklist_gateway,",
)
cockpit = cockpit.replace(
    "Local AI reads evidence and maintains private learning memory.",
    "Deterministic InstaComp evidence parsing and trusted memory support the catalog match.",
)
cockpit_path.write_text(cockpit)

doctor_path = Path("services/instacomp-ai/app/system_doctor.py")
doctor = doctor_path.read_text()
doctor = doctor.replace(
    "    reader,\n    checklist_gateway,",
    "    checklist_gateway,",
)
ollama_start = doctor.find("    ollama_ready = await reader.health()\n")
if ollama_start >= 0:
    ollama_end = doctor.index("\n    cache_source =", ollama_start)
    doctor = (
        doctor[:ollama_start]
        + '    add(\n        "engine_mode",\n        True,\n        "Catalog-only mode is active; generative readers are disabled.",\n    )\n'
        + doctor[ollama_end:]
    )
doctor_path.write_text(doctor)

# --- Website adapter: unresolved is a normal catalog review, never an exception. ---
local_path = Path("src/lib/instacomp-ai-local.ts")
local = local_path.read_text()
local = replace_once(
    local,
    """  trusted_identity?: Record<string, unknown> | null;
  local_suggestion?: InstaCompAiLocalSuggestion | null;
  match_source?:
""",
    """  trusted_identity?: Record<string, unknown> | null;
  local_suggestion?: InstaCompAiLocalSuggestion | null;
  printed_identity?: Record<string, unknown> | null;
  match_source?:
""",
    "local printed identity type",
)
local = replace_once(
    local,
    """  const trusted = scan.trusted_identity || null;
  const suggested = scan.local_suggestion?.identity || null;
  const identity = trusted || suggested;
  if (!identity) return null;

  const player = text(identity.player);
  const cardNumber = text(identity.card_number ?? identity.cardNumber);
  const setName = text(identity.set_name ?? identity.setName);
  if (!player && !cardNumber && !setName) return null;
""",
    """  const trusted = scan.trusted_identity || null;
  const suggested = scan.local_suggestion?.identity || null;
  const printed = scan.printed_identity || null;
  const identity = trusted || suggested || printed || {};

  const player = text(identity.player);
  const cardNumber = text(identity.card_number ?? identity.cardNumber);
  const setName = text(identity.set_name ?? identity.setName);
""",
    "catalog-only empty identity handling",
)
local = local.replace(
    '  const source = scan.match_source || scan.local_suggestion?.provider || "instacomp";\n',
    '  const source = scan.match_source || scan.local_suggestion?.provider || "instacomp_catalog_only";\n',
)
reset_helper = '''
export async function resetInstaCompAiLocalScans(params: {
  scanIds: string[];
  reason?: string | null;
  timeoutMs?: number;
}) {
  if (!hasConfiguredInstaCompAiLocal()) {
    throw new Error("InstaComp internal engine is not configured for this runtime.");
  }
  const scanIds = Array.from(
    new Set(params.scanIds.map((value) => safeScanId(value)).filter(Boolean)),
  ).slice(0, 500);
  if (!scanIds.length) {
    return { requested: 0, deleted_scans: 0, deleted_lessons: 0 };
  }
  const headers = requestHeaders();
  headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl()}/v1/scans/reset`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      scan_ids: scanIds,
      reason: text(params.reason)?.slice(0, 500) || null,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(params.timeoutMs ?? 30_000),
  });
  const payload = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!response.ok || payload?.ok !== true) {
    throw new Error(
      text(payload?.detail) ||
        text(payload?.error) ||
        `InstaComp pending reset failed with HTTP ${response.status}.`,
    );
  }
  return payload;
}

'''
archive_marker = "export async function getInstaCompAiLocalScanArchive(\n"
if "resetInstaCompAiLocalScans" not in local:
    if archive_marker not in local:
        raise SystemExit("local reset helper insertion anchor missing")
    local = local.replace(archive_marker, reset_helper + archive_marker, 1)
local_path.write_text(local)

# --- Readiness reports catalog-only health, not model readiness. ---
readiness_path = Path("src/app/api/instacomp/internal-readiness/route.ts")
readiness = readiness_path.read_text()
readiness = readiness.replace("localModelReady", "catalogOnlyReady")
readiness = readiness.replace(
    '        architecture: ["instacomp_ai"],',
    '        architecture: ["instacomp_ai", "deterministic_ocr", "checklist_registry"],\n        generativeReadersDisabled: true,',
)
readiness = readiness.replace(
    '    const catalogOnlyReady = health.ollama === "ready";\n    const ok = internalMemoryReady && checklistReady && catalogOnlyReady;',
    '    const catalogOnlyReady = health.engine_mode === "catalog_only";\n    const ok = internalMemoryReady && checklistReady && catalogOnlyReady;',
)
readiness_path.write_text(readiness)

# --- Pending queue: reversible reset of every private draft, then existing UI rescans. ---
queue_path = Path("src/app/api/admin/card-listing-queue/route.ts")
queue = queue_path.read_text()
import_anchor = 'import { buildCardListingTitle } from "../../../../lib/card-listing-title";\n'
if "resetInstaCompAiLocalScans" not in queue:
    queue = queue.replace(
        import_anchor,
        import_anchor
        + 'import { resetInstaCompAiLocalScans } from "../../../../lib/instacomp-ai-local";\n',
        1,
    )
reset_function = '''
async function resetAllPendingForCatalogOnly() {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const { data: rows, error } = await supabase
    .from("inventory_items")
    .select("id")
    .eq("store_id", storeId)
    .is("seller_account_id", null)
    .eq("status", "draft")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const cards: Array<Awaited<ReturnType<typeof loadCard>>> = [];
  const scanIds: string[] = [];
  for (const row of rows || []) {
    const card = await loadCard({
      inventoryItemId: String(row.id),
      storeId,
      supabase,
    });
    const metadata = record(card.inventory.metadata);
    if (
      BLOCKED_DELETE_STATUSES.has(channelStatus(metadata, "website")) ||
      BLOCKED_DELETE_STATUSES.has(channelStatus(metadata, "ebay")) ||
      card.product?.ebay_item_id
    ) {
      continue;
    }
    const urls = cardImageUrls(card);
    if (!urls.front) continue;
    const previousScanId = text(record(metadata.instacomp).scanId, 160);
    if (previousScanId) scanIds.push(previousScanId);
    cards.push(card);
  }

  if (scanIds.length) {
    await resetInstaCompAiLocalScans({
      scanIds,
      reason: "Owner requested a clean catalog-only pending reset.",
      timeoutMs: 60_000,
    });
  }

  const resetAt = new Date().toISOString();
  const results: UnknownRecord[] = [];
  for (const card of cards) {
    const metadata = record(card.inventory.metadata);
    const previousInstaComp = record(metadata.instacomp);
    const previousDual = record(metadata.dual_marketplace);
    const previousWebsite = record(previousDual.website);
    const previousEbay = record(previousDual.ebay);
    const urls = cardImageUrls(card);
    const genericTitle = "Pending card — catalog match required";
    const nextMetadata = {
      ...metadata,
      catalogOnlyReset: {
        resetAt,
        previousTitle: card.inventory.title,
        previousScanId: text(previousInstaComp.scanId, 160) || null,
        previousIdentity: record(metadata.cardIdentity),
        previousProposedIdentity: record(previousInstaComp.proposedIdentity),
        imagesPreserved: true,
      },
      cardIdentity: {},
      seller_review: {
        ...record(metadata.seller_review),
        identity_confirmed: false,
        confirmed_at: null,
        confirmed_by: null,
        confirmed_account_id: null,
        reset_at: resetAt,
        reset_reason: "catalog_only_clean_rebuild",
      },
      instacomp: {
        ...previousInstaComp,
        status: "pending",
        version: "catalog-only-v1",
        engineMode: "catalog_only",
        generativeReadersDisabled: true,
        scanId: null,
        ai: null,
        proposedIdentity: null,
        identityConfidence: null,
        identityComplete: false,
        trustedForIdentity: false,
        humanVerified: false,
        manualIdentityEdit: false,
        manualIdentityLocked: false,
        identityRefreshRequired: true,
        catalogConfirmed: false,
        listingPrice: null,
        suggestedPrice: null,
        searchQuery: null,
        decision: null,
        reviewReasons: [],
        sourceCoverage: [],
        completedAt: null,
        lastError: null,
        lastErrorCode: null,
        resetAt,
        frontImageUrl: urls.front,
        backImageUrl: urls.back || null,
      },
      dual_marketplace: {
        ...previousDual,
        website: {
          ...previousWebsite,
          title: genericTitle,
          description: "",
          price: 0,
          status: text(previousWebsite.status, 60) || "draft",
        },
        ebay: {
          ...previousEbay,
          title: genericTitle,
          description: "",
          price: 0,
          aspects: {},
          status: text(previousEbay.status, 60) || "draft",
        },
        updatedAt: resetAt,
      },
    };

    const { error: inventoryError } = await supabase
      .from("inventory_items")
      .update({
        title: genericTitle,
        description: "",
        metadata: nextMetadata,
        updated_at: resetAt,
      })
      .eq("store_id", storeId)
      .is("seller_account_id", null)
      .eq("id", card.inventory.id)
      .eq("status", "draft");
    if (inventoryError) throw inventoryError;

    if (card.inventory.legacy_product_id) {
      const { error: productError } = await supabase
        .from("products")
        .update({
          title: genericTitle,
          description: "",
          player: null,
          sport: "Sports Cards",
          price: 0,
        })
        .eq("store_id", storeId)
        .is("seller_account_id", null)
        .eq("id", card.inventory.legacy_product_id)
        .is("ebay_item_id", null);
      if (productError) throw productError;
    }

    results.push({
      inventoryItemId: card.inventory.id,
      previousTitle: card.inventory.title,
      frontImageUrl: urls.front,
      backImageUrl: urls.back || null,
      reset: true,
    });
  }
  return { results, scanIdsReset: scanIds.length, resetAt };
}

'''
post_marker = "export async function POST(request: NextRequest) {\n"
if "async function resetAllPendingForCatalogOnly" not in queue:
    if post_marker not in queue:
        raise SystemExit("queue POST anchor missing")
    queue = queue.replace(post_marker, reset_function + post_marker, 1)
queue = replace_once(
    queue,
    """    const body = await request.json().catch(() => ({}));
    if (text(body.action, 40) !== "instacomp") {
      return Response.json(
        { success: false, error: "Unsupported listing queue action." },
        { status: 400 },
      );
    }
    const inventoryItemId = text(body.inventoryItemId, 80);
""",
    """    const body = await request.json().catch(() => ({}));
    const action = text(body.action, 40);
    if (action === "reset-all-catalog-only") {
      if (text(body.confirmation, 80) !== "RESET ALL PENDING") {
        return Response.json(
          { success: false, error: "Type RESET ALL PENDING to confirm." },
          { status: 400 },
        );
      }
      const reset = await resetAllPendingForCatalogOnly();
      return Response.json({ success: true, ...reset });
    }
    if (action !== "instacomp") {
      return Response.json(
        { success: false, error: "Unsupported listing queue action." },
        { status: 400 },
      );
    }
    const inventoryItemId = text(body.inventoryItemId, 80);
""",
    "catalog-only reset action",
)
queue_path.write_text(queue)

# --- Admin UI: one guarded reset-and-rescan control. ---
ui_path = Path("src/app/admin/pending-card-import/TcosListingGateway.tsx")
ui = ui_path.read_text()
ui = ui.replace(
    "      setRows(drafts);\n",
    "      rowsRef.current = drafts;\n      setRows(drafts);\n",
    1,
)
reset_ui = '''
  async function resetAllPendingCatalogOnly() {
    if (working) return;
    const confirmation = window.prompt(
      "This preserves every front/back image, clears all pending identities and matching Mac lessons, then rescans with catalog-only InstaComp. Type RESET ALL PENDING to continue.",
    );
    if (confirmation !== "RESET ALL PENDING") return;

    setBusy("catalog-reset");
    setError("");
    setNotice("Backing up pending state in metadata and resetting catalog-only scans...");
    try {
      const response = await fetch("/api/admin/card-listing-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "reset-all-catalog-only",
          confirmation,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Catalog-only reset failed.");
      }
      const ids = (Array.isArray(data.results) ? data.results : [])
        .map((entry: any) => String(entry.inventoryItemId || ""))
        .filter(Boolean);
      await loadRows(ids);
      setSelectedIds(ids);
      setNotice(
        `${ids.length} pending card${ids.length === 1 ? "" : "s"} reset. Starting catalog-only rescans now...`,
      );
      await runInstaComp(ids);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Catalog-only reset failed.",
      );
    } finally {
      setBusy(null);
    }
  }

'''
percent_marker = "  const instaCompPercent = instaCompProgress?.total\n"
if "resetAllPendingCatalogOnly" not in ui:
    if percent_marker not in ui:
        raise SystemExit("UI reset insertion anchor missing")
    ui = ui.replace(percent_marker, reset_ui + percent_marker, 1)
button_anchor = '''          <button
            type="button"
            onClick={() => void loadRows()}
            disabled={working || loading}
            className="rounded-xl border-2 border-neutral-950 px-4 py-2 font-black disabled:opacity-40"
          >
            Refresh queue
          </button>
'''
reset_button = button_anchor + '''          <button
            type="button"
            onClick={() => void resetAllPendingCatalogOnly()}
            disabled={working || loading || rows.length === 0}
            className="rounded-xl border-2 border-red-800 bg-red-50 px-4 py-2 font-black text-red-900 disabled:opacity-40"
          >
            Reset all pending + catalog rescan
          </button>
'''
ui = replace_once(ui, button_anchor, reset_button, "reset UI button")
ui_path.write_text(ui)

print("Applied InstaComp catalog-only reset and pending rebuild patch")
