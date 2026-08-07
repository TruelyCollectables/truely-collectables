from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one source block, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


# 1) Deterministic Apple Vision set/insert title extraction from prominent front text.
vision = Path("services/instacomp-ai/app/local_vision.py")
text = vision.read_text(encoding="utf-8")
marker = "SERIAL_EXACT_RE = re.compile"
if "SET_TITLE_STOPWORDS" not in text:
    insertion = '''SET_TITLE_STOPWORDS = {
    "panini", "topps", "bowman", "upper", "deck", "leaf", "donruss", "fleer", "score",
    "prizm", "prism", "select", "optic", "mosaic", "wnba", "nba", "nfl", "nhl", "mlb",
    "basketball", "baseball", "football", "hockey", "rookie", "official", "trading", "card",
    "cards", "copyright", "concourse", "premier", "courtside",
}


'''
    text = text.replace(marker, insertion + marker, 1)
    vision.write_text(text, encoding="utf-8")

set_hint = '''\n\ndef _set_name_hint(observations: Iterable[OCRObservation]) -> str | None:\n    values = [value for value in observations if value.side == "front"]\n    player = _player_hint(values)\n    player_key = re.sub(r"[^a-z0-9]+", " ", str(player or "").lower()).strip()\n    candidates: list[tuple[float, str]] = []\n    for observation in values:\n        if observation.confidence < 0.82:\n            continue\n        cleaned = re.sub(r"[^A-Za-z0-9 &'\\-]+", " ", str(observation.text or ""))\n        cleaned = " ".join(cleaned.split()).strip(" -")\n        words = cleaned.split()\n        if not 1 <= len(words) <= 4:\n            continue\n        normalized = re.sub(r"[^a-z0-9]+", " ", cleaned.lower()).strip()\n        if not normalized or normalized == player_key:\n            continue\n        tokens = [token for token in normalized.split() if token]\n        if not tokens or all(token in SET_TITLE_STOPWORDS for token in tokens):\n            continue\n        if any(needle == normalized for needle in MANUFACTURERS):\n            continue\n        if normalized.isdigit() or YEAR_RE.fullmatch(normalized):\n            continue\n        width = float(observation.box.width or 0)\n        height = float(observation.box.height or 0)\n        if width < 0.14 or height < 0.045:\n            continue\n        cy = observation.box.y + observation.box.height / 2\n        score = float(observation.confidence) + min(0.8, height * 6.0) + min(0.45, width * 0.5)\n        if cleaned.upper() == cleaned and any(char.isalpha() for char in cleaned):\n            score += 0.15\n        if 0.12 <= cy <= 0.75:\n            score += 0.10\n        candidates.append((score, cleaned))\n    if not candidates:\n        return None\n    score, value = max(candidates, key=lambda item: item[0])\n    return value if score >= 1.45 else None\n'''
if "def _set_name_hint(" not in vision.read_text(encoding="utf-8"):
    replace_once(
        vision,
        "\n\ndef _parallel_hint(\n",
        set_hint + "\n\ndef _parallel_hint(\n",
        "insert deterministic set title helper",
    )
replace_once(
    vision,
    "        player=_player_hint(observations),\n        card_number=_card_number_hint(observations),\n",
    "        player=_player_hint(observations),\n        set_name=_set_name_hint(front.ocr),\n        card_number=_card_number_hint(observations),\n",
    "wire deterministic set name",
)

# 2) Deterministic set title outranks free-form Qwen just like year/card number.
ollama = Path("services/instacomp-ai/app/ollama.py")
replace_once(
    ollama,
    '    hard_fields = {"year", "manufacturer", "card_number"}\n',
    '    hard_fields = {"year", "manufacturer", "set_name", "card_number"}\n',
    "make deterministic set name hard",
)

