import { NextRequest } from "next/server";
import { adminMutationSecurityDecision } from "../../../../lib/admin-request-security";
import { POST as runInstaCompFast } from "../../instacomp/scan-fast/route";
import { buildCardListingTitle } from "../../../../lib/card-listing-title";
import { handleGuardedDualMarketplaceGet } from "../../../../lib/dual-marketplace-admin-route-guard";
import { evaluateInstaCompListingGate } from "../../../../lib/instacomp-listing-gate";
import {
  pendingImportIdentityCorrection,
  shouldApplyPendingImportIdentityCorrection,
} from "../../../../lib/pending-import-identity-corrections";
import {
  requireInstaCompJobActor,
  InstaCompJobServerError,
  instaCompJobErrorResponse,
} from "../../../../lib/instacomp-job-server";
import { buildInstaCompV2Decision } from "../../../../lib/instacomp-v2";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const MAX_DELETE_ITEMS = 250;
const BLOCKED_DELETE_STATUSES = new Set([
  "active",
  "publishing",
  "reconciliation_required",
]);

type UnknownRecord = Record<string, unknown>;

type InventoryRow = {
  id: string;
  legacy_product_id: number | null;
  title: string;
  description: string | null;
  category: string | null;
  condition: string | null;
  status: string;
  quantity: number | null;
  metadata: UnknownRecord | null;
};

type ProductRow = {
  id: number;
  title: string | null;
  image_url: string | null;
  ebay_item_id: string | null;
};

type ImageRow = {
  inventory_item_id: string;
  image_url: string;
  sort_order: number | null;
  is_primary: boolean | null;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown, maximum = 2_000) {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maximum) : "";
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueStrings(values: unknown[]) {
  return Array.from(new Set(values.map((value) => text(value)).filter(Boolean)));
}

function channelStatus(metadata: UnknownRecord, channel: "website" | "ebay") {
  return text(record(record(metadata.dual_marketplace)[channel]).status, 60) || "draft";
}

function imageSummary(metadata: UnknownRecord) {
  const instacomp = record(metadata.instacomp);
  return {
    frontImageUrl: text(instacomp.frontImageUrl),
    backImageUrl: text(instacomp.backImageUrl),
  };
}

function enrichQueueRow(row: UnknownRecord, metadata: UnknownRecord) {
  const instacomp = record(metadata.instacomp);
  const images = imageSummary(metadata);
  const imageUrls = uniqueStrings([
    images.frontImageUrl,
    images.backImageUrl,
    ...(Array.isArray(row.imageUrls) ? row.imageUrls : []),
  ]);

  return {
    ...row,
    imageUrls,
    frontImageUrl: images.frontImageUrl || imageUrls[0] || null,
    backImageUrl: images.backImageUrl || imageUrls[1] || null,
    instaCompStatus: text(instacomp.status, 60) || "pending",
    instaCompVersion: text(instacomp.version, 20) || "2.0",
    instaCompScanId: text(instacomp.scanId, 160) || null,
    instaCompConfidence: numberValue(instacomp.identityConfidence) || null,
    instaCompSuggestedPrice: numberValue(instacomp.listingPrice) || null,
  };
}

async function requireAdmin(request: Request) {
  const actor = await requireInstaCompJobActor(request);
  if (actor.type !== "admin") {
    throw new InstaCompJobServerError(
      "TCOS listing queue actions are owner/admin only.",
      403,
      "INSTACOMP_ADMIN_REQUIRED",
    );
  }
  return actor;
}

