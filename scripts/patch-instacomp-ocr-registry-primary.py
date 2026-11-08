from __future__ import annotations

from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"{label} anchor missing")
    return text.replace(old, new, 1)


# Export the pure OCR enrichment helper for permanent regressions.
server_path = Path("src/lib/instacomp-checklist-first-server.ts")
server = server_path.read_text()
server = replace_once(
    server,
    "function enrichInputFromOcr(\n",
    "export function enrichInstaCompChecklistInputFromOcr(\n",
    "OCR enrichment export",
)
server = replace_once(
    server,
    "const enriched = enrichInputFromOcr(input, candidates);",
    "const enriched = enrichInstaCompChecklistInputFromOcr(input, candidates);",
    "OCR enrichment call",
)
if server.count("const supabase = serviceClient();") != 1:
    raise SystemExit("Supabase client must be scoped to exactly one real lookup call")
server_path.write_text(server)


# Send bounded OCR evidence with the same front/back card request.
client_path = Path("src/lib/instacomp-ai-local.ts")
client = client_path.read_text()
client = replace_once(
    client,
    '''export async function analyzeWithInstaCompAiLocal(params: {
  front: Blob;
  back?: Blob | null;
  timeoutMs?: number;
}): Promise<InstaCompAiLocalScan> {''',
    '''export async function analyzeWithInstaCompAiLocal(params: {
  front: Blob;
  back?: Blob | null;
  printedEvidence?: {
    provider?: string;
    text?: string;
    serialNumber?: string | null;
    checkedImages?: number;
    conflicts?: string[];
  } | null;
  timeoutMs?: number;
}): Promise<InstaCompAiLocalScan> {''',
    "local client signature",
)
client = replace_once(
    client,
    '''  body.append("front", params.front, "front.jpg");
  if (params.back) body.append("back", params.back, "back.jpg");
  const response = await fetch''',
    '''  body.append("front", params.front, "front.jpg");
  if (params.back) body.append("back", params.back, "back.jpg");
  if (params.printedEvidence?.text) {
    body.append(
      "printed_evidence_json",
      JSON.stringify({
        provider: text(params.printedEvidence.provider)?.slice(0, 120) || null,
        text: String(params.printedEvidence.text).slice(0, 12_000),
        serialNumber:
          text(params.printedEvidence.serialNumber)?.slice(0, 80) || null,
        checkedImages: Math.max(
          0,
          Math.min(Number(params.printedEvidence.checkedImages) || 0, 64),
        ),
        conflicts: Array.isArray(params.printedEvidence.conflicts)
          ? params.printedEvidence.conflicts
              .map((value) => text(value)?.slice(0, 160))
              .filter(Boolean)
              .slice(0, 20)
          : [],
      }),
    );
  }
  const response = await fetch''',
    "local client multipart body",
)
client_path.write_text(client)


# The website has already run bounded OCR. Forward the receipt to InstaComp.
route_path = Path("src/app/api/instacomp/scan/route.ts")
route = route_path.read_text()
route = replace_once(
    route,
    '''              front: params.frontImage,
              back: params.backImage || null,
              timeoutMs: 150_000,''',
    '''              front: params.frontImage,
              back: params.backImage || null,
              printedEvidence: params.externalOcr,
              timeoutMs: 150_000,''',
    "website local engine call",
)
route_path.write_text(route)


# Internal service order: trusted visual memory -> OCR/Registry -> Ollama backup.
main_path = Path("services/instacomp-ai/app/main.py")
main = main_path.read_text()
main = replace_once(
    main,
    "from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile",
    "from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile",
    "FastAPI Form import",
)
main = replace_once(
    main,
    "from .ollama import OllamaReader\n",
    '''from .ollama import OllamaReader
from .printed_evidence import (
    identity_from_printed_evidence,
    parse_printed_evidence,
)
''',
    "printed evidence import",
)
main = replace_once(
    main,
    '''async def analyze_scan(
    front: UploadFile = File(...),
    back: UploadFile | None = File(default=None),
) -> AnalyzeResponse:''',
    '''async def analyze_scan(
    front: UploadFile = File(...),
    back: UploadFile | None = File(default=None),
    printed_evidence_json: str | None = Form(default=None),
) -> AnalyzeResponse:''',
    "FastAPI scan signature",
)
main = replace_once(
    main,
    '''    combined_hash = pair_hash(
        front_image.sha256,
        back_image.sha256 if back_image else None,
    )
''',
    '''    combined_hash = pair_hash(
        front_image.sha256,
        back_image.sha256 if back_image else None,
    )
    printed_evidence = parse_printed_evidence(printed_evidence_json)
    printed_identity = identity_from_printed_evidence(printed_evidence)
    printed_text = printed_evidence.text if printed_evidence else None
''',
    "printed evidence parsing",
)
main = replace_once(
    main,
    '''    # BACKUP READER: Ollama is called only for a card the internal visual memory
    # did not know. Its suggestion is evidence, not trusted identity.
''',
    '''    # PRIMARY ENGINE STEP TWO: bounded printed text and the Checklist
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
''',
    "OCR Registry primary block",
)
main = replace_once(
    main,
    "        checklist_result = await checklist_gateway.match(proposed_identity)\n",
    '''        checklist_result = await checklist_gateway.match(
            proposed_identity,
            printed_text,
        )
''',
    "Ollama evidence Registry call",
)
main_path.write_text(main)


# Permanent static contract prevents accidental model-first regression.
contract_path = Path("scripts/check-instacomp-local-primary-contract.mjs")
contract = contract_path.read_text()
marker = '''requireText(
  client,
  "internalScanId: safeScanId(scan.scan_id)",
  "The website must retain the internal scan receipt for later teaching.",
);
'''
addition = '''requireText(
  route,
  "printedEvidence: params.externalOcr",
  "The website must forward bounded printed evidence to InstaComp.",
);
requireText(
  client,
  '"printed_evidence_json"',
  "The local client must carry bounded printed evidence with the card.",
);
requireText(
  service,
  "printed_registry = (",
  "The local engine must query the Checklist Registry before Ollama.",
);
if (service.indexOf("printed_registry = (") >= service.indexOf("reader.analyze")) {
  throw new Error("OCR/Checklist Registry resolution must run before Ollama backup.");
}
requireText(
  service,
  'match_source="checklist_registry"',
  "OCR-resolved cards must record Checklist Registry provenance.",
);
'''
if addition not in contract:
    if marker not in contract:
        raise SystemExit("permanent contract marker missing")
    contract = contract.replace(marker, addition + marker, 1)
contract_path.write_text(contract)

print("OCR/Checklist Registry primary patch applied")
