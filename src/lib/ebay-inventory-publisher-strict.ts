import "server-only";

import {
  getEbayPublishingReadiness,
  publishEbayInventoryItem as publishAuditedEbayInventoryItem,
  type EbayInventoryPublishInput,
  type EbayInventoryPublishResult,
  type EbaySetupReadiness,
} from "./ebay-inventory-publisher-audited";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  EbayInventoryPublishInput,
  EbayInventoryPublishResult,
  EbaySetupReadiness,
};

export async function publishEbayInventoryItem(params: {
  supabase: SupabaseClient;
  storeId: string;
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
