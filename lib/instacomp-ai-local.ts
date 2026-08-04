type InstaCompAiLocalHealth = {
  ok: boolean;
  app: string;
  codename: string;
  version: string;
  database: "ready" | "error";
  ollama: "ready" | "unavailable" | "unchecked";
  ollama_model: string;
  checklist: "not_configured" | "ready";
};

export type InstaCompAiLocalScan = {
  schema_version: "tcos.instacomp-ai.scan.v1";
  scan_id: string;
  status:
    | "trusted_memory_match"
    | "needs_checklist"
    | "needs_review"
    | "model_unavailable";
  pricing_allowed: boolean;
  learning_allowed: boolean;
  next_action: string;
  [key: string]: unknown;
};

function localBaseUrl() {
  return (process.env.INSTACOMP_AI_LOCAL_URL || "http://127.0.0.1:8787").replace(
    /\/+$/,
    "",
  );
}

function localHeaders() {
  const key = process.env.INSTACOMP_AI_LOCAL_KEY?.trim();
  return key ? { "X-InstaComp-AI-Key": key } : {};
}

export async function getInstaCompAiLocalHealth(
  timeoutMs = 5_000,
): Promise<InstaCompAiLocalHealth> {
  const response = await fetch(`${localBaseUrl()}/health`, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`InstaComp AI health failed with HTTP ${response.status}`);
  }
  return (await response.json()) as InstaCompAiLocalHealth;
}

export async function analyzeWithInstaCompAiLocal(params: {
  front: File | Blob;
  back?: File | Blob | null;
  timeoutMs?: number;
}): Promise<InstaCompAiLocalScan> {
  const body = new FormData();
  body.append("front", params.front, "front.jpg");
  if (params.back) body.append("back", params.back, "back.jpg");

  const response = await fetch(`${localBaseUrl()}/v1/scans/analyze`, {
    method: "POST",
    headers: localHeaders(),
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
  return payload as InstaCompAiLocalScan;
}
