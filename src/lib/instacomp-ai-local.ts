export type InstaCompAiLocalScan = {
  schema_version: "tcos.instacomp-ai.scan.v1";
  scan_id: string;
  status: "trusted_memory_match" | "needs_checklist" | "needs_review" | "model_unavailable";
  pricing_allowed: boolean;
  learning_allowed: boolean;
  trusted_identity?: Record<string, unknown> | null;
  checklist: {
    outcome: string;
    identity_id?: string | null;
    source_receipts?: string[];
    reasons?: string[];
  };
  next_action: string;
  [key: string]: unknown;
};

function baseUrl() {
  return (process.env.INSTACOMP_AI_LOCAL_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
}

function headers() {
  const key = process.env.INSTACOMP_AI_LOCAL_KEY?.trim();
  return key ? { "X-InstaComp-AI-Key": key } : {};
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
    headers: headers(),
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(params.timeoutMs ?? 150_000),
  });
  const payload = (await response.json().catch(() => null)) as InstaCompAiLocalScan | { detail?: unknown } | null;
  if (!response.ok) {
    const detail = payload && "detail" in payload ? payload.detail : null;
    throw new Error(`InstaComp AI scan failed with HTTP ${response.status}${detail ? `: ${String(detail)}` : ""}`);
  }
  const scan = payload as InstaCompAiLocalScan;
  if (scan.pricing_allowed && (!scan.checklist?.identity_id || !scan.checklist?.source_receipts?.some((value) => value.startsWith("registry_fingerprint:")))) {
    throw new Error("Mac service returned pricing_allowed without a complete Registry receipt.");
  }
  return scan;
}
