import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import {
  getInstaCompAiLocalArchivedImage,
  getInstaCompAiLocalScanArchive,
} from "../../../../../../lib/instacomp-ai-local";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";
import { POST as runInventoryInstaComp } from "../../inventory/instacomp/route";
import { POST as runVerifiedPricing } from "../../inventory/instacomp-verified/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const IMAGE_BUCKET = "instacomp-listing-images";
const MAX_REPAIRS_PER_REQUEST = 25;

type JsonRecord = Record<string, unknown>;

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requestedIds(body: JsonRecord) {
  const values = Array.isArray(body.itemIds)
    ? body.itemIds
    : body.inventoryItemId
      ? [body.inventoryItemId]
      : [];
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ).slice(0, MAX_REPAIRS_PER_REQUEST);
}

function forwardedHeaders(request: NextRequest, requestId: string) {
  const headers = new Headers({
    "content-type": "application/json",
    "x-instacomp-request-id": requestId,
  });
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  if (authorization) headers.set("authorization", authorization);
  if (cookie) headers.set("cookie", cookie);
  return headers;
}

async function ensureImageBucket(supabase: ReturnType<typeof createSupabaseServerClient>) {
  const { data: bucket } = await supabase.storage.getBucket(IMAGE_BUCKET);
  if (bucket) return;
  const { error } = await supabase.storage.createBucket(IMAGE_BUCKET, {
    public: true,
    fileSizeLimit: 12 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg"],
  });
  if (error && !/already exists|duplicate/i.test(error.message || "")) {
    throw error;
  }
}

async function uploadRecoveredImage(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  accountId: string;
  inventoryItemId: string;
  scanId: string;
  side: "front" | "back";
  sha256: string;
  bytes: ArrayBuffer;
}) {
  const objectPath = [
    "accounts",
    params.accountId,
    "inventory",
    params.inventoryItemId,
    `${params.scanId}-${params.sha256}-${params.side}.jpg`,
  ].join("/");
  const { error } = await params.supabase.storage
    .from(IMAGE_BUCKET)
    .upload(objectPath, new Uint8Array(params.bytes), {
      contentType: "image/jpeg",
      cacheControl: "31536000",
      upsert: true,
    });
  if (error) throw error;
  const { data } = params.supabase.storage
    .from(IMAGE_BUCKET)
    .getPublicUrl(objectPath);
  if (!data.publicUrl) {
    throw new Error(`Could not create a public ${params.side} image URL.`);
  }
  return data.publicUrl;
}

function lockedIdentityFields(metadata: JsonRecord) {
  const instaComp = recordValue(metadata.instacomp);
  const checklistIdentity = recordValue(instaComp.checklistIdentity);
  const lockedFields = recordValue(checklistIdentity.lockedFields);
  const ai = recordValue(instaComp.ai);
  return {
    player: textValue(lockedFields.player) || textValue(ai.player),
    sport: textValue(lockedFields.sport) || textValue(ai.sport),
  };
}

