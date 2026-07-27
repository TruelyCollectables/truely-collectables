import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { POST as runLiveScan } from "../../live-scan/route";
import {
  ADMIN_SESSION_COOKIE_NAME,
  createAdminSessionValue,
} from "../../../../../lib/admin-session";
import {
  INSTACOMP_EBAY_BENCHMARK_CASES,
  INSTACOMP_EBAY_BENCHMARK_TARGET,
  type InstaCompEbayBenchmarkCase,
  type InstaCompEbayBenchmarkExpectedIdentity,
} from "../../../../../lib/instacomp-ebay-benchmark-cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_EBAY_RESULTS = 50;
const MAX_CANDIDATES_TO_HYDRATE = 12;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

let ebayTokenCache: { token: string; expiresAt: number } | null = null;

type EbayImage = { imageUrl?: string | null };

type EbayItemSummary = {
  itemId?: string;
  legacyItemId?: string;
  title?: string;
  itemWebUrl?: string;
  image?: EbayImage | null;
  additionalImages?: EbayImage[] | null;
  categories?: Array<{ categoryId?: string; categoryName?: string }> | null;
  localizedAspects?: Array<{ name?: string; value?: string }> | null;
};

type ImageRoleSelection = {
  frontIndex: number;
  backIndex: number;
  confidence: number;
  notes: string;
  method: "openai" | "fallback";
};

