import "server-only";

import { createHash } from "node:crypto";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "./account-auth";
import { applyActiveMarketConsensus } from "./active-market-consensus";
import {
  canonicalActiveMarketProofItemId,
} from "./active-market-competitor-proof";
import { handleActiveMarketAttackWithCompetitorProofGuard } from "./active-market-competitor-proof-guard";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

const OWNER_EMAILS = new Set([
  "sales@truelycollectables.com",
  "sales@trulycollectables.com",
]);

type Json = Record<string, any>;

type SellerProof = {
  itemId: string;
  checkedAt: string;
  confirmed: boolean;
  sellerUsername: string | null;
  feedbackScore: number | null;
  positiveFeedbackPercent: number | null;
  failureCode: string | null;
  failureMessage: string | null;
};

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  const result = String(value || "").trim();
  return result || null;
}

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

function receipt(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24);
}

function failedSellerProof(
  itemId: string,
  code: string,
  message: string,
): SellerProof {
  return {
    itemId,
    checkedAt: new Date().toISOString(),
    confirmed: false,
    sellerUsername: null,
    feedbackScore: null,
    positiveFeedbackPercent: null,
    failureCode: code,
    failureMessage: message.slice(0, 500),
  };
}

async function sellerProof(itemId: string): Promise<SellerProof> {
  const clientId = process.env.EBAY_CLIENT_ID;
  if (!clientId) {
    return failedSellerProof(
      itemId,
      "seller_proof_client_id_missing",
      "EBAY_CLIENT_ID is unavailable for seller-independence proof.",
    );
  }

  const url = new URL("https://open.api.ebay.com/shopping");
  url.searchParams.set("callname", "GetSingleItem");
  url.searchParams.set("responseencoding", "JSON");
  url.searchParams.set("appid", clientId);
  url.searchParams.set("siteid", "0");
  url.searchParams.set("version", "967");
  url.searchParams.set("ItemID", itemId);
  url.searchParams.set("IncludeSelector", "Details");

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    const payload: any = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      return failedSellerProof(
        itemId,
        `seller_proof_http_${response.status}`,
        "The eBay seller proof request did not return a usable response.",
      );
    }

    const ack = String(payload.Ack || "").toLowerCase();
    const item = record(payload.Item);
    const seller = record(item.Seller);
    const sellerUsername = text(seller.UserID || seller.userId || item.SellerUserID);
    if (ack !== "success" && ack !== "warning") {
      return failedSellerProof(
        itemId,
        "seller_proof_api_rejected",
        text(payload.Errors?.LongMessage || payload.Errors?.ShortMessage) ||
          "The eBay Shopping API rejected seller proof.",
      );
    }
    if (!sellerUsername) {
      return failedSellerProof(
        itemId,
        "seller_proof_username_missing",
        "The direct item response did not expose a seller username.",
      );
    }

    return {
      itemId,
      checkedAt: new Date().toISOString(),
      confirmed: true,
      sellerUsername,
      feedbackScore: number(seller.FeedbackScore),
      positiveFeedbackPercent: number(seller.PositiveFeedbackPercent),
      failureCode: null,
      failureMessage: null,
    };
  } catch (error) {
    return failedSellerProof(
      itemId,
      "seller_proof_request_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function stripOldConsensusNote(value: unknown): string {
  return String(value || "")
    .replace(/\s*ACTIVE MARKET CONSENSUS:[\s\S]*$/i, "")
    .trim();
}

export async function handleActiveMarketAttackWithConsensusGuard(
  request: Request,
  context: { params: Promise<{ inventoryItemId: string }> },
) {
  const baseResponse = await handleActiveMarketAttackWithCompetitorProofGuard(
    request,
    context,
  );
  const payload: any = await baseResponse.json().catch(() => null);
  if (!payload || !baseResponse.ok || payload.success !== true) {
    return Response.json(
      payload || { error: "Active Market Attack Mode failed." },
      { status: baseResponse.status },
    );
  }

  const tracking = record(payload.tracking);
  if (Number(tracking.soldCompCount || 0) > 0) {
    return Response.json(payload, { status: baseResponse.status });
  }

  const account = await getAuthenticatedAccountFromRequest(request);
  if (!account) return Response.json(payload, { status: baseResponse.status });
  await ensureAccountStoreMembership({
    accountId: account.id,
    role: "seller",
    status: "active",
  });

  const { inventoryItemId } = await context.params;
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const owner = OWNER_EMAILS.has(String(account.email || "").toLowerCase());
  const { data: item, error: itemError } = await supabase
    .from("inventory_items")
    .select("id,seller_account_id,metadata")
    .eq("id", inventoryItemId)
    .eq("store_id", storeId)
    .single();
  if (itemError || !item) {
    return Response.json(payload, { status: baseResponse.status });
  }
  if (
    !(
      item.seller_account_id === account.id ||
      (owner && item.seller_account_id === null)
    )
  ) {
    return Response.json(payload, { status: baseResponse.status });
  }

  const attack = record(tracking.activeMarketAttack || payload.attack);
  const competitorIds = uniqueStrings(
    list(attack.competitors)
      .map((candidate) => canonicalActiveMarketProofItemId(candidate))
      .filter(Boolean),
  ).slice(0, 10);
  const sellerProofs = await Promise.all(
    competitorIds.map((itemId) => sellerProof(itemId)),
  );
  const sellerProofById = new Map(
    sellerProofs.map((proof) => [proof.itemId, proof]),
  );
  const enrichedCompetitors = list(attack.competitors).map((value) => {
    const candidate = record(value);
    const itemId = canonicalActiveMarketProofItemId(candidate);
    const proof = itemId ? sellerProofById.get(itemId) : null;
    return {
      ...candidate,
      sellerUsername: proof?.sellerUsername || null,
      sellerProof: proof || null,
      sellerProofConfirmed: proof?.confirmed === true,
      flags: uniqueStrings([
        ...(Array.isArray(candidate.flags) ? candidate.flags : []),
        proof?.confirmed
          ? `seller proof confirmed: ${proof.sellerUsername}`
          : proof?.failureCode || "seller proof unavailable",
      ]),
    };
  });

  const consensus = applyActiveMarketConsensus({
    attack: {
      ...attack,
      competitors: enrichedCompetitors,
      marketConsensusSellerProofs: sellerProofs,
    },
  });
  const consensusAttack = record(consensus.attack);
  const consensusReceipt = receipt({
    competitorIds,
    sellerProofs,
    level: consensus.level,
    passed: consensus.passed,
    independentSellerCount: consensus.independentSellerCount,
    medianLandedPrice: consensus.medianLandedPrice,
    spreadPercent: consensus.spreadPercent,
    duplicateSellerCount: consensus.duplicateSellerCount,
    outlierCount: consensus.outlierCount,
    finalCompetitors: list(consensusAttack.competitors).map((value) => {
      const candidate = record(value);
      return {
        itemId: canonicalActiveMarketProofItemId(candidate),
        sellerUsername: candidate.sellerUsername,
        landedPrice: candidate.landedPrice,
      };
    }),
  });
  const baseTax =
    stripOldConsensusNote(consensusAttack.taxNote) ||
    "Sales tax is excluded because it varies by buyer location and is not controlled by the seller.";
  const consensusMessage = `ACTIVE MARKET CONSENSUS: ${consensus.passed ? "PASSED" : "BLOCKED"}. ${consensusAttack.marketConsensusSummary} Receipt ${consensusReceipt}.`;
  const marketLabel = String(
    record(consensusAttack.marketLocation).label || "US estimate",
  )
    .replace(/\s*·\s*consensus (?:passed|blocked).*$/i, "")
    .trim();
  const nextAttack: Json = {
    ...consensusAttack,
    marketConsensusReceipt: consensusReceipt,
    marketConsensusCheckedAt: new Date().toISOString(),
    taxNote: `${baseTax} ${consensusMessage}`,
    marketLocation: {
      ...record(consensusAttack.marketLocation),
      label: `${marketLabel} · consensus ${consensus.passed ? "passed" : "blocked"} · sellers ${consensus.independentSellerCount}`,
    },
    updatedAt: new Date().toISOString(),
  };

  const existingReasons = Array.isArray(tracking.reviewReasons)
    ? tracking.reviewReasons
        .map(String)
        .filter(
          (reason: string) =>
            reason !== "active_market_consensus_passed" &&
            reason !== "active_market_consensus_blocked",
        )
    : [];
  const nextTracking: Json = {
    ...tracking,
    activeMarketAttack: nextAttack,
    marketCompCount: Number(nextAttack.exactActiveCount || 0),
    trustedForPricing:
      consensus.passed &&
      tracking.trustedForPricing === true &&
      Number(nextAttack.exactActiveCount || 0) >= 2,
    marketPrice: consensus.passed ? tracking.marketPrice ?? null : null,
    deltaAmount: consensus.passed ? tracking.deltaAmount ?? null : null,
    deltaPercent: consensus.passed ? tracking.deltaPercent ?? null : null,
    pricingEvidenceMode: consensus.passed
      ? "active_market_attack"
      : "active_market_consensus_blocked",
    reviewReasons: uniqueStrings([
      ...existingReasons,
      consensus.passed
        ? "active_market_consensus_passed"
        : "active_market_consensus_blocked",
    ]),
    topMarketComps: nextAttack.competitors,
    marketConsensusReceipt: consensusReceipt,
    updatedAt: nextAttack.updatedAt,
  };

  const metadata = record(item.metadata);
  const root = record(metadata.instacomp_tracking);
  const { error: updateError } = await supabase
    .from("inventory_items")
    .update({
      metadata: {
        ...metadata,
        instacomp_tracking: {
          ...root,
          schema: "truely.instacompInventoryTrackingHistory.v15",
          current: nextTracking,
        },
      },
      updated_at: nextTracking.updatedAt,
    })
    .eq("id", inventoryItemId)
    .eq("store_id", storeId);
  if (updateError) throw updateError;

  return Response.json({
    ...payload,
    tracking: nextTracking,
    attack: nextAttack,
    mode: consensus.passed
      ? "active_market_attack"
      : "active_market_consensus_blocked",
    diagnostics: {
      ...record(payload.diagnostics),
      marketConsensusPassed: consensus.passed,
      marketConsensusLevel: consensus.level,
      marketConsensusIndependentSellerCount:
        consensus.independentSellerCount,
      marketConsensusMedianLandedPrice: consensus.medianLandedPrice,
      marketConsensusSpreadPercent: consensus.spreadPercent,
      marketConsensusDuplicateSellerCount: consensus.duplicateSellerCount,
      marketConsensusOutlierCount: consensus.outlierCount,
      marketConsensusExcludedCount: consensus.excludedCount,
      marketConsensusReceipt: consensusReceipt,
      marketConsensusSellerProofs: sellerProofs,
    },
  });
}
