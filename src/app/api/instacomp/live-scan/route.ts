import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { POST as runIdentityScan } from "../scan/route";
import { getExactEbayMarketProviders } from "../../../../lib/instacomp-exact-market-provider";
import { getOpenAiExactEbayMarketProviders } from "../../../../lib/instacomp-openai-web-market-provider";
import { verifyInstaCompCompetitionImages } from "../../../../lib/instacomp-comp-visual-verification";
import { sanitizeInstaCompProviderError } from "../../../../lib/instacomp-provider-safety";
import type {
  InstaCompAiResult,
  InstaCompProviderResult,
} from "../../../../lib/instacomp";
import {
  buildExactIdentityTitle,
  mergeExactMarketSources,
  missingExactIdentityFields,
  providerCoverage,
  type InstaCompExactMarketSource,
} from "../../../../lib/instacomp-live-pipeline";
import {
  instaCompJobErrorResponse,
  requireInstaCompJobActor,
} from "../../../../lib/instacomp-job-server";
import {
  checkPublicEndpointRateLimit,
  publicEndpointRateLimitResponse,
} from "../../../../lib/public-endpoint-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const SUPABASE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "",
).trim();

type LegacyScanResponse = {
  ok?: boolean;
  error?: string;
  scanId?: string | null;
  ai?: InstaCompAiResult;
  searchQuery?: string;
  links?: {
    ebaySoldUrl?: string;
    ebayActiveUrl?: string;
    [key: string]: unknown;
  };
  providers?: InstaCompProviderResult[];
  [key: string]: unknown;
};

type PersistenceResult = {
  status: "saved" | "skipped" | "error";
  message: string;
};

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function providerError(params: {
  source: string;
  label: string;
  message: string;
}): InstaCompProviderResult {
  return {
    source: params.source,
    label: params.label,
    status: "error",
    message: params.message,
    results: [],
  };
}

function forceVisualProof(provider: InstaCompProviderResult) {
  return {
    ...provider,
    results: provider.results.map((row) => ({
      ...row,
      flags: Array.from(
        new Set([
          ...row.flags,
          "guidance comp",
          "strict exact title awaiting image proof",
        ]),
      ).slice(0, 20),
    })),
  } satisfies InstaCompProviderResult;
}

function normalizedVisualSourceCategory(
  value: string,
): InstaCompProviderResult["results"][number]["sourceCategory"] {
  if (value === "sold") return "sold";
  if (value === "marketplace") return "marketplace";
  if (value === "auction") return "auction";
  if (value === "pricing") return "pricing";
  if (value === "broad") return "broad";
  return "reference";
}

function providerAfterVisualReview(params: {
  provider: InstaCompProviderResult;
  accepted: Awaited<ReturnType<typeof verifyInstaCompCompetitionImages>>["accepted"];
  rejectedCount: number;
}) {
  if (!params.provider.results.length) return params.provider;
  return {
    ...params.provider,
    status: params.accepted.length ? "live" : "no_matches",
    message: params.accepted.length
      ? `${params.accepted.length} candidate image${params.accepted.length === 1 ? "" : "s"} passed exact-card visual proof.`
      : `${params.rejectedCount} title candidate${params.rejectedCount === 1 ? " was" : "s were"} rejected or inconclusive after image proof.`,
    results: params.accepted.map((row) => ({
      ...row,
      sourceCategory: normalizedVisualSourceCategory(row.sourceCategory),
      matchScore: row.matchScore ?? 0,
    })),
  } satisfies InstaCompProviderResult;
}



function settledMessage(value: PromiseSettledResult<unknown>) {
  if (value.status === "fulfilled") return null;
  return sanitizeInstaCompProviderError(
    value.reason instanceof Error
      ? value.reason.message
      : String(value.reason || "Provider request failed."),
  );
}

function soldStats(summary: ReturnType<typeof mergeExactMarketSources>) {
  return {
    low: summary.pricing.soldLow,
    median: summary.pricing.soldMedian,
    average: summary.pricing.soldAverage,
    high: summary.pricing.soldHigh,
    suggestedPrice: summary.trustedSuggestedPrice,
  };
}

