import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { POST as runIdentityScan } from "../scan/route";
import {
  getExactEbayMarketProviders,
  type EbaySerpItem,
} from "../../../../lib/instacomp-exact-market-provider";
import { getOpenAiExactEbayMarketProviders } from "../../../../lib/instacomp-openai-web-market-provider";
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
  sourceCoverage?: unknown[];
  [key: string]: unknown;
};

type PersistenceResult = {
  status: "saved" | "skipped" | "error";
  message: string;
};

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
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

function settledMessage(value: PromiseSettledResult<unknown>) {
  if (value.status === "fulfilled") return null;
  return value.reason instanceof Error
    ? value.reason.message
    : String(value.reason || "Provider request failed.");
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
  const { error } = await supabase
    .from("instacomp_scans")
    .update({
      search_query: params.query,
      suggested_price: params.suggestedPrice,
      ebay_sold_url: params.soldSearchUrl,
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

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let frontReceived = false;
  let backReceived = false;

  try {
    const inspection = await request.clone().formData();
    frontReceived = inspection.get("frontImage") instanceof File;
    backReceived = inspection.get("backImage") instanceof File;
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

  if (!frontReceived) {
    return json(
      {
        ok: false,
        error: "Upload the front image before running InstaComp.",
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
    getOpenAiExactEbayMarketProviders({
      exactTitle,
      ai,
    }),
  ]);

  const serp =
    serpSettled.status === "fulfilled" ? serpSettled.value : null;
  const openAi =
    openAiSettled.status === "fulfilled" ? openAiSettled.value : null;

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

  const summary = mergeExactMarketSources([serpSource, openAiSource]);
  const exactProviders = [
    serpSource.sold,
    openAiSource.sold,
    serpSource.active,
    openAiSource.active,
  ];
  const soldSearchUrl =
    serp?.sold.searchUrl ||
    openAi?.sold.searchUrl ||
    (base.links?.ebaySoldUrl ? String(base.links.ebaySoldUrl) : null);
  const persistence = await persistExactMarketSummary({
    scanId: base.scanId ? String(base.scanId) : null,
    query: exactTitle,
    suggestedPrice: summary.trustedSuggestedPrice,
    soldSearchUrl,
  });

  const providerMessages = exactProviders
    .map((provider) => ({
      label: provider.label,
      status: provider.status,
      results: provider.results.length,
      message: provider.message || null,
    }))
    .filter((provider) => provider.status !== "live" || provider.message);
  const note = summary.sold.length
    ? `${summary.sold.length} strict exact sold comp${summary.sold.length === 1 ? "" : "s"} support the InstaComp price. ${summary.active.length} exact active listing${summary.active.length === 1 ? "" : "s"} were checked as competition.`
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
      activeCount: summary.active.length,
      trustedSuggestedPrice: summary.trustedSuggestedPrice,
      pricing: summary.pricing,
      sold: summary.sold,
      active: summary.active,
      providerMessages,
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
