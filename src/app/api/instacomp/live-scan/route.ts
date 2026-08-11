import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { POST as runIdentityScan } from "../scan/route";
import { getExactEbayMarketProviders } from "../../../../lib/instacomp-exact-market-provider";
import { getOpenAiExactEbayMarketProviders } from "../../../../lib/instacomp-openai-web-market-provider";
import { getTeacherExactMarketProviders } from "../../../../lib/instacomp-teacher-market-provider";
import { pushInstaCompTeacherReceipt } from "../../../../lib/instacomp-teacher-learning-bridge";
import { verifyInstaCompCompetitionImages } from "../../../../lib/instacomp-comp-visual-verification";
import { sanitizeInstaCompProviderError } from "../../../../lib/instacomp-provider-safety";
import { loadExactCardMarketHistory } from "../../../../lib/instacomp-market-history";
import { trustedHistoricalSoldPricing } from "../../../../lib/deal-hunter-trusted-sold-history";
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
  isValidInstaCompServiceRequest,
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
  cardUuid: string | null;
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
        cardUuid: params.cardUuid,
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
  // This branch is reachable only with the dedicated internal service
  // credential. It bypasses the PUBLIC endpoint rate limiter, not
  // authentication, so a Supabase rate-limit outage cannot break the
  // already-authenticated physical Mac -> website scan channel.
  if (isValidInstaCompServiceRequest(request)) return null;

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
  const cardUuid = String((ai as any).internalCardUuid || "").trim() || null;
  const missingIdentity = missingExactIdentityFields(ai);
  const exactTitle = buildExactIdentityTitle(ai, base.searchQuery);

  if (missingIdentity.length) {
    const persistence = await persistExactMarketSummary({
      scanId: base.scanId ? String(base.scanId) : null,
      cardUuid,
      query: exactTitle,
      suggestedPrice: null,
      soldSearchUrl: base.links?.ebaySoldUrl
        ? String(base.links.ebaySoldUrl)
        : null,
    });

    return json({
      ...base,
      ok: true,
      cardUuid,
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


  const memoryRegistryReceipt = ((base as any).checklistRegistry || {}) as Record<string, any>;
  const memoryRegistryIdentityId = String(memoryRegistryReceipt.identityId || "").trim() || null;
  const memoryRegistryFingerprintSha256 =
    String(memoryRegistryReceipt.fingerprintSha256 || "").trim() || null;

  if (
    memoryRegistryReceipt.matched === true &&
    memoryRegistryIdentityId &&
    memoryRegistryFingerprintSha256
  ) {
    try {
      const history = await loadExactCardMarketHistory(memoryRegistryIdentityId);
      const historical = trustedHistoricalSoldPricing({
        history,
        registryIdentityId: memoryRegistryIdentityId,
        registryFingerprintSha256: memoryRegistryFingerprintSha256,
        maxAgeDays: 90,
      });
      if (historical) {
        const officialEbayActive = (base.providers || []).find(
          (provider) => provider.source === "ebay_active",
        );
        const activeProvider: InstaCompProviderResult =
          officialEbayActive || {
            source: "ebay_active",
            label: "eBay Active",
            status: "no_matches",
            message: "The official eBay Browse search returned no exact active evidence.",
            results: [],
          };
        const memoryProvider: InstaCompProviderResult = {
          source: "instacomp_exact_market_memory",
          label: "InstaComp Exact Sold Memory",
          status: "live",
          message: `${historical.soldCount} previously verified exact sold comp${historical.soldCount === 1 ? "" : "s"} were reused from the Registry-locked market history; paid sold searches were skipped.`,
          results: [],
        };
        const memoryStats = {
          low: null,
          median: historical.medianDeliveredPrice,
          average: historical.medianDeliveredPrice,
          high: null,
          suggestedPrice: historical.medianDeliveredPrice,
        };
        const memoryPricing = {
          soldCount: historical.soldCount,
          soldLow: null,
          soldMedian: historical.medianDeliveredPrice,
          soldAverage: historical.medianDeliveredPrice,
          soldHigh: null,
          activeCount: 0,
          activeLow: null,
          activeMedian: null,
          activeAverage: null,
          activeHigh: null,
        };
        const persistence = await persistExactMarketSummary({
          scanId: base.scanId ? String(base.scanId) : null,
          cardUuid,
          query: exactTitle,
          suggestedPrice: historical.medianDeliveredPrice,
          soldSearchUrl: base.links?.ebaySoldUrl
            ? String(base.links.ebaySoldUrl)
            : null,
          exactMarketEvidence: {
            status: "ready",
            query: exactTitle,
            queries: [],
            soldEvidenceCount: historical.soldCount,
            pricingEligibleSoldCount: historical.soldCount,
            activeEvidenceCount: activeProvider.results.length,
            pricingEligibleActiveCount: 0,
            trustedSuggestedPrice: historical.medianDeliveredPrice,
            pricing: memoryPricing,
            sold: [],
            active: activeProvider.results.slice(0, 25),
            historicalSoldMemory: {
              used: true,
              source: "trusted_exact_card_market_history",
              soldCount: historical.soldCount,
              medianDeliveredPrice: historical.medianDeliveredPrice,
              oldestSoldAt: historical.oldestSoldAt,
              newestSoldAt: historical.newestSoldAt,
              maxAgeDays: historical.maxAgeDays,
              registryIdentityId: memoryRegistryIdentityId,
              registryFingerprintSha256: memoryRegistryFingerprintSha256,
              paidSoldSearchesSkipped: true,
              serpApiCalls: 0,
            },
          },
        });

        return json({
          ...base,
          ok: true,
          cardUuid,
          simulated: false,
          searchQuery: exactTitle,
          providers: [memoryProvider, activeProvider],
          sourceCoverage: providerCoverage([memoryProvider, activeProvider], "sold"),
          activeComps: activeProvider.results,
          marketValueComps: [],
          soldComps: [],
          remainingCards: [],
          stats: memoryStats,
          soldStats: memoryStats,
          note: `${historical.soldCount} Registry-locked exact sold comp${historical.soldCount === 1 ? "" : "s"} were reused from InstaComp market memory. No paid sold provider was called; official eBay Browse remains available for active-market context.`,
          exactMarket: {
            status: "ready",
            query: exactTitle,
            queries: [],
            soldCount: historical.soldCount,
            pricingEligibleSoldCount: historical.soldCount,
            activeCount: activeProvider.results.length,
            pricingEligibleActiveCount: 0,
            trustedSuggestedPrice: historical.medianDeliveredPrice,
            pricing: memoryPricing,
            sold: [],
            active: activeProvider.results,
            providerMessages: [
              {
                label: memoryProvider.label,
                status: memoryProvider.status,
                results: 0,
                message: memoryProvider.message,
              },
              {
                label: activeProvider.label,
                status: activeProvider.status,
                results: activeProvider.results.length,
                message: activeProvider.message || null,
              },
            ],
            historicalSoldMemory: {
              used: true,
              source: "trusted_exact_card_market_history",
              soldCount: historical.soldCount,
              medianDeliveredPrice: historical.medianDeliveredPrice,
              oldestSoldAt: historical.oldestSoldAt,
              newestSoldAt: historical.newestSoldAt,
              maxAgeDays: historical.maxAgeDays,
              registryIdentityId: memoryRegistryIdentityId,
              registryFingerprintSha256: memoryRegistryFingerprintSha256,
              paidSoldSearchesSkipped: true,
              serpApiCalls: 0,
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
              status: "ready_from_memory",
              soldCount: historical.soldCount,
              activeCount: activeProvider.results.length,
              paidSoldSearchesSkipped: true,
              serpApiCalls: 0,
              memoryRegistryIdentityId,
              memoryRegistryFingerprintSha256,
            },
            persistence,
            durationMs: Date.now() - startedAt,
          },
        });
      }
    } catch (error) {
      console.warn(
        "InstaComp exact sold memory preflight failed; continuing to live sold providers:",
        sanitizeInstaCompProviderError(error instanceof Error ? error.message : String(error)),
      );
    }
  }

  let teacher: Awaited<ReturnType<typeof getTeacherExactMarketProviders>> | null = null;
  let teacherFailure: string | null = null;
  try {
    teacher = await getTeacherExactMarketProviders({ exactTitle, ai });
  } catch (error) {
    teacherFailure = sanitizeInstaCompProviderError(
      error instanceof Error ? error.message : String(error),
    );
  }
  const teacherSource: InstaCompExactMarketSource = teacher
    ? { sold: teacher.sold, active: teacher.active }
    : {
        sold: providerError({
          source: "teacher_consensus_exact_sold",
          label: "Outside AI Teacher Consensus Sold",
          message: teacherFailure || "Outside teacher market search failed.",
        }),
        active: providerError({
          source: "teacher_discovery_active",
          label: "Outside AI Teacher Active Discovery",
          message: teacherFailure || "Outside teacher market search failed.",
        }),
      };

  let openAi: Awaited<ReturnType<typeof getOpenAiExactEbayMarketProviders>> | null = null;
  let openAiFailure: string | null = null;
  if (!teacherSource.sold.results.length) {
    try {
      openAi = await getOpenAiExactEbayMarketProviders({ exactTitle, ai });
    } catch (error) {
      openAiFailure = sanitizeInstaCompProviderError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  const openAiSource: InstaCompExactMarketSource = openAi
    ? { sold: openAi.sold, active: openAi.active }
    : {
        sold: providerError({
          source: "openai_web_ebay_sold_exact",
          label: "eBay Sold via OpenAI Web",
          message: teacherSource.sold.results.length
            ? "Skipped because outside teacher consensus already supplied trusted exact sold evidence."
            : openAiFailure || "OpenAI exact sold provider failed or was unavailable.",
        }),
        active: providerError({
          source: "openai_web_ebay_active_exact",
          label: "eBay Active via OpenAI Web",
          message: teacherSource.sold.results.length
            ? "Skipped because outside teacher consensus already supplied trusted exact sold evidence."
            : openAiFailure || "OpenAI exact active provider failed or was unavailable.",
        }),
      };

  let serp: Awaited<ReturnType<typeof getExactEbayMarketProviders>> | null = null;
  let serpFailure: string | null = null;
  if (!teacherSource.sold.results.length && !openAiSource.sold.results.length) {
    try {
      serp = await getExactEbayMarketProviders({
        exactTitle,
        fallbackQuery: base.searchQuery || exactTitle,
        ai,
      });
    } catch (error) {
      serpFailure = sanitizeInstaCompProviderError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  const serpSource: InstaCompExactMarketSource = serp
    ? { sold: serp.sold, active: serp.active }
    : {
        sold: providerError({
          source: "ebay_sold_serpapi_exact",
          label: "eBay Sold",
          message:
            teacherSource.sold.results.length || openAiSource.sold.results.length
              ? "SerpApi held as last fallback and was not called."
              : serpFailure || "SerpApi sold provider failed or was unavailable.",
        }),
        active: providerError({
          source: "ebay_active_serpapi_exact",
          label: "eBay Active",
          message:
            teacherSource.sold.results.length || openAiSource.sold.results.length
              ? "SerpApi held as last fallback and was not called."
              : serpFailure || "SerpApi active provider failed or was unavailable.",
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
    teacherSource,
    verifiedSerpSource,
    verifiedOfficialActiveSource,
  ]);
  const exactProviders = [
    teacherSource.sold,
    teacherSource.active,
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
    teacherConsensus: teacher
      ? {
          configuredTeachers: teacher.configuredTeachers,
          requiredVotes: teacher.requiredVotes,
          attempts: teacher.attempts,
          studentHypothesis: teacher.studentHypothesis,
        }
      : null,
    discoveryCandidates: {
      sold: [
        ...(teacher?.discovery.sold || []),
        ...openAiSource.sold.results,
      ].slice(0, 20),
      active: [
        ...(teacher?.discovery.active || []),
        ...openAiSource.active.results,
      ].slice(0, 20),
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
    cardUuid,
    query: exactTitle,
    suggestedPrice: summary.trustedSuggestedPrice,
    soldSearchUrl,
    exactMarketEvidence,
  });

  const registryReceipt = ((base as any).checklistRegistry || {}) as Record<string, any>;
  const registryIdentityId = String(registryReceipt.identityId || "").trim() || null;
  const registryFingerprintSha256 =
    String(registryReceipt.fingerprintSha256 || "").trim() || null;
  const teacherTrusted = Boolean(
    teacher &&
      teacherSource.sold.results.length > 0 &&
      registryReceipt.matched === true &&
      registryIdentityId &&
      registryFingerprintSha256,
  );
  const teacherLearning = teacher
    ? await pushInstaCompTeacherReceipt({
        schemaVersion: "tcos.instacomp.teacher-comp-receipt.v1",
        source: "instacomp",
        scanId: base.scanId ? String(base.scanId) : null,
        registryIdentityId,
        registryFingerprintSha256,
        canonicalIdentity: ai as unknown as Record<string, unknown>,
        studentHypothesis: teacher.studentHypothesis as unknown as Record<string, unknown>,
        teacherConsensus: {
          configuredTeachers: teacher.configuredTeachers,
          requiredVotes: teacher.requiredVotes,
          trusted: teacherTrusted,
          attempts: teacher.attempts,
        },
        acceptedSoldComps: teacherSource.sold.results,
        discoverySoldComps: teacher.discovery.sold,
        discoveryActiveComps: teacher.discovery.active,
        trustedSuggestedPrice: teacherTrusted ? summary.trustedSuggestedPrice : null,
        pricingEligibleSoldCount: teacherTrusted
          ? teacherSource.sold.results.length
          : 0,
        studentMode: true,
        pricingAuthority: false,
        identityTrainingMutationAllowed: false,
        createdAt: new Date().toISOString(),
      })
    : {
        status: "skipped" as const,
        receiptId: null,
        trustedMarketTruth: false,
        studentTrainingEligible: false,
        pricingAuthority: false as const,
        identityTrainingMutated: false as const,
        reason: "No outside teacher run was available to teach InstaComp AI.",
      };

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
    cardUuid,
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
      teacherLearning,
      teacherConsensus: teacher
        ? {
            configuredTeachers: teacher.configuredTeachers,
            requiredVotes: teacher.requiredVotes,
            attempts: teacher.attempts,
          }
        : null,
      discoveryCandidates: {
        sold: [
          ...(teacher?.discovery.sold || []),
          ...openAiSource.sold.results,
        ],
        active: [
          ...(teacher?.discovery.active || []),
          ...openAiSource.active.results,
        ],
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
        teachers: teacher
          ? {
              configuredTeachers: teacher.configuredTeachers,
              requiredVotes: teacher.requiredVotes,
              attempts: teacher.attempts,
              trustedSoldCount: teacher.sold.results.length,
            }
          : {
              configuredTeachers: [],
              requiredVotes: 2,
              attempts: [],
              trustedSoldCount: 0,
              error: teacherFailure,
            },
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
      teacherLearning,
      legacyProviderSummary: (base.providers || []).map((provider) => ({
        label: provider.label,
        status: provider.status,
        results: provider.results.length,
      })),
      durationMs: Date.now() - startedAt,
    },
  });
}
