import type { InstaCompAiResult } from "./instacomp";

export type InstaCompAiLocalVisualEvidence = {
  visible_text?: string[];
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

function boolean(value: unknown) {
  return value === true;
}

function confidence(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(numeric > 1 ? numeric / 100 : numeric, 1));
}

export function instaCompAiLocalScanToAi(
  scan: InstaCompAiLocalScan,
): InstaCompAiResult | null {
  const trusted = scan.trusted_identity || null;
  const suggested = scan.local_suggestion?.identity || null;
  const identity = trusted || suggested;
  if (!identity) return null;

  const player = text(identity.player);
  const cardNumber = text(identity.card_number ?? identity.cardNumber);
  const setName = text(identity.set_name ?? identity.setName);
  if (!player && !cardNumber && !setName) return null;

  const serialRun = Number(identity.serial_run ?? identity.serialRun);
  const printRun =
    Number.isInteger(serialRun) && serialRun > 0 ? `/${serialRun}` : null;
  const identityConfidence = trusted
    ? Math.max(confidence(scan.visual_match_score), 0.98)
    : confidence(scan.local_suggestion?.confidence);
  const source = scan.match_source || scan.local_suggestion?.provider || "instacomp";
  const evidence = scan.local_suggestion?.evidence;
  const notes = [
    `InstaComp internal source: ${source}.`,
    scan.canonical_filename
      ? `Canonical filename: ${scan.canonical_filename}.`
      : null,
    scan.local_suggestion?.explanation || null,
    evidence?.back_notes?.length
      ? `Back evidence: ${evidence.back_notes.join(" | ")}`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    player,
    year: text(identity.year),
    brand: text(identity.brand ?? identity.manufacturer),
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
  };
}

export async function analyzeWithInstaCompAiLocal(params: {
  front: Blob;
  back?: Blob | null;
  timeoutMs?: number;
}): Promise<InstaCompAiLocalScan> {
  const body = new FormData();
  body.append("front", params.front, "front.jpg");
  if (params.back) body.append("back", params.back, "back.jpg");
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
