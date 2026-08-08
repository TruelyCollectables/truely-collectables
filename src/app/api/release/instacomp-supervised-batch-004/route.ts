import { NextRequest } from "next/server";
import { INSTACOMP_SUPERVISED_BATCH_004 } from "../../../../lib/instacomp-supervised-batch-004";
import { resolveInstaCompChecklistFirstFromRegistry } from "../../../../lib/instacomp-checklist-first-server";
import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type JsonRecord = Record<string, unknown>;

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

function normalizedText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedParallel(value: unknown) {
  const normalized = normalizedText(value);
  if (!normalized || normalized === "base") return "";
  return normalized
    .split(" ")
    .filter((token) => token !== "prizm" && token !== "prizms")
    .join(" ")
    .trim();
}

function productFamily(value: unknown) {
  const normalized = normalizedText(value);
  if (normalized.includes("donruss")) return "donruss";
  if (normalized.includes("select")) return "select";
  if (normalized.includes("prizm")) return "prizm";
  return normalized;
}

function sameText(left: unknown, right: unknown) {
  return normalizedText(left) === normalizedText(right);
}

function exactTrustedMemoryMatch(card: (typeof INSTACOMP_SUPERVISED_BATCH_004)[number], example: JsonRecord) {
  const identity =
    example.confirmed_identity && typeof example.confirmed_identity === "object"
      ? (example.confirmed_identity as JsonRecord)
      : {};
  return (
    example.trusted === true &&
    sameText(identity.year, card.year) &&
    sameText(identity.player, card.player) &&
    sameText(identity.card_number, card.cardNumber) &&
    sameText(identity.set_name, card.setName) &&
    productFamily(identity.brand || identity.manufacturer) === productFamily(card.brand) &&
    normalizedParallel(identity.parallel) === normalizedParallel(card.parallel)
  );
}

function exactRegistryCandidateMatch(
  card: (typeof INSTACOMP_SUPERVISED_BATCH_004)[number],
  candidate: {
    year: string | null;
    player: string | null;
    cardNumber: string | null;
    setName?: string | null;
    brand?: string | null;
    product?: string | null;
    manufacturer: string | null;
    parallel?: string | null;
  },
) {
  return (
    sameText(candidate.year, card.year) &&
    sameText(candidate.player, card.player) &&
    sameText(candidate.cardNumber, card.cardNumber) &&
    sameText(candidate.setName, card.setName) &&
    productFamily(candidate.brand || candidate.product || candidate.manufacturer) === productFamily(card.brand) &&
    normalizedParallel(candidate.parallel) === normalizedParallel(card.parallel)
  );
}

async function loadTrustedTrainingExamples() {
  const baseUrl = String(process.env.INSTACOMP_AI_LOCAL_URL || "")
    .trim()
    .replace(/\/+$/, "");
  const apiKey = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
  if (!/^https:\/\/[^/]+\.truelycollectables\.com$/i.test(baseUrl) || !apiKey) {
    throw new Error("Production InstaComp internal coordinates are not configured.");
  }

  const response = await fetch(
    `${baseUrl}/v1/training/examples?trusted_only=true&limit=2000`,
    {
      headers: {
        "X-InstaComp-AI-Key": apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(45_000),
    },
  );
  if (!response.ok) {
    throw new Error(`InstaComp trusted-memory read returned HTTP ${response.status}.`);
  }
  const payload = (await response.json()) as { examples?: unknown };
  return Array.isArray(payload.examples)
    ? (payload.examples.filter(
        (value): value is JsonRecord => Boolean(value && typeof value === "object"),
      ) as JsonRecord[])
    : [];
}

export async function POST(request: NextRequest) {
  if (!(await verifyVercelToken(request))) {
    return Response.json(
      { success: false, error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const trustedExamples = await loadTrustedTrainingExamples();
    const rows = [];

    for (const card of INSTACOMP_SUPERVISED_BATCH_004) {
      const trustedMemoryCount = trustedExamples.filter((example) =>
        exactTrustedMemoryMatch(card, example),
      ).length;

      const decision = await resolveInstaCompChecklistFirstFromRegistry({
        year: card.year,
        manufacturer: card.manufacturer,
        brand: card.brand,
        setName: card.setName,
        cardNumber: card.cardNumber,
        player: card.player,
        serialNumber: null,
        isAuto: false,
        isRelic: false,
        parallel: card.parallel,
        variation: null,
        ocrText: null,
      });
      const registryExpectedCandidateCount = decision.candidates.filter((candidate) =>
        exactRegistryCandidateMatch(card, candidate),
      ).length;

      rows.push({
        ordinal: card.ordinal,
        player: card.player,
        cardNumber: card.cardNumber,
        setName: card.setName,
        parallel: card.parallel,
        trustedMemoryVerified: trustedMemoryCount > 0,
        trustedMemoryCount,
        registryStatus: decision.status,
        registryCandidateCount: decision.candidates.length,
        registryExpectedCandidateVerified: registryExpectedCandidateCount > 0,
        registryExpectedCandidateCount,
        operatorCorrection: card.ordinal === 88 ? card.operatorNote : null,
      });
    }

    const missingTrustedMemoryOrdinals = rows
      .filter((row) => !row.trustedMemoryVerified)
      .map((row) => row.ordinal);
    const missingRegistryOrdinals = rows
      .filter((row) => !row.registryExpectedCandidateVerified)
      .map((row) => row.ordinal);

    return Response.json(
      {
        success: true,
        schema: "tcos.instacomp-ai.supervised-batch-004-live-verification.v1",
        checkedAt: new Date().toISOString(),
        batch: "004",
        total: rows.length,
        trustedMemoryVerified: rows.length - missingTrustedMemoryOrdinals.length,
        registryExpectedCandidateVerified: rows.length - missingRegistryOrdinals.length,
        missingTrustedMemoryOrdinals,
        missingRegistryOrdinals,
        allTrustedMemoryVerified: missingTrustedMemoryOrdinals.length === 0,
        allRegistryCandidatesVerified: missingRegistryOrdinals.length === 0,
        nothingMutated: true,
        nothingPublished: true,
        rows,
      },
      {
        status: 200,
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
        error:
          error instanceof Error
            ? error.message
            : "Batch 004 live verification failed.",
        nothingMutated: true,
        nothingPublished: true,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