type FieldCheck = {
  field: string;
  expected: unknown;
  actual: unknown;
  status: "pass" | "partial" | "fail";
  weight: number;
  earned: number;
  note: string | null;
};

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalized(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactCardNumber(value: unknown) {
  return normalized(value).replace(/[^a-z0-9]/g, "");
}

function safeTokenEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function authorizeBenchmark(request: NextRequest) {
  const expected = clean(process.env.INSTACOMP_BENCHMARK_TOKEN);
  const environment = clean(process.env.VERCEL_ENV);
  const authorization = request.headers.get("authorization") || "";
  const supplied = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";

  if (environment !== "preview") {
    return json(
      {
        ok: false,
        error: "The eBay benchmark is disabled outside a Vercel preview deployment.",
      },
      404,
    );
  }

  if (expected.length < 32 || !supplied || !safeTokenEqual(supplied, expected)) {
    return json({ ok: false, error: "Benchmark authorization failed." }, 401);
  }

  return null;
}

function ebayApiBase() {
  return clean(process.env.EBAY_ENVIRONMENT).toLowerCase() === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
}

async function getEbayApplicationToken() {
  if (ebayTokenCache && ebayTokenCache.expiresAt > Date.now() + 60_000) {
    return ebayTokenCache.token;
  }

  const clientId = clean(process.env.EBAY_CLIENT_ID);
  const clientSecret = clean(process.env.EBAY_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    throw new Error("EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are not visible to the preview runtime.");
  }

  const response = await fetch(`${ebayApiBase()}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    throw new Error(
      `eBay application-token request failed (${response.status}): ${clean(payload?.error_description || payload?.error || response.statusText)}`,
    );
  }

  const expiresIn = Math.max(300, Number(payload.expires_in) || 7200);
  ebayTokenCache = {
    token: String(payload.access_token),
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return ebayTokenCache.token;
}

function imageUrls(item: EbayItemSummary) {
  return Array.from(
    new Set(
      [item.image?.imageUrl, ...(item.additionalImages || []).map((image) => image?.imageUrl)]
        .map(clean)
        .filter((url) => /^https?:\/\//i.test(url)),
    ),
  );
}

function rejectedTitle(title: string) {
  return /\b(?:lot|team set|complete set|reprint|custom|digital|nft|break|you pick|choose your card|psa|bgs|sgc|cgc|graded|gem mint)\b/i.test(
    title,
  );
}

function titleScore(title: string, expected: InstaCompEbayBenchmarkExpectedIdentity) {
  const text = normalized(title);
  const playerOptions = [expected.player, ...(expected.playerAliases || [])].map(normalized);
  const playerPass = playerOptions.some((player) => player && text.includes(player));
  const numberPass = text.replace(/[^a-z0-9]/g, "").includes(compactCardNumber(expected.cardNumber));
  const yearPass = text.includes(normalized(expected.year));
  const setOptions = [expected.setName, ...(expected.setAliases || [])].map(normalized);
  const setPass = setOptions.some((setName) => setName && setName.split(" ").every((token) => text.includes(token)));
  const parallelOptions = [expected.parallel, ...(expected.parallelAliases || [])]
    .map(normalized)
    .filter(Boolean);
  const parallelPass =
    !parallelOptions.length ||
    normalized(expected.parallel) === "base" ||
    parallelOptions.some((parallel) => parallel.split(" ").every((token) => text.includes(token)));
  const serialPass =
    !expected.serialDenominator ||
    new RegExp(`(?:/|to\\s*)${expected.serialDenominator}\\b`, "i").test(title);

  return (
    (playerPass ? 40 : 0) +
    (numberPass ? 25 : 0) +
    (yearPass ? 10 : 0) +
    (setPass ? 10 : 0) +
    (parallelPass ? 10 : 0) +
    (serialPass ? 5 : 0)
  );
}

async function searchEbay(testCase: InstaCompEbayBenchmarkCase) {
  const token = await getEbayApplicationToken();
  const url = new URL(`${ebayApiBase()}/buy/browse/v1/item_summary/search`);
  url.searchParams.set("q", testCase.searchQuery);
  url.searchParams.set("category_ids", "261328");
  url.searchParams.set("limit", String(MAX_EBAY_RESULTS));
  url.searchParams.set("fieldgroups", "EXTENDED");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      "X-EBAY-C-ENDUSERCTX": "contextualLocation=country=US,zip=80014",
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `eBay Browse search failed (${response.status}): ${clean(payload?.errors?.[0]?.message || payload?.error || response.statusText)}`,
    );
  }

  const summaries = (Array.isArray(payload?.itemSummaries) ? payload.itemSummaries : []) as EbayItemSummary[];
  const ranked = summaries
    .map((item) => ({
      item,
      title: clean(item.title),
      score: titleScore(clean(item.title), testCase.expected),
    }))
    .filter(({ item, title, score }) => item.itemId && title && !rejectedTitle(title) && score >= 65)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_CANDIDATES_TO_HYDRATE);

  const attempts: Array<Record<string, unknown>> = [];
  for (const candidate of ranked) {
    let item = candidate.item;
    let urls = imageUrls(item);

    if (urls.length < 2 && item.itemId) {
      const detailResponse = await fetch(
        `${ebayApiBase()}/buy/browse/v1/item/${encodeURIComponent(item.itemId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
            "X-EBAY-C-ENDUSERCTX": "contextualLocation=country=US,zip=80014",
          },
          cache: "no-store",
        },
      );
      const detail = await detailResponse.json().catch(() => ({}));
      if (detailResponse.ok) {
        item = { ...item, ...detail };
        urls = imageUrls(item);
      }
    }

    attempts.push({
      itemId: item.itemId || null,
      title: clean(item.title),
      titleScore: candidate.score,
      imageCount: urls.length,
    });

    if (urls.length >= 2) {
      return { item, urls: urls.slice(0, 6), attempts, rawCount: summaries.length };
    }
  }

  return { item: null, urls: [] as string[], attempts, rawCount: summaries.length };
}

function outputText(payload: any) {
  return (Array.isArray(payload?.choices) ? payload.choices : [])
    .map((choice: any) => clean(choice?.message?.content))
    .filter(Boolean)
    .join("\n");
}

