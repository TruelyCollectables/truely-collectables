import type { InstaCompAiResult } from "./instacomp";

export type InstaCompAiLocalVisualEvidence = {
  visible_text?: string[];
  front_visible_text?: string[];
  back_visible_text?: string[];
  logos?: string[];
  colors?: string[];
  foil_or_pattern?: string[];
  front_notes?: string[];
  back_notes?: string[];
  uncertainty?: string[];
  [key: string]: unknown;
};

export type InstaCompAiLocalSuggestion = {
  provider: string;
  model: string;
  identity: Record<string, unknown>;
  evidence: InstaCompAiLocalVisualEvidence;
  confidence: number;
  explanation: string;
  raw: Record<string, unknown>;
};

export type InstaCompAiLocalScan = {
  schema_version: "tcos.instacomp-ai.scan.v1";
  scan_id: string;
  created_at?: string;
  status:
    | "trusted_memory_match"
    | "needs_checklist"
    | "needs_review"
    | "model_unavailable";
  front_sha256?: string;
  back_sha256?: string | null;
  image_pair_sha256?: string;
  front_reference_sha256?: string | null;
  back_reference_sha256?: string | null;
  front_perceptual_hash?: string | null;
  back_perceptual_hash?: string | null;
  pricing_allowed: boolean;
  learning_allowed: boolean;
  trusted_identity?: Record<string, unknown> | null;
  local_suggestion?: InstaCompAiLocalSuggestion | null;
  match_source?:
    | "exact_image_pair"
    | "visual_memory"
    | "trusted_text_memory"
    | "checklist_registry"
    | "ollama_backup"
    | "none";
  visual_match_score?: number | null;
  canonical_filename?: string | null;
  checklist: {
    outcome: string;
    identity_id?: string | null;
    source_receipts?: string[];
    reasons?: string[];
  };
  next_action: string;
  [key: string]: unknown;
};

export type InstaCompAiLocalScanArchive = {
  schema_version: "tcos.instacomp-ai.scan-archive.v1";
  scan_id: string;
  created_at: string;
  front_sha256: string;
  back_sha256: string | null;
  image_pair_sha256: string;
  local_suggestion: Record<string, unknown> | null;
  checklist: Record<string, unknown>;
  status: string;
  has_front_image: boolean;
  has_back_image: boolean;
};

export type InstaCompAiLocalLessonIdentity = {
  sport?: string | null;
  league?: string | null;
  year?: string | null;
  manufacturer?: string | null;
  brand?: string | null;
  set_name?: string | null;
  subset?: string | null;
  player?: string | null;
  team?: string | null;
  card_number?: string | null;
  parallel?: string | null;
  variation?: string | null;
  serial_number?: string | null;
  serial_run?: number | null;
  rookie?: boolean | null;
  autograph?: boolean | null;
  inscription?: boolean | null;
  inscription_text?: string | null;
  memorabilia?: boolean | null;
  memorabilia_type?: string | null;
};

export type InstaCompAiResultWithInternalReceipt = InstaCompAiResult & {
  internalScanId: string;
  internalStatus: string;
  internalChecklistOutcome: string | null;
  internalChecklistCandidateCount: number;
  internalChecklistReasons: string[];
  internalChecklistSourceReceipts: string[];
  internalChecklistIdentityId: string | null;
  internalChecklistFingerprintSha256: string | null;
  internalDeterministicIdentity: Record<string, unknown> | null;
  internalDeterministicEvidence: string[];
  internalMatchSource: string | null;
  internalCanonicalFilename: string | null;
  internalLearningAllowed: boolean;
  internalInscription: boolean;
  internalInscriptionText: string | null;
  internalMemorabiliaType: string | null;
  frontVisibleText: string[];
  backVisibleText: string[];
  backEvidence: string | null;
};

function baseUrl() {
  return (process.env.INSTACOMP_AI_LOCAL_URL || "http://127.0.0.1:8787").replace(
    /\/+$/,
    "",
  );
}

