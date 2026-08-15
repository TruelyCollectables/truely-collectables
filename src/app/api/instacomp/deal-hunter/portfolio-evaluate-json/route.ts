import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function text(value: unknown, max = 4000) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, max) : null;
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : null;
}

function deliveredCost(listing: Record<string, unknown>) {
  const parts = [
    numberValue(listing.itemPrice),
    numberValue(listing.inboundShipping),
    numberValue(listing.buyerFees),
    numberValue(listing.tax),
  ];
  return Number(parts.reduce<number>((sum, value) => sum + (value || 0), 0).toFixed(2));
}

function publicHttpsUrl(raw: unknown) {
  const value = text(raw, 4000);
  if (!value) throw new Error("Image URL is required.");
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Image URL must use HTTPS.");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("Image URL points to a private or local host.");
  }
  return url;
}

async function fetchImage(raw: unknown, label: "front" | "back") {
  let current = publicHttpsUrl(raw);
  for (let redirectCount = 0; redirectCount <= 2; redirectCount += 1) {
    const response = await fetch(current, {
      headers: {
        Accept: "image/jpeg,image/png,image/webp",
        "User-Agent": "tcos-portfolio-instacomp/1.0",
      },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === 2) {
        throw new Error(`${label} image redirect limit reached.`);
      }
      current = publicHttpsUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`${label} image HTTP ${response.status}.`);
    const contentType = String(response.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw new Error(`${label} image type ${contentType || "unknown"} is unsupported.`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
      throw new Error(`${label} image is empty or exceeds 12MB.`);
    }
    const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
    return new File([bytes], `${label}.${extension}`, { type: contentType });
  }
  throw new Error(`${label} image could not be fetched.`);
}

type TrustedAuth = {
  ok: boolean;
  internalInstaCompKey: string;
};

async function secretsMatch(provided: string, expected: string) {
  if (!expected || !provided || expected.length !== provided.length) return false;
  try {
    const { timingSafeEqual } = await import("node:crypto");
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(provided, "utf8"));
  } catch {
    return expected === provided;
  }
}

async function authorize(request: Request): Promise<TrustedAuth> {
  const instaCompExpected = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
  const instaCompProvided = String(request.headers.get("x-instacomp-ai-key") || "").trim();
  if (await secretsMatch(instaCompProvided, instaCompExpected)) {
    return { ok: true, internalInstaCompKey: instaCompExpected };
  }

  const cronExpected = String(process.env.TCOS_CRON_SECRET || "").trim();
  const cronProvided = String(request.headers.get("x-tcos-cron-secret") || "").trim();
  if (await secretsMatch(cronProvided, cronExpected) && instaCompExpected) {
    return { ok: true, internalInstaCompKey: instaCompExpected };
  }
  return { ok: false, internalInstaCompKey: "" };
}

