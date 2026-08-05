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
  pricing_allowed: boolean;
  learning_allowed: boolean;
  trusted_identity?: Record<string, unknown> | null;
  local_suggestion?: InstaCompAiLocalSuggestion | null;
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