# 3) Preserve Mac Registry receipt and deterministic identity hints through web bridge.
local_ts = Path("src/lib/instacomp-ai-local.ts")
replace_once(
    local_ts,
    "  internalChecklistSourceReceipts: string[];\n  internalMatchSource: string | null;\n",
    "  internalChecklistSourceReceipts: string[];\n  internalChecklistIdentityId: string | null;\n  internalChecklistFingerprintSha256: string | null;\n  internalDeterministicIdentity: Record<string, unknown> | null;\n  internalDeterministicEvidence: string[];\n  internalMatchSource: string | null;\n",
    "extend local receipt type",
)
helper = '''\nfunction record(value: unknown): Record<string, unknown> {\n  return value && typeof value === "object" && !Array.isArray(value)\n    ? (value as Record<string, unknown>)\n    : {};\n}\n\nfunction checklistReceiptValue(scan: InstaCompAiLocalScan, prefix: string) {\n  const receipts = textList(scan.checklist?.source_receipts);\n  const value = receipts.find((receipt) => receipt.startsWith(prefix));\n  return value ? text(value.slice(prefix.length)) : null;\n}\n\nfunction deterministicIdentity(scan: InstaCompAiLocalScan) {\n  const localVision = record(scan.local_vision);\n  const hints = record(localVision.identity_hints);\n  const identity: Record<string, unknown> = {\n    player: text(hints.player),\n    year: text(hints.year),\n    brand: text(hints.manufacturer ?? hints.brand),\n    setName: text(hints.set_name ?? hints.setName),\n    cardNumber: text(hints.card_number ?? hints.cardNumber),\n    parallel: text(hints.parallel),\n    serialNumber: text(hints.serial_number ?? hints.serialNumber),\n    team: text(hints.team),\n    sport: text(hints.sport),\n    isRookie: hints.rookie === true ? true : null,\n    isAuto: hints.autograph === true ? true : null,\n    isRelic: hints.memorabilia === true ? true : null,\n  };\n  const compact = Object.fromEntries(\n    Object.entries(identity).filter(([, value]) => value !== null && value !== ""),\n  );\n  return Object.keys(compact).length ? compact : null;\n}\n\nfunction deterministicEvidence(scan: InstaCompAiLocalScan) {\n  const localVision = record(scan.local_vision);\n  const front = record(localVision.front);\n  const pattern = record(front.pattern);\n  const hints = deterministicIdentity(scan);\n  return [\n    hints ? "Apple Vision/OpenCV deterministic identity hints present" : null,\n    text(pattern.label) && text(pattern.label) !== "unknown"\n      ? `OpenCV front pattern: ${text(pattern.label)}`\n      : null,\n  ].filter((value): value is string => Boolean(value));\n}\n'''
if "function deterministicIdentity(scan:" not in local_ts.read_text(encoding="utf-8"):
    replace_once(
        local_ts,
        "\nfunction confidence(value: unknown) {\n",
        helper + "\nfunction confidence(value: unknown) {\n",
        "insert deterministic bridge helpers",
    )

# Add receipt fields to both return paths.
replace_once(
    local_ts,
    "      internalChecklistSourceReceipts: checklistReceipts,\n      internalMatchSource: text(scan.match_source),\n",
    "      internalChecklistSourceReceipts: checklistReceipts,\n      internalChecklistIdentityId: text(scan.checklist?.identity_id),\n      internalChecklistFingerprintSha256: checklistReceiptValue(scan, \"registry_fingerprint:\"),\n      internalDeterministicIdentity: deterministicIdentity(scan),\n      internalDeterministicEvidence: deterministicEvidence(scan),\n      internalMatchSource: text(scan.match_source),\n",
    "bridge receipt fields no-identity return",
)
replace_once(
    local_ts,
    "    internalChecklistSourceReceipts: textList(\n      scan.checklist?.source_receipts,\n    ),\n    internalMatchSource: text(source),\n",
    "    internalChecklistSourceReceipts: textList(\n      scan.checklist?.source_receipts,\n    ),\n    internalChecklistIdentityId: text(scan.checklist?.identity_id),\n    internalChecklistFingerprintSha256: checklistReceiptValue(scan, \"registry_fingerprint:\"),\n    internalDeterministicIdentity: deterministicIdentity(scan),\n    internalDeterministicEvidence: deterministicEvidence(scan),\n    internalMatchSource: text(source),\n",
    "bridge receipt fields identity return",
)