async function selectImageRoles(urls: string[]): Promise<ImageRoleSelection> {
  const fallback: ImageRoleSelection = {
    frontIndex: 0,
    backIndex: 1,
    confidence: 0,
    notes: "OpenAI image-role selection was unavailable; used eBay primary image then first additional image.",
    method: "fallback",
  };
  const apiKey = clean(process.env.OPENAI_API_KEY);
  if (!apiKey || urls.length < 2) return fallback;

  const content: any[] = [
    {
      type: "text",
      text: "Select one clear FRONT and one clear BACK image of the same physical sports card from these eBay listing images. Do not select duplicate fronts, closeups, shipping photos, slabs, or unrelated bonus cards. Return zero-based indices. Use null only when no defensible pair exists.",
    },
  ];
  urls.slice(0, 6).forEach((url, index) => {
    content.push({ type: "text", text: `IMAGE INDEX ${index}` });
    content.push({ type: "image_url", image_url: { url, detail: "low" } });
  });

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: clean(process.env.INSTACOMP_OPENAI_FALLBACK_MODEL) || "gpt-4.1-mini",
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "ebay_card_image_roles",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                frontIndex: { type: ["integer", "null"] },
                backIndex: { type: ["integer", "null"] },
                confidence: { type: "number" },
                notes: { type: "string" },
              },
              required: ["frontIndex", "backIndex", "confidence", "notes"],
            },
          },
        },
        messages: [{ role: "user", content }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return fallback;
    const parsed = JSON.parse(outputText(payload));
    const frontIndex = Number(parsed.frontIndex);
    const backIndex = Number(parsed.backIndex);
    const confidence = Number(parsed.confidence);
    if (
      !Number.isInteger(frontIndex) ||
      !Number.isInteger(backIndex) ||
      frontIndex < 0 ||
      backIndex < 0 ||
      frontIndex >= urls.length ||
      backIndex >= urls.length ||
      frontIndex === backIndex
    ) {
      return fallback;
    }
    return {
      frontIndex,
      backIndex,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
      notes: clean(parsed.notes),
      method: "openai",
    };
  } catch {
    return fallback;
  }
}

