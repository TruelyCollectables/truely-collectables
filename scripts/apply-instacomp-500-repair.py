from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        if new in source:
            return source
        raise SystemExit(f"{label} block not found")
    return source.replace(old, new, 1)


main_path = Path("services/instacomp-ai/app/main.py")
main = main_path.read_text()

main = main.replace(
    'Private InstaComp internal memory engine with Checklist Registry locking, "\n        "Ollama backup vision, and no direct OpenAI dependency.',
    'Private InstaComp internal memory engine with Checklist Registry locking, "\n        "deterministic review receipts, and no external identity dependency.',
)

old_health = '''    database_ready = store.ready()
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
    )'''
new_health = '''    database_ready = store.ready()
    checklist_ready = await checklist_gateway.health()
    return HealthResponse(
        ok=database_ready and checklist_ready,
        app=settings.app_name,
        codename=settings.codename,
        version=settings.version,
        database="ready" if database_ready else "error",
        ollama="unchecked",
        ollama_model="disabled_for_identity_scans",
        checklist="ready" if checklist_ready else "not_configured",
    )'''
main = replace_once(main, old_health, new_health, "health contract")

old_marker = (
    "    # BACKUP READER: Ollama is called only when trusted image memory and\n"
    "    # bounded OCR/Checklist Registry resolution did not identify the card."
)
new_marker = (
    "    # CHECKLIST-ONLY REVIEW PATH: unresolved cards are preserved as complete\n"
    "    # scan receipts. No Ollama or external identity reader is called here."
)
if old_marker in main:
    start = main.index(old_marker)
    end = main.index("    suggestion_back_evidence = (", start)
    replacement = '''    # CHECKLIST-ONLY REVIEW PATH: unresolved cards are preserved as complete
    # scan receipts. No Ollama or external identity reader is called here.
    suggestion = None
    proposed_identity = printed_identity
    memory_matches = (
        store.search(proposed_identity)
        if any(proposed_identity.model_dump().values())
        else []
    )
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
        checklist_result = printed_registry
        trusted_identity = None
        pricing_allowed = False
        match_source = "none"
        if checklist_result.outcome == ChecklistOutcome.NOT_CONFIGURED:
            status = "needs_checklist"
            next_action = (
                "Checklist Registry is not connected. Preserve this scan for private manual review."
            )
        else:
            status = "needs_review"
            next_action = (
                "InstaComp preserved the front/back scan and checklist receipt, but one exact identity was not proven. Review or correct the card privately."
            )

'''
    main = main[:start] + replacement + main[end:]
elif new_marker not in main:
    raise SystemExit("Ollama identity block not found")

main_path.write_text(main)

local_path = Path("src/lib/instacomp-ai-local.ts")
local = local_path.read_text()

local = replace_once(
    local,
    "  internalScanId: string;\n  internalMatchSource: string | null;",
    "  internalScanId: string;\n  internalStatus: string;\n  internalChecklistOutcome: string | null;\n  internalChecklistCandidateCount: number;\n  internalChecklistReasons: string[];\n  internalChecklistSourceReceipts: string[];\n  internalMatchSource: string | null;",
    "internal receipt type",
)

old_no_identity = '''  const identity = trusted || suggested;
  if (!identity) return null;

  const player = text(identity.player);'''
new_no_identity = '''  const identity = trusted || suggested;
  if (!identity) {
    const checklistReasons = textList(scan.checklist?.reasons);
    const checklistReceipts = textList(scan.checklist?.source_receipts);
    return {
      player: null,
      year: null,
      brand: null,
      setName: null,
      cardNumber: null,
      parallel: null,
      serialNumber: null,
      team: null,
      sport: null,
      isRookie: false,
      isAuto: false,
      isRelic: false,
      conditionGuess: null,
      confidence: 0,
      notes: [
        `InstaComp internal status: ${scan.status}.`,
        scan.next_action || null,
        checklistReasons.length
          ? `Checklist: ${checklistReasons.join(" | ")}`
          : null,
      ]
        .filter(Boolean)
        .join(" "),
      internalScanId: safeScanId(scan.scan_id),
      internalStatus: scan.status,
      internalChecklistOutcome: text(scan.checklist?.outcome),
      internalChecklistCandidateCount: Math.max(
        0,
        Number(
          (scan.checklist as Record<string, unknown> | undefined)
            ?.candidate_count || 0,
        ),
      ),
      internalChecklistReasons: checklistReasons,
      internalChecklistSourceReceipts: checklistReceipts,
      internalMatchSource: text(scan.match_source),
      internalCanonicalFilename: text(scan.canonical_filename),
      internalLearningAllowed: false,
      internalInscription: false,
      internalInscriptionText: null,
      internalMemorabiliaType: null,
      frontVisibleText: [],
      backVisibleText: [],
      backEvidence: null,
    };
  }

  const player = text(identity.player);'''
