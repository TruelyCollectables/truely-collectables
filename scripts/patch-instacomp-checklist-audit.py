from __future__ import annotations

from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"{label}: expected anchor was not found")
    return text.replace(old, new, 1)


def write(path: str, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


# ---------------------------------------------------------------------------
# Mac response contracts: preserve a complete checklist audit receipt.
# ---------------------------------------------------------------------------
models_path = Path("services/instacomp-ai/app/models.py")
models = models_path.read_text(encoding="utf-8")
models = replace_once(
    models,
    '''class ChecklistResult(BaseModel):
    outcome: ChecklistOutcome
    identity_id: str | None = None
    identity: CardIdentity | None = None
    candidate_count: int = 0
    reasons: list[str] = Field(default_factory=list)
    source_receipts: list[str] = Field(default_factory=list)
''',
    '''class ChecklistResult(BaseModel):
    outcome: ChecklistOutcome
    identity_id: str | None = None
    identity: CardIdentity | None = None
    candidate_count: int = 0
    candidate_summaries: list[dict[str, Any]] = Field(default_factory=list)
    lookup_attempted: bool = False
    registry_reachable: bool = False
    reasons: list[str] = Field(default_factory=list)
    source_receipts: list[str] = Field(default_factory=list)
''',
    "checklist result audit fields",
)
models = replace_once(
    models,
    '''    local_suggestion: ModelSuggestion | None = None
    checklist: ChecklistResult
    trusted_identity: CardIdentity | None = None
''',
    '''    local_suggestion: ModelSuggestion | None = None
    checklist: ChecklistResult
    checklist_audit: dict[str, Any] = Field(default_factory=dict)
    trusted_identity: CardIdentity | None = None
''',
    "analyze response checklist audit",
)
models = replace_once(
    models,
    '''    ollama_model: str
    checklist: Literal["not_configured", "ready"]
''',
    '''    ollama_model: str
    checklist: Literal["not_configured", "ready"]
    checklist_registry_authenticated: bool = False
    checklist_active_live_versions: int = 0
    checklist_active_live_cards: int = 0
''',
    "health checklist coverage fields",
)
models_path.write_text(models, encoding="utf-8")


# ---------------------------------------------------------------------------
# Deterministic printed evidence: recognize unlabeled prefixed card numbers.
# ---------------------------------------------------------------------------
printed_path = Path("services/instacomp-ai/app/printed_evidence.py")
printed = printed_path.read_text(encoding="utf-8")
printed = replace_once(
    printed,
    '''    patterns = [
        r"\\b(?:card\\s*(?:no\\.?|number)?|no\\.?|number)\\s*[:#.-]?\\s*([a-z]{0,5}-?\\d{1,5}[a-z]{0,3})\\b",
        r"#\\s*([a-z]{0,5}-?\\d{1,5}[a-z]{0,3})\\b",
    ]
''',
    '''    patterns = [
        r"\\b(?:card\\s*(?:no\\.?|number)?|no\\.?|number)\\s*[:#.-]?\\s*([a-z]{0,5}-?\\d{1,5}[a-z]{0,3})\\b",
        r"#\\s*([a-z]{0,5}-?\\d{1,5}[a-z]{0,3})\\b",
        # Many Bowman/Topps backs print a prefixed key such as BCP-79 without
        # the words CARD NO. The prefix makes this bounded enough to retrieve
        # Registry candidates without treating years or serial stamps as keys.
        r"\\b([a-z]{1,6}-\\d{1,5}[a-z]{0,3})\\b",
        r"\\b([a-z]{2,6}\\d{1,5}[a-z]{0,3})\\b",
    ]
''',
    "unlabeled card number extraction",
)
printed_path.write_text(printed, encoding="utf-8")


# ---------------------------------------------------------------------------
# Registry gateway: prove whether a lookup happened, whether it was reachable,
# and which exact candidate variants were considered.
# ---------------------------------------------------------------------------
checklist_path = Path("services/instacomp-ai/app/checklist.py")
checklist = checklist_path.read_text(encoding="utf-8")
checklist = replace_once(
    checklist,
    '''    async def health(self) -> bool: ...
''',
    '''    async def health(self) -> bool: ...

    async def coverage(self) -> dict[str, Any]: ...
''',
    "checklist coverage protocol",
)
checklist = replace_once(
    checklist,
    '''def _registry_headers() -> dict[str, str]:
''',
    '''def _candidate_summaries(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    summaries: list[dict[str, Any]] = []
    for raw in value[:50]:
        if not isinstance(raw, dict):
            continue
        summaries.append(
            {
                "identityId": _text(raw.get("identityId")),
                "year": _text(raw.get("year")),
                "manufacturer": _text(raw.get("manufacturer")),
                "brand": _text(raw.get("brand")),
                "setName": _text(raw.get("setName") or raw.get("product")),
                "cardNumber": _text(raw.get("cardNumber")),
                "player": _text(raw.get("player")),
                "parallel": _text(raw.get("parallel")),
                "variation": _text(raw.get("variation")),
                "serialRun": raw.get("serialRun"),
                "isAuto": raw.get("isAuto"),
                "isRelic": raw.get("isRelic"),
                "sport": _text(raw.get("sport")),
            }
        )
    return summaries


def _registry_headers() -> dict[str, str]:
''',
    "candidate summary helper",
)
checklist = checklist.replace(
    '''                outcome=ChecklistOutcome.NOT_CONFIGURED,
                reasons=["INSTACOMP_AI_REGISTRY_URL is not configured."],
''',
    '''                outcome=ChecklistOutcome.NOT_CONFIGURED,
                lookup_attempted=False,
                registry_reachable=False,
                reasons=["INSTACOMP_AI_REGISTRY_URL is not configured."],
''',
)
checklist = checklist.replace(
    '''                outcome=ChecklistOutcome.INPUT_INCOMPLETE,
                reasons=["Missing identity field: card_number"],
''',
    '''                outcome=ChecklistOutcome.INPUT_INCOMPLETE,
                lookup_attempted=False,
                registry_reachable=False,
                reasons=["Missing identity field: card_number"],
''',
)
checklist = checklist.replace(
    '''                outcome=ChecklistOutcome.NOT_CONFIGURED,
                reasons=[f"Checklist Registry request failed: {error}"],
''',
    '''                outcome=ChecklistOutcome.NOT_CONFIGURED,
                lookup_attempted=True,
                registry_reachable=False,
                reasons=[f"Checklist Registry request failed: {error}"],
''',
)
checklist = checklist.replace(
    '''                outcome=ChecklistOutcome.NOT_CONFIGURED,
                reasons=["Checklist Registry authentication failed."],
''',
    '''                outcome=ChecklistOutcome.NOT_CONFIGURED,
                lookup_attempted=True,
                registry_reachable=True,
                reasons=["Checklist Registry authentication failed."],
''',
)
checklist = checklist.replace(
    '''                outcome=ChecklistOutcome.SET_PRESENT_NO_EXACT_MATCH,
                reasons=[_text(data.get("error")) or "Checklist Registry lookup failed."],
''',
    '''                outcome=ChecklistOutcome.SET_PRESENT_NO_EXACT_MATCH,
                lookup_attempted=True,
                registry_reachable=True,
                reasons=[_text(data.get("error")) or "Checklist Registry lookup failed."],
''',
)
checklist = replace_once(
    checklist,
    '''        candidate_count = int(data.get("candidateCount") or 0)

        if status == "exact_match" and registry_identity_id and registry_fingerprint:
''',
    '''        candidate_count = int(data.get("candidateCount") or 0)
        candidate_summaries = _candidate_summaries(data.get("candidates"))

        if status == "exact_match" and registry_identity_id and registry_fingerprint:
''',
    "registry candidate collection",
)
checklist = replace_once(
    checklist,
    '''                candidate_count=max(candidate_count, 1),
                reasons=reasons,
''',
    '''                candidate_count=max(candidate_count, 1),
                candidate_summaries=candidate_summaries,
                lookup_attempted=True,
                registry_reachable=True,
                reasons=reasons,
''',
    "exact registry receipt",
)
checklist = replace_once(
    checklist,
    '''            candidate_count=candidate_count,
            reasons=reasons or ["Checklist Registry requires operator review."],
        )

    async def health(self) -> bool:
        return _registry_base_url() is not None
''',
    '''            candidate_count=candidate_count,
            candidate_summaries=candidate_summaries,
            lookup_attempted=True,
            registry_reachable=True,
            reasons=reasons or ["Checklist Registry requires operator review."],
        )

    async def coverage(self) -> dict[str, Any]:
        base_url = _registry_base_url()
        if not base_url:
            return {
                "configured": False,
                "authenticated": False,
                "ready": False,
                "activeLiveVersions": 0,
                "activeLiveCards": 0,
                "error": "registry_url_missing",
            }
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.get(
                    f"{base_url}/api/instacomp/checklist-coverage",
                    headers=_registry_headers(),
                )
        except httpx.HTTPError as error:
            return {
                "configured": True,
                "authenticated": False,
                "ready": False,
                "activeLiveVersions": 0,
                "activeLiveCards": 0,
                "error": f"coverage_request_failed:{error}",
            }
        data = response.json() if response.content else {}
        authenticated = response.status_code not in {401, 403}
        versions = int(data.get("activeLiveVersions") or 0)
        cards = int(data.get("activeLiveCards") or 0)
        return {
            "configured": True,
            "authenticated": authenticated and data.get("registryAuthenticated") is True,
            "ready": response.is_success and data.get("ok") is True and versions > 0 and cards > 0,
            "activeLiveVersions": versions,
            "activeLiveCards": cards,
            "error": _text(data.get("error")),
        }

    async def health(self) -> bool:
        return bool((await self.coverage()).get("ready"))
''',
    "live Registry coverage probe",
)
checklist_path.write_text(checklist, encoding="utf-8")


# ---------------------------------------------------------------------------
# Mac scan endpoint: emit one durable, sanitized receipt on every path.
# ---------------------------------------------------------------------------
main_path = Path("services/instacomp-ai/app/main.py")
main = main_path.read_text(encoding="utf-8")
main = replace_once(main, "import re\n", "import json\nimport re\n", "json import")
main = replace_once(
    main,
    '''    checklist_ready = await checklist_gateway.health()
    # Ollama is a backup reader. Its outage must not mark the internal memory
''',
    '''    checklist_coverage = await checklist_gateway.coverage()
    checklist_ready = bool(checklist_coverage.get("ready"))
    # Ollama is a backup reader. Its outage must not mark the internal memory
''',
    "health coverage lookup",
)
main = replace_once(
    main,
    '''        ollama_model=settings.ollama_model,
        checklist="ready" if checklist_ready else "not_configured",
    )
''',
    '''        ollama_model=settings.ollama_model,
        checklist="ready" if checklist_ready else "not_configured",
        checklist_registry_authenticated=bool(
            checklist_coverage.get("authenticated")
        ),
        checklist_active_live_versions=int(
            checklist_coverage.get("activeLiveVersions") or 0
        ),
        checklist_active_live_cards=int(
            checklist_coverage.get("activeLiveCards") or 0
        ),
    )
''',
    "health coverage response",
)
helper = '''

def _audit_response(
    response: AnalyzeResponse,
    *,
    printed_evidence,
    printed_identity: CardIdentity,
    checklist_result: ChecklistResult,
    phase: str,
    memory_match: MemoryMatch | None = None,
) -> AnalyzeResponse:
    suggestion = response.local_suggestion
    evidence = suggestion.evidence if suggestion else None
    pattern_evidence = list(
        dict.fromkeys(
            [
                *(evidence.colors if evidence else []),
                *(evidence.foil_or_pattern if evidence else []),
                *(evidence.front_notes if evidence else []),
            ]
        )
    )
    candidate_parallels = list(
        dict.fromkeys(
            str(candidate.get("parallel") or "").strip()
            for candidate in checklist_result.candidate_summaries
            if str(candidate.get("parallel") or "").strip()
        )
    )
    selected_identity = response.trusted_identity or (
        suggestion.identity if suggestion else None
    )
    audit = {
        "schema": "tcos.instacomp.checklist-audit.v1",
        "scanId": response.scan_id,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "phase": phase,
        "ocr": {
            "ran": bool(printed_evidence and printed_evidence.checked_images > 0),
            "provider": printed_evidence.provider if printed_evidence else None,
            "checkedImages": printed_evidence.checked_images if printed_evidence else 0,
            "textLength": len(printed_evidence.text) if printed_evidence else 0,
            "conflicts": list(printed_evidence.conflicts) if printed_evidence else [],
        },
        "extracted": printed_identity.model_dump(mode="json"),
        "cardNumberExtracted": bool(printed_identity.card_number),
        "memory": {
            "used": memory_match is not None,
            "lessonId": memory_match.lesson_id if memory_match else None,
            "score": memory_match.score if memory_match else None,
            "source": _memory_source(memory_match) if memory_match else None,
        },
        "registry": {
            "lookupAttempted": checklist_result.lookup_attempted,
            "reachable": checklist_result.registry_reachable,
            "outcome": checklist_result.outcome.value,
            "candidateCount": checklist_result.candidate_count,
            "candidates": checklist_result.candidate_summaries,
            "parallelCandidates": candidate_parallels,
            "exactIdentityId": checklist_result.identity_id,
            "sourceReceipts": checklist_result.source_receipts,
            "reasons": checklist_result.reasons,
        },
        "surface": {
            "patternEvidence": pattern_evidence,
            "selectedParallel": selected_identity.parallel if selected_identity else None,
        },
        "result": {
            "status": response.status,
            "matchSource": response.match_source,
            "exactRegistryMatch": (
                checklist_result.outcome == ChecklistOutcome.EXACT_MATCH
                and bool(checklist_result.identity_id)
            ),
            "pricingAllowed": response.pricing_allowed,
            "learningAllowed": response.learning_allowed,
            "nextAction": response.next_action,
        },
    }
    response.checklist_audit = audit
    print(
        "INSTACOMP_CHECKLIST_AUDIT "
        + json.dumps(audit, sort_keys=True, separators=(",", ":")),
        flush=True,
    )
    return response
'''
main = replace_once(
    main,
    '''

@app.post(
    "/v1/scans/analyze",
''',
    helper + '''

@app.post(
    "/v1/scans/analyze",
''',
    "checklist audit helper",
)
# First direct response: trusted image memory.
main = replace_once(
    main,
    '''        return AnalyzeResponse(
            scan_id=scan_id,
''',
    '''        response = AnalyzeResponse(
            scan_id=scan_id,
''',
    "memory response variable",
)
main = replace_once(
    main,
    '''            ),
        )

    # PRIMARY ENGINE STEP TWO: bounded printed text and the Checklist
''',
    '''            ),
        )
        return _audit_response(
            response,
            printed_evidence=printed_evidence,
            printed_identity=printed_identity,
            checklist_result=registry_result,
            phase="trusted_image_memory",
            memory_match=image_memory,
        )

    # PRIMARY ENGINE STEP TWO: bounded printed text and the Checklist
''',
    "memory audit return",
)
# Second direct response: printed evidence exact Registry match.
main = replace_once(
    main,
    '''        return AnalyzeResponse(
            scan_id=scan_id,
''',
    '''        response = AnalyzeResponse(
            scan_id=scan_id,
''',
    "printed response variable",
)
main = replace_once(
    main,
    '''            ),
        )

    # BACKUP READER: Ollama is called only when trusted image memory and
''',
    '''            ),
        )
        return _audit_response(
            response,
            printed_evidence=printed_evidence,
            printed_identity=printed_identity,
            checklist_result=printed_registry,
            phase="printed_evidence_registry",
        )

    # BACKUP READER: Ollama is called only when trusted image memory and
''',
    "printed registry audit return",
)
main = replace_once(
    main,
    '''        next_action=next_action,
    )
    _save_scan(
''',
    '''        next_action=next_action,
    )
    result = _audit_response(
        result,
        printed_evidence=printed_evidence,
        printed_identity=printed_identity,
        checklist_result=checklist_result,
        phase="model_evidence_registry" if suggestion else "registry_unresolved",
        memory_match=trusted_text_match,
    )
    _save_scan(
''',
    "final audit receipt",
)
main_path.write_text(main, encoding="utf-8")


# ---------------------------------------------------------------------------
# Website bridge: retain the Mac audit receipt inside the AI object.
# ---------------------------------------------------------------------------
local_path = Path("src/lib/instacomp-ai-local.ts")
local = local_path.read_text(encoding="utf-8")
local = replace_once(
    local,
    '''  checklist: {
    outcome: string;
    identity_id?: string | null;
    source_receipts?: string[];
    reasons?: string[];
  };
''',
    '''  checklist: {
    outcome: string;
    identity_id?: string | null;
    source_receipts?: string[];
    reasons?: string[];
  };
  checklist_audit?: Record<string, unknown>;
''',
    "local scan audit type",
)
local = replace_once(
    local,
    '''  backEvidence: string | null;
};
''',
    '''  backEvidence: string | null;
  internalChecklistAudit: Record<string, unknown> | null;
};
''',
    "AI receipt audit type",
)
local = replace_once(
    local,
    '''    backVisibleText,
    backEvidence,
  };
''',
    '''    backVisibleText,
    backEvidence,
    internalChecklistAudit:
      scan.checklist_audit && typeof scan.checklist_audit === "object"
        ? scan.checklist_audit
        : null,
  };
''',
    "AI receipt audit value",
)
local_path.write_text(local, encoding="utf-8")


# ---------------------------------------------------------------------------
# Pending-card persistence and display.
# ---------------------------------------------------------------------------
front_back_path = Path(
    "src/app/api/account/seller/inventory/instacomp-front-back/route.ts"
)
front_back = front_back_path.read_text(encoding="utf-8")
front_back = replace_once(
    front_back,
    '''        review: scanPayload.review || null,
        identitySource: "fresh_front_back_scan",
''',
    '''        review: scanPayload.review || null,
        checklistAudit: record(ai.internalChecklistAudit),
        identitySource: "fresh_front_back_scan",
''',
    "persist checklist audit",
)
front_back = replace_once(
    front_back,
    '''      scanId: scanPayload.scanId || null,
      frontBackContract: {
''',
    '''      scanId: scanPayload.scanId || null,
      checklistAudit: record(ai.internalChecklistAudit),
      frontBackContract: {
''',
    "return checklist audit",
)
front_back_path.write_text(front_back, encoding="utf-8")

status_path = Path(
    "src/app/api/account/seller/inventory/instacomp-job-status/route.ts"
)
status = status_path.read_text(encoding="utf-8")
status = replace_once(
    status,
    '''            backEvidenceText: text(ai.backEvidenceText),
            updatedAt: row.updated_at || null,
''',
    '''            backEvidenceText: text(ai.backEvidenceText),
            checklistAudit: record(instaComp.checklistAudit),
            updatedAt: row.updated_at || null,
''',
    "job status checklist audit",
)
status_path.write_text(status, encoding="utf-8")

page_path = Path("src/app/kingmaker/pending/page.tsx")
page = page_path.read_text(encoding="utf-8")
page = replace_once(
    page,
    '''  backEvidenceText: string | null;
  updatedAt: string | null;
};
''',
    '''  backEvidenceText: string | null;
  checklistAudit: Record<string, unknown> | null;
  updatedAt: string | null;
};
''',
    "page audit type",
)
page = replace_once(
    page,
    '''function message(error: unknown) {
  return error instanceof Error ? error.message : "The operation failed.";
}
''',
    '''function message(error: unknown) {
  return error instanceof Error ? error.message : "The operation failed.";
}

function auditRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function auditText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || "—";
}

function auditYesNo(value: unknown) {
  return value === true ? "YES" : value === false ? "NO" : "—";
}

function auditList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}
''',
    "page audit helpers",
)
page = replace_once(
    page,
    '''            const job = jobs[card.inventoryItemId];
            const stage = localStage[card.inventoryItemId] || (job?.status === "failed" ? "failed" : job?.identityComplete ? "complete" : "waiting");
''',
    '''            const job = jobs[card.inventoryItemId];
            const checklistAudit = auditRecord(job?.checklistAudit);
            const ocrAudit = auditRecord(checklistAudit.ocr);
            const registryAudit = auditRecord(checklistAudit.registry);
            const memoryAudit = auditRecord(checklistAudit.memory);
            const surfaceAudit = auditRecord(checklistAudit.surface);
            const resultAudit = auditRecord(checklistAudit.result);
            const stage = localStage[card.inventoryItemId] || (job?.status === "failed" ? "failed" : job?.identityComplete ? "complete" : "waiting");
''',
    "page audit records",
)
audit_panel = '''                  {Object.keys(checklistAudit).length ? (
                    <details className="mt-3 rounded-lg border-2 border-violet-700 bg-violet-50 p-3 text-sm">
                      <summary className="cursor-pointer font-black text-violet-950">
                        Checklist Audit — prove what InstaComp actually accessed
                      </summary>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        <p><strong>OCR ran:</strong> {auditYesNo(ocrAudit.ran)}</p>
                        <p><strong>OCR provider:</strong> {auditText(ocrAudit.provider)}</p>
                        <p><strong>Images checked:</strong> {auditText(ocrAudit.checkedImages)}</p>
                        <p><strong>Card number:</strong> {auditText(checklistAudit.cardNumberExtracted ? auditRecord(checklistAudit.extracted).card_number : null)}</p>
                        <p><strong>Registry called:</strong> {auditYesNo(registryAudit.lookupAttempted)}</p>
                        <p><strong>Registry reachable:</strong> {auditYesNo(registryAudit.reachable)}</p>
                        <p><strong>Registry outcome:</strong> {auditText(registryAudit.outcome)}</p>
                        <p><strong>Candidates found:</strong> {auditText(registryAudit.candidateCount)}</p>
                        <p><strong>Exact identity ID:</strong> {auditText(registryAudit.exactIdentityId)}</p>
                        <p><strong>Memory used first:</strong> {auditYesNo(memoryAudit.used)}</p>
                        <p><strong>Match source:</strong> {auditText(resultAudit.matchSource)}</p>
                        <p><strong>Selected parallel:</strong> {auditText(surfaceAudit.selectedParallel)}</p>
                      </div>
                      <p className="mt-3"><strong>Parallel candidates:</strong> {auditList(registryAudit.parallelCandidates).join(" · ") || "—"}</p>
                      <p className="mt-2"><strong>Surface/pattern evidence:</strong> {auditList(surfaceAudit.patternEvidence).join(" · ") || "—"}</p>
                      <p className="mt-2"><strong>Registry reasons:</strong> {auditList(registryAudit.reasons).join(" · ") || "—"}</p>
                      <details className="mt-3 rounded border border-violet-300 bg-white p-2">
                        <summary className="cursor-pointer font-bold">Raw audit receipt</summary>
                        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(checklistAudit, null, 2)}</pre>
                      </details>
                    </details>
                  ) : null}
'''
page = replace_once(
    page,
    '''                  {job?.backEvidenceText ? (
                    <details className="mt-3 rounded-lg border border-neutral-400 bg-neutral-50 p-3 text-sm">
                      <summary className="cursor-pointer font-black">Back evidence used by InstaComp</summary>
                      <p className="mt-2 break-words font-semibold">{job.backEvidenceText}</p>
                    </details>
                  ) : null}
''',
    '''                  {job?.backEvidenceText ? (
                    <details className="mt-3 rounded-lg border border-neutral-400 bg-neutral-50 p-3 text-sm">
                      <summary className="cursor-pointer font-black">Back evidence used by InstaComp</summary>
                      <p className="mt-2 break-words font-semibold">{job.backEvidenceText}</p>
                    </details>
                  ) : null}
''' + audit_panel,
    "visible checklist audit panel",
)
page_path.write_text(page, encoding="utf-8")


# ---------------------------------------------------------------------------
# Production Registry coverage endpoint and readiness visibility.
# ---------------------------------------------------------------------------
write(
    "src/app/api/instacomp/checklist-coverage/route.ts",
    '''import { NextResponse } from "next/server";
import {
  isValidInstaCompServiceRequest,
  requireInstaCompJobSupabase,
} from "../../../../lib/instacomp-job-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!isValidInstaCompServiceRequest(request)) {
      return NextResponse.json(
        { ok: false, error: "Valid InstaComp service authentication is required." },
        { status: 401 },
      );
    }
    const supabase = requireInstaCompJobSupabase();
    const [versionsResult, cardsResult] = await Promise.all([
      supabase
        .from("checklist_versions")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .eq("status", "live"),
      supabase
        .from("checklist_cards")
        .select(
          "id,version:checklist_versions!inner(id,is_active,status)",
          { count: "exact", head: true },
        )
        .eq("version.is_active", true)
        .eq("version.status", "live"),
    ]);
    if (versionsResult.error) throw versionsResult.error;
    if (cardsResult.error) throw cardsResult.error;
    const activeLiveVersions = Number(versionsResult.count || 0);
    const activeLiveCards = Number(cardsResult.count || 0);
    return NextResponse.json(
      {
        ok: activeLiveVersions > 0 && activeLiveCards > 0,
        registryAuthenticated: true,
        activeLiveVersions,
        activeLiveCards,
        lookupScope: "all active/live checklist versions and their card rows",
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        registryAuthenticated: true,
        activeLiveVersions: 0,
        activeLiveCards: 0,
        error: error instanceof Error ? error.message : "Checklist coverage audit failed.",
      },
      { status: 500 },
    );
  }
}
''',
)

readiness_path = Path("src/app/api/instacomp/internal-readiness/route.ts")
readiness = readiness_path.read_text(encoding="utf-8")
readiness = replace_once(
    readiness,
    '''    const localModelReady = health.ollama === "ready";
    const ok = internalMemoryReady && checklistReady && localModelReady;
''',
    '''    const localModelReady = health.ollama === "ready";
    const checklistRegistryAuthenticated =
      health.checklist_registry_authenticated === true;
    const checklistActiveLiveVersions = Number(
      health.checklist_active_live_versions || 0,
    );
    const checklistActiveLiveCards = Number(
      health.checklist_active_live_cards || 0,
    );
    const ok = internalMemoryReady && checklistReady && localModelReady;
''',
    "readiness coverage extraction",
)
readiness = replace_once(
    readiness,
    '''        checklistReady,
        localModelReady,
        app: typeof health.app === "string" ? health.app : "InstaComp AI",
''',
    '''        checklistReady,
        checklistRegistryAuthenticated,
        checklistActiveLiveVersions,
        checklistActiveLiveCards,
        localModelReady,
        app: typeof health.app === "string" ? health.app : "InstaComp AI",
''',
    "readiness coverage response",
)
readiness_path.write_text(readiness, encoding="utf-8")

print("Applied InstaComp checklist path audit patch.")
