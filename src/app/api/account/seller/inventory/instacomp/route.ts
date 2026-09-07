import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import {
  buildCompLinks,
  buildInstaCompQueries,
  type InstaCompAiResult,
} from "../../../../../../lib/instacomp";
import { verifyInstaCompCompetitionImages } from "../../../../../../lib/instacomp-comp-visual-verification";
import { getOpenAiExactEbayMarketProviders } from "../../../../../../lib/instacomp-openai-web-market-provider";
import { getTeacherExactMarketProviders } from "../../../../../../lib/instacomp-teacher-market-provider";
import { getFanaticsExactSoldProvider } from "../../../../../../lib/instacomp-fanatics-sold-provider";
import { calculateInstaCompSweetSpot } from "../../../../../../lib/instacomp-sweet-spot";
import {
  assertSafeInstaCompRemoteImageUrl,
  sanitizeInstaCompProviderError,
} from "../../../../../../lib/instacomp-provider-safety";
import { normalizeListingImageUrls } from "../../../../../../lib/listing-image-utils";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";
import {
  getConfiguredInstaCompMacKey,
  getConfiguredInstaCompMacUrl,
  isTrustedInstaCompMacUrl,
} from "../../../../../../lib/instacomp-mac-credentials";
import { POST as runInstaCompScan } from "../../../../instacomp/scan/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_SOURCE_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_SCAN_BYTES = 18 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type Evidence = {
  title: string;
  price: number;
  itemPrice: number | null;
  shippingPrice: number | null;
  priceIncludesShipping: boolean;
  currency: string;
  url: string;
  imageUrl: string | null;
  source: string;
  sourceLabel: string;
  sourceCategory: string;
  matchScore: number | null;
  flags: string[];
  soldAt: string | null;
  listedAt: string | null;
  observedAt: string | null;
};

function recordValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || "").trim()).filter(Boolean).slice(0, 250)
    : [];
}

function hasUsableStoredIdentity(ai: Record<string, unknown>) {
  return Boolean(
    String(ai.player || "").trim() &&
      String(ai.year || "").trim() &&
      String(ai.setName || ai.brand || "").trim() &&
      String(ai.cardNumber || "").trim(),
  );
}