export function hasConfiguredInstaCompAiLocal() {
  const configured = String(process.env.INSTACOMP_AI_LOCAL_URL || "").trim();
  if (!configured) return process.env.NODE_ENV !== "production";
  if (
    process.env.NODE_ENV === "production" &&
    /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/i.test(configured)
  ) {
    return false;
  }
  return /^https?:\/\//i.test(configured);
}

function requestHeaders(): Headers {
  const headers = new Headers();
  const key = process.env.INSTACOMP_AI_LOCAL_KEY?.trim();
  if (key) headers.set("X-InstaComp-AI-Key", key);
  return headers;
}

function safeScanId(scanId: string) {
  const value = scanId.trim();
  if (!/^[0-9a-z-]{1,100}$/i.test(value)) {
    throw new Error("Invalid InstaComp scan ID.");
  }
  return value;
}

function text(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function textList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter((item): item is string => Boolean(item))
    : [];
}

function boolean(value: unknown) {
  return value === true;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function localVisionOcrText(scan: InstaCompAiLocalScan, side: "front" | "back") {
  const localVision = record(scan.local_vision);
  const sideEvidence = record(localVision[side]);
  const observations = Array.isArray(sideEvidence.ocr) ? sideEvidence.ocr : [];
  return Array.from(
    new Set(
      observations
        .map((value) => record(value))
        .filter((value) => Number(value.confidence ?? 0) >= 0.5)
        .map((value) => text(value.text))
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function checklistReceiptValue(scan: InstaCompAiLocalScan, prefix: string) {
  const receipts = textList(scan.checklist?.source_receipts);
  const value = receipts.find((receipt) => receipt.startsWith(prefix));
  return value ? text(value.slice(prefix.length)) : null;
}

function deterministicIdentity(scan: InstaCompAiLocalScan) {
  const localVision = record(scan.local_vision);
  const hints = record(localVision.identity_hints);
  const identity: Record<string, unknown> = {
    player: text(hints.player),
    year: text(hints.year),
    brand: text(hints.manufacturer ?? hints.brand),
    setName: text(hints.set_name ?? hints.setName),
    cardNumber: text(hints.card_number ?? hints.cardNumber),
    parallel: text(hints.parallel),
    serialNumber: text(hints.serial_number ?? hints.serialNumber),
    team: text(hints.team),
    sport: text(hints.sport),
    isRookie: hints.rookie === true ? true : null,
    isAuto: hints.autograph === true ? true : null,
    isRelic: hints.memorabilia === true ? true : null,
  };
  const compact = Object.fromEntries(
    Object.entries(identity).filter(([, value]) => value !== null && value !== ""),
  );
  return Object.keys(compact).length ? compact : null;
}

function deterministicEvidence(scan: InstaCompAiLocalScan) {
  const localVision = record(scan.local_vision);
  const front = record(localVision.front);
  const pattern = record(front.pattern);
  const hints = deterministicIdentity(scan);
  return [
    hints ? "Apple Vision/OpenCV deterministic identity hints present" : null,
    text(pattern.label) && text(pattern.label) !== "unknown"
      ? `OpenCV front pattern: ${text(pattern.label)}`
      : null,
  ].filter((value): value is string => Boolean(value));
}

function confidence(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(numeric > 1 ? numeric / 100 : numeric, 1));
}

export function instaCompAiLocalScanToAi(
  scan: InstaCompAiLocalScan,
): InstaCompAiResultWithInternalReceipt | null {
  const freshFrontVisibleText = localVisionOcrText(scan, "front");
  const freshBackVisibleText = localVisionOcrText(scan, "back");
  const trusted = scan.trusted_identity || null;
  const suggested = scan.local_suggestion?.identity || null;
  const identity = trusted || suggested;
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
      internalChecklistIdentityId: text(scan.checklist?.identity_id),
      internalChecklistFingerprintSha256: checklistReceiptValue(scan, "registry_fingerprint:"),
      internalDeterministicIdentity: deterministicIdentity(scan),
      internalDeterministicEvidence: deterministicEvidence(scan),
      internalMatchSource: text(scan.match_source),
      internalCanonicalFilename: text(scan.canonical_filename),
      internalLearningAllowed: false,
      internalInscription: false,
      internalInscriptionText: null,
      internalMemorabiliaType: null,
      frontVisibleText: freshFrontVisibleText,
      backVisibleText: freshBackVisibleText,
      backEvidence: freshBackVisibleText.join(" | ") || null,
    };
  }

  const player = text(identity.player);
  const cardNumber = text(identity.card_number ?? identity.cardNumber);
  const setName = text(identity.set_name ?? identity.setName);

  const serialRun = Number(identity.serial_run ?? identity.serialRun);
  const printRun =
    Number.isInteger(serialRun) && serialRun > 0 ? `/${serialRun}` : null;
  const identityConfidence = trusted
    ? Math.max(confidence(scan.visual_match_score), 0.98)
    : confidence(scan.local_suggestion?.confidence);
  const source = scan.match_source || scan.local_suggestion?.provider || "instacomp";
  const evidence = scan.local_suggestion?.evidence;
  const frontVisibleText = Array.from(
    new Set([...freshFrontVisibleText, ...textList(evidence?.front_visible_text)]),
  );
  const backVisibleText = Array.from(
    new Set([...freshBackVisibleText, ...textList(evidence?.back_visible_text)]),
  );
  const backNotes = textList(evidence?.back_notes);
  const frontPatternEvidence = [
    ...textList(evidence?.colors),
    ...textList(evidence?.foil_or_pattern),
    ...textList(evidence?.front_notes),
  ].join(" | ") || null;
  const backEvidence = [...backVisibleText, ...backNotes].join(" | ") || null;
  const notes = [
    `InstaComp internal source: ${source}.`,
    scan.canonical_filename
      ? `Canonical filename: ${scan.canonical_filename}.`
      : null,
    scan.local_suggestion?.explanation || null,
    frontPatternEvidence
      ? `Front surface evidence: ${frontPatternEvidence}`
      : null,
    backEvidence ? `Back evidence: ${backEvidence}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    player,
    year: text(identity.year),
    brand: text(identity.manufacturer ?? identity.brand),
    setName,
    cardNumber,
    parallel: text(identity.parallel),
    // InstaComp exposes only the print run to the website. The individual copy
    // number remains archived evidence and is not part of the canonical identity.
    serialNumber: printRun,
    team: text(identity.team),
    sport: text(identity.sport),
    isRookie: boolean(identity.rookie ?? identity.isRookie),
    isAuto: boolean(identity.autograph ?? identity.isAuto),
    isRelic: boolean(identity.memorabilia ?? identity.isRelic),
    conditionGuess: null,
    confidence: identityConfidence,
    notes: notes || null,
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
    internalChecklistReasons: textList(scan.checklist?.reasons),
    internalChecklistSourceReceipts: textList(
      scan.checklist?.source_receipts,
    ),
    internalChecklistIdentityId: text(scan.checklist?.identity_id),
    internalChecklistFingerprintSha256: checklistReceiptValue(scan, "registry_fingerprint:"),
    internalDeterministicIdentity: deterministicIdentity(scan),
    internalDeterministicEvidence: deterministicEvidence(scan),
    internalMatchSource: text(source),
    internalCanonicalFilename: text(scan.canonical_filename),
    internalLearningAllowed: scan.learning_allowed === true,
    internalInscription: boolean(identity.inscription),
    internalInscriptionText: text(identity.inscription_text),
    internalMemorabiliaType: text(identity.memorabilia_type),
    frontVisibleText,
    backVisibleText,
    backEvidence,
  };
}

export async function analyzeWithInstaCompAiLocal(params: {
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
}): Promise<InstaCompAiLocalScan> {
  const body = new FormData();
  body.append("front", params.front, "front.jpg");
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
  const response = await fetch(`${baseUrl()}/v1/scans/analyze`, {
    method: "POST",
    headers: requestHeaders(),
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(params.timeoutMs ?? 150_000),
  });
  const payload = (await response.json().catch(() => null)) as
    | InstaCompAiLocalScan
    | { detail?: unknown }
    | null;
  if (!response.ok) {
    const detail = payload && "detail" in payload ? payload.detail : null;
    throw new Error(
      `InstaComp AI scan failed with HTTP ${response.status}${
        detail ? `: ${String(detail)}` : ""
      }`,
    );
  }
  const scan = payload as InstaCompAiLocalScan;
  if (
    scan.pricing_allowed &&
    (!scan.checklist?.identity_id ||
      !scan.checklist?.source_receipts?.some((value) =>
        value.startsWith("registry_fingerprint:"),
      ))
  ) {
    throw new Error(
      "Mac service returned pricing_allowed without a complete Registry receipt.",
    );
  }
  return scan;
}

export async function confirmInstaCompAiLocalLesson(params: {
  scanId: string;
  identity: InstaCompAiLocalLessonIdentity;
  operatorId: string;
  notes?: string | null;
  timeoutMs?: number;
}) {
  if (!hasConfiguredInstaCompAiLocal()) {
    throw new Error("InstaComp internal engine is not configured for this runtime.");
  }
  const headers = requestHeaders();
  headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl()}/v1/lessons`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      scan_id: safeScanId(params.scanId),
      state: "operator_confirmed",
      identity: params.identity,
      verification_source: "seller_manual_edit",
      operator_id: params.operatorId.trim().slice(0, 200),
      notes: text(params.notes)?.slice(0, 4000) || null,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(params.timeoutMs ?? 30_000),
  });
  const payload = (await response.json().catch(() => null)) as
    | { lesson_id?: unknown; trusted?: unknown; detail?: unknown }
    | null;
  if (!response.ok) {
    throw new Error(
      text(payload?.detail) ||
        `InstaComp internal lesson failed with HTTP ${response.status}.`,
    );
  }
  const lessonId = text(payload?.lesson_id);
  if (!lessonId || payload?.trusted !== true) {
    throw new Error("InstaComp did not confirm the seller correction as trusted memory.");
  }
  return { lessonId, trusted: true as const };
}