async function ensureLinkedProduct(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  row: any;
  metadata: JsonRecord;
  frontUrl: string;
  now: string;
}) {
  const identity = lockedIdentityFields(params.metadata);
  const productPayload = {
    store_id: params.storeId,
    seller_account_id: params.row.seller_account_id,
    sku: params.row.sku || null,
    title: params.row.title,
    description: params.row.description || "",
    player: identity.player,
    sport: identity.sport,
    price: Number(params.row.price || 0),
    quantity: Math.max(0, Number(params.row.quantity || 0)),
    image_url: params.frontUrl,
    last_seen_at: params.now,
  };

  if (params.row.legacy_product_id) {
    const { data, error } = await params.supabase
      .from("products")
      .update(productPayload)
      .eq("id", params.row.legacy_product_id)
      .eq("store_id", params.storeId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return Number(data.id);
  }

  if (params.row.sku) {
    const { data: duplicate, error: duplicateError } = await params.supabase
      .from("products")
      .select("id,title")
      .eq("store_id", params.storeId)
      .eq("sku", params.row.sku)
      .limit(1)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate?.id) {
      throw new Error(
        `SKU ${params.row.sku} is already linked to ${duplicate.title}. Automatic image recovery stopped to avoid attaching photos to the wrong product.`,
      );
    }
  }

  const { data: product, error } = await params.supabase
    .from("products")
    .insert({
      ...productPayload,
      ebay_item_id: null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return Number(product.id);
}

async function replaceRecoveredImageRows(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  inventoryItemId: string;
  title: string;
  frontUrl: string;
  backUrl: string;
}) {
  const { error: deleteError } = await params.supabase
    .from("inventory_images")
    .delete()
    .eq("inventory_item_id", params.inventoryItemId);
  if (deleteError) throw deleteError;

  const { error: insertError } = await params.supabase
    .from("inventory_images")
    .insert([
      {
        inventory_item_id: params.inventoryItemId,
        image_url: params.frontUrl,
        alt_text: `${params.title} front`,
        sort_order: 0,
        is_primary: true,
      },
      {
        inventory_item_id: params.inventoryItemId,
        image_url: params.backUrl,
        alt_text: `${params.title} back`,
        sort_order: 1,
        is_primary: false,
      },
    ]);
  if (insertError) throw insertError;
}

async function rerunWithRecoveredPair(params: {
  request: NextRequest;
  inventoryItemId: string;
}) {
  const requestId = `recover-${params.inventoryItemId}-${Date.now()}`;
  const headers = forwardedHeaders(params.request, requestId);
  const scanRequest = new NextRequest(
    new URL("/api/account/seller/inventory/instacomp", params.request.url),
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        inventoryItemId: params.inventoryItemId,
        aiCouncilTier: "adaptive",
        forceIdentityRescan: true,
        requestId,
      }),
    },
  );
  const scanResponse = await runInventoryInstaComp(scanRequest);
  const scanPayload = await scanResponse.json().catch(() => ({}));
  if (!scanResponse.ok || scanPayload?.success !== true) {
    return {
      scanSucceeded: false,
      pricingSucceeded: false,
      error: scanPayload?.error || "Image pair recovered, but identity re-scan failed.",
    };
  }

  const pricingRequest = new NextRequest(
    new URL(
      "/api/account/seller/inventory/instacomp-verified",
      params.request.url,
    ),
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        inventoryItemId: params.inventoryItemId,
        aiCouncilTier: "adaptive",
        forceIdentityRescan: false,
        requestId: `${requestId}-pricing`,
      }),
    },
  );
  const pricingResponse = await runVerifiedPricing(pricingRequest);
  const pricingPayload = await pricingResponse.json().catch(() => ({}));
  return {
    scanSucceeded: true,
    pricingSucceeded: pricingResponse.ok,
    error: pricingResponse.ok
      ? null
      : pricingPayload?.error ||
        pricingPayload?.payload?.error ||
        "Image pair and identity were repaired, but pricing needs a retry.",
  };
}