# 4) Current Registry receipt revalidation by exact identity UUID + fingerprint.
learning = Path("src/lib/instacomp-learning-server.ts")
receipt_helper = r'''

export async function revalidateChecklistRegistryReceipt(params: {
  ai: Record<string, any>;
  identityId?: string | null;
  fingerprintSha256?: string | null;
}): Promise<ChecklistRegistryLookupResult | null> {
  const identityId = String(params.identityId || "").trim();
  const fingerprintSha256 = String(params.fingerprintSha256 || "").trim().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identityId) ||
    !/^[0-9a-f]{64}$/.test(fingerprintSha256)
  ) {
    return null;
  }

  const supabase = serviceClient();
  const identityResult = await supabase
    .from("checklist_card_identities")
    .select(
      "id,card_id,fingerprint_sha256,canonical_key,variation,autograph_status,memorabilia_status,configuration_exclusivity,metadata,parallel:checklist_parallels(name,serial_run)",
    )
    .eq("id", identityId)
    .maybeSingle();
  if (identityResult.error || !identityResult.data) return null;
  const identity = identityResult.data as any;
  if (String(identity.fingerprint_sha256 || "").toLowerCase() !== fingerprintSha256) {
    return null;
  }

  const cardResult = await supabase
    .from("checklist_cards")
    .select(
      "id,release_id,version_id,set_id,card_number,normalized_card_number,variation,autograph_status,memorabilia_status",
    )
    .eq("id", identity.card_id)
    .maybeSingle();
  if (cardResult.error || !cardResult.data) return null;
  const card = cardResult.data as any;

  const [versionResult, setResult, releaseResult, playerResult, teamResult] = await Promise.all([
    supabase.from("checklist_versions").select("id,is_active,status").eq("id", card.version_id).maybeSingle(),
    supabase.from("checklist_sets").select("id,name,normalized_name,release_id,version_id").eq("id", card.set_id).maybeSingle(),
    supabase
      .from("checklist_releases")
      .select(
        "id,product_name,release_year,season,manufacturer:checklist_manufacturers(name),brand:checklist_brands(name),sport:checklist_sports(name),league:checklist_leagues(name)",
      )
      .eq("id", card.release_id)
      .maybeSingle(),
    supabase
      .from("checklist_card_players")
      .select("card_id,display_order,player:checklist_players(canonical_name)")
      .eq("card_id", card.id),
    supabase
      .from("checklist_card_teams")
      .select("card_id,display_order,team:checklist_teams(canonical_name)")
      .eq("card_id", card.id),
  ]);
  if (
    versionResult.error || setResult.error || releaseResult.error ||
    playerResult.error || teamResult.error ||
    !versionResult.data || !setResult.data || !releaseResult.data
  ) {
    return null;
  }
  const version = versionResult.data as any;
  if (version.is_active !== true || String(version.status || "") !== "live") return null;

  const row = {
    ...card,
    version,
    set: setResult.data,
    release: releaseResult.data,
    players: playerResult.data || [],
    teams: teamResult.data || [],
    identities: [identity],
  };
  const match = chooseRegistryMatch(params.ai, [row]);
  if (
    !match ||
    match.identityId !== identityId ||
    match.fingerprintSha256.toLowerCase() !== fingerprintSha256
  ) {
    return null;
  }
  return {
    status: "internal_exact_match",
    match,
    reasons: ["current_registry_revalidated_exact_mac_identity_receipt_against_visible_evidence"],
    candidateCount: 1,
    coveredReleaseIds: [String(card.release_id)],
    coveredVersionIds: [String(card.version_id)],
    coveredSetIds: [String(card.set_id)],
    sourceTier: "internal",
    externalLookupEligible: false,
    externalLookupAttempted: false,
  };
}
'''
if "export async function revalidateChecklistRegistryReceipt" not in learning.read_text(encoding="utf-8"):
    replace_once(
        learning,
        "\nexport async function findChecklistRegistryMatch(ai: Record<string, any>) {\n",
        receipt_helper + "\nexport async function findChecklistRegistryMatch(ai: Record<string, any>) {\n",
        "insert exact Registry receipt revalidation",
    )