async function downloadImage(url: string, fileName: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "TCOS-InstaComp-Benchmark/1.0" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Could not download ${fileName} (${response.status}).`);
  }
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`${fileName} was empty or exceeded 12 MB.`);
  }
  const reportedType = clean(response.headers.get("content-type")).split(";")[0].toLowerCase();
  const inferredType = /\.png(?:\?|$)/i.test(url)
    ? "image/png"
    : /\.webp(?:\?|$)/i.test(url)
      ? "image/webp"
      : "image/jpeg";
  const type = ALLOWED_IMAGE_TYPES.has(reportedType) ? reportedType : inferredType;
  return new File([bytes], fileName, { type });
}

function phrasePass(actual: unknown, options: Array<string | null | undefined>) {
  const text = normalized(actual);
  return options
    .map(normalized)
    .filter(Boolean)
    .some((option) => option === text || text.includes(option) || option.includes(text));
}

function tokenPhrasePass(actual: unknown, options: Array<string | null | undefined>) {
  const text = normalized(actual);
  return options
    .map(normalized)
    .filter(Boolean)
    .some((option) => option.split(" ").every((token) => text.includes(token)));
}

function serialDenominator(value: unknown) {
  const matches = Array.from(clean(value).matchAll(/\/\s*(\d{1,6})\b/g));
  const last = matches.at(-1)?.[1];
  return last ? Number(last) : null;
}

function check(params: {
  field: string;
  expected: unknown;
  actual: unknown;
  pass: boolean;
  partial?: boolean;
  weight: number;
  note?: string | null;
}): FieldCheck {
  const status = params.pass ? "pass" : params.partial ? "partial" : "fail";
  return {
    field: params.field,
    expected: params.expected,
    actual: params.actual,
    status,
    weight: params.weight,
    earned: params.pass ? params.weight : params.partial ? params.weight / 2 : 0,
    note: params.note || null,
  };
}

function gradeScan(
  testCase: InstaCompEbayBenchmarkCase,
  scan: any,
  imageRoles: ImageRoleSelection,
  sellerTitle: string,
) {
  const expected = testCase.expected;
  const ai = scan?.ai || {};
  const actualIdentityText = [ai.setName, ai.parallel, ai.notes].filter(Boolean).join(" ");
  const expectedPlayerOptions = [expected.player, ...(expected.playerAliases || [])];
  const expectedSetOptions = [expected.setName, ...(expected.setAliases || [])];
  const expectedParallelOptions = [expected.parallel, ...(expected.parallelAliases || [])];
  const expectedBase = normalized(expected.parallel) === "base" || !normalized(expected.parallel);
  const actualParallelText = normalized([ai.parallel, ai.setName].filter(Boolean).join(" "));
  const baseParallelPass =
    expectedBase &&
    (!normalized(ai.parallel) ||
      ["base", "base card", "standard", "regular", "young guns", "city satellites", "gaming xp", "checkpoint", "gaming pvp"].includes(
        normalized(ai.parallel),
      ));

  const checks: FieldCheck[] = [
    check({
      field: "player",
      expected: expected.player,
      actual: ai.player,
      pass: phrasePass(ai.player, expectedPlayerOptions),
      weight: 20,
    }),
    check({
      field: "year",
      expected: expected.year,
      actual: ai.year,
      pass: normalized(ai.year) === normalized(expected.year),
      partial: normalized(ai.year).includes("2024") && normalized(expected.year).includes("2024"),
      weight: 10,
    }),
    check({
      field: "manufacturer",
      expected: expected.brand,
      actual: ai.brand,
      pass: phrasePass(ai.brand, [expected.brand]),
      weight: 8,
    }),
    check({
      field: "product/set",
      expected: `${expected.product} — ${expected.setName}`,
      actual: ai.setName,
      pass: tokenPhrasePass(actualIdentityText, expectedSetOptions),
      partial: tokenPhrasePass(actualIdentityText, [expected.product]),
      weight: 15,
    }),
    check({
      field: "card number",
      expected: expected.cardNumber,
      actual: ai.cardNumber,
      pass: compactCardNumber(ai.cardNumber) === compactCardNumber(expected.cardNumber),
      weight: 15,
    }),
    check({
      field: "parallel/variation",
      expected: expected.parallel || "Base",
      actual: ai.parallel,
      pass:
        baseParallelPass ||
        tokenPhrasePass(actualParallelText, expectedParallelOptions) ||
        tokenPhrasePass(actualIdentityText, expectedParallelOptions),
      partial: expectedBase && !normalized(ai.parallel),
      weight: 14,
    }),
    check({
      field: "serial denominator",
      expected: expected.serialDenominator,
      actual: ai.serialNumber,
      pass:
        expected.serialDenominator === null
          ? serialDenominator(ai.serialNumber) === null
          : serialDenominator(ai.serialNumber) === expected.serialDenominator,
      weight: 5,
    }),
    check({
      field: "rookie",
      expected: expected.isRookie,
      actual: Boolean(ai.isRookie),
      pass: Boolean(ai.isRookie) === expected.isRookie,
      weight: 4,
    }),
    check({
      field: "autograph",
      expected: expected.isAuto,
      actual: Boolean(ai.isAuto),
      pass: Boolean(ai.isAuto) === expected.isAuto,
      weight: 2,
    }),
    check({
      field: "relic",
      expected: expected.isRelic,
      actual: Boolean(ai.isRelic),
      pass: Boolean(ai.isRelic) === expected.isRelic,
      weight: 2,
    }),
    check({
      field: "team",
      expected: expected.team,
      actual: ai.team,
      pass: !expected.team || phrasePass(ai.team, [expected.team]),
      partial: Boolean(expected.team && normalized(ai.team).split(" ").some((token: string) => normalized(expected.team).includes(token))),
      weight: 2,
    }),
    check({
      field: "sport",
      expected: expected.sport,
      actual: ai.sport,
      pass: phrasePass(ai.sport, [expected.sport, "Ice Hockey"]),
      weight: 3,
    }),
  ];

  const score = Math.round(checks.reduce((sum, item) => sum + item.earned, 0) * 10) / 10;
  const weirdErrors: Array<{ code: string; severity: "critical" | "major" | "minor"; detail: string }> = [];
  const codeByField: Record<string, string> = {
    player: "PLAYER_MISMATCH",
    year: "YEAR_MISMATCH",
    manufacturer: "MANUFACTURER_MISMATCH",
    "product/set": "PRODUCT_SET_MISMATCH",
    "card number": "CARD_NUMBER_MISMATCH",
    "parallel/variation": "PARALLEL_VARIATION_MISMATCH",
    "serial denominator": "SERIAL_DENOMINATOR_MISMATCH",
    rookie: "ROOKIE_FLAG_MISMATCH",
    autograph: "AUTOGRAPH_FLAG_MISMATCH",
    relic: "RELIC_FLAG_MISMATCH",
    team: "TEAM_MISMATCH",
    sport: "SPORT_MISMATCH",
  };
  for (const fieldCheck of checks) {
    if (fieldCheck.status === "fail") {
      weirdErrors.push({
        code: codeByField[fieldCheck.field] || "IDENTITY_FIELD_MISMATCH",
        severity: ["player", "product/set", "card number", "parallel/variation", "serial denominator"].includes(
          fieldCheck.field,
        )
          ? "critical"
          : "major",
        detail: `${fieldCheck.field}: expected ${clean(fieldCheck.expected) || "none"}; got ${clean(fieldCheck.actual) || "none"}.`,
      });
    } else if (fieldCheck.status === "partial") {
      weirdErrors.push({
        code: `${codeByField[fieldCheck.field] || "IDENTITY_FIELD"}_PARTIAL`,
        severity: "minor",
        detail: `${fieldCheck.field} was only a partial match.`,
      });
    }
  }

  const catalogEvidence = scan?.catalogEvidence || null;
  if (!catalogEvidence) {
    weirdErrors.push({
      code: "TCOS_CHECKLIST_REGISTRY_COVERAGE_GAP",
      severity: "major",
      detail: "The official manufacturer checklist has this card, but the current TCOS curated checklist returned no catalog evidence.",
    });
  } else if (!catalogEvidence?.selectedMatch && !catalogEvidence?.compIdentity) {
    weirdErrors.push({
      code: "TCOS_CHECKLIST_REGISTRY_UNCONFIRMED",
      severity: "major",
      detail: `TCOS catalog status was ${clean(catalogEvidence?.status) || "unknown"} without a selected identity.`,
    });
  }

  const confidence = Number(ai.confidence);
  if (!Number.isFinite(confidence) || confidence < 0.85) {
    weirdErrors.push({
      code: "LOW_IDENTITY_CONFIDENCE",
      severity: confidence < 0.65 ? "major" : "minor",
      detail: `Identity confidence was ${Number.isFinite(confidence) ? Math.round(confidence * 100) : 0}%.`,
    });
  }

  if (imageRoles.method === "fallback" || imageRoles.confidence < 0.7) {
    weirdErrors.push({
      code: "FRONT_BACK_PAIRING_UNCERTAIN",
      severity: "minor",
      detail: imageRoles.notes,
    });
  }

  if (scan?.exactMarket?.status === "provider_error") {
    weirdErrors.push({
      code: "EXACT_MARKET_PROVIDER_ERROR",
      severity: "major",
      detail: "One or more exact sold/active providers failed during the real scan.",
    });
  } else if (!Number(scan?.exactMarket?.soldCount || 0)) {
    weirdErrors.push({
      code: "ZERO_STRICT_EXACT_SOLD_COMPS",
      severity: "minor",
      detail: "No strict exact sold comp passed verification; InstaComp correctly withheld a trusted price.",
    });
  }

  if (scan?.exactMarket?.trustedSuggestedPrice && !Number(scan?.exactMarket?.soldCount || 0)) {
    weirdErrors.push({
      code: "UNSUPPORTED_PRICE_CREATED",
      severity: "critical",
      detail: "A trusted price was returned without a strict exact sold comp.",
    });
  }

  if (scan?.pipelineDiagnostics?.simulated) {
    weirdErrors.push({
      code: "SIMULATED_RESULT_LEAKED_INTO_LIVE_BENCHMARK",
      severity: "critical",
      detail: "The live benchmark received a simulated result.",
    });
  }

  const sellerTitleExpectedScore = titleScore(sellerTitle, expected);
  if (sellerTitleExpectedScore < 80) {
    weirdErrors.push({
      code: "SELLER_TITLE_WEAK_OR_MISLABELED",
      severity: "minor",
      detail: `The selected eBay title scored ${sellerTitleExpectedScore}/100 against official checklist ground truth.`,
    });
  }

  return {
    score,
    pass: score >= 94 && !weirdErrors.some((error) => error.severity === "critical"),
    targetScore: 94,
    fieldChecks: checks,
    weirdErrors,
    criticalErrorCount: weirdErrors.filter((error) => error.severity === "critical").length,
    majorErrorCount: weirdErrors.filter((error) => error.severity === "major").length,
    minorErrorCount: weirdErrors.filter((error) => error.severity === "minor").length,
  };
}

async function cleanupBenchmarkScan(scanId: unknown) {
  const id = clean(scanId);
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!id) return { status: "skipped", message: "No saved scan ID was returned." };
  if (!url || !key) return { status: "error", message: "Supabase service-role cleanup is not configured." };

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.from("instacomp_scans").delete().eq("id", id);
  return error
    ? { status: "error", message: error.message }
    : { status: "deleted", message: "Benchmark scan row removed after grading." };
}

export async function GET(request: NextRequest) {
  const blocked = authorizeBenchmark(request);
  if (blocked) return blocked;

  return json({
    ok: true,
    target: INSTACOMP_EBAY_BENCHMARK_TARGET,
    poolSize: INSTACOMP_EBAY_BENCHMARK_CASES.length,
    cases: INSTACOMP_EBAY_BENCHMARK_CASES.map((testCase) => ({
      id: testCase.id,
      searchQuery: testCase.searchQuery,
      catalogSourceLabel: testCase.catalogSourceLabel,
      catalogSourceUrl: testCase.catalogSourceUrl,
      expected: testCase.expected,
    })),
  });
}

export async function POST(request: NextRequest) {
  const blocked = authorizeBenchmark(request);
  if (blocked) return blocked;

  const startedAt = Date.now();
  const body = await request.json().catch(() => ({}));
  const caseId = clean(body?.caseId);
  const testCase = INSTACOMP_EBAY_BENCHMARK_CASES.find((candidate) => candidate.id === caseId);
  if (!testCase) return json({ ok: false, error: "Unknown benchmark case." }, 400);

  try {
    const discovery = await searchEbay(testCase);
    if (!discovery.item || discovery.urls.length < 2) {
      return json(
        {
          ok: false,
          status: "discovery_failed",
          caseId,
          expected: testCase.expected,
          catalogSourceLabel: testCase.catalogSourceLabel,
          catalogSourceUrl: testCase.catalogSourceUrl,
          eBay: {
            rawResultCount: discovery.rawCount,
            attempts: discovery.attempts,
          },
          error: "No defensible active eBay listing with at least two images was found for this official checklist case.",
          durationMs: Date.now() - startedAt,
        },
        422,
      );
    }

    const roles = await selectImageRoles(discovery.urls);
    const frontUrl = discovery.urls[roles.frontIndex];
    const backUrl = discovery.urls[roles.backIndex];
    const [frontFile, backFile] = await Promise.all([
      downloadImage(frontUrl, `${caseId}-front.jpg`),
      downloadImage(backUrl, `${caseId}-back.jpg`),
    ]);

    const formData = new FormData();
    formData.append("frontImage", frontFile);
    formData.append("backImage", backFile);
    formData.append("aiCouncilTier", "adaptive");

    const adminSession = await createAdminSessionValue();
    const scanRequest = new NextRequest("https://instacomp-benchmark.local/api/instacomp/live-scan", {
      method: "POST",
      headers: {
        cookie: `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(adminSession)}`,
        "x-forwarded-for": "127.0.0.1",
      },
      body: formData,
    });
    const scanResponse = await runLiveScan(scanRequest);
    const scan = await scanResponse.json().catch(() => ({}));
    const sellerTitle = clean(discovery.item.title);

    if (!scanResponse.ok || !scan?.ok) {
      return json(
        {
          ok: false,
          status: "scan_failed",
          caseId,
          expected: testCase.expected,
          catalogSourceLabel: testCase.catalogSourceLabel,
          catalogSourceUrl: testCase.catalogSourceUrl,
          eBay: {
            itemId: discovery.item.itemId || null,
            legacyItemId: discovery.item.legacyItemId || null,
            title: sellerTitle,
            url: discovery.item.itemWebUrl || null,
            images: discovery.urls,
            frontImageUrl: frontUrl,
            backImageUrl: backUrl,
            imageRoles: roles,
            attempts: discovery.attempts,
          },
          scan,
          error: scan?.error || "Live InstaComp scan failed.",
          durationMs: Date.now() - startedAt,
        },
        scanResponse.status || 500,
      );
    }

    const grade = gradeScan(testCase, scan, roles, sellerTitle);
    const cleanup = await cleanupBenchmarkScan(scan.scanId);
    if (cleanup.status === "error") {
      grade.weirdErrors.push({
        code: "BENCHMARK_SCAN_CLEANUP_FAILED",
        severity: "minor",
        detail: cleanup.message,
      });
      grade.minorErrorCount += 1;
    }

    return json({
      ok: true,
      status: "completed",
      caseId,
      expected: testCase.expected,
      catalogSourceLabel: testCase.catalogSourceLabel,
      catalogSourceUrl: testCase.catalogSourceUrl,
      eBay: {
        itemId: discovery.item.itemId || null,
        legacyItemId: discovery.item.legacyItemId || null,
        title: sellerTitle,
        url: discovery.item.itemWebUrl || null,
        categories: discovery.item.categories || [],
        localizedAspects: discovery.item.localizedAspects || [],
        images: discovery.urls,
        frontImageUrl: frontUrl,
        backImageUrl: backUrl,
        imageRoles: roles,
        titleScore: titleScore(sellerTitle, testCase.expected),
        attempts: discovery.attempts,
      },
      scan: {
        scanId: scan.scanId || null,
        ai: scan.ai || null,
        review: scan.review || null,
        consensus: scan.consensus || null,
        catalogEvidence: scan.catalogEvidence || null,
        exactMarket: scan.exactMarket || null,
        pipelineDiagnostics: scan.pipelineDiagnostics || null,
        ocrDiagnostics: scan.ocrDiagnostics || null,
        note: scan.note || null,
      },
      grade,
      cleanup,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        status: "benchmark_error",
        caseId,
        expected: testCase.expected,
        catalogSourceLabel: testCase.catalogSourceLabel,
        catalogSourceUrl: testCase.catalogSourceUrl,
        error: error instanceof Error ? error.message : "Unknown benchmark error.",
        durationMs: Date.now() - startedAt,
      },
      500,
    );
  }
}
