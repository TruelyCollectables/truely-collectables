import { NextRequest, NextResponse } from "next/server";
import {
  type BallsDeepSummary,
  sendBallsDeepDealHunterEmail,
} from "../../../../lib/deal-hunter-balls-deep-email";

export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Truely-Origin": "cloudflare-worker",
};

const EXPECTED_LABELS = [
  "WNBA",
  "IVAN DEMIDOV",
  "MATVEI MICHKOV YOUNG GUNS",
  "BASEBALL PROSPECTS",
  "SIGNED BASEBALLS",
  "ALL BUILT-IN SCOPES",
  "MICHKOV OPC PLATINUM",
] as const;

function safeEqual(left: string, right: string) {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function integer(value: unknown, maximum = 1_000_000) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) return null;
  return parsed;
}

function validateSummary(value: unknown): BallsDeepSummary | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (body.overall !== "PASS") return null;

  const passedCount = integer(body.passedCount, EXPECTED_LABELS.length);
  const failedCount = integer(body.failedCount, EXPECTED_LABELS.length);
  const surfaceCount = integer(body.surfaceCount, EXPECTED_LABELS.length);
  const totalFamilies = integer(body.totalFamilies, 10_000);
  const totalSuccessful = integer(body.totalSuccessful, 10_000);
  const totalFailedFamilies = integer(body.totalFailedFamilies, 10_000);
  const testedAt = typeof body.testedAt === "string" ? body.testedAt : "";
  const testedAtMs = Date.parse(testedAt);

  if (
    passedCount !== EXPECTED_LABELS.length ||
    failedCount !== 0 ||
    surfaceCount !== EXPECTED_LABELS.length ||
    totalFamilies === null ||
    totalFamilies <= 0 ||
    totalSuccessful !== totalFamilies ||
    totalFailedFamilies !== 0 ||
    !Number.isFinite(testedAtMs) ||
    testedAtMs < Date.now() - 45 * 60_000 ||
    testedAtMs > Date.now() + 5 * 60_000 ||
    !Array.isArray(body.results) ||
    body.results.length !== EXPECTED_LABELS.length
  ) {
    return null;
  }

  const results = body.results.map((raw, index) => {
    if (!raw || typeof raw !== "object") return null;
    const entry = raw as Record<string, unknown>;
    const families = integer(entry.families, 10_000);
    const successful = integer(entry.successful, 10_000);
    const failed = integer(entry.failed, 10_000);
    const rawCount = integer(entry.raw, 1_000_000);
    const deduped = integer(entry.deduped, 1_000_000);
    const status = integer(entry.status, 999);

    if (
      entry.label !== EXPECTED_LABELS[index] ||
      entry.passed !== true ||
      entry.origin !== "cloudflare-worker" ||
      status !== 200 ||
      families === null ||
      families <= 0 ||
      successful !== families ||
      failed !== 0 ||
      rawCount === null ||
      deduped === null
    ) {
      return null;
    }

    return {
      label: EXPECTED_LABELS[index],
      passed: true,
      status,
      origin: "cloudflare-worker",
      families,
      successful,
      failed,
      raw: rawCount,
      deduped,
    };
  });

  if (results.some((entry) => entry === null)) return null;
  const safeResults = results as BallsDeepSummary["results"];
  const summedFamilies = safeResults.reduce((sum, entry) => sum + entry.families, 0);
  const summedSuccessful = safeResults.reduce((sum, entry) => sum + entry.successful, 0);
  if (summedFamilies !== totalFamilies || summedSuccessful !== totalSuccessful) return null;

  return {
    overall: "PASS",
    passedCount,
    failedCount: 0,
    surfaceCount,
    totalFamilies,
    totalSuccessful,
    totalFailedFamilies: 0,
    results: safeResults,
    testedAt,
  };
}

export async function POST(request: NextRequest) {
  const configuredSecret = String(process.env.TCOS_CRON_SECRET || "").trim();
  if (!configuredSecret) {
    return NextResponse.json(
      { ok: false, error: "Production delivery authorization is not configured." },
      { status: 503, headers: RESPONSE_HEADERS },
    );
  }

  const authorization = request.headers.get("authorization") || "";
  const suppliedSecret = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!suppliedSecret || !safeEqual(suppliedSecret, configuredSecret)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401, headers: RESPONSE_HEADERS },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON payload." },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }

  const summary = validateSummary(payload);
  if (!summary) {
    return NextResponse.json(
      { ok: false, error: "BALLS DEEP production proof payload failed validation." },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }

  try {
    const delivery = await sendBallsDeepDealHunterEmail(summary);
    return NextResponse.json(
      {
        ok: true,
        emailAccepted: delivery.accepted,
        providerIdPresent: delivery.providerIdPresent,
        recipientCount: delivery.recipientCount,
        sentAt: delivery.sentAt,
      },
      { status: 200, headers: RESPONSE_HEADERS },
    );
  } catch (error) {
    console.error(
      "BALLS DEEP production email delivery failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json(
      { ok: false, error: "Production email delivery failed." },
      { status: 502, headers: RESPONSE_HEADERS },
    );
  }
}