# 5) Base product-line wording is not itself a surface/finish risk.
consensus = Path("src/lib/instacomp-consensus.ts")
replace_once(
    consensus,
    "    /\\b(speckle(?:d)?|sparkle|glitter|rainbow|holo(?:graphic)?|foil|acetate|clear[-\\s]*stock|transparent|translucent|outburst|refractor|prizm|prism|shimmer|wave|pulsar|mojo|mosaic|laser|black\\s+and\\s+white)\\b/i;\n",
    "    /\\b(speckle(?:d)?|sparkle|glitter|rainbow|holo(?:graphic)?|foil|acetate|clear[-\\s]*stock|transparent|translucent|outburst|refractor|shimmer|wave|pulsar|mojo|mosaic|laser|black\\s+and\\s+white)\\b/i;\n",
    "remove generic Prizm product word from surface risk",
)

# 6) Route: deterministic local witness, safe Registry receipt revalidation, and honor requested basic/adaptive policy.
route = Path("src/app/api/instacomp/scan/route.ts")
replace_once(
    route,
    "  instaCompAiLocalScanToAi,\n} from \"../../../../lib/instacomp-ai-local\";\n",
    "  instaCompAiLocalScanToAi,\n  type InstaCompAiResultWithInternalReceipt,\n} from \"../../../../lib/instacomp-ai-local\";\n",
    "import local receipt type",
)
replace_once(
    route,
    "  buildInstaCompEvidenceIdentityDecision,\n  resolveChecklistRegistry,\n} from \"../../../../lib/instacomp-learning-server\";\n",
    "  buildInstaCompEvidenceIdentityDecision,\n  resolveChecklistRegistry,\n  revalidateChecklistRegistryReceipt,\n} from \"../../../../lib/instacomp-learning-server\";\n",
    "import Registry receipt revalidator",
)
replace_once(
    route,
    "      environment: process.env.NODE_ENV,\n    });\n",
    "      environment: process.env.NODE_ENV,\n      // Authenticated local-first scans may explicitly choose the basic lane.\n      // Exact identity still requires deterministic evidence + current Registry truth.\n      allowBasic: true,\n    });\n",
    "allow authenticated basic local-first lane",
)

primary_block = '''  const readers: InstaCompConsensusReaderFinding[] = [\n    buildInstaCompReaderFindingFromAi({\n      readerId: `primary_vision_${params.primaryAiProvider}`,\n      label: `Primary AI vision (${params.primaryAiProvider})`,\n      kind: "primary_vision",\n      family: params.primaryAiFamily,\n      ai: params.baseAi,\n      evidence: ["front/back image model identity pass"],\n      weight: 1,\n    }),\n  ];\n\n'''
deterministic_block = primary_block + '''  const internal = params.baseAi as InstaCompAiResultWithInternalReceipt;\n  const deterministicIdentity = internal.internalDeterministicIdentity || null;\n  if (deterministicIdentity && Object.keys(deterministicIdentity).length) {\n    readers.push({\n      readerId: "instacomp_local_deterministic",\n      label: "Apple Vision/OpenCV deterministic evidence",\n      kind: "ocr_printed_evidence",\n      family: "instacomp_local_deterministic",\n      identity: deterministicIdentity as InstaCompConsensusIdentity,\n      confidence: 0.99,\n      weight: 1.25,\n      evidence: internal.internalDeterministicEvidence.length\n        ? internal.internalDeterministicEvidence\n        : ["Apple Vision/OpenCV deterministic identity hints"],\n    });\n  }\n\n'''
replace_once(route, primary_block, deterministic_block, "add deterministic local consensus witness")
replace_once(
    route,
    "    const aiCouncilRaw = await runInstaCompAiCouncil({\n      runSecondaryVision: false,\n      requestedTier: \"basic\",\n",
    "    const aiCouncilRaw = await runInstaCompAiCouncil({\n      runSecondaryVision:\n        requestedAiCouncilTier !== \"basic\" && consensusEscalation.runSecondaryVision,\n      requestedTier: requestedAiCouncilTier,\n",
    "honor resolved council policy",
)
replace_once(
    route,
    "    const checklistResolution = await resolveChecklistRegistry(registryProbeAi, {\n      evidenceTrusted: evidenceConsensus.trustedForIdentity,\n    });\n",
    "    const internalReceipt = primaryAiResult.value as InstaCompAiResultWithInternalReceipt;\n    const receiptResolution = await revalidateChecklistRegistryReceipt({\n      ai: registryProbeAi,\n      identityId: internalReceipt.internalChecklistIdentityId,\n      fingerprintSha256: internalReceipt.internalChecklistFingerprintSha256,\n    });\n    const checklistResolution =\n      receiptResolution ||\n      (await resolveChecklistRegistry(registryProbeAi, {\n        evidenceTrusted: evidenceConsensus.trustedForIdentity,\n      }));\n",
    "use current exact Mac Registry receipt before broad lookup",
)