async function applyKnownPendingImportCorrection(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  inventoryItemId: string;
  row: UnknownRecord;
  metadata: UnknownRecord;
}) {
  const correction = pendingImportIdentityCorrection(params.metadata);
  if (
    !correction ||
    !shouldApplyPendingImportIdentityCorrection(
      params.metadata,
      params.row.websiteTitle,
    )
  ) {
    return null;
  }

  const websiteStatus = text(params.row.websiteStatus, 60) || "draft";
  const ebayStatus = text(params.row.ebayStatus, 60) || "draft";
  if (
    BLOCKED_DELETE_STATUSES.has(websiteStatus) ||
    BLOCKED_DELETE_STATUSES.has(ebayStatus) ||
    text(params.row.ebayItemId, 100)
  ) {
    return null;
  }

  const now = new Date().toISOString();
  const pendingImport = record(params.metadata.pendingImport);
  const existingDual = record(params.metadata.dual_marketplace);
  const existingWebsite = record(existingDual.website);
  const existingEbay = record(existingDual.ebay);
  const nextMetadata = {
    ...params.metadata,
    pendingImport: {
      ...pendingImport,
      originalIdentity: correction.identity,
      correction: {
        appliedAt: now,
        source: "checklist_and_stored_images",
        reason: correction.reason,
      },
    },
    cardIdentity: {
      ...record(params.metadata.cardIdentity),
      ...correction.identity,
    },
    instacomp: {
      ...record(params.metadata.instacomp),
      status: "pending",
      version: "2.0",
      scanId: null,
      identityConfidence: null,
      listingPrice: null,
      searchQuery: null,
      decision: null,
      reviewReasons: ["known_checklist_correction_applied"],
      correctedAt: now,
    },
    dual_marketplace: {
      ...existingDual,
      website: {
        ...existingWebsite,
        title: correction.title,
        description: correction.description,
        price: 0,
        status: websiteStatus,
      },
      ebay: {
        ...existingEbay,
        title: correction.title.slice(0, 80),
        description: correction.description,
        price: 0,
        aspects: {
          ...record(existingEbay.aspects),
          Player: ["Kiki Iriafen"],
          Team: ["Washington Mystics"],
          Sport: ["Basketball"],
          Year: ["2025"],
          Brand: ["Panini"],
          Set: ["Prizm WNBA"],
          "Card Number": ["149"],
          "Parallel/Variety": ["Cracked Ice Prizm"],
        },
        status: ebayStatus,
      },
      updatedAt: now,
    },
  };

  const { error: inventoryError } = await params.supabase
    .from("inventory_items")
    .update({
      title: correction.title,
      description: correction.description,
      metadata: nextMetadata,
      updated_at: now,
    })
    .eq("store_id", params.storeId)
    .is("seller_account_id", null)
    .eq("id", params.inventoryItemId)
    .eq("status", "draft");
  if (inventoryError) throw inventoryError;

  const legacyProductId = numberValue(params.row.legacyProductId);
  if (legacyProductId > 0) {
    const { error: productError } = await params.supabase
      .from("products")
      .update({
        title: correction.title,
        description: correction.description,
        player: "Kiki Iriafen",
        sport: "Basketball",
        price: 0,
      })
      .eq("store_id", params.storeId)
      .is("seller_account_id", null)
      .eq("id", legacyProductId);
    if (productError) throw productError;
  }

  return {
    metadata: nextMetadata,
    rowPatch: {
      websiteTitle: correction.title,
      websiteDescription: correction.description,
      ebayTitle: correction.title.slice(0, 80),
      ebayDescription: correction.description,
      websitePrice: 0,
      ebayPrice: 0,
      aspects: record(record(nextMetadata.dual_marketplace).ebay).aspects,
      lastError: null,
    },
  };
}