export async function POST(request: NextRequest) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const body = recordValue(await request.json().catch(() => ({})));
    const itemIds = requestedIds(body);
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isStoreOwnerAccount =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";

    let query = supabase
      .from("inventory_items")
      .select(
        "id,legacy_product_id,seller_account_id,sku,title,description,category,condition,status,quantity,price,metadata,created_at",
      )
      .eq("store_id", storeId)
      .eq("status", "draft")
      .order("created_at", { ascending: true })
      .limit(MAX_REPAIRS_PER_REQUEST);
    if (itemIds.length) query = query.in("id", itemIds);
    query = isStoreOwnerAccount
      ? query.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : query.eq("seller_account_id", account.id);

    const { data: rows, error: rowsError } = await query;
    if (rowsError) throw rowsError;

    const targets = (rows || []).filter((row: any) => {
      const metadata = recordValue(row.metadata);
      const instaComp = recordValue(metadata.instacomp);
      return Boolean(
        textValue(instaComp.scanId) &&
          (textValue(instaComp.source) === "mac_registry_scanner" ||
            textValue(instaComp.source) === "seller_inventory_action"),
      );
    });

    await ensureImageBucket(supabase);
    const results: Array<Record<string, unknown>> = [];

    for (const row of targets) {
      try {
        const metadata = recordValue(row.metadata);
        const instaComp = recordValue(metadata.instacomp);
        const scanId = textValue(instaComp.scanId);
        if (!scanId) throw new Error("Pending listing is missing its Mac scan ID.");

        const archive = await getInstaCompAiLocalScanArchive(scanId);
        if (
          !archive.has_front_image ||
          !archive.has_back_image ||
          !archive.front_sha256 ||
          !archive.back_sha256
        ) {
          throw new Error(
            "The Mac archive does not contain both original photos for this scan.",
          );
        }

        const [front, back] = await Promise.all([
          getInstaCompAiLocalArchivedImage({ scanId, side: "front" }),
          getInstaCompAiLocalArchivedImage({ scanId, side: "back" }),
        ]);
        if (
          front.sha256 &&
          front.sha256 !== archive.front_sha256
        ) {
          throw new Error("Recovered front-image hash did not match the scan receipt.");
        }
        if (back.sha256 && back.sha256 !== archive.back_sha256) {
          throw new Error("Recovered back-image hash did not match the scan receipt.");
        }
        if (archive.front_sha256 === archive.back_sha256) {
          throw new Error("Archived front and back hashes are identical.");
        }

        const [frontUrl, backUrl] = await Promise.all([
          uploadRecoveredImage({
            supabase,
            accountId: account.id,
            inventoryItemId: row.id,
            scanId,
            side: "front",
            sha256: archive.front_sha256,
            bytes: front.bytes,
          }),
          uploadRecoveredImage({
            supabase,
            accountId: account.id,
            inventoryItemId: row.id,
            scanId,
            side: "back",
            sha256: archive.back_sha256,
            bytes: back.bytes,
          }),
        ]);

        const now = new Date().toISOString();
        const productId = await ensureLinkedProduct({
          supabase,
          storeId,
          row,
          metadata,
          frontUrl,
          now,
        });
        await replaceRecoveredImageRows({
          supabase,
          inventoryItemId: row.id,
          title: row.title,
          frontUrl,
          backUrl,
        });

        const sellerReview = recordValue(metadata.seller_review);
        const nextMetadata = {
          ...metadata,
          instacomp: {
            ...instaComp,
            scanId: archive.scan_id,
            frontSha256: archive.front_sha256,
            backSha256: archive.back_sha256,
            imagePairSha256: archive.image_pair_sha256,
            hasBackImage: true,
            imageRequirement: "front_and_back_required_for_listing",
            imageRecoveryStatus: "recovered_from_mac_scan_archive",
            imageRecoveredAt: now,
            recoveredImageUrls: {
              front: frontUrl,
              back: backUrl,
            },
          },
          seller_review: {
            ...sellerReview,
            identity_confirmed: false,
            confirmed_at: null,
            confirmed_by: null,
            confirmed_account_id: null,
            reset_at: now,
            reset_reason: "front_back_images_recovered_and_identity_rescanned",
          },
        };
        const { error: updateError } = await supabase
          .from("inventory_items")
          .update({
            legacy_product_id: productId,
            metadata: nextMetadata,
            updated_at: now,
          })
          .eq("id", row.id)
          .eq("store_id", storeId);
        if (updateError) throw updateError;

        const rerun = await rerunWithRecoveredPair({
          request,
          inventoryItemId: row.id,
        });
        results.push({
          inventoryItemId: row.id,
          title: row.title,
          success: true,
          productId,
          frontUrl,
          backUrl,
          scanId,
          identityRescanSucceeded: rerun.scanSucceeded,
          pricingSucceeded: rerun.pricingSucceeded,
          warning: rerun.error,
        });
      } catch (error: unknown) {
        results.push({
          inventoryItemId: row.id,
          title: row.title,
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Could not recover this pending listing's image pair.",
        });
      }
    }

    return NextResponse.json({
      success: results.every((result) => result.success === true),
      attempted: targets.length,
      repaired: results.filter((result) => result.success === true).length,
      failed: results.filter((result) => result.success !== true).length,
      results,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not repair pending InstaComp image pairs.",
      },
      { status: 500 },
    );
  }
}