function marketStats(summary: ReturnType<typeof mergeExactMarketSources>) {
  const hasSold = summary.sold.length > 0;
  return {
    low: hasSold ? summary.pricing.soldLow : summary.pricing.activeLow,
    median: hasSold ? summary.pricing.soldMedian : summary.pricing.activeMedian,
    average: hasSold ? summary.pricing.soldAverage : summary.pricing.activeAverage,
    high: hasSold ? summary.pricing.soldHigh : summary.pricing.activeHigh,
    suggestedPrice: summary.trustedSuggestedPrice,
  };
}

async function persistExactMarketSummary(params: {
  scanId: string | null;
  query: string;
  suggestedPrice: number | null;
  soldSearchUrl: string | null;
  exactMarketEvidence?: Record<string, unknown> | null;
}): Promise<PersistenceResult> {
  if (!params.scanId) {
    return {
      status: "skipped",
      message: "Identity scan did not return a saved scan ID.",
    };
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return {
      status: "skipped",
      message: "Supabase is not configured in this runtime.",
    };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: existing } = await supabase
    .from("instacomp_scans")
    .select("raw_comp_results")
    .eq("id", params.scanId)
    .maybeSingle();
  const previousRaw =
    existing?.raw_comp_results && typeof existing.raw_comp_results === "object"
      ? (existing.raw_comp_results as Record<string, unknown>)
      : {};
  const { error } = await supabase
    .from("instacomp_scans")
    .update({
      search_query: params.query,
      suggested_price: params.suggestedPrice,
      ebay_sold_url: params.soldSearchUrl,
      raw_comp_results: {
        ...previousRaw,
        exactMarket: params.exactMarketEvidence || null,
      },
    })
    .eq("id", params.scanId);

  if (error) {
    return {
      status: "error",
      message: `Exact-market save failed: ${error.message}`,
    };
  }

  return {
    status: "saved",
    message: "Exact identity and sold-backed pricing summary saved.",
  };
}

function runtimeConfiguration() {
  return {
    openAi: Boolean(String(process.env.OPENAI_API_KEY || "").trim()),
    serpApi: Boolean(String(process.env.SERPAPI_API_KEY || "").trim()),
    ebay:
      Boolean(String(process.env.EBAY_CLIENT_ID || "").trim()) &&
      Boolean(String(process.env.EBAY_CLIENT_SECRET || "").trim()),
    supabase: Boolean(SUPABASE_URL && SUPABASE_KEY),
  };
}