# 7) Real OCR regression: prominent GROOVY title becomes deterministic set hint.
test_py = Path("services/instacomp-ai/tests/test_ocr_registry_hard_facts.py")
test_text = test_py.read_text(encoding="utf-8")
if "test_real_groovy_prominent_front_title_becomes_set_hint" not in test_text:
    test_text += '''\n\ndef test_real_groovy_prominent_front_title_becomes_set_hint():\n    front = side(\n        "front",\n        [\n            obs("GROOVY", side="front", x=0.244, y=0.203, width=0.497, height=0.096, confidence=1.0),\n            obs("SONIA CITRON", side="front", x=0.28, y=0.10, width=0.38, height=0.052, confidence=1.0),\n            obs("WASHINGTON MYSTICS", side="front", x=0.31, y=0.06, width=0.30, height=0.030, confidence=1.0),\n        ],\n    )\n    back = side(\n        "back",\n        [\n            obs("No. 13", side="back", x=0.75, y=0.80, width=0.12, height=0.04, confidence=1.0),\n            obs("2025 PANINI - WNBA PRIZM BASKETBALL", side="back", x=0.54, y=0.15, width=0.48, height=0.03, confidence=1.0),\n        ],\n    )\n    identity = build_identity_hints(front=front, back=back, serial=SerialEvidence())\n    assert identity.set_name == "GROOVY"\n    assert identity.card_number == "13"\n    assert identity.manufacturer == "Panini"\n'''
    test_py.write_text(test_text, encoding="utf-8")