export async function GET(request: Request) {
  try {
    const response = await handleGuardedDualMarketplaceGet(request);
    const data = await response.clone().json().catch(() => null);
    if (!response.ok || !data || !Array.isArray(data.rows)) return response;

    const ids = data.rows
      .map((row: UnknownRecord) => text(row.inventoryItemId, 80))
      .filter(Boolean);
    const metadataById = new Map<string, UnknownRecord>();

    if (ids.length) {
      const supabase = createSupabaseServerClient({ admin: true });
      const storeId = getActiveStoreId();
      for (let index = 0; index < ids.length; index += 100) {
        const { data: rows, error } = await supabase
          .from("inventory_items")
          .select("id,metadata")
          .eq("store_id", storeId)
          .is("seller_account_id", null)
          .in("id", ids.slice(index, index + 100));
        if (error) throw error;
        for (const row of rows || []) {
          metadataById.set(String(row.id), record(row.metadata));
        }
      }

      for (const row of data.rows as UnknownRecord[]) {
        const inventoryItemId = text(row.inventoryItemId, 80);
        const metadata = metadataById.get(inventoryItemId) || {};
        const repaired = await applyKnownPendingImportCorrection({
          supabase,
          storeId,
          inventoryItemId,
          row,
          metadata,
        });
        if (!repaired) continue;
        metadataById.set(inventoryItemId, repaired.metadata);
        Object.assign(row, repaired.rowPatch);
      }
    }

    data.rows = data.rows.map((row: UnknownRecord) =>
      enrichQueueRow(
        row,
        metadataById.get(text(row.inventoryItemId, 80)) || {},
      ),
    );
    return Response.json(data, { status: response.status });
  } catch (error) {
    if (error instanceof InstaCompJobServerError) {
      return instaCompJobErrorResponse(error);
    }
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not load the TCOS listing queue.",
      },
      { status: 500 },
    );
  }
}

async function loadCard(params: {
  inventoryItemId: string;
  storeId: string;
  supabase: ReturnType<typeof createSupabaseServerClient>;
}) {
  const { data: inventory, error } = await params.supabase
    .from("inventory_items")
    .select(
      "id,legacy_product_id,title,description,category,condition,status,quantity,metadata",
    )
    .eq("store_id", params.storeId)
    .is("seller_account_id", null)
    .eq("id", params.inventoryItemId)
    .maybeSingle();
  if (error) throw error;
  if (!inventory) throw new Error("The selected card draft was not found.");

  let product: ProductRow | null = null;
  if (inventory.legacy_product_id) {
    const { data, error: productError } = await params.supabase
      .from("products")
      .select("id,title,image_url,ebay_item_id")
      .eq("store_id", params.storeId)
      .is("seller_account_id", null)
      .eq("id", inventory.legacy_product_id)
      .maybeSingle();
    if (productError) throw productError;
    product = (data || null) as ProductRow | null;
  }

  const { data: imageRows, error: imageError } = await params.supabase
    .from("inventory_images")
    .select("inventory_item_id,image_url,sort_order,is_primary")
    .eq("inventory_item_id", params.inventoryItemId)
    .order("sort_order", { ascending: true });
  if (imageError) throw imageError;

  return {
    inventory: inventory as InventoryRow,
    product,
    images: (imageRows || []) as ImageRow[],
  };
}

function cardImageUrls(card: Awaited<ReturnType<typeof loadCard>>) {
  const metadata = record(card.inventory.metadata);
  const instacomp = record(metadata.instacomp);
  const sorted = card.images.slice().sort((left, right) => {
    if (Boolean(left.is_primary) !== Boolean(right.is_primary)) {
      return left.is_primary ? -1 : 1;
    }
    return Number(left.sort_order || 0) - Number(right.sort_order || 0);
  });
  const front =
    text(instacomp.frontImageUrl) ||
    text(sorted.find((image) => image.is_primary)?.image_url) ||
    text(card.product?.image_url) ||
    text(sorted[0]?.image_url);
  const back =
    text(instacomp.backImageUrl) ||
    text(sorted.find((image) => !image.is_primary && text(image.image_url) !== front)?.image_url);
  return { front, back };
}

async function imageFile(url: string, side: "front" | "back") {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`The ${side} card image could not be downloaded.`);
  }
  const contentType = (response.headers.get("content-type") || "image/jpeg")
    .split(";")[0]
    .trim();
  const extension = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
      ? "webp"
      : "jpg";
  return new File([await response.arrayBuffer()], `${side}.${extension}`, {
    type: contentType,
  });
}