export async function GET() {
  return json({
    ok: true,
    schema: "tcos.portfolio-evaluate-json.status.v1",
    ready: true,
    inboundFormat: "application/json",
    frontBackRequired: true,
  });
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return json({ ok: false, stage: "portfolio_json_auth", error: "Invalid trusted portfolio credential." }, 401);
  }

  let body: Record<string, any>;
  try {
    if (!String(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
      throw new Error("Content-Type application/json is required.");
    }
    body = (await request.json()) as Record<string, any>;
    if (!body || typeof body !== "object" || !body.listing || typeof body.listing !== "object") {
      throw new Error("listing is required.");
    }
    if (!body.frontImageUrl || !body.backImageUrl) {
      throw new Error("frontImageUrl and backImageUrl are required.");
    }
  } catch (error) {
    return json(
      {
        ok: false,
        stage: "portfolio_json_input",
        error: error instanceof Error ? error.message : String(error),
      },
      400,
    );
  }

  let front: File;
  let back: File;
  try {
    [front, back] = await Promise.all([
      fetchImage(body.frontImageUrl, "front"),
      fetchImage(body.backImageUrl, "back"),
    ]);
  } catch (error) {
    return json(
      {
        ok: false,
        stage: "portfolio_json_image_fetch",
        error: error instanceof Error ? error.message : String(error),
      },
      422,
    );
  }

  let runDealHunterCore: (request: NextRequest) => Promise<Response>;
  try {
    const module = await import("../evaluate/core");
    runDealHunterCore = module.POST;
  } catch (error) {
    return json(
      {
        ok: false,
        stage: "portfolio_json_core_import",
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }

  const listing = body.listing as Record<string, any>;
  const form = new FormData();
  form.set("listingJson", JSON.stringify(listing));
  form.set("frontImage", front, front.name || "front.jpg");
  form.set("backImage", back, back.name || "back.jpg");
  const headers = new Headers({ Accept: "application/json" });
  headers.set("x-instacomp-ai-key", auth.internalInstaCompKey);

  let coreResponse: Response;
  try {
    coreResponse = await runDealHunterCore(
      new NextRequest(new URL("/api/instacomp/deal-hunter/evaluate", request.url), {
        method: "POST",
        headers,
        body: form,
      }),
    );
  } catch (error) {
    return json(
      {
        ok: false,
        stage: "portfolio_json_core_exception",
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }

  const payload = (await coreResponse.clone().json().catch(() => null)) as Record<string, any> | null;
  if (!coreResponse.ok || payload?.ok !== true || !payload.scan) {
    return json(
      {
        ...(payload || {}),
        ok: false,
        stage: payload?.stage || "portfolio_json_core_response",
        error:
          text(payload?.error || payload?.note, 2000) ||
          `Hardened Deal Hunter core failed with HTTP ${coreResponse.status}.`,
      },
      coreResponse.status || 500,
    );
  }

  let persistExactCardMarketHistory: any;
  try {
    const module = await import("../../../../../lib/instacomp-market-history");
    persistExactCardMarketHistory = module.persistExactCardMarketHistory;
  } catch (error) {
    return json(
      {
        ok: false,
        stage: "portfolio_json_history_import",
        error: error instanceof Error ? error.message : String(error),
        originalEvaluation: payload.evaluation || null,
      },
      500,
    );
  }

  try {
    const scan = payload.scan as Record<string, any>;
    const registry = scan.checklistRegistry || null;
    const ai = scan.ai || {};
    const exactMarket = scan.exactMarket || {};
    const sold = Array.isArray(scan.soldComps)
      ? scan.soldComps
      : Array.isArray(exactMarket.sold)
        ? exactMarket.sold
        : [];
    const active = Array.isArray(scan.activeComps)
      ? scan.activeComps
      : Array.isArray(exactMarket.active)
        ? exactMarket.active
        : [];
    const observedAt = new Date().toISOString();
    const targetListing = {
      title: String(listing.title || "Untitled Deal Hunter listing"),
      marketplace: String(listing.marketplace || "eBay"),
      listingUrl: String(listing.listingUrl || ""),
      listingItemId: String(listing.listingItemId || "").trim() || null,
      itemPrice: numberValue(listing.itemPrice),
      shippingPrice: numberValue(listing.inboundShipping),
      buyerFees: numberValue(listing.buyerFees),
      tax: numberValue(listing.tax),
      deliveredPrice: deliveredCost(listing),
      currency: "USD",
      conditionText: String(listing.conditionText || "").trim() || null,
      observedAt,
    };
    const marketHistory = await persistExactCardMarketHistory({
      registry,
      ai,
      sold,
      active,
      targetListing,
      scanId: String(scan.scanId || scan.scan_id || "").trim() || null,
      observedAt,
    });
    if (registry?.matched === true && marketHistory.status !== "saved") {
      throw new Error(
        `Registry-confirmed Deal Hunter card was not persisted to market history: ${marketHistory.reason}`,
      );
    }
    return json({
      ...payload,
      marketHistory,
      portfolioEvaluator: {
        inboundFormat: "json_image_urls",
        serverFetchedFrontBack: true,
        registryExactLockRequired: true,
        exactSoldRequiredForPositiveEconomics: true,
      },
    });
  } catch (error) {
    return json(
      {
        ok: false,
        stage: "portfolio_json_exact_card_market_history",
        error: error instanceof Error ? error.message : String(error),
        originalEvaluation: payload.evaluation || null,
      },
      500,
    );
  }
}