function imageType(bytes: ArrayBuffer) {
  const view = new Uint8Array(bytes);
  if (view.length >= 3 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    view.length >= 8 &&
    view[0] === 0x89 &&
    view[1] === 0x50 &&
    view[2] === 0x4e &&
    view[3] === 0x47 &&
    view[4] === 0x0d &&
    view[5] === 0x0a &&
    view[6] === 0x1a &&
    view[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    view.length >= 12 &&
    String.fromCharCode(...view.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...view.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function imageExtension(type: string) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

async function downloadImage(url: string, index: number) {
  const safeUrl = assertSafeInstaCompRemoteImageUrl(url);
  const response = await fetch(safeUrl, {
    redirect: "manual",
    signal: AbortSignal.timeout(25_000),
    headers: { "User-Agent": "TCOS-InstaComp-ExactMarket/1.0" },
  });
  if (!response.ok) throw new Error(`Image ${index + 1} returned HTTP ${response.status}.`);
  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(`Image ${index + 1} is larger than 12MB.`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(`Image ${index + 1} is empty or larger than 12MB.`);
  }
  const type = imageType(bytes);
  if (!type || !ALLOWED_IMAGE_TYPES.has(type)) {
    throw new Error(`Image ${index + 1} was not a real JPEG, PNG, or WebP image.`);
  }
  return new File([bytes], `inventory-${index + 1}.${imageExtension(type)}`, { type });
}

function normalizedEvidence(value: unknown): Evidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const price = Number(row.price);
  const url = typeof row.url === "string" ? row.url.trim() : "";
  if (!Number.isFinite(price) || price <= 0 || !url) return null;
  return {
    title: typeof row.title === "string" ? row.title : "Untitled listing",
    price: Math.round(price * 100) / 100,
    itemPrice:
      Number.isFinite(Number(row.itemPrice)) && Number(row.itemPrice) > 0
        ? Math.round(Number(row.itemPrice) * 100) / 100
        : null,
    shippingPrice:
      Number.isFinite(Number(row.shippingPrice)) && Number(row.shippingPrice) >= 0
        ? Math.round(Number(row.shippingPrice) * 100) / 100
        : null,
    priceIncludesShipping: row.priceIncludesShipping === true,
    currency: typeof row.currency === "string" ? row.currency : "USD",
    url,
    imageUrl: typeof row.imageUrl === "string" ? row.imageUrl : null,
    source: typeof row.source === "string" ? row.source : "unknown",
    sourceLabel: typeof row.sourceLabel === "string" ? row.sourceLabel : "Unknown source",
    sourceCategory: typeof row.sourceCategory === "string" ? row.sourceCategory : "broad",
    matchScore: Number.isFinite(Number(row.matchScore)) ? Number(row.matchScore) : null,
    flags: Array.isArray(row.flags) ? row.flags.map((flag) => String(flag)).slice(0, 20) : [],
    soldAt: typeof row.soldAt === "string" ? row.soldAt : null,
    listedAt: typeof row.listedAt === "string" ? row.listedAt : null,
    observedAt: typeof row.observedAt === "string" ? row.observedAt : null,
  };
}

function evidenceList(value: unknown, limit = 50) {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizedEvidence)
    .filter((row): row is Evidence => Boolean(row))
    .slice(0, limit);
}

function dedupeEvidence(values: Evidence[], limit: number) {
  const seen = new Set<string>();
  return values
    .filter((row) => {
      if (seen.has(row.url)) return false;
      seen.add(row.url);
      return true;
    })
    .slice(0, limit);
}

function isExcludedEvidence(row: Evidence) {
  return row.flags.some((flag) =>
    /excluded|guidance comp|parallel mismatch|not exact parallel|visual mismatch|inconclusive|unavailable/i.test(
      flag,
    ),
  );
}

function isPricingEligibleEvidence(row: Evidence, lane: "sold" | "active") {
  if (
    row.sourceCategory === "reference" ||
    row.source.toLowerCase().startsWith("openai_web_") ||
    row.flags.some((flag) =>
      /not independently verified for pricing|discovery(?: only| candidate)?|not used for pricing/i.test(
        flag,
      ),
    )
  ) {
    return false;
  }
  if (!row.priceIncludesShipping) return false;
  if (!Number.isFinite(row.itemPrice) || Number(row.itemPrice) <= 0) return false;
  if (!Number.isFinite(row.shippingPrice) || Number(row.shippingPrice) < 0) return false;
  if (lane === "sold" && !row.soldAt) return false;
  return true;
}

function forceImageVerification(values: Evidence[]) {
  return values.map((row) => ({
    ...row,
    flags: Array.from(new Set([...row.flags, "guidance comp", "strict exact title awaiting image proof"])).slice(
      0,
      20,
    ),
  }));
}

type MacMarketResult = {
  status: "ready" | "failed" | "not_configured";
  sold: Evidence[];
  active: Evidence[];
  rejected: Array<Record<string, any>>;
  providerCoverage: Array<Record<string, any>>;
  query: string | null;
  learning: Record<string, any> | null;
  error: string | null;
};

async function requestMacExactMarket(params: {
  exactTitle: string;
  ai: InstaCompAiResult;
  scanId: string | null;
  registryIdentityId: string | null;
  registryFingerprintSha256: string | null;
  operatorCertifiedIdentity: boolean;
  researchId: string;
}): Promise<MacMarketResult> {
  const baseUrl = getConfiguredInstaCompMacUrl();
  const key = getConfiguredInstaCompMacKey();
  if (!baseUrl || !key || !isTrustedInstaCompMacUrl(baseUrl)) {
    return {
      status: "not_configured",
      sold: [],
      active: [],
      rejected: [],
      providerCoverage: [],
      query: null,
      learning: null,
      error: "The authenticated InstaComp Mac market bridge is not configured.",
    };
  }
  try {
    const aiRecord = params.ai as InstaCompAiResult & Record<string, unknown>;
    const response = await fetch(`${baseUrl}/v1/market-comp/search`, {
      method: "POST",
      headers: {
        "X-InstaComp-AI-Key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        exact_title: params.exactTitle,
        identity: {
          player: params.ai.player,
          year: params.ai.year,
          manufacturer: aiRecord.manufacturer,
          brand: params.ai.brand,
          product: aiRecord.product || params.ai.setName,
          setName: params.ai.setName,
          cardNumber: params.ai.cardNumber,
          parallel: params.ai.parallel,
          serialNumber: params.ai.serialNumber,
          serialRun: aiRecord.serialRun,
          gradingCompany: params.ai.gradingCompany,
          gradeValue: params.ai.gradeValue,
          isAuto: params.ai.isAuto,
          isRelic: params.ai.isRelic,
        },
        scan_id: params.scanId,
        registry_identity_id: params.registryIdentityId,
        registry_fingerprint_sha256: params.registryFingerprintSha256,
        research_id: params.researchId,
        operator_certified_identity: params.operatorCertifiedIdentity,
        max_sold: 50,
        max_active: 30,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(190_000),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
    if (!response.ok || payload.ok !== true) {
      return {
        status: "failed",
        sold: [],
        active: [],
        rejected: Array.isArray(payload.rejected) ? payload.rejected : [],
        providerCoverage: Array.isArray(payload.providerCoverage) ? payload.providerCoverage : [],
        query: typeof payload.query === "string" ? payload.query : null,
        learning: payload.learning && typeof payload.learning === "object" ? payload.learning : null,
        error: sanitizeInstaCompProviderError(
          String(payload.detail || payload.error || `Mac market search HTTP ${response.status}`),
        ),
      };
    }
    return {
      status: "ready",
      sold: evidenceList(payload.sold, 50),
      active: evidenceList(payload.active, 30),
      rejected: Array.isArray(payload.rejected) ? payload.rejected : [],
      providerCoverage: Array.isArray(payload.providerCoverage) ? payload.providerCoverage : [],
      query: typeof payload.query === "string" ? payload.query : null,
      learning: payload.learning && typeof payload.learning === "object" ? payload.learning : null,
      error: null,
    };
  } catch (error) {
    return {
      status: "failed",
      sold: [],
      active: [],
      rejected: [],
      providerCoverage: [],
      query: null,
      learning: null,
      error: sanitizeInstaCompProviderError(error instanceof Error ? error.message : String(error)),
    };
  }
}

function competitiveStats(values: Evidence[]) {
  const totals = values
    .map((row) => Number(row.price))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!totals.length) return { low: null, median: null };
  const middle = Math.floor(totals.length / 2);
  const median = totals.length % 2
    ? totals[middle]
    : (totals[middle - 1] + totals[middle]) / 2;
  return {
    low: Math.round(totals[0] * 100) / 100,
    median: Math.round(median * 100) / 100,
  };
}

async function persistMacMarketLearning(params: {
  exactTitle: string;
  ai: InstaCompAiResult;
  scanId: string | null;
  registryIdentityId: string | null;
  registryFingerprintSha256: string | null;
  operatorCertifiedIdentity: boolean;
  localDeterministicMarketTruth: boolean;
  researchId: string;
  acceptedSold: Evidence[];
  acceptedActive: Evidence[];
  rejected: Array<Record<string, any>>;
  suggestedPrice: number;
}) {
  const baseUrl = getConfiguredInstaCompMacUrl();
  const key = getConfiguredInstaCompMacKey();
  if (!baseUrl || !key || !isTrustedInstaCompMacUrl(baseUrl)) {
    return { status: "not_configured", student_training_eligible: false };
  }
  const aiRecord = params.ai as InstaCompAiResult & Record<string, unknown>;
  const competitive = competitiveStats(params.acceptedActive);
  try {
    const response = await fetch(`${baseUrl}/v1/training/exact-market-history`, {
      method: "POST",
      headers: {
        "X-InstaComp-AI-Key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        schemaVersion: "tcos.instacomp.teacher-comp-receipt.v1",
        source: "kingmaker_mac_exact_market_final",
        sourceAuthority: "mac_local_browser_and_direct_market_feeds",
        localDeterministicMarketTruth: params.localDeterministicMarketTruth,
        operatorCertifiedIdentity: params.operatorCertifiedIdentity,
        scanId: params.scanId,
        researchId: params.researchId,
        registryIdentityId: params.registryIdentityId,
        registryFingerprintSha256: params.registryFingerprintSha256,
        canonicalIdentity: {
          player: params.ai.player,
          year: params.ai.year,
          brand: params.ai.brand,
          setName: params.ai.setName,
          cardNumber: params.ai.cardNumber,
          parallel: params.ai.parallel,
          serialNumber: params.ai.serialNumber,
          gradingCompany: params.ai.gradingCompany,
          gradeValue: params.ai.gradeValue,
          isRookie: params.ai.isRookie,
          isAuto: params.ai.isAuto,
          isRelic: params.ai.isRelic,
          manufacturer: aiRecord.manufacturer || null,
          product: aiRecord.product || null,
        },
        teacherConsensus: {
          configuredTeachers: ["mac_deterministic_exact_gate", "human_certified_identity"],
          requiredVotes: 2,
          trusted: params.operatorCertifiedIdentity,
        },
        acceptedSoldComps: params.acceptedSold,
        discoverySoldComps: params.acceptedSold,
        acceptedActiveComps: params.acceptedActive,
        discoveryActiveComps: params.acceptedActive,
        rejectedMarketCandidates: params.rejected,
        trustedSuggestedPrice: params.suggestedPrice,
        pricingEligibleSoldCount: params.acceptedSold.length,
        competitiveActiveLow: competitive.low,
        competitiveActiveMedian: competitive.median,
        decision: "INSTACOMP_PRICE",
        decisionRecord: {
          decision: "INSTACOMP_PRICE",
          price: params.suggestedPrice,
          activeLow: competitive.low,
          activeMedian: competitive.median,
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
    return response.ok
      ? payload
      : { status: "failed", student_training_eligible: false, error: sanitizeInstaCompProviderError(String(payload.detail || payload.error || `Mac learning HTTP ${response.status}`)) };
  } catch (error) {
    return {
      status: "failed",
      student_training_eligible: false,
      error: sanitizeInstaCompProviderError(error instanceof Error ? error.message : String(error)),
    };
  }
}


function providerCoverageRow(provider: {
  source: string;
  label: string;
  status: string;
  message: string | null;
  results: unknown[];
  searchUrl?: string;
  attempts?: unknown[];
}) {
  return {
    source: provider.source,
    label: provider.label,
    status: provider.status,
    resultCount: provider.results.length,
    message: provider.message,
    searchUrl: provider.searchUrl || null,
    attempts: Array.isArray(provider.attempts) ? provider.attempts : [],
  };
}

async function scanIdentity(params: {
  request: NextRequest;
  files: File[];
  aiCouncilTier: string;
}) {
  const formData = new FormData();
  formData.set("frontImage", params.files[0]);
  if (params.files[1]) formData.set("backImage", params.files[1]);
  for (const detail of params.files.slice(2, 8)) formData.append("detailImages", detail);
  formData.set("aiCouncilTier", params.aiCouncilTier);
  const authorization = params.request.headers.get("authorization") || "";
  const scanRequest = new NextRequest("http://localhost/api/instacomp/scan", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
    body: formData,
  });
  const response = await runInstaCompScan(scanRequest);
  const text = await response.text();
  let scan: any;
  try {
    scan = JSON.parse(text);
  } catch {
    throw new Error(`InstaComp returned an unreadable response: ${text.slice(0, 300)}`);
  }
  if (!response.ok || scan?.ok !== true || !scan?.ai) {
    throw new Error(scan?.error || "InstaComp could not identify this inventory item.");
  }
  return scan;
}

export async function POST(request: NextRequest) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const body = await request.json().catch(() => ({}));
    const inventoryItemId = String(body?.inventoryItemId || "").trim();
    if (!inventoryItemId) {
      return NextResponse.json({ error: "Choose a seller inventory item to scan." }, { status: 400 });
    }

    const scanStartedAt = Date.now();
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isStoreOwnerAccount =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    let itemQuery = supabase
      .from("inventory_items")
      .select("id,legacy_product_id,seller_account_id,sku,title,status,quantity,price,metadata")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId);
    itemQuery = isStoreOwnerAccount
      ? itemQuery.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : itemQuery.eq("seller_account_id", account.id);
    const { data: item, error: itemError } = await itemQuery.maybeSingle();
    if (itemError) throw itemError;
    if (!item) return NextResponse.json({ error: "Seller inventory item was not found." }, { status: 404 });

    const [{ data: product, error: productError }, { data: imageRows, error: imageError }] =
      await Promise.all([
        item.legacy_product_id
          ? supabase
              .from("products")
              .select("id,image_url")
              .eq("id", item.legacy_product_id)
              .eq("store_id", storeId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from("inventory_images")
          .select("image_url,sort_order,is_primary")
          .eq("inventory_item_id", item.id)
          .order("sort_order", { ascending: true }),
      ]);
    if (productError) throw productError;
    if (imageError) throw imageError;

    let metadata = recordValue(item.metadata);
    let currentInstaComp = recordValue(metadata.instacomp);
    const storedAi = recordValue(currentInstaComp.ai);
    const trustedStoredIdentity =
      currentInstaComp.humanVerified === true || currentInstaComp.trustedForIdentity === true;
    const useStoredIdentity =
      body?.forceIdentityRescan !== true && trustedStoredIdentity && hasUsableStoredIdentity(storedAi);

    const sourceUrls = normalizeListingImageUrls([
      ...(imageRows || []).map((row: any) => row.image_url),
      product?.image_url,
      ...(Array.isArray(metadata.ebay_image_urls) ? metadata.ebay_image_urls : []),
    ]);
    if (!sourceUrls.length) {
      return NextResponse.json({ error: "This inventory item has no usable card images." }, { status: 409 });
    }

    const files: File[] = [];
    let totalBytes = 0;
    const imageLimit = useStoredIdentity ? 2 : 8;
    for (const [index, url] of sourceUrls.slice(0, imageLimit).entries()) {
      try {
        const file = await downloadImage(url, index);
        if (totalBytes + file.size > MAX_TOTAL_SCAN_BYTES) break;
        files.push(file);
        totalBytes += file.size;
      } catch (error) {
        if (index === 0) throw error;
      }
    }
    if (!files.length) throw new Error("The primary card image could not be downloaded.");

    let ai: InstaCompAiResult;
    let scanId: string | null = String(currentInstaComp.scanId || "").trim() || null;
    let review: unknown = currentInstaComp.review || null;
    let identitySource = "stored_human_verified_identity";
    if (useStoredIdentity) {
      ai = storedAi as InstaCompAiResult;
    } else {
      const scan = await scanIdentity({
        request,
        files,
        aiCouncilTier: typeof body?.aiCouncilTier === "string" ? body.aiCouncilTier : "adaptive",
      });
      ai = scan.ai as InstaCompAiResult;
      scanId = scan.scanId || null;
      review = scan.review || null;
      identitySource = "fresh_image_scan";
      const { data: refreshedItem, error: refreshError } = await supabase
        .from("inventory_items")
        .select("metadata")
        .eq("id", item.id)
        .eq("store_id", storeId)
        .maybeSingle();
      if (refreshError) throw refreshError;
      metadata = recordValue(refreshedItem?.metadata || metadata);
      currentInstaComp = recordValue(metadata.instacomp);
    }

    const fallbackQuery = buildInstaCompQueries(ai).primary;
    const compLinks = buildCompLinks(fallbackQuery);
    const aiRecord = ai as InstaCompAiResult & Record<string, unknown>;
    const registryIdentityId =
      String(
        currentInstaComp.registryIdentityId ||
          currentInstaComp.registry_identity_id ||
          aiRecord.registryIdentityId ||
          aiRecord.registry_identity_id ||
          aiRecord.internalCardUuid ||
          "",
      ).trim() || null;
    const registryFingerprintSha256 =
      String(
        currentInstaComp.registryFingerprintSha256 ||
          currentInstaComp.registry_fingerprint_sha256 ||
          aiRecord.registryFingerprintSha256 ||
          aiRecord.checklistFingerprintSha256 ||
          "",
      ).trim() || null;
    const operatorCertifiedIdentity =
      useStoredIdentity &&
      (currentInstaComp.humanVerified === true ||
        currentInstaComp.manualIdentityLocked === true ||
        currentInstaComp.trustedForIdentity === true);

    // Mac-first: the user's own InstaComp worker searches the market before any
    // paid/cloud AI lane. Mercari is active/purchase-side reference only.
    const macMarket = await requestMacExactMarket({
      exactTitle: item.title,
      ai,
      scanId,
      registryIdentityId,
      registryFingerprintSha256,
      operatorCertifiedIdentity,
      researchId: scanId || item.id,
    });
    const macPricingSold = macMarket.sold.filter((row) =>
      isPricingEligibleEvidence(row, "sold"),
    );
    const macMarketHasPricing = macMarket.status === "ready" && macPricingSold.length > 0;

    let fanaticsSold: any = {
      source: "fanatics_collect_sales_history",
      label: "Fanatics Collect Sales History",
      status: "skipped",
      message: "Skipped because the Mac-first market search returned exact pricing evidence.",
      results: [],
    };
    let teacher: Awaited<ReturnType<typeof getTeacherExactMarketProviders>> | null = null;
    let teacherFailure: string | null = null;
    if (!macMarketHasPricing) {
      fanaticsSold = await getFanaticsExactSoldProvider({ exactTitle: item.title, ai });
      try {
        teacher = await getTeacherExactMarketProviders({ exactTitle: item.title, ai });
      } catch (error) {
        teacherFailure = sanitizeInstaCompProviderError(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    const teacherSold: any = teacher?.sold || {
      source: "teacher_consensus_exact_sold",
      label: "Outside AI Teacher Consensus Sold",
      status: macMarketHasPricing ? "skipped" : "error",
      message: macMarketHasPricing
        ? "Skipped because the Mac-first market search returned exact pricing evidence."
        : teacherFailure || "Outside teacher market search failed.",
      results: [],
    };
    const teacherActive: any = teacher?.active || {
      source: "teacher_discovery_active",
      label: "Outside AI Teacher Active Discovery",
      status: macMarketHasPricing ? "skipped" : "error",
      message: macMarketHasPricing
        ? "Skipped because the Mac-first market search returned exact pricing evidence."
        : teacherFailure || "Outside teacher market search failed.",
      results: [],
    };

    const shouldSearchOpenAiWeb =
      !macMarketHasPricing && fanaticsSold.results.length === 0 && teacherSold.results.length === 0;
    const openAiMarket = shouldSearchOpenAiWeb
      ? await getOpenAiExactEbayMarketProviders({ exactTitle: item.title, ai })
      : null;

    const preservedTrustedSold =
      currentInstaComp.trustedForPricing === true && useStoredIdentity
        ? evidenceList(currentInstaComp.soldCompEvidence, 50).filter((row) =>
            isPricingEligibleEvidence(row, "sold"),
          )
        : [];
    const trustedSoldEvidence = dedupeEvidence(
      [
        ...preservedTrustedSold,
        ...macMarket.sold,
        ...evidenceList(fanaticsSold.results, 20),
        ...evidenceList(teacherSold.results, 20),
      ],
      50,
    );
    const discoverySoldCandidates = forceImageVerification(
      evidenceList(openAiMarket?.sold.results, 20),
    );
    const teacherActiveCandidates = evidenceList(teacherActive.results, 20);
    const discoveryActiveCandidates = [
      ...teacherActiveCandidates,
      ...forceImageVerification(evidenceList(openAiMarket?.active.results, 20)),
    ].slice(0, 30);
    let soldReview: any = {
      accepted: [],
      rejected: [],
      reviewedCount: 0,
      titleOverrides: 0,
      configured: true,
      model: "mac_local_exact_market_gate",
    };
    let activeReview: any = {
      accepted: [],
      rejected: [],
      reviewedCount: 0,
      titleOverrides: 0,
      configured: true,
      model: "mac_local_exact_market_gate",
    };
    if (!macMarketHasPricing) {
      [soldReview, activeReview] = await Promise.all([
        verifyInstaCompCompetitionImages({
          targetFrontImage: files[0],
          targetAi: ai,
          candidates: discoverySoldCandidates,
        }),
        verifyInstaCompCompetitionImages({
          targetFrontImage: files[0],
          targetAi: ai,
          candidates: discoveryActiveCandidates,
        }),
      ]);
    }

    const excludedCompUrls = new Set(stringList(currentInstaComp.excludedCompUrls));
    const acceptedDiscoverySold = dedupeEvidence(
      evidenceList(soldReview.accepted, 20).filter((row) => !isExcludedEvidence(row)),
      20,
    );
    const acceptedSoldEvidence = dedupeEvidence(
      [...trustedSoldEvidence, ...acceptedDiscoverySold],
      50,
    ).filter((row) => !excludedCompUrls.has(row.url));
    const activeCompetition = dedupeEvidence(
      [
        ...macMarket.active,
        ...evidenceList(activeReview.accepted, 30).filter((row) => !isExcludedEvidence(row)),
      ],
      30,
    ).filter((row) => !excludedCompUrls.has(row.url));
    const soldCompEvidence = acceptedSoldEvidence.filter((row) =>
      isPricingEligibleEvidence(row, "sold"),
    );
    const activePricingEvidence = activeCompetition.filter((row) =>
      isPricingEligibleEvidence(row, "active"),
    );
    const pricingIneligibleExactEvidence = dedupeEvidence(
      [
        ...acceptedSoldEvidence.filter((row) => !isPricingEligibleEvidence(row, "sold")),
        ...activeCompetition.filter((row) => !isPricingEligibleEvidence(row, "active")),
      ],
      60,
    );
    const rejectedCandidates = dedupeEvidence(
      [...evidenceList(soldReview.rejected, 30), ...evidenceList(activeReview.rejected, 30)],
      60,
    );

    const rawPricingAnalysis = calculateInstaCompSweetSpot({
      sold: soldCompEvidence,
      active: activePricingEvidence,
    });
    const hasReliableSoldComps = rawPricingAnalysis.soldCount > 0;
    const suggestedPrice = hasReliableSoldComps ? rawPricingAnalysis.suggestedPrice : 0;
    const pricingAnalysis = { ...rawPricingAnalysis, suggestedPrice };
    const pricingStatus = hasReliableSoldComps
      ? "suggested_from_reliable_sold_comps"
      : "seller_price_required";
    const pricingReason = hasReliableSoldComps
      ? pricingAnalysis.explanation
      : `${pricingAnalysis.explanation} InstaComp will not issue a suggested price without at least one strict exact sold listing.`;
    const marketLearning = await persistMacMarketLearning({
      exactTitle: item.title,
      ai,
      scanId,
      registryIdentityId,
      registryFingerprintSha256,
      operatorCertifiedIdentity,
      localDeterministicMarketTruth: macMarketHasPricing,
      researchId: scanId || item.id,
      acceptedSold: soldCompEvidence,
      acceptedActive: activeCompetition,
      rejected: [...macMarket.rejected, ...rejectedCandidates],
      suggestedPrice,
    });
    const checkedAt = new Date().toISOString();
    const macCoverage = macMarket.providerCoverage.map((row) => ({
      source: String(row.source || "mac_market_source"),
      label: String(row.label || row.source || "Mac market source"),
      status: String(row.status || "unknown"),
      resultCount: Math.max(0, Number(row.resultCount || 0) || 0),
      message:
        String(row.source || "").includes("mercari")
          ? `${String(row.message || "Mercari active search completed.")} Purchase-side only; never used as sold-comp evidence.`
          : String(row.message || ""),
      searchUrl: typeof row.searchUrl === "string" ? row.searchUrl : null,
      attempts: Array.isArray(row.attempts) ? row.attempts : [],
    }));
    const providerCoverage = [
      {
        source: "mac_local_market_stack",
        label: "InstaComp Mac Market Search",
        status: macMarket.status === "ready" ? "live" : macMarket.status,
        resultCount: macMarket.sold.length + macMarket.active.length,
        message: macMarketHasPricing
          ? `${macPricingSold.length} pricing-eligible exact sold comps returned by the Mac-first market worker.`
          : macMarket.error || "Mac market search returned no pricing-eligible exact sold comps; fallback providers were allowed.",
        searchUrl: null,
        attempts: [],
      },
      ...macCoverage,
      ...(!macMarketHasPricing
        ? [
            providerCoverageRow(fanaticsSold),
            providerCoverageRow(teacherSold),
            providerCoverageRow(teacherActive),
            ...(openAiMarket
              ? [providerCoverageRow(openAiMarket.sold), providerCoverageRow(openAiMarket.active)]
              : []),
          ]
        : []),
    ];
    const exactMarketQueries = Array.from(
      new Set(
        [item.title, fallbackQuery, macMarket.query]
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    );
    const existingSourceLinks = recordValue(currentInstaComp.sourceLinks);
    const coverageLink = (source: string) =>
      macCoverage.find((row) => row.source === source)?.searchUrl || null;
    const sourceLinks = {
      ...existingSourceLinks,
      ebaySoldUrl:
        coverageLink("mac_chrome_ebay_sold") ||
        openAiMarket?.sold.searchUrl ||
        existingSourceLinks.ebaySoldUrl ||
        null,
      ebayActiveUrl:
        openAiMarket?.active.searchUrl ||
        existingSourceLinks.ebayActiveUrl ||
        compLinks.ebayActiveUrl,
      one30pointUrl:
        coverageLink("mac_chrome_130point_sold") ||
        "https://130point.com/search?new=sold",
      mercariUrl:
        coverageLink("mac_chrome_mercari_active") || compLinks.mercariUrl,
      fanaticsUrl:
        coverageLink("fanatics_collect_sales_history") || compLinks.fanaticsUrl,
      broadCardMarketUrl: compLinks.broadCardMarketUrl,
    };

    const nextMetadata = {
      ...metadata,
      instacomp: {
        ...currentInstaComp,
        schema: "truely.instacompInventoryScan.v5",
        source: "seller_inventory_exact_market_action",
        scanId,
        humanVerified: currentInstaComp.humanVerified === true,
        trustedForIdentity: useStoredIdentity || currentInstaComp.trustedForIdentity === true,
        identitySource,
        hasBackImage: files.length >= 2 || currentInstaComp.hasBackImage === true,
        ai,
        review,
        exactStoredTitleQuery: item.title,
        exactMarketQueries,
        macMarketSearch: {
          status: macMarket.status,
          query: macMarket.query,
          pricingEligibleSoldCount: macPricingSold.length,
          soldEvidenceCount: macMarket.sold.length,
          activePurchaseReferenceCount: macMarket.active.length,
          activeMarketReferenceCount: macMarket.active.length,
          rejectedMarketCandidateCount: macMarket.rejected.length,
          providerCoverage: macCoverage,
          rawLearningReceipt: macMarket.learning,
          finalLearningReceipt: marketLearning,
          error: macMarket.error,
          sourceAuthority: "mac_local_browser_and_direct_market_feeds",
          trainingAllowed: marketLearning?.student_training_eligible === true,
        },
        openAiWebMarket: openAiMarket
          ? {
              model: openAiMarket.model,
              responseId: openAiMarket.responseId,
              citedItemIds: openAiMarket.citedItemIds,
              notes: openAiMarket.notes,
              cached: openAiMarket.cached,
            }
          : null,
        marketPrice: suggestedPrice,
        suggestedPrice,
        pricingStatus,
        pricingReason,
        pricingAnalysis,
        reliableSoldCompCount: hasReliableSoldComps ? pricingAnalysis.soldCount : 0,
        pricingCheckedAt: checkedAt,
        trustedForPricing: hasReliableSoldComps,
        soldCompEvidence,
        activeCompetition,
        rejectedCandidates,
        pricingIneligibleExactEvidence,
        activePricingEvidenceCount: activePricingEvidence.length,
        excludedCompUrls: Array.from(excludedCompUrls),
        excludedCompEvidence: Array.isArray(currentInstaComp.excludedCompEvidence)
          ? currentInstaComp.excludedCompEvidence
          : [],
        providerCoverage,
        teacherAttempts: teacher?.attempts || [],
        sourceLinks,
        exactMarketVisualReview: {
          soldReviewed: soldReview.reviewedCount,
          activeReviewed: activeReview.reviewedCount,
          soldTitleOverrides: soldReview.titleOverrides,
          activeTitleOverrides: activeReview.titleOverrides,
          configured: soldReview.configured && activeReview.configured,
          model: soldReview.model,
        },
        scannedAt: checkedAt,
      },
    };
    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ metadata: nextMetadata, updated_at: checkedAt })
      .eq("id", item.id)
      .eq("store_id", storeId);
    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      inventoryItemId: item.id,
      sku: item.sku,
      title: item.title,
      scanId,
      ai,
      review,
      identitySource,
      suggestedPrice,
      pricingStatus,
      pricingReason,
      pricingAnalysis,
      trustedForPricing: hasReliableSoldComps,
      exactCompCount: hasReliableSoldComps ? pricingAnalysis.soldCount : 0,
      reliableSoldCompCount: hasReliableSoldComps ? pricingAnalysis.soldCount : 0,
      soldCompEvidence,
      activeCompetition,
      rejectedCandidates,
      pricingIneligibleExactEvidence,
      activePricingEvidenceCount: activePricingEvidence.length,
      sourceLinks,
      providerCoverage,
      macMarketSearch: {
        status: macMarket.status,
        query: macMarket.query,
        pricingEligibleSoldCount: macPricingSold.length,
        soldEvidenceCount: macMarket.sold.length,
        activePurchaseReferenceCount: macMarket.active.length,
        activeMarketReferenceCount: macMarket.active.length,
        rejectedMarketCandidateCount: macMarket.rejected.length,
        error: macMarket.error,
        usedForPricing: macMarketHasPricing,
        rawLearningReceipt: macMarket.learning,
        finalLearningReceipt: marketLearning,
        trainingAllowed: marketLearning?.student_training_eligible === true,
      },
      marketLearning,
      teacherAttempts: teacher?.attempts || [],
      providerProblems: providerCoverage.filter((row) =>
        ["error", "failed", "not_configured", "challenge"].includes(String(row.status)),
      ),
      exactMarketQueries,
      openAiWebMarket: openAiMarket
        ? {
            model: openAiMarket.model,
            responseId: openAiMarket.responseId,
            citedItemIds: openAiMarket.citedItemIds,
            notes: openAiMarket.notes,
            cached: openAiMarket.cached,
          }
        : null,
      exactMarketVisualReview: {
        soldReviewed: soldReview.reviewedCount,
        activeReviewed: activeReview.reviewedCount,
        soldTitleOverrides: soldReview.titleOverrides,
        activeTitleOverrides: activeReview.titleOverrides,
      },
      fastLane: useStoredIdentity,
      durationMs: Date.now() - scanStartedAt,
      imageCountUsed: files.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: sanitizeInstaCompProviderError(error?.message || "Seller inventory InstaComp exact-market scan failed."),
        code: error?.code || null,
      },
      { status: 500 },
    );
  }
}