function identityAspects(ai: UnknownRecord) {
  const pairs: Array<[string, unknown]> = [
    ["Player", ai.player],
    ["Team", ai.team],
    ["Sport", ai.sport],
    ["Year", ai.year],
    ["Brand", ai.brand],
    ["Set", ai.setName],
    ["Card Number", ai.cardNumber],
    ["Parallel/Variety", ai.parallel],
  ];
  return Object.fromEntries(
    pairs
      .map(([name, value]) => [name, text(value, 160)] as const)
      .filter(([, value]) => Boolean(value))
      .map(([name, value]) => [name, [value]]),
  );
}

function listingDescription(title: string, ai: UnknownRecord, hasBack: boolean) {
  const details = [
    text(ai.player) ? `Player/Subject: ${text(ai.player, 160)}` : null,
    text(ai.team) ? `Team: ${text(ai.team, 160)}` : null,
    text(ai.sport) ? `Sport: ${text(ai.sport, 100)}` : null,
    text(ai.year) ? `Year: ${text(ai.year, 30)}` : null,
    text(ai.brand) ? `Brand: ${text(ai.brand, 120)}` : null,
    text(ai.setName) ? `Set: ${text(ai.setName, 160)}` : null,
    text(ai.cardNumber) ? `Card Number: ${text(ai.cardNumber, 100)}` : null,
    text(ai.parallel) ? `Parallel/Variation: ${text(ai.parallel, 160)}` : null,
    text(ai.serialNumber)
      ? `Full Serial Number: ${text(ai.serialNumber, 100)}`
      : null,
    ai.isRookie === true ? "Rookie: Yes" : null,
    ai.isAuto === true ? "Autograph: Yes" : null,
    ai.isRelic === true ? "Relic/Memorabilia: Yes" : null,
    hasBack ? "Images: Front and back" : "Images: Front only",
  ].filter(Boolean);

  return [
    title,
    "",
    ...details,
    "",
    "The listing images show the exact card you will receive.",
  ].join("\n");
}