local = replace_once(local, old_no_identity, new_no_identity, "no-identity review adapter")

local = local.replace("  if (!player && !cardNumber && !setName) return null;\n", "", 1)

local = replace_once(
    local,
    "    internalScanId: safeScanId(scan.scan_id),\n    internalMatchSource: text(source),",
    "    internalScanId: safeScanId(scan.scan_id),\n    internalStatus: scan.status,\n    internalChecklistOutcome: text(scan.checklist?.outcome),\n    internalChecklistCandidateCount: Math.max(\n      0,\n      Number(\n        (scan.checklist as Record<string, unknown> | undefined)\n          ?.candidate_count || 0,\n      ),\n    ),\n    internalChecklistReasons: textList(scan.checklist?.reasons),\n    internalChecklistSourceReceipts: textList(\n      scan.checklist?.source_receipts,\n    ),\n    internalMatchSource: text(source),",
    "resolved-identity receipt",
)
local_path.write_text(local)

simulation_path = Path("scripts/run-instacomp-review-contract-simulations.ts")
simulation_path.write_text('''import assert from "node:assert/strict";
import {
  instaCompAiLocalScanToAi,
  type InstaCompAiLocalScan,
} from "../src/lib/instacomp-ai-local";

const scan: InstaCompAiLocalScan = {
  schema_version: "tcos.instacomp-ai.scan.v1",
  scan_id: "review-contract-123",
  status: "needs_review",
  pricing_allowed: false,
  learning_allowed: false,
  trusted_identity: null,
  local_suggestion: null,
  match_source: "none",
  checklist: {
    outcome: "input_incomplete",
    reasons: ["Printed evidence did not contain a labeled card number."],
    source_receipts: [],
  },
  next_action: "Review privately.",
};

const ai = instaCompAiLocalScanToAi(scan);
assert.ok(ai, "A valid review scan must never be converted to null");
assert.equal(ai.internalScanId, "review-contract-123");
assert.equal(ai.internalStatus, "needs_review");
assert.equal(ai.internalChecklistOutcome, "input_incomplete");
assert.deepEqual(ai.internalChecklistReasons, [
  "Printed evidence did not contain a labeled card number.",
]);
assert.equal(ai.confidence, 0);
assert.equal(ai.player, null);
assert.match(ai.notes || "", /Review privately/);
console.log("InstaComp review contract simulation passed.");
''')

static_test = Path("services/instacomp-ai/tests/test_checklist_only_scan_contract.py")
static_test.parent.mkdir(parents=True, exist_ok=True)
static_test.write_text('''from pathlib import Path


def analyze_source() -> str:
    source = Path("services/instacomp-ai/app/main.py").read_text()
    return source.split("async def analyze_scan", 1)[1].split(
        '@app.post(\n    "/v1/lessons"', 1
    )[0]


def test_analyze_scan_has_no_ollama_identity_call():
    analyze = analyze_source()
    assert "await reader.analyze(" not in analyze
    assert "CHECKLIST-ONLY REVIEW PATH" in analyze
    assert 'status = "needs_review"' in analyze


def test_unresolved_scan_still_builds_and_saves_response():
    analyze = analyze_source()
    assert "result = AnalyzeResponse(" in analyze
    assert "_save_scan(" in analyze
    assert "return result" in analyze


def test_health_marks_ollama_unchecked():
    source = Path("services/instacomp-ai/app/main.py").read_text()
    assert 'ollama="unchecked"' in source
    assert 'ollama_model="disabled_for_identity_scans"' in source
''')

print("Applied InstaComp checklist-only 500 repair.")