async function authorizeLiveScan(request: NextRequest) {
  const actor = await requireInstaCompJobActor(request);
  const rateLimit = await checkPublicEndpointRateLimit({
    request,
    endpointKey: "instacomp_live_scan",
    subjectKey:
      actor.type === "seller"
        ? `seller:${actor.sellerAccountId}`
        : `admin:${actor.storeId}`,
    maxAttempts: 600,
    windowSeconds: 24 * 60 * 60,
  });

  if (!rateLimit.allowed) {
    const blocked = publicEndpointRateLimitResponse(rateLimit);
    return NextResponse.json(blocked.body, { status: blocked.status });
  }

  return null;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let frontReceived = false;
  let backReceived = false;
  let targetFrontImage: File | null = null;

  try {
    const blocked = await authorizeLiveScan(request);
    if (blocked) return blocked;
  } catch (error) {
    return instaCompJobErrorResponse(error);
  }

  try {
    const inspection = await request.clone().formData();
    const inspectedFront = inspection.get("frontImage");
    const inspectedBack = inspection.get("backImage");
    targetFrontImage = inspectedFront instanceof File ? inspectedFront : null;
    frontReceived = Boolean(targetFrontImage);
    backReceived = inspectedBack instanceof File;
  } catch (error) {
    return json(
      {
        ok: false,
        error: "The scanner could not read the uploaded image form.",
        details: error instanceof Error ? error.message : "Invalid multipart request.",
        pipelineDiagnostics: {
          mode: "live",
          simulated: false,
          runtimeConfiguration: runtimeConfiguration(),
          request: { frontReceived, backReceived },
        },
      },
      400,
    );
  }

  if (!frontReceived || !backReceived) {
    return json(
      {
        ok: false,
        error: "Upload both the front and back before running exact-card InstaComp.",
        pipelineDiagnostics: {
          mode: "live",
          simulated: false,
          runtimeConfiguration: runtimeConfiguration(),
          request: { frontReceived, backReceived },
        },
      },
      400,
    );
  }

  let identityResponse: Response;
  let base: LegacyScanResponse;
  try {
    identityResponse = await runIdentityScan(request);
    base = (await identityResponse.json()) as LegacyScanResponse;
  } catch (error) {
    return json(
      {
        ok: false,
        error: "The real image-recognition pipeline crashed before returning a result.",
        details: error instanceof Error ? error.message : "Unknown identity-pipeline error.",
        pipelineDiagnostics: {
          mode: "live",
          simulated: false,
          runtimeConfiguration: runtimeConfiguration(),
          request: { frontReceived, backReceived },
          durationMs: Date.now() - startedAt,
        },
      },
      500,
    );
  }

  if (!identityResponse.ok || !base.ok || !base.ai) {
    return json(
      {
        ...base,
        ok: false,
        error: base.error || "The real image-recognition pipeline failed.",
        pipelineDiagnostics: {
          mode: "live",
          simulated: false,
          runtimeConfiguration: runtimeConfiguration(),
          request: { frontReceived, backReceived },
          identity: {
            status: "error",
            message: base.error || "No card identity was returned.",
          },
          durationMs: Date.now() - startedAt,
        },
      },
      identityResponse.status || 500,
    );
  }

  const ai = base.ai;
  const missingIdentity = missingExactIdentityFields(ai);
  const exactTitle = buildExactIdentityTitle(ai, base.searchQuery);

  if (missingIdentity.length) {
    const persistence = await persistExactMarketSummary({
      scanId: base.scanId ? String(base.scanId) : null,
      query: exactTitle,
      suggestedPrice: null,
      soldSearchUrl: base.links?.ebaySoldUrl
        ? String(base.links.ebaySoldUrl)
        : null,
    });

    return json({
      ...base,
      ok: true,
      simulated: false,
      providers: [],
      sourceCoverage: [],
      activeComps: [],
      marketValueComps: [],
      soldComps: [],
      remainingCards: [],
      stats: {
        low: null,
        median: null,
        average: null,
        high: null,
        suggestedPrice: null,
      },
      soldStats: {
        low: null,
        median: null,
        average: null,
        high: null,
        suggestedPrice: null,
      },
      note: `Identity needs review before pricing. Missing: ${missingIdentity.join(", ")}.`,
      exactMarket: {
        status: "identity_incomplete",
        query: exactTitle,
        missingIdentityFields: missingIdentity,
        soldCount: 0,
        activeCount: 0,
        trustedSuggestedPrice: null,
      },
      pipelineDiagnostics: {
        mode: "live",
        simulated: false,
        runtimeConfiguration: runtimeConfiguration(),
        request: { frontReceived, backReceived },
        identity: {
          status: "review",
          confidence: ai.confidence,
          missingFields: missingIdentity,
        },
        exactMarket: {
          status: "blocked",
          message: "Exact market search was blocked to prevent a bad-card comp match.",
        },
        persistence,
        durationMs: Date.now() - startedAt,
      },
    });
  }

  const [serpSettled, openAiSettled] = await Promise.allSettled([
    getExactEbayMarketProviders({
      exactTitle,
      fallbackQuery: base.searchQuery || exactTitle,
      ai,
    }),
    getOpenAiExactEbayMarketProviders({ exactTitle, ai }),
  ]);

  const serp = serpSettled.status === "fulfilled" ? serpSettled.value : null;
  const openAi = openAiSettled.status === "fulfilled" ? openAiSettled.value : null;

  const serpSource: InstaCompExactMarketSource = serp
    ? { sold: serp.sold, active: serp.active }
    : {
        sold: providerError({
          source: "ebay_sold_serpapi_exact",
          label: "eBay Sold",
          message: settledMessage(serpSettled) || "SerpApi sold provider failed.",
        }),
        active: providerError({
          source: "ebay_active_serpapi_exact",
          label: "eBay Active",
          message: settledMessage(serpSettled) || "SerpApi active provider failed.",
        }),
      };
  const openAiSource: InstaCompExactMarketSource = openAi
    ? { sold: openAi.sold, active: openAi.active }
    : {
        sold: providerError({
          source: "openai_web_ebay_sold_exact",
          label: "eBay Sold via OpenAI Web",
          message:
            settledMessage(openAiSettled) || "OpenAI exact sold provider failed.",
        }),
        active: providerError({
          source: "openai_web_ebay_active_exact",
          label: "eBay Active via OpenAI Web",
          message:
            settledMessage(openAiSettled) || "OpenAI exact active provider failed.",
        }),
      };

  const officialEbayActive = (base.providers || []).find(
    (provider) => provider.source === "ebay_active",
  );
  const officialActiveSource: InstaCompExactMarketSource = {
    sold: {
      source: "ebay_official_sold_unavailable",
      label: "eBay Official Sold",
      status: "not_configured",
      message: "The official Browse API does not expose completed sales.",
      results: [],
    },
    active:
      officialEbayActive || {
        source: "ebay_active",
        label: "eBay Active",
        status: "no_matches",
        message: "The official eBay Browse search returned no exact active evidence.",
        results: [],
      },
  };
  const visualTarget = targetFrontImage;
  if (!visualTarget) {
    return json({ ok: false, error: "The exact-market verifier lost the target front image." }, 500);
  }
  const serpSoldForReview = forceVisualProof(serpSource.sold);
  const serpActiveForReview = forceVisualProof(serpSource.active);
  const officialActiveForReview = forceVisualProof(officialActiveSource.active);
  const [serpSoldReview, serpActiveReview, officialActiveReview] = await Promise.all([
    verifyInstaCompCompetitionImages({
      targetFrontImage: visualTarget,
      targetAi: ai,
      candidates: serpSoldForReview.results,
    }),
    verifyInstaCompCompetitionImages({
      targetFrontImage: visualTarget,
      targetAi: ai,
      candidates: serpActiveForReview.results,
    }),
    verifyInstaCompCompetitionImages({
      targetFrontImage: visualTarget,
      targetAi: ai,
      candidates: officialActiveForReview.results,
    }),
  ]);
  const verifiedSerpSource: InstaCompExactMarketSource = {
    sold: providerAfterVisualReview({
      provider: serpSource.sold,
      accepted: serpSoldReview.accepted,
      rejectedCount: serpSoldReview.rejected.length,
    }),
    active: providerAfterVisualReview({
      provider: serpSource.active,
      accepted: serpActiveReview.accepted,
      rejectedCount: serpActiveReview.rejected.length,
    }),
  };
  const verifiedOfficialActiveSource: InstaCompExactMarketSource = {
    sold: officialActiveSource.sold,
    active: providerAfterVisualReview({
      provider: officialActiveSource.active,
      accepted: officialActiveReview.accepted,
      rejectedCount: officialActiveReview.rejected.length,
    }),
  };
  const summary = mergeExactMarketSources([
    verifiedSerpSource,
    verifiedOfficialActiveSource,
  ]);
  const exactProviders = [
    verifiedSerpSource.sold,
    verifiedSerpSource.active,
    verifiedOfficialActiveSource.active,
    openAiSource.sold,
    openAiSource.active,
  ];
  const soldSearchUrl =
    serp?.sold.searchUrl ||
    openAi?.sold.searchUrl ||
    (base.links?.ebaySoldUrl ? String(base.links.ebaySoldUrl) : null);
  const exactMarketEvidence = {
    status: summary.status,
    query: exactTitle,
    queries: serp?.queries || [exactTitle],
    soldEvidenceCount: summary.sold.length,
    pricingEligibleSoldCount: summary.pricing.soldCount,
    activeEvidenceCount: summary.active.length,
    pricingEligibleActiveCount: summary.pricing.activeCount,
    trustedSuggestedPrice: summary.trustedSuggestedPrice,
    pricing: summary.pricing,
    sold: summary.sold.slice(0, 25),
    active: summary.active.slice(0, 25),
    discoveryCandidates: {
      sold: openAiSource.sold.results.slice(0, 10),
      active: openAiSource.active.results.slice(0, 10),
    },
    providers: exactProviders.map((provider) => ({
      source: provider.source,
      label: provider.label,
      status: provider.status,
      message: provider.message,
      results: provider.results.slice(0, 10),
    })),
  };
  const persistence = await persistExactMarketSummary({
    scanId: base.scanId ? String(base.scanId) : null,
    query: exactTitle,
    suggestedPrice: summary.trustedSuggestedPrice,
    soldSearchUrl,
    exactMarketEvidence,
  });

  const providerMessages = exactProviders
    .map((provider) => ({
      label: provider.label,
      status: provider.status,
      results: provider.results.length,
      message: provider.message || null,
    }))
    .filter((provider) => provider.status !== "live" || provider.message);
  const note = summary.pricing.soldCount
    ? `${summary.pricing.soldCount} strict exact, delivered-price sold comp${summary.pricing.soldCount === 1 ? "" : "s"} support the InstaComp price. ${summary.active.length} exact active listing${summary.active.length === 1 ? "" : "s"} were retained as evidence; ${summary.pricing.activeCount} had complete delivered pricing.`
    : summary.status === "provider_error"
      ? "No trusted price was created because the exact sold providers failed or returned unusable evidence."
      : "Zero strict exact sold comps were found. Active listings are shown separately and cannot create a trusted InstaComp price.";

  return json({
    ...base,
    ok: true,
    simulated: false,
    searchQuery: exactTitle,
    providers: exactProviders,
    sourceCoverage: providerCoverage(exactProviders, "sold"),
    activeComps: summary.active,
    marketValueComps: summary.sold,
    soldComps: summary.sold,
    remainingCards: [],
    stats: marketStats(summary),
    soldStats: soldStats(summary),
    note,
    exactMarket: {
      status: summary.status,
      query: exactTitle,
      queries: serp?.queries || [exactTitle],
      soldCount: summary.sold.length,
      pricingEligibleSoldCount: summary.pricing.soldCount,
      activeCount: summary.active.length,
      pricingEligibleActiveCount: summary.pricing.activeCount,
      trustedSuggestedPrice: summary.trustedSuggestedPrice,
      pricing: summary.pricing,
      sold: summary.sold,
      active: summary.active,
      providerMessages,
      discoveryCandidates: {
        sold: openAiSource.sold.results,
        active: openAiSource.active.results,
        trustedForPricing: false,
      },
    },
    pipelineDiagnostics: {
      mode: "live",
      simulated: false,
      runtimeConfiguration: runtimeConfiguration(),
      request: { frontReceived, backReceived },
      identity: {
        status: "complete",
        confidence: ai.confidence,
        missingFields: [],
      },
      exactMarket: {
        status: summary.status,
        soldCount: summary.sold.length,
        activeCount: summary.active.length,
        serpApi: {
          soldStatus: serpSource.sold.status,
          activeStatus: serpSource.active.status,
          soldAttempts: serp?.sold.attempts || [],
          activeAttempts: serp?.active.attempts || [],
        },
        visualProof: {
          configured:
            serpSoldReview.configured &&
            serpActiveReview.configured &&
            officialActiveReview.configured,
          model: serpSoldReview.model,
          soldReviewed: serpSoldReview.reviewedCount,
          soldRejected: serpSoldReview.rejected.length,
          serpActiveReviewed: serpActiveReview.reviewedCount,
          serpActiveRejected: serpActiveReview.rejected.length,
          officialActiveReviewed: officialActiveReview.reviewedCount,
          officialActiveRejected: officialActiveReview.rejected.length,
        },
        openAiWeb: {
          soldStatus: openAiSource.sold.status,
          activeStatus: openAiSource.active.status,
          model: openAi?.model || null,
          cached: openAi?.cached || false,
          responseId: openAi?.responseId || null,
        },
      },
      persistence,
      legacyProviderSummary: (base.providers || []).map((provider) => ({
        label: provider.label,
        status: provider.status,
        results: provider.results.length,
      })),
      durationMs: Date.now() - startedAt,
    },
  });
}