async function runCardInstaComp(request: NextRequest, inventoryItemId: string) {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const card = await loadCard({ inventoryItemId, storeId, supabase });
  const metadata = record(card.inventory.metadata);

  if (card.inventory.status !== "draft") {
    throw new Error("InstaComp 2.0 can only update an unpublished draft from this queue.");
  }
  if (
    BLOCKED_DELETE_STATUSES.has(channelStatus(metadata, "website")) ||
    BLOCKED_DELETE_STATUSES.has(channelStatus(metadata, "ebay")) ||
    card.product?.ebay_item_id
  ) {
    throw new Error("This card is already publishing or active on a channel.");
  }

  const urls = cardImageUrls(card);
  if (!urls.front) throw new Error("The card does not have a front image.");
  const [frontImage, backImage] = await Promise.all([
    imageFile(urls.front, "front"),
    urls.back ? imageFile(urls.back, "back") : Promise.resolve(null),
  ]);

  const formData = new FormData();
  formData.append("frontImage", frontImage, frontImage.name);
  formData.append("aiCouncilTier", "adaptive");
  if (backImage) formData.append("backImage", backImage, backImage.name);

  const headers = new Headers(request.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  const scanRequest = new NextRequest(
    new URL("/api/instacomp/scan-fast", request.url),
    { method: "POST", headers, body: formData },
  );
  const scanResponse = await runInstaCompFast(scanRequest);
  const payload = (await scanResponse.json().catch(() => null)) as UnknownRecord | null;
  if (!scanResponse.ok || !payload || payload.ok === false) {
    throw new Error(text(payload?.error) || "InstaComp 2.0 could not complete this card.");
  }

  const rawAi = record(payload.ai);
  const pendingImport = record(metadata.pendingImport);
  const immutableImportedIdentity = record(pendingImport.originalIdentity);
  const importedIdentity = Object.keys(immutableImportedIdentity).length
    ? immutableImportedIdentity
    : record(metadata.cardIdentity);
  const gate = evaluateInstaCompListingGate({
    payload,
    importedIdentity,
    pendingImport,
  });
  const ai = gate.identity;
  const decision = buildInstaCompV2Decision(payload as never);
  const rawSuggestedPrice = Math.max(
    0,
    numberValue(record(decision.targets).listPrice) ||
      numberValue(record(payload.soldStats).suggestedPrice) ||
      numberValue(record(payload.stats).suggestedPrice),
  );
  const suggestedPrice = gate.priceApproved ? rawSuggestedPrice : 0;
  const now = new Date().toISOString();

  if (!gate.identityApproved) {
    const nextMetadata = {
      ...metadata,
      instacomp: {
        ...record(metadata.instacomp),
        status: "needs_review",
        version: "2.0",
        scanId: text(payload.scanId, 160) || null,
        identityConfidence: gate.confidence || null,
        listingPrice: null,
        searchQuery: text(payload.searchQuery, 500) || null,
        decision: null,
        proposedIdentity: ai,
        catalogConfirmed: gate.catalogConfirmed,
        reviewReasons: gate.reviewReasons,
        sourceCoverage: Array.isArray(payload.sourceCoverage)
          ? payload.sourceCoverage
          : [],
        completedAt: now,
        frontImageUrl: urls.front,
        backImageUrl: urls.back || null,
      },
    };
    const { error: reviewError } = await supabase
      .from("inventory_items")
      .update({ metadata: nextMetadata, updated_at: now })
      .eq("store_id", storeId)
      .is("seller_account_id", null)
      .eq("id", inventoryItemId);
    if (reviewError) throw reviewError;

    return {
      inventoryItemId,
      title: card.inventory.title,
      scanId: text(payload.scanId, 160) || null,
      confidence: gate.confidence || null,
      suggestedPrice: null,
      status: "needs_review",
      reviewReasons: gate.reviewReasons,
    };
  }

  const title = buildCardListingTitle({
    year: ai.year,
    brand: ai.brand,
    setName: ai.setName,
    cardNumber: ai.cardNumber,
    player: ai.player,
    parallel: ai.parallel,
    serialNumber: ai.serialNumber,
    isRookie: ai.isRookie === true,
    isAuto: ai.isAuto === true,
    isRelic: ai.isRelic === true,
  });
  if (!title) throw new Error("InstaComp 2.0 did not return enough identity data to build a title.");

  const description = listingDescription(title, ai, Boolean(urls.back));
  const existingDual = record(metadata.dual_marketplace);
  const existingWebsite = record(existingDual.website);
  const existingEbay = record(existingDual.ebay);
  const aspects = identityAspects(ai);
  const existingWebsitePrice = numberValue(existingWebsite.price);
  const existingEbayPrice = numberValue(existingEbay.price);
  const nextMetadata = {
    ...metadata,
    cardIdentity: {
      ...record(metadata.cardIdentity),
      player: text(ai.player, 160) || null,
      year: text(ai.year, 30) || null,
      brand: text(ai.brand, 120) || null,
      setName: text(ai.setName, 160) || null,
      cardNumber: text(ai.cardNumber, 100) || null,
      parallel: text(ai.parallel, 160) || null,
      serialNumber: text(ai.serialNumber, 100) || null,
      team: text(ai.team, 160) || null,
      sport: text(ai.sport, 100) || null,
      isRookie: ai.isRookie === true,
      isAuto: ai.isAuto === true,
      isRelic: ai.isRelic === true,
    },
    instacomp: {
      ...record(metadata.instacomp),
      status: "complete",
      version: "2.0",
      scanId: text(payload.scanId, 160) || null,
      identityConfidence: gate.confidence || null,
      catalogConfirmed: gate.catalogConfirmed,
      reviewReasons: gate.reviewReasons,
      listingPrice: suggestedPrice || null,
      searchQuery: text(payload.searchQuery, 500) || null,
      decision: {
        action: text(decision.recommendation.action, 80) || null,
        listPrice: suggestedPrice || null,
      },
      sourceCoverage: Array.isArray(payload.sourceCoverage)
        ? payload.sourceCoverage
        : [],
      completedAt: now,
      frontImageUrl: urls.front,
      backImageUrl: urls.back || null,
    },
    dual_marketplace: {
      ...existingDual,
      website: {
        ...existingWebsite,
        title,
        description,
        price: existingWebsitePrice > 0 ? existingWebsitePrice : 0,
        status: text(existingWebsite.status, 60) || "draft",
      },
      ebay: {
        ...existingEbay,
        title: title.slice(0, 80),
        description,
        price:
          existingEbayPrice > 0 ? existingEbayPrice : suggestedPrice || 0,
        cardCondition: text(ai.conditionGuess, 120),
        aspects,
        status: text(existingEbay.status, 60) || "draft",
      },
      updatedAt: now,
    },
  };

  const { error: inventoryError } = await supabase
    .from("inventory_items")
    .update({
      title,
      description,
      condition: text(ai.conditionGuess, 120) || card.inventory.condition,
      metadata: nextMetadata,
      updated_at: now,
    })
    .eq("store_id", storeId)
    .is("seller_account_id", null)
    .eq("id", inventoryItemId);
  if (inventoryError) throw inventoryError;

  if (card.inventory.legacy_product_id) {
    const { error: productError } = await supabase
      .from("products")
      .update({
        title,
        description,
        player: text(ai.player, 160) || null,
        sport: text(ai.sport, 100) || "Sports Cards",
        price: 0,
        quantity: Math.max(1, Number(card.inventory.quantity || 1)),
      })
      .eq("store_id", storeId)
      .is("seller_account_id", null)
      .eq("id", card.inventory.legacy_product_id);
    if (productError) throw productError;
  }

  return {
    inventoryItemId,
    title,
    scanId: text(payload.scanId, 160) || null,
    confidence: gate.confidence || null,
    suggestedPrice: suggestedPrice || null,
    status: "complete",
  };
}

export async function POST(request: NextRequest) {
const mutation = adminMutationSecurityDecision(request);
if (!mutation.allowed) {
  return Response.json(
    {
      success: false,
      error: mutation.reason || "Privileged mutation rejected.",
      code: mutation.code,
    },
    { status: 403 },
  );
}
  try {
    await requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    if (text(body.action, 40) !== "instacomp") {
      return Response.json(
        { success: false, error: "Unsupported listing queue action." },
        { status: 400 },
      );
    }
    const inventoryItemId = text(body.inventoryItemId, 80);
    if (!inventoryItemId) {
      return Response.json(
        { success: false, error: "inventoryItemId is required." },
        { status: 400 },
      );
    }

    const result = await runCardInstaComp(request, inventoryItemId);
    return Response.json({ success: true, result });
  } catch (error) {
    if (
      error instanceof InstaCompJobServerError ||
      String((error as { code?: unknown })?.code || "").startsWith("INSTACOMP_")
    ) {
      return instaCompJobErrorResponse(error);
    }
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "InstaComp 2.0 queue processing failed.",
      },
      { status: 500 },
    );
  }
}

