import { NextRequest } from "next/server";
import {
  INSTACOMP_SUPERVISED_203,
  type InstaCompSupervised203Card,
} from "../../../../lib/instacomp-supervised-203";
import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type JsonRecord = Record<string, unknown>;
type MacResult = { ok: boolean; status: number; payload: JsonRecord | null };

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
}

async function verifyVercelToken(request: Request) {
  const token = bearerToken(request);
  if (!token) return false;
  try {
    const response = await fetch("https://api.vercel.com/v2/teams?limit=100", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { teams?: unknown };
    return releaseRuntimeTeamIsAllowed(payload.teams);
  } catch {
    return false;
  }
}

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function same(left: unknown, right: unknown) {
  return normalize(left) === normalize(right);
}

function identityMatches(card: InstaCompSupervised203Card, example: JsonRecord) {
  const identity =
    example.confirmed_identity && typeof example.confirmed_identity === "object"
      ? (example.confirmed_identity as JsonRecord)
      : {};
  if (
    example.trusted !== true ||
    !same(identity.year, card.year) ||
    !same(identity.manufacturer, card.manufacturer) ||
    !same(identity.brand, card.brand) ||
    !same(identity.set_name, card.setName) ||
    !same(identity.player, card.player) ||
    !same(identity.card_number, card.cardNumber) ||
    !same(identity.parallel, card.parallel)
  ) {
    return false;
  }
  if (card.serialNumber !== null && !same(identity.serial_number, card.serialNumber)) {
    return false;
  }
  if (card.serialRun !== null && Number(identity.serial_run || 0) !== card.serialRun) {
    return false;
  }
  if (card.autograph !== null && Boolean(identity.autograph) !== card.autograph) {
    return false;
  }
  return true;
}

function macCoordinates() {
  const baseUrl = String(process.env.INSTACOMP_AI_LOCAL_URL || "")
    .trim()
    .replace(/\/+$/, "");
  const apiKey = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
  if (
    !/^https:\/\//i.test(baseUrl) ||
    /^https:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/i.test(baseUrl) ||
    !apiKey
  ) {
    throw new Error("Production InstaComp internal coordinates are not configured.");
  }
  return { baseUrl, apiKey };
}

async function macFetch(
  baseUrl: string,
  apiKey: string,
  route: string,
  init: RequestInit = {},
  timeoutMs = 45_000,
): Promise<MacResult> {
  const headers = new Headers(init.headers);
  headers.set("X-InstaComp-AI-Key", apiKey);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = (await response.json().catch(() => null)) as JsonRecord | null;
  return { ok: response.ok, status: response.status, payload };
}

async function mapLimit<T, U>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<U>,
) {
  const output = new Array<U>(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

async function loadExamples(baseUrl: string, apiKey: string, trustedOnly: boolean) {
  const result = await macFetch(
    baseUrl,
    apiKey,
    `/v1/training/examples?trusted_only=${trustedOnly ? "true" : "false"}&limit=5000`,
  );
  if (!result.ok) {
    throw new Error(`InstaComp training-example read returned HTTP ${result.status}.`);
  }
  const examples = result.payload?.examples;
  return Array.isArray(examples)
    ? examples.filter(
        (value): value is JsonRecord => Boolean(value && typeof value === "object"),
      )
    : [];
}

function lessonPayload(card: InstaCompSupervised203Card, priorIdentity: JsonRecord | null) {
  return {
    scan_id: card.scanId,
    state: "operator_confirmed",
    identity: {
      sport: card.sport,
      league: card.league,
      year: card.year,
      manufacturer: card.manufacturer,
      brand: card.brand,
      set_name: card.setName,
      subset: null,
      player: card.player,
      team: null,
      card_number: card.cardNumber,
      parallel: card.parallel,
      variation: null,
      serial_number: card.serialNumber,
      serial_run: card.serialRun,
      rookie: null,
      autograph: card.autograph,
      inscription: null,
      inscription_text: null,
      memorabilia: null,
      memorabilia_type: null,
    },
    verification_source: "supervised_203_2026-08-08",
    operator_id: "truely-collectables-owner",
    notes: [
      `Operator-supervised physical card ${card.ordinal}/203.`,
      card.operatorNote,
      "Structural Base is retained internally but never displayed in titles.",
    ]
      .filter(Boolean)
      .join(" "),
    rejected_identity: priorIdentity,
  };
}

export async function POST(request: NextRequest) {
  if (!(await verifyVercelToken(request))) {
    return Response.json(
      { success: false, error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const { baseUrl, apiKey } = macCoordinates();
    const health = await macFetch(baseUrl, apiKey, "/health", {}, 20_000);
    if (!health.ok || health.payload?.database !== "ready") {
      throw new Error("Physical InstaComp Mac database is not ready.");
    }

    // HARD GATE: prove every named physical scan and both images exist before
    // writing any trusted lesson. A bad/missing mapping produces zero mutation.
    const presence = await mapLimit(INSTACOMP_SUPERVISED_203, 12, async (card) => {
      const result = await macFetch(
        baseUrl,
        apiKey,
        `/v1/scans/${encodeURIComponent(card.scanId)}/archive`,
        {},
        20_000,
      );
      return {
        ordinal: card.ordinal,
        scanId: card.scanId,
        exists: result.ok,
        hasFront: result.payload?.has_front_image === true,
        hasBack: result.payload?.has_back_image === true,
        httpStatus: result.status,
      };
    });
    const missingOrIncomplete = presence.filter(
      (row) => !row.exists || !row.hasFront || !row.hasBack,
    );
    if (missingOrIncomplete.length) {
      return Response.json(
        {
          success: false,
          schema: "tcos.instacomp-ai.supervised-203-live-import.v1",
          stage: "scan_presence_gate",
          total: INSTACOMP_SUPERVISED_203.length,
          completePhysicalScanPairs:
            INSTACOMP_SUPERVISED_203.length - missingOrIncomplete.length,
          missingOrIncomplete: missingOrIncomplete.map((row) => row.scanId),
          nothingMutated: true,
          nothingPublished: true,
        },
        { status: 409, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const before = await loadExamples(baseUrl, apiKey, false);
    const alreadyTrusted = new Set<string>();
    const toInsert: Array<{
      card: InstaCompSupervised203Card;
      priorIdentity: JsonRecord | null;
    }> = [];

    for (const card of INSTACOMP_SUPERVISED_203) {
      const sameScan = before.filter((example) => example.scan_id === card.scanId);
      if (sameScan.some((example) => identityMatches(card, example))) {
        alreadyTrusted.add(card.scanId);
        continue;
      }
      const prior = sameScan.find(
        (example) =>
          example.confirmed_identity && typeof example.confirmed_identity === "object",
      );
      toInsert.push({
        card,
        priorIdentity: prior
          ? (prior.confirmed_identity as JsonRecord)
          : null,
      });
    }

    const insertResults = await mapLimit(toInsert, 5, async ({ card, priorIdentity }) => {
      const result = await macFetch(
        baseUrl,
        apiKey,
        "/v1/lessons",
        { method: "POST", body: JSON.stringify(lessonPayload(card, priorIdentity)) },
        45_000,
      );
      return {
        ordinal: card.ordinal,
        scanId: card.scanId,
        ok: result.ok,
        httpStatus: result.status,
        error: result.ok
          ? null
          : String(result.payload?.detail || result.payload?.error || "lesson insert failed").slice(0, 500),
      };
    });

    const failedInserts = insertResults.filter((row) => !row.ok);
    const after = await loadExamples(baseUrl, apiKey, true);
    const finalMissing = INSTACOMP_SUPERVISED_203.filter(
      (card) => !after.some((example) => example.scan_id === card.scanId && identityMatches(card, example)),
    );

    const readinessResult = await macFetch(baseUrl, apiKey, "/v1/training/readiness");
    const readiness = readinessResult.ok ? readinessResult.payload : null;
    const success = failedInserts.length === 0 && finalMissing.length === 0;

    return Response.json(
      {
        success,
        schema: "tcos.instacomp-ai.supervised-203-live-import.v1",
        checkedAt: new Date().toISOString(),
        total: INSTACOMP_SUPERVISED_203.length,
        completePhysicalScanPairs: presence.length,
        alreadyTrusted: alreadyTrusted.size,
        insertedTrustedLessons: insertResults.filter((row) => row.ok).length,
        failedInsertCount: failedInserts.length,
        failedInsertScanIds: failedInserts.map((row) => row.scanId),
        finalTrustedVerified: INSTACOMP_SUPERVISED_203.length - finalMissing.length,
        finalMissingScanIds: finalMissing.map((card) => card.scanId),
        trainingReadiness: readiness
          ? {
              trustedExamples: Number(readiness.trusted_examples || 0),
              operatorConfirmed: Number(readiness.operator_confirmed || 0),
              withPatternLabels: Number(readiness.with_pattern_labels || 0),
              readyForTrialLora: readiness.ready_for_trial_lora === true,
              readyForProductionCandidate:
                readiness.ready_for_production_candidate === true,
            }
          : null,
        trainingExportDeferredUntilLatest-per-scanDedupIsLive: true,
        nothingPublished: true,
      },
      {
        status: success ? 200 : 503,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        nothingPublished: true,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
