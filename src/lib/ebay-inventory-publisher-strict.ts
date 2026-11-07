import "server-only";

import {
  getEbayPublishingReadiness,
  publishEbayInventoryItem as publishAuditedEbayInventoryItem,
  reviseExistingEbayInventoryItem as reviseAuditedExistingEbayInventoryItem,
  type EbayExistingRevisionInput,
  type EbayExistingRevisionResult,
  type EbayInventoryPublishInput,
  type EbayInventoryPublishResult,
  type EbaySetupReadiness,
} from "./ebay-inventory-publisher-audited";
import type { SupabaseClient } from "@supabase/supabase-js";


type EbayPublisherAuthority = {
  supabase?: SupabaseClient | null;
  storeId?: string | null;
  refreshToken?: string | null;
};

const SPORTS_AND_NONSPORT_RAW_CONDITIONS = new Set([
  "Near Mint or Better",
  "Excellent",
  "Very Good",
  "Poor",
]);

const CCG_RAW_CONDITIONS = new Set([
  "Near Mint or Better",
  "Lightly Played (Excellent)",
  "Moderately Played (Very Good)",
  "Heavily Played (Poor)",
]);

function exactRawConditionSet(categoryId: string) {
  return categoryId === "183454"
    ? CCG_RAW_CONDITIONS
    : SPORTS_AND_NONSPORT_RAW_CONDITIONS;
}

export { getEbayPublishingReadiness };
export type {
  EbayExistingRevisionInput,
  EbayExistingRevisionResult,
  EbayInventoryPublishInput,
  EbayInventoryPublishResult,
  EbaySetupReadiness,
};


export async function reviseExistingEbayInventoryItem(params: EbayPublisherAuthority & {
  revision: EbayExistingRevisionInput;
}): Promise<EbayExistingRevisionResult> {
  return reviseAuditedExistingEbayInventoryItem(params);
}

export async function publishEbayInventoryItem(params: EbayPublisherAuthority & {
  item: EbayInventoryPublishInput;
}): Promise<EbayInventoryPublishResult> {
  if (params.item.condition === "USED_VERY_GOOD") {
    const allowed = exactRawConditionSet(String(params.item.categoryId || ""));
    if (!allowed.has(String(params.item.cardCondition || ""))) {
      throw new Error(
        `The raw-card condition is not an exact eBay-supported value for category ${params.item.categoryId}. Review it before publishing.`,
      );
    }
  }

  return publishAuditedEbayInventoryItem(params);
}
