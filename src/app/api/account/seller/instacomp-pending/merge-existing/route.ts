import { createHash } from "node:crypto";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type Json = Record<string, any>;

const OWNER_EMAILS = new Set([
  "sales@truelycollectables.com",
  "sales@trulycollectables.com",
]);

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function text(value: unknown) {
  const result = String(value ?? "").trim();
  return result || null;
}
function fingerprint(metadataValue: unknown) {
  const metadata = record(metadataValue);
  const instaComp = record(metadata.instacomp);
  const checklist = record(instaComp.checklistIdentity);
  const channelDraft = record(instaComp.channelDraft);
  return (
    text(checklist.registryFingerprintSha256) ||
    text(checklist.fingerprintSha256) ||
    text(channelDraft.registryFingerprintSha256) ||
    text(instaComp.registryFingerprintSha256) ||
    text(instaComp.pricingGroupKey)
  );
}

function uniquePhysical(metadataValue: unknown) {
  const metadata = record(metadataValue);
  const instaComp = record(metadata.instacomp);
  const asset = record(metadata.collectible_asset);
  const identity = record(instaComp.ai);
  return Boolean(
    text(asset.exact_serial_number) ||
      text(asset.grading_cert_number) ||
      text(identity.serialNumber) ||
      text(identity.certificationNumber) ||
      text(identity.gradingCertNumber),
  );
}
function wholeQuantity(value: unknown) {
  const parsed = Math.floor(Number(value || 0));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function mercariSold(status: unknown) {
  return /^(sold|ended|inactive|out[_ -]?of[_ -]?stock|completed)$/i.test(
    String(status || "").trim(),
  );
}

function mergeIdFor(groupFingerprint: string, sourceIds: string[]) {
  return createHash("sha256")
    .update(`${groupFingerprint}:${[...sourceIds].sort().join(",")}`)
    .digest("hex")
    .slice(0, 24);
}

function ownerScope(query: any, accountId: string, isOwner: boolean) {
  return isOwner
    ? query.or(`seller_account_id.eq.${accountId},seller_account_id.is.null`)
    : query.eq("seller_account_id", accountId);
}
export async function POST(request: Request) {
  const account = await getAuthenticatedAccountFromRequest(request);
  if (!account) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  await ensureAccountStoreMembership({
    accountId: account.id,
    role: "seller",
    status: "active",
  });

  const body = await request.json().catch(() => ({}));
  const sourceIds = Array.from(
    new Set(
      (Array.isArray(body.sourceInventoryItemIds)
        ? body.sourceInventoryItemIds
        : [body.inventoryItemId]
      )
        .map((value: unknown) => String(value || "").trim())
        .filter(Boolean),
    ),
  ).slice(0, 100) as string[];
  if (!sourceIds.length) {
    return Response.json(
      { success: false, error: "Select at least one scanned card to merge." },
      { status: 400 },
    );
  }
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const isOwner = OWNER_EMAILS.has(String(account.email || "").toLowerCase());

  let sourceQuery = supabase
    .from("inventory_items")
    .select("id,legacy_product_id,seller_account_id,status,quantity,price,title,metadata")
    .eq("store_id", storeId)
    .in("id", sourceIds);
  sourceQuery = ownerScope(sourceQuery, account.id, isOwner);
  const { data: sourceRows, error: sourceError } = await sourceQuery;
  if (sourceError) throw sourceError;
  if (!sourceRows || sourceRows.length !== sourceIds.length) {
    return Response.json(
      { success: false, error: "One or more selected scans were not found or not owned." },
      { status: 404 },
    );
  }

  const fingerprints = new Set(sourceRows.map((row) => fingerprint(row.metadata)));
  if (fingerprints.size !== 1 || fingerprints.has(null)) {
    return Response.json(
      { success: false, error: "Selected cards do not share one exact Registry fingerprint." },
      { status: 409 },
    );
  }
  const groupFingerprint = Array.from(fingerprints)[0] as string;
  const mergeId = mergeIdFor(groupFingerprint, sourceIds);
  const alreadyMerged = (row: (typeof sourceRows)[number]) => {
    const merge = record(record(row.metadata).commercial_merge);
    return (
      row.status === "archived" &&
      merge.state === "completed" &&
      merge.mergeId === mergeId &&
      merge.registryFingerprintSha256 === groupFingerprint
    );
  };
  if (
    sourceRows.some(
      (row) =>
        uniquePhysical(row.metadata) ||
        (row.status === "draft"
          ? wholeQuantity(row.quantity) < 1
          : !alreadyMerged(row)),
    )
  ) {
    return Response.json(
      {
        success: false,
        error:
          "Only unlisted raw non-serialized exact-card scans can be quantity-merged.",
      },
      { status: 409 },
    );
  }

  let targetQuery = supabase
    .from("inventory_items")
    .select("id,legacy_product_id,seller_account_id,status,quantity,price,title,metadata")
    .eq("store_id", storeId)
    .eq("status", "active");
  targetQuery = ownerScope(targetQuery, account.id, isOwner);
  const { data: activeRows, error: targetError } = await targetQuery.range(0, 4999);
  if (targetError) throw targetError;
  const targets = (activeRows || []).filter(
    (row) =>
      !sourceIds.includes(row.id) &&
      !uniquePhysical(row.metadata) &&
      fingerprint(row.metadata) === groupFingerprint,
  );
  if (targets.length !== 1) {
    return Response.json(
      {
        success: false,
        error:
          targets.length === 0
            ? "No active exact-card listing exists for this Registry fingerprint."
            : "More than one active exact-card listing exists. Reconcile the duplicates before merging.",
        activeExactMatchCount: targets.length,
      },
      { status: 409 },
    );
  }

  const target = targets[0];
  const quantityDelta = sourceRows.reduce((sum, row) => {
    if (alreadyMerged(row)) {
      return (
        sum +
        wholeQuantity(record(record(row.metadata).commercial_merge).mergedQuantity)
      );
    }
    return sum + wholeQuantity(row.quantity);
  }, 0);
  const targetQuantityBefore = wholeQuantity(target.quantity);
  const targetQuantityAfter = targetQuantityBefore + quantityDelta;
  const now = new Date().toISOString();
  const targetMetadata = record(target.metadata);
  const targetInstaComp = record(targetMetadata.instacomp);
  const dual = record(targetMetadata.dual_marketplace);
  const website = record(dual.website);
  const mercari = record(dual.mercari);
  const ebay = record(dual.ebay);
  const previousMercariStatus = text(mercari.status) || "draft";
  const nextMercari = mercariSold(previousMercariStatus)
    ? {
        ...mercari,
        status: "eligible_to_relist",
        relistEligible: true,
        relistReason: "exact_inventory_quantity_added",
        relistEligibleAt: now,
      }
    : mercari;

  const existingHistory = Array.isArray(targetInstaComp.exactMergeHistory)
    ? targetInstaComp.exactMergeHistory
    : [];
  const priorReceipt = existingHistory.find(
    (entry: unknown) => record(entry).mergeId === mergeId,
  );
  let productBefore: number | null = null;
  let productAfter: number | null = null;
  if (target.legacy_product_id) {
    const { data: product, error: productReadError } = await supabase
      .from("products")
      .select("id,quantity")
      .eq("store_id", storeId)
      .eq("id", target.legacy_product_id)
      .maybeSingle();
    if (productReadError) throw productReadError;
    if (product) {
      productBefore = wholeQuantity(product.quantity);
      productAfter = productBefore + quantityDelta;
    }
  }

  const scanIds = sourceRows
    .map((row) => text(record(record(row.metadata).instacomp).scanId))
    .filter((value): value is string => Boolean(value));
  const receipt = priorReceipt || {
    mergeId,
    registryFingerprintSha256: groupFingerprint,
    sourceInventoryItemIds: sourceIds,
    sourceScanIds: scanIds,
    quantityDelta,
    mergedAt: now,
    targetInventoryItemId: target.id,
    targetQuantityBefore,
    targetQuantityAfter,
    pricePreserved: target.price,
    reversible: true,
    channels: {
      website: {
        action: target.legacy_product_id ? "increment_quantity" : "inventory_only",
        quantityBefore: productBefore,
        quantityAfter: productAfter,
      },
      ebay: {
        action: "unchanged",
        status: text(ebay.status) || "draft",
        quantityDelta: 0,
      },
      mercari: {
        action: mercariSold(previousMercariStatus)
          ? "mark_eligible_to_relist"
          : "leave_existing_listing_unchanged",
        statusBefore: previousMercariStatus,
        statusAfter: text(nextMercari.status) || previousMercariStatus,
        quantityDelta: 0,
      },
    },
  };
  if (!priorReceipt) {
    const { data: targetUpdated, error: targetUpdateError } = await supabase
      .from("inventory_items")
      .update({
        quantity: targetQuantityAfter,
        metadata: {
          ...targetMetadata,
          instacomp: {
            ...targetInstaComp,
            commercialQuantity: targetQuantityAfter,
            exactMergeHistory: [...existingHistory.slice(-99), receipt],
          },
          dual_marketplace: {
            ...dual,
            website,
            ebay,
            mercari: nextMercari,
          },
        },
        updated_at: now,
      })
      .eq("store_id", storeId)
      .eq("id", target.id)
      .eq("quantity", targetQuantityBefore)
      .select("id,quantity")
      .maybeSingle();
    if (targetUpdateError) throw targetUpdateError;
    if (!targetUpdated) {
      return Response.json(
        {
          success: false,
          code: "MERGE_QUANTITY_RACE",
          error:
            "The existing listing quantity changed while this merge was running. Nothing was counted twice; reload and retry.",
        },
        { status: 409 },
      );
    }

    if (target.legacy_product_id && productAfter !== null) {
      const { data: productUpdated, error: productError } = await supabase
        .from("products")
        .update({ quantity: productAfter })
        .eq("store_id", storeId)
        .eq("id", target.legacy_product_id)
        .eq("quantity", productBefore)
        .select("id,quantity")
        .maybeSingle();
      if (productError || !productUpdated) {
        await supabase
          .from("inventory_items")
          .update({ quantity: targetQuantityBefore, metadata: targetMetadata })
          .eq("store_id", storeId)
          .eq("id", target.id)
          .eq("quantity", targetQuantityAfter);
        if (productError) throw productError;
        return Response.json(
          {
            success: false,
            code: "WEBSITE_QUANTITY_RACE",
            error:
              "Website quantity changed while the merge was running. The inventory increment was rolled back; reload and retry.",
          },
          { status: 409 },
        );
      }
    }
  }

  for (const source of sourceRows) {
    if (!alreadyMerged(source)) {
      const sourceMetadata = record(source.metadata);
      const sourceQuantity = wholeQuantity(source.quantity);
      const { error: archiveError } = await supabase
      .from("inventory_items")
      .update({
        status: "archived",
        quantity: 0,
        metadata: {
          ...sourceMetadata,
          commercial_merge: {
            mergeId,
            state: "completed",
            keeperInventoryItemId: target.id,
            registryFingerprintSha256: groupFingerprint,
            mergedQuantity: sourceQuantity,
            mergedAt: now,
            reversible: true,
          },
        },
        updated_at: now,
      })
      .eq("store_id", storeId)
      .eq("id", source.id);
      if (archiveError) throw archiveError;
    }

    if (
      source.legacy_product_id &&
      source.legacy_product_id !== target.legacy_product_id
    ) {
      await supabase
        .from("products")
        .update({ quantity: 0, archived_at: now })
        .eq("store_id", storeId)
        .eq("id", source.legacy_product_id)
        .throwOnError();
    }
  }

  return Response.json({
    success: true,
    idempotent: Boolean(priorReceipt),
    mergeId,
    registryFingerprintSha256: groupFingerprint,
    targetInventoryItemId: target.id,
    targetTitle: target.title,
    sourceInventoryItemIds: sourceIds,
    quantityDelta,
    targetQuantityBefore: priorReceipt
      ? Number(record(priorReceipt).targetQuantityBefore || targetQuantityBefore)
      : targetQuantityBefore,
    targetQuantityAfter: priorReceipt
      ? Number(record(priorReceipt).targetQuantityAfter || targetQuantityAfter)
      : targetQuantityAfter,
    pricePreserved: target.price,
    websiteQuantityUpdated: Boolean(target.legacy_product_id),
    mercariAction: record(receipt).channels?.mercari?.action || null,
    receipt,
  });
}
