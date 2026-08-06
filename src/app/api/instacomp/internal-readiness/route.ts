import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function configuredLocalUrl() {
  const value = String(process.env.INSTACOMP_AI_LOCAL_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(value)) return null;
  if (
    process.env.NODE_ENV === "production" &&
    /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/i.test(value)
  ) {
    return null;
  }
  return value;
}

function readinessResponse(
  payload: Record<string, unknown>,
  status = 200,
) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET() {
  const baseUrl = configuredLocalUrl();
  const emergencyConfigured = Boolean(
    String(process.env.OPENAI_API_KEY || "").trim(),
  );
  if (!baseUrl) {
    return readinessResponse(
      {
        ok: false,
        configured: false,
        reachable: false,
        internalMemoryReady: false,
        checklistReady: false,
        ollamaBackupReady: false,
        openAiEmergencyConfigured: emergencyConfigured,
        reason: "internal_engine_url_not_configured",
      },
      503,
    );
  }

  try {
    const headers = new Headers();
    const key = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
    if (key) headers.set("X-InstaComp-AI-Key", key);
    const response = await fetch(`${baseUrl}/health`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const health = (await response.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!response.ok || !health) {
      return readinessResponse(
        {
          ok: false,
          configured: true,
          reachable: true,
          internalMemoryReady: false,
          checklistReady: false,
          ollamaBackupReady: false,
          openAiEmergencyConfigured: emergencyConfigured,
          reason: `internal_health_http_${response.status}`,
        },
        503,
      );
    }

    const internalMemoryReady = health.database === "ready";
    const checklistReady = health.checklist === "ready";
    const ollamaBackupReady = health.ollama === "ready";
    const ok = internalMemoryReady && checklistReady;
    return readinessResponse(
      {
        ok,
        configured: true,
        reachable: true,
        internalMemoryReady,
        checklistReady,
        ollamaBackupReady,
        openAiEmergencyConfigured: emergencyConfigured,
        app: typeof health.app === "string" ? health.app : "InstaComp AI",
        version: typeof health.version === "string" ? health.version : null,
        architecture: [
          "instacomp_internal_memory",
          "checklist_registry",
          "ollama_backup",
          "openai_emergency",
        ],
        reason: ok ? null : "internal_engine_not_fully_ready",
      },
      ok ? 200 : 503,
    );
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || /timeout/i.test(error.message));
    return readinessResponse(
      {
        ok: false,
        configured: true,
        reachable: false,
        internalMemoryReady: false,
        checklistReady: false,
        ollamaBackupReady: false,
        openAiEmergencyConfigured: emergencyConfigured,
        reason: timedOut
          ? "internal_engine_health_timeout"
          : "internal_engine_health_unreachable",
      },
      503,
    );
  }
}