# 8) Permanent TypeScript simulations for consensus and bridge behavior.
sim = Path("scripts/run-instacomp-final-identity-consensus-simulations.ts")
if not sim.exists():
    sim.write_text(r'''import assert from "node:assert/strict";
import { buildInstaCompMultiScannerConsensus } from "../src/lib/instacomp-consensus";
import { buildChecklistRegistryCatalogEvidence, buildInstaCompEvidenceIdentityDecision } from "../src/lib/instacomp-learning-server";
import { catalogEvidenceToConsensusReferee } from "../src/lib/instacomp-curated-checklist";
import { instaCompAiLocalScanToAi } from "../src/lib/instacomp-ai-local";

const iceMatch = {
  identityId: "bde0577b-72e8-4e59-8287-89aaf2f9e7e2",
  fingerprintSha256: "1".repeat(64),
  sourceLabel: "InstaComp Checklist Registry",
  score: 100,
  manufacturer: "Panini",
  brand: "Panini",
  product: "2025 Panini Prizm WNBA",
  player: "Dominique Malonga",
  year: "2025",
  setName: "Base",
  cardNumber: "116",
  parallel: "Prizms Ice",
  variation: null,
  serialRun: null,
  team: null,
  sport: "Basketball",
  league: "WNBA",
  languageCode: null,
  configurationExclusivity: null,
  isAuto: false,
  isRelic: false,
  matchedEvidence: ["exact registry"],
};
const iceCatalog = buildChecklistRegistryCatalogEvidence(iceMatch);
const iceReferee = catalogEvidenceToConsensusReferee(iceCatalog);
const iceConsensus = buildInstaCompMultiScannerConsensus({
  readers: [
    {
      readerId: "primary",
      label: "Primary local Qwen",
      kind: "primary_vision",
      family: "instacomp_internal",
      identity: { player: "Dominique Malonga", year: "2025", brand: "Panini", setName: "Base", cardNumber: "116", parallel: "Prizms Ice", sport: "Basketball", isAuto: false, isRelic: false },
      confidence: 0.98,
      evidence: ["front/back model"],
    },
    {
      readerId: "deterministic",
      label: "Apple Vision/OpenCV deterministic evidence",
      kind: "ocr_printed_evidence",
      family: "instacomp_local_deterministic",
      identity: { year: "2025", brand: "Panini", cardNumber: "116", parallel: "Cracked Ice Prizm" },
      confidence: 0.99,
      evidence: ["OpenCV front pattern: cracked_ice"],
    },
  ],
  baseIdentity: { player: "Dominique Malonga", year: "2025", brand: "Panini", setName: "Base", cardNumber: "116", parallel: "Prizms Ice", sport: "Basketball", isAuto: false, isRelic: false },
  catalogReferee: iceReferee,
  escalation: { schema: "tcos.instacomp.consensusEscalation.v1", speedLane: "fast_lane", councilMode: "fast_lane_council", riskTier: "low", runSecondaryVision: false, reasons: [], scannerPlan: [], explanation: "test" },
});
assert.equal(iceConsensus.trustedForIdentity, true);
assert.equal(iceConsensus.catalogReferee.status, "catalog_confirmed");

const baseMatch = { ...iceMatch, identityId: "2a7d4ddd-e9f7-4ce2-904c-b1a17b33ae4f", fingerprintSha256: "2".repeat(64), player: "Sonia Citron", cardNumber: "122", parallel: "Base" };
const baseCatalog = buildChecklistRegistryCatalogEvidence(baseMatch);
const baseConsensus = buildInstaCompMultiScannerConsensus({
  readers: [{
    readerId: "primary-base",
    label: "Primary local Qwen",
    kind: "primary_vision",
    family: "instacomp_internal",
    identity: { player: "Sonia Citron", year: "2025", brand: "Panini", setName: "Base", cardNumber: "122", parallel: "Base", sport: "Basketball", isAuto: false, isRelic: false },
    confidence: 0.98,
    evidence: ["2025 Panini Prizm WNBA product line; no named surface treatment observed"],
  }],
  baseIdentity: { player: "Sonia Citron", year: "2025", brand: "Panini", setName: "Base", cardNumber: "122", parallel: "Base", sport: "Basketball", isAuto: false, isRelic: false },
  catalogReferee: catalogEvidenceToConsensusReferee(baseCatalog),
  escalation: { schema: "tcos.instacomp.consensusEscalation.v1", speedLane: "fast_lane", councilMode: "fast_lane_council", riskTier: "low", runSecondaryVision: false, reasons: [], scannerPlan: [], explanation: "test" },
});
assert.equal(baseConsensus.trustedForIdentity, true);
assert.equal(baseConsensus.catalogReferee.status, "catalog_confirmed");
const baseDecision = buildInstaCompEvidenceIdentityDecision({
  resolution: { status: "internal_exact_match", match: baseMatch, reasons: [], candidateCount: 1, coveredReleaseIds: ["r"], coveredVersionIds: ["v"], coveredSetIds: ["s"], sourceTier: "internal", externalLookupEligible: false, externalLookupAttempted: false },
  consensus: baseConsensus,
  hasBackImage: true,
  threshold: 0.95,
});
assert.equal(baseDecision.confirmed, true);
assert.ok(baseDecision.confidence >= 0.95);

const local = instaCompAiLocalScanToAi({
  schema_version: "tcos.instacomp-ai.scan.v1",
  scan_id: "11111111-1111-4111-8111-111111111111",
  status: "trusted_memory_match",
  pricing_allowed: true,
  learning_allowed: true,
  trusted_identity: { year: "2025", manufacturer: "Panini", set_name: "Base", player: "Dominique Malonga", card_number: "116", parallel: "Prizms Ice" },
  local_vision: { identity_hints: { year: "2025", manufacturer: "Panini", card_number: "116", parallel: "Cracked Ice Prizm" }, front: { pattern: { label: "cracked_ice" } } },
  checklist: { outcome: "exact_match", identity_id: iceMatch.identityId, source_receipts: [`registry_fingerprint:${iceMatch.fingerprintSha256}`], reasons: [] },
  next_action: "verified",
} as any);
assert.ok(local);
assert.equal(local?.internalChecklistIdentityId, iceMatch.identityId);
assert.equal(local?.internalChecklistFingerprintSha256, iceMatch.fingerprintSha256);
assert.equal((local?.internalDeterministicIdentity as any)?.parallel, "Cracked Ice Prizm");
console.log("PASS final InstaComp identity consensus simulations");
''', encoding="utf-8")

print("Final frozen-five consensus/Registry/Groovy patch applied")