function storageObject(url: string) {
  const marker = "/storage/v1/object/public/";
  const index = url.indexOf(marker);
  if (index < 0) return null;
  const remainder = url.slice(index + marker.length);
  const slash = remainder.indexOf("/");
  if (slash <= 0) return null;
  return {
    bucket: decodeURIComponent(remainder.slice(0, slash)),
    path: decodeURIComponent(remainder.slice(slash + 1)),
  };
}

async function removeStorageFiles(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  urls: string[],
) {
  const byBucket = new Map<string, string[]>();
  for (const url of uniqueStrings(urls)) {
    const object = storageObject(url);
    if (!object) continue;
    const paths = byBucket.get(object.bucket) || [];
    paths.push(object.path);
    byBucket.set(object.bucket, paths);
  }
  const warnings: string[] = [];
  for (const [bucket, paths] of byBucket) {
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) warnings.push(`${bucket}: ${error.message}`);
  }
  return warnings;
}

export async function DELETE(request: Request) {
const mutation = adminMutationSecurityDecision(request);
if (!mutation.allowed) {
  return Response.json(
    {
      success: false,
      error: mutation.reason || "Privileged mutation rejected.",
      code: mutation.code,
    },
    { status: 403 },
  );
}
  try {
    await requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    const inventoryItemIds = Array.from(
      new Set<string>(
        (Array.isArray(body.inventoryItemIds) ? body.inventoryItemIds : [])
          .map((value: unknown) => text(value, 80))
          .filter(Boolean),
      ),
    );
    if (!inventoryItemIds.length) {
      return Response.json(
        { success: false, error: "Select at least one draft to delete." },
        { status: 400 },
      );
    }
    if (inventoryItemIds.length > MAX_DELETE_ITEMS) {
      return Response.json(
        {
          success: false,
          error: `Delete no more than ${MAX_DELETE_ITEMS} drafts at one time.`,
        },
        { status: 413 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const results: UnknownRecord[] = [];
    const errors: UnknownRecord[] = [];

    for (const inventoryItemId of inventoryItemIds) {
      try {
        const card = await loadCard({ inventoryItemId, storeId, supabase });
        const metadata = record(card.inventory.metadata);
        const websiteStatus = channelStatus(metadata, "website");
        const ebayStatus = channelStatus(metadata, "ebay");
        if (card.inventory.status !== "draft") {
          throw new Error("Only unpublished drafts can be deleted from this queue.");
        }
        if (
          BLOCKED_DELETE_STATUSES.has(websiteStatus) ||
          BLOCKED_DELETE_STATUSES.has(ebayStatus) ||
          card.product?.ebay_item_id
        ) {
          throw new Error("This draft is active, publishing, or linked to eBay and cannot be deleted here.");
        }

        const urls = uniqueStrings([
          card.product?.image_url,
          ...card.images.map((image) => image.image_url),
          ...Object.values(imageSummary(metadata)),
        ]);

        const { error: attributeError } = await supabase
          .from("inventory_attributes")
          .delete()
          .eq("inventory_item_id", inventoryItemId);
        if (attributeError) throw attributeError;

        const { error: imageError } = await supabase
          .from("inventory_images")
          .delete()
          .eq("inventory_item_id", inventoryItemId);
        if (imageError) throw imageError;

        const { error: inventoryError } = await supabase
          .from("inventory_items")
          .delete()
          .eq("store_id", storeId)
          .is("seller_account_id", null)
          .eq("id", inventoryItemId);
        if (inventoryError) throw inventoryError;

        if (card.inventory.legacy_product_id) {
          const { error: productError } = await supabase
            .from("products")
            .delete()
            .eq("store_id", storeId)
            .is("seller_account_id", null)
            .eq("id", card.inventory.legacy_product_id)
            .is("ebay_item_id", null);
          if (productError) throw productError;
        }

        const warnings = await removeStorageFiles(supabase, urls);
        results.push({
          inventoryItemId,
          title: card.inventory.title,
          deleted: true,
          warnings,
        });
      } catch (error) {
        errors.push({
          inventoryItemId,
          deleted: false,
          error: error instanceof Error ? error.message : "Draft deletion failed.",
        });
      }
    }

    return Response.json(
      {
        success: errors.length === 0,
        results,
        errors,
        message: `${results.length} draft${results.length === 1 ? "" : "s"} deleted${
          errors.length ? `; ${errors.length} could not be deleted` : ""
        }.`,
      },
      { status: errors.length === inventoryItemIds.length ? 400 : 200 },
    );
  } catch (error) {
    if (error instanceof InstaCompJobServerError) {
      return instaCompJobErrorResponse(error);
    }
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not delete selected card drafts.",
      },
      { status: 500 },
    );
  }
}
