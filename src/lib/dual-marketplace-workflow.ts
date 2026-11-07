import type { DualMarketplaceFeeProfile } from "./dual-marketplace-pricing";

export type DualMarketplaceAction =
  | "save"
  | "publish-website"
  | "publish-ebay"
  | "publish-both";

export type DualMarketplaceReadinessInput = {
  sku: string | null;
  websiteTitle: string;
  websiteDescription: string;
  websitePrice: number;
  ebayTitle: string;
  ebayDescription: string;
  ebayPrice: number;
  quantity: number;
  imageUrls: string[];
  ebayCategoryId: string;
  ebayCondition: "LIKE_NEW" | "USED_VERY_GOOD";
  grader: string;
  grade: string;
  cardCondition: string;
  aspects: Record<string, string[]>;
};

export const MAX_DUAL_MARKETPLACE_SELECTION = 500;
export const MAX_DUAL_MARKETPLACE_REQUEST_ITEMS = 50;
export const DUAL_MARKETPLACE_EBAY_BATCH_SIZE = 5;
export const DUAL_MARKETPLACE_LOCAL_BATCH_SIZE = 50;

function unique(values: string[]) {
  return Array.from(new Set(values));
}

export function dualMarketplaceBatchSize(action: DualMarketplaceAction) {
  return action === "publish-ebay" || action === "publish-both"
    ? DUAL_MARKETPLACE_EBAY_BATCH_SIZE
    : DUAL_MARKETPLACE_LOCAL_BATCH_SIZE;
}

export function chunkDualMarketplaceItems<T>(
  items: T[],
  action: DualMarketplaceAction,
) {
  const batchSize = dualMarketplaceBatchSize(action);
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += batchSize) {
    chunks.push(items.slice(index, index + batchSize));
  }

  return chunks;
}

export function dualMarketplaceReadinessErrors(
  input: DualMarketplaceReadinessInput,
) {
  const website: string[] = [];
  const ebay: string[] = [];
  const structure: string[] = [];

  if (input.websiteTitle.length > 200) structure.push("website title is over 200 characters");
  if (input.websiteDescription.length > 100_000) {
    structure.push("website description is over 100,000 characters");
  }
  if (input.ebayTitle.length > 80) structure.push("eBay title is over 80 characters");
  if (input.ebayDescription.length > 100_000) {
    structure.push("eBay description is over 100,000 characters");
  }
  if (input.quantity > 1_000_000) structure.push("quantity is too large");
  if (input.ebayPrice > 10_000_000 || input.websitePrice > 10_000_000) {
    structure.push("price is too large");
  }

  for (const [name, values] of Object.entries(input.aspects)) {
    if (!name.trim()) structure.push("eBay item-specific name is blank");
    if (name.trim().length > 40) {
      structure.push(`eBay item-specific name is over 40 characters: ${name}`);
    }
    for (const value of values) {
      if (value.trim().length > 50) {
        structure.push(`eBay item-specific value is over 50 characters: ${name}`);
      }
    }
  }

  if (!input.websiteTitle.trim()) website.push("website title is missing");
  if (!input.websiteDescription.trim()) website.push("website description is missing");
  if (input.websitePrice <= 0) website.push("website price is missing");
  if (input.ebayPrice <= 0) website.push("eBay comparison price is missing");
  if (input.websitePrice >= input.ebayPrice && input.ebayPrice > 0) {
    website.push("website price must remain lower than the eBay price");
  }
  if (input.quantity < 1) website.push("quantity must be at least 1");
  if (!input.imageUrls.length) website.push("card image is missing");

  if (!input.sku) ebay.push("SKU is missing");
  if (!input.ebayTitle.trim()) ebay.push("eBay title is missing");
  if (!input.ebayDescription.trim()) ebay.push("eBay description is missing");
  if (input.ebayPrice <= 0) ebay.push("eBay price is missing");
  if (input.quantity < 1) ebay.push("quantity must be at least 1");
  if (!input.imageUrls.length) ebay.push("card image is missing");
  if (!/^\d+$/.test(input.ebayCategoryId)) ebay.push("eBay category is invalid");
  if (input.ebayCondition === "LIKE_NEW" && (!input.grader || !input.grade)) {
    ebay.push("graded cards require grader and grade");
  }
  if (input.ebayCondition === "USED_VERY_GOOD" && !input.cardCondition) {
    ebay.push("raw cards require a reviewed Card Condition");
  }

  return {
    structure: unique(structure),
    website: unique(website),
    ebay: unique(ebay),
  };
}

export function validateDualMarketplaceAction(
  action: DualMarketplaceAction,
  input: DualMarketplaceReadinessInput,
) {
  const readiness = dualMarketplaceReadinessErrors(input);

  if (action === "save") return readiness.structure;
  if (action === "publish-website") {
    return unique([...readiness.structure, ...readiness.website]);
  }
  if (action === "publish-ebay") {
    return unique([...readiness.structure, ...readiness.ebay]);
  }

  return unique([
    ...readiness.structure,
    ...readiness.website,
    ...readiness.ebay,
  ]);
}

export function dualMarketplaceFeeSummary(profile: DualMarketplaceFeeProfile) {
  return {
    ebayPercent: profile.ebayPercent,
    promotedPercent: profile.promotedPercent,
    ebayFixedUnderTen: profile.ebayFixedUnderTen,
    ebayFixedOverTen: profile.ebayFixed,
    websitePercent: profile.websitePercent,
    websiteFixed: profile.websiteFixed,
  };
}
