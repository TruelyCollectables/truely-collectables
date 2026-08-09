import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { POST as runLiveScan } from "../../live-scan/route";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import { getInstaCompServiceToken } from "../../../../../lib/tcos-profit-hunter-secrets";
import { loadExactCardMarketHistory } from "../../../../../lib/instacomp-market-history";
import { trustedHistoricalSoldPricing } from "../../../../../lib/deal-hunter-trusted-sold-history";

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
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, max) : null;
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedRate(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function boundedMoney(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function secretMatches(provided: string, expected: string) {
  const left = Buffer.from(provided, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function authorizeMac(request: Request) {
  const expected = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
  const provided = String(request.headers.get("x-instacomp-ai-key") || "").trim();
  return Boolean(expected && provided && secretMatches(provided, expected));
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function economics(listing: Record<string, unknown>, scan: Record<string, any>) {
  const exactMarket = (scan.exactMarket || {}) as Record<string, any>;
  const soldCount = Number(
    exactMarket.pricingEligibleSoldCount ??
      exactMarket.soldCount ??
      (Array.isArray(scan.soldComps) ? scan.soldComps.length : 0),
  );
  const conservativeResale = numberValue(
    exactMarket.trustedSuggestedPrice ?? scan.soldStats?.suggestedPrice,
  );
  const itemPrice = numberValue(listing.itemPrice) || 0;
  const inboundShipping = numberValue(listing.inboundShipping) || 0;
  const buyerFees = numberValue(listing.buyerFees) || 0;
  const explicitTax = numberValue(listing.tax);
  const estimatedTaxRate = boundedRate("DEAL_HUNTER_ESTIMATED_TAX_RATE", 0.09);
  const tax = explicitTax ?? (itemPrice + inboundShipping) * estimatedTaxRate;
  const deliveredCost = itemPrice + inboundShipping + buyerFees + tax;
  const sellingFeeRate = boundedRate("DEAL_HUNTER_SELLING_FEE_RATE", 0.1325);
  const orderFee = boundedMoney("DEAL_HUNTER_ORDER_FEE", 0.4);
  const outboundShipping = boundedMoney("DEAL_HUNTER_OUTBOUND_SHIPPING", 0.78);
  const supplies = boundedMoney("DEAL_HUNTER_SUPPLIES", 0.25);
  const returnReserveRate = boundedRate("DEAL_HUNTER_RETURN_RESERVE_RATE", 0.02);
  const manualReviewRequired = listing.manualReviewRequired === true;

  let expectedNetProfit: number | null = null;
  let roiPercent: number | null = null;
  if (conservativeResale !== null && soldCount > 0 && deliveredCost > 0) {
    const sellingFees = conservativeResale * sellingFeeRate;
    const returnReserve = conservativeResale * returnReserveRate;
    const expectedNetProceeds =
      conservativeResale - sellingFees - orderFee - outboundShipping - supplies - returnReserve;
    expectedNetProfit = expectedNetProceeds - deliveredCost;
    roiPercent = (expectedNetProfit / deliveredCost) * 100;
  }

  let dealLabel = "SUPPRESSED — NO TRUSTED EXACT SOLD PRICE";
  let actionable = false;
  let alertworthy = false;
  let status = "completed";
  let reason = "Hardened InstaComp did not return pricing-eligible exact sold evidence.";
  let errorCode: string | null = "DEAL_HUNTER_EXACT_SOLD_REQUIRED";

  if (manualReviewRequired && conservativeResale !== null) {
    dealLabel = "TOO GOOD TO BE TRUE";
    alertworthy = true;
    status = "identity_review";
    reason = "The listing may be misidentified or mislabeled and requires front/back, seller, and condition review.";
    errorCode = "DEAL_HUNTER_MANUAL_REVIEW_REQUIRED";
  } else if (expectedNetProfit !== null && roiPercent !== null) {
    errorCode = null;
    if (roiPercent >= 50) {
      dealLabel = "TOO GOOD TO BE TRUE";
      alertworthy = true;
      reason = "The verified spread is unusually large and requires a final fraud, seller, identity, and condition check.";
    } else if (roiPercent >= 30 && expectedNetProfit >= 15) {
      dealLabel = "MUST BUY";
      actionable = true;
      alertworthy = true;
      reason = "Exact sold-backed economics clear the 30% ROI and $15 net-profit gates.";
    } else if (roiPercent >= 20) {
      dealLabel = "BORDERLINE BUY";
      actionable = true;
      alertworthy = true;
      reason = "Exact sold-backed economics clear the 20% minimum ROI gate.";
    } else {
      dealLabel = "NO FUCKING WAY / OVERPRICED";
      reason = "Projected net ROI is below 20% after acquisition and resale costs.";
    }
  }

  return {
    status,
    soldCount,
    deliveredCost: Number(deliveredCost.toFixed(2)),
    conservativeResale:
      conservativeResale === null ? null : Number(conservativeResale.toFixed(2)),
    expectedNetProfit:
      expectedNetProfit === null ? null : Number(expectedNetProfit.toFixed(2)),
    roiPercent: roiPercent === null ? null : Number(roiPercent.toFixed(2)),
    dealLabel,
    actionable,
    alertworthy,
    reason,
    errorCode,
    assumptions: {
      taxEstimated: explicitTax === null,
      estimatedTaxRate,
      sellingFeeRate,
      orderFee,
      outboundShipping,
      supplies,
      returnReserveRate,
    },
  };
}


async function applyTrustedHistoricalSoldFallback(scan: Record<string, any>) {
  const exactMarket = (scan.exactMarket || {}) as Record<string, any>;
  const liveSoldCount = Number(exactMarket.pricingEligibleSoldCount || 0);
  const livePrice = numberValue(exactMarket.trustedSuggestedPrice);
  if (liveSoldCount > 0 && livePrice !== null) return scan;

  const registry = (scan.checklistRegistry || {}) as Record<string, any>;
  const identityId = text(registry.identityId, 100);
  const fingerprint = text(registry.fingerprintSha256, 128);
  if (registry.matched !== true || !identityId || !fingerprint) return scan;

  try {
    const history = await loadExactCardMarketHistory(identityId);
    const historical = trustedHistoricalSoldPricing({
      history,
      registryIdentityId: identityId,
      registryFingerprintSha256: fingerprint,
      maxAgeDays: 90,
    });
    if (!historical) return scan;

    return {
      ...scan,
      exactMarket: {
        ...exactMarket,
        status: "ready",
        pricingEligibleSoldCount: historical.soldCount,
        trustedSuggestedPrice: historical.medianDeliveredPrice,
        historicalSoldFallback: {
          used: true,
          source: "trusted_exact_card_market_history",
          soldCount: historical.soldCount,
          medianDeliveredPrice: historical.medianDeliveredPrice,
          oldestSoldAt: historical.oldestSoldAt,
          newestSoldAt: historical.newestSoldAt,
          maxAgeDays: historical.maxAgeDays,
          registryIdentityId: identityId,
          registryFingerprintSha256: fingerprint,
        },
      },
    };
  } catch (error) {
    return {
      ...scan,
      exactMarket: {
        ...exactMarket,
        historicalSoldFallback: {
          used: false,
          error: text(error instanceof Error ? error.message : String(error), 500),
        },
      },
    };
  }
}

async function persistRunSummary(body: Record<string, any>) {
  const runId = text(body.runId, 100);
  if (!runId) throw new Error("runId is required.");
  const counts = (body.counts || {}) as Record<string, unknown>;
  const supabase = createSupabaseServerClient({ admin: true });
  const { error } = await supabase.from("tcos_deal_hunter_runs").upsert(
    {
      run_id: runId,
      status: text(body.status, 40) || "unknown",
      completed_at: new Date().toISOString(),
      discovery_count: Number(counts.discovery || 0),
      evaluated_count: Number(counts.evaluated || 0),
      actionable_count: Number(counts.actionable || 0),
      manual_review_count: Number(counts.manual_review || 0),
      failure_count: Number(counts.failure || 0),
      summary: body.summary || {},
    },
    { onConflict: "run_id" },
  );
  if (error) throw new Error(error.message);
  return { ok: true, kind: "run_complete", runId };
}

async function sendAlertEmail(params: {
  listing: Record<string, unknown>;
  evaluation: ReturnType<typeof economics>;
}) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const to = String(
    process.env.DEAL_HUNTER_ALERT_TO || "truelycollectables@gmail.com",
  ).trim();
  if (!apiKey || !to || !params.evaluation.alertworthy) {
    return { status: "skipped", reason: "Alert delivery is not configured or not required." };
  }

  const from = String(
    process.env.DEAL_HUNTER_ALERT_FROM ||
      "Truely Collectables <sales@truelycollectables.com>",
  ).trim();
  const title = text(params.listing.title, 500) || "Deal Hunter candidate";
  const directUrl = text(params.listing.listingUrl, 2000) || "";
  const subject = `${params.evaluation.dealLabel} — ${title}`.slice(0, 240);
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:720px;margin:auto;color:#111">
      <h1>${escapeHtml(params.evaluation.dealLabel)}</h1>
      <h2>${escapeHtml(title)}</h2>
      <p><strong>Delivered cost:</strong> $${params.evaluation.deliveredCost.toFixed(2)}</p>
      <p><strong>Conservative resale:</strong> ${params.evaluation.conservativeResale === null ? "Not proven" : `$${params.evaluation.conservativeResale.toFixed(2)}`}</p>
      <p><strong>Expected net profit:</strong> ${params.evaluation.expectedNetProfit === null ? "Not proven" : `$${params.evaluation.expectedNetProfit.toFixed(2)}`}</p>
      <p><strong>ROI:</strong> ${params.evaluation.roiPercent === null ? "Not proven" : `${params.evaluation.roiPercent.toFixed(1)}%`}</p>
      <p>${escapeHtml(params.evaluation.reason)}</p>
      <p><a href="${escapeHtml(directUrl)}" style="display:inline-block;padding:12px 18px;background:#000;color:#fff;text-decoration:none;border-radius:999px">OPEN LISTING</a></p>
      <p style="font-size:12px;color:#666">No purchase was made. Deal Hunter is discovery and decision support only.</p>
    </div>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      status: "failed",
      reason: text((payload as any)?.message, 1000) || `Resend HTTP ${response.status}`,
    };
  }
  return { status: "sent", id: (payload as any)?.id || null };
}

async function persistEvaluation(params: {
  listing: Record<string, any>;
  scan: Record<string, any>;
  evaluation: ReturnType<typeof economics>;
}) {
  const listingUrl = text(params.listing.listingUrl, 2000);
  const candidateKey = text(params.listing.candidateKey, 300);
  if (!listingUrl || !candidateKey) throw new Error("Listing URL and candidate key are required.");
  const fingerprint = createHash("sha256")
    .update(
      [
        candidateKey,
        String(params.listing.itemPrice ?? ""),
        params.evaluation.dealLabel,
        String(params.evaluation.expectedNetProfit ?? ""),
      ].join("|"),
    )
    .digest("hex");
  const supabase = createSupabaseServerClient({ admin: true });
  const { data: prior } = await supabase
    .from("tcos_deal_hunter_candidates")
    .select("id,alert_sent_at")
    .eq("candidate_fingerprint", fingerprint)
    .maybeSingle();

  const { data, error } = await supabase
    .from("tcos_deal_hunter_candidates")
    .upsert(
      {
        run_id: text(params.listing.runId, 100),
        candidate_key: candidateKey,
        candidate_fingerprint: fingerprint,
        lane: text(params.listing.lane, 200),
        watched_person: text(params.listing.watchedPerson, 200),
        marketplace: text(params.listing.marketplace, 100) || "eBay",
        listing_item_id: text(params.listing.listingItemId, 200),
        listing_url: listingUrl,
        title: text(params.listing.title, 1000) || "Untitled listing",
        seller_name: text(params.listing.sellerName, 300),
        item_price: numberValue(params.listing.itemPrice),
        delivered_cost: params.evaluation.deliveredCost,
        conservative_resale: params.evaluation.conservativeResale,
        expected_net_profit: params.evaluation.expectedNetProfit,
        roi_percent: params.evaluation.roiPercent,
        deal_label: params.evaluation.dealLabel,
        actionable: params.evaluation.actionable,
        alertworthy: params.evaluation.alertworthy,
        identity: params.scan.ai || {},
        exact_market: params.scan.exactMarket || {},
        evaluation: params.evaluation,
        source_payload: params.listing,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "candidate_fingerprint" },
    )
    .select("id,alert_sent_at")
    .single();
  if (error) throw new Error(error.message);

  let delivery: Record<string, unknown> = {
    status: "duplicate_suppressed",
    reason: "This exact price/evaluation fingerprint was already stored.",
  };
  if (!prior?.alert_sent_at && params.evaluation.alertworthy) {
    delivery = await sendAlertEmail({
      listing: params.listing,
      evaluation: params.evaluation,
    });
    if (delivery.status === "sent") {
      await supabase
        .from("tcos_deal_hunter_candidates")
        .update({
          alert_sent_at: new Date().toISOString(),
          alert_delivery: delivery,
        })
        .eq("id", data.id);
    }
  }
  return { id: data.id, fingerprint, delivery };
}

export async function POST(request: NextRequest) {
  if (!authorizeMac(request)) {
    return json({ ok: false, error: "Invalid InstaComp AI Mac credential." }, 401);
  }

  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    try {
      const body = (await request.json()) as Record<string, any>;
      if (body.kind !== "run_complete") {
        return json({ ok: false, error: "Unsupported Deal Hunter message kind." }, 400);
      }
      return json(await persistRunSummary(body));
    } catch (error) {
      return json(
        { ok: false, error: error instanceof Error ? error.message : String(error) },
        500,
      );
    }
  }

  let listing: Record<string, any>;
  let front: File;
  let back: File;
  try {
    const form = await request.formData();
    const listingJson = form.get("listingJson");
    const frontValue = form.get("frontImage");
    const backValue = form.get("backImage");
    if (typeof listingJson !== "string") throw new Error("listingJson is required.");
    if (!(frontValue instanceof File) || !(backValue instanceof File)) {
      throw new Error("Both frontImage and backImage are required.");
    }
    if (
      !ALLOWED_IMAGE_TYPES.has(frontValue.type) ||
      !ALLOWED_IMAGE_TYPES.has(backValue.type)
    ) {
      throw new Error("Deal Hunter images must be JPEG, PNG, or WebP.");
    }
    if (
      frontValue.size <= 0 ||
      backValue.size <= 0 ||
      frontValue.size > MAX_IMAGE_BYTES ||
      backValue.size > MAX_IMAGE_BYTES
    ) {
      throw new Error("Deal Hunter images must be non-empty and no larger than 12MB each.");
    }
    listing = JSON.parse(listingJson) as Record<string, any>;
    front = frontValue;
    back = backValue;
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }

  try {
    const internalForm = new FormData();
    internalForm.set("frontImage", front, front.name || "front.jpg");
    internalForm.set("backImage", back, back.name || "back.jpg");
    internalForm.set("aiCouncilTier", "adaptive");
    const listingTitleHint = text(listing.title, 1000);
    if (listingTitleHint) internalForm.set("listingTitleHint", listingTitleHint);
    const internalHeaders = new Headers({ Accept: "application/json" });
    internalHeaders.set(
      "x-tcos-instacomp-service-token",
      getInstaCompServiceToken(),
    );
    const internalRequest = new NextRequest(
      new URL("/api/instacomp/live-scan", request.url),
      {
        method: "POST",
        headers: internalHeaders,
        body: internalForm,
      },
    );
    const scanResponse = await runLiveScan(internalRequest);
    const scan = (await scanResponse.json().catch(() => null)) as Record<string, any> | null;
    if (!scanResponse.ok || !scan?.ok) {
      return json(
        {
          ok: false,
          error: text(scan?.error || scan?.note, 2000) || `InstaComp live scan failed with HTTP ${scanResponse.status}.`,
          scan,
        },
        scanResponse.status || 502,
      );
    }

    const pricedScan = await applyTrustedHistoricalSoldFallback(scan);
    const evaluation = economics(listing, pricedScan);
    const persistence = await persistEvaluation({ listing, scan: pricedScan, evaluation });
    return json({
      ok: true,
      schema: "truely.deal-hunter.evaluation.v1",
      listing: {
        candidateKey: listing.candidateKey,
        listingUrl: listing.listingUrl,
        title: listing.title,
      },
      evaluation,
      persistence,
      scan: pricedScan,
      boundaries: {
        purchaseCapability: false,
        autoBuy: false,
        ledgerMutationCapability: false,
        exactSoldRequiredForPositiveEconomics: true,
      },
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
}