export async function getInstaCompAiLocalScanArchive(
  scanId: string,
  timeoutMs = 30_000,
): Promise<InstaCompAiLocalScanArchive> {
  const response = await fetch(
    `${baseUrl()}/v1/scans/${encodeURIComponent(safeScanId(scanId))}/archive`,
    {
      headers: requestHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | InstaCompAiLocalScanArchive
    | { detail?: unknown }
    | null;
  if (!response.ok) {
    const detail = payload && "detail" in payload ? payload.detail : null;
    throw new Error(
      `Archived InstaComp scan ${scanId} could not be read${
        detail ? `: ${String(detail)}` : ` (HTTP ${response.status})`
      }`,
    );
  }
  return payload as InstaCompAiLocalScanArchive;
}

export async function getInstaCompAiLocalArchivedImage(params: {
  scanId: string;
  side: "front" | "back";
  timeoutMs?: number;
}) {
  const response = await fetch(
    `${baseUrl()}/v1/scans/${encodeURIComponent(safeScanId(params.scanId))}/images/${params.side}`,
    {
      headers: requestHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(params.timeoutMs ?? 30_000),
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { detail?: unknown }
      | null;
    throw new Error(
      `Archived ${params.side} image for scan ${params.scanId} could not be read${
        payload?.detail
          ? `: ${String(payload.detail)}`
          : ` (HTTP ${response.status})`
      }`,
    );
  }
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 12 * 1024 * 1024) {
    throw new Error(
      `Archived ${params.side} image for scan ${params.scanId} was empty or too large.`,
    );
  }
  return {
    bytes,
    contentType: response.headers.get("content-type") || "image/jpeg",
    sha256: response.headers.get("x-instacomp-image-sha256") || null,
  };
}
