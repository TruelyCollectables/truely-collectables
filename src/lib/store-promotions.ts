import { createHash } from "node:crypto";

export const PROMOTION_CODE_PATTERN = /^[A-Za-z0-9-]{3,32}$/;

export function normalizePromotionCode(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

export function normalizePromotionCategory(value: unknown) {
  const category = String(value || "").trim().toLowerCase();
  return category || null;
}

export function normalizePromotionEmail(value: unknown) {
  const email = String(value || "").trim().toLowerCase();
  return email && email.includes("@") ? email : null;
}

export function normalizePromotionAddress(value: {
  line1?: unknown;
  city?: unknown;
  state?: unknown;
  postalCode?: unknown;
  country?: unknown;
}) {
  const parts = [
    value.line1, value.city, value.state, value.postalCode, value.country || "US",
  ].map((part) => String(part || "").trim().toLowerCase().replace(/\s+/g, " "));
  return parts.every(Boolean) ? parts.join("|") : null;
}

export function hashPromotionIdentity(value: string | null) {
  return value ? createHash("sha256").update(value, "utf8").digest("hex") : null;
}

export function categoryMatchesPromotion(itemCategory: unknown, promotionCategory: unknown) {
  const scope = normalizePromotionCategory(promotionCategory);
  return !scope || normalizePromotionCategory(itemCategory) === scope;
}

export function validatePromotionInput(input: {
  code: unknown;
  percentOff: unknown;
  maxRedemptions?: unknown;
  expiresAt?: unknown;
  startsAt?: unknown;
  category?: unknown;
  freeShipping?: unknown;
}) {
  const code = normalizePromotionCode(input.code);
  const percentOff = Number(input.percentOff);
  const maxRedemptions = input.maxRedemptions ? Number(input.maxRedemptions) : null;
  const startsAt = input.startsAt ? new Date(String(input.startsAt)) : null;
  const expiresAt = input.expiresAt ? new Date(String(input.expiresAt)) : null;
  const category = normalizePromotionCategory(input.category);
  const freeShipping = input.freeShipping === true;

  if (!PROMOTION_CODE_PATTERN.test(code)) throw new Error("Use 3-32 letters, numbers, or dashes for the coupon code.");
  if (!Number.isFinite(percentOff) || percentOff < 0 || percentOff > 100) throw new Error("Discount percent must be 0-100.");
  if (percentOff === 0 && !freeShipping) throw new Error("Add a discount percent or enable free shipping.");
  if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions <= 0)) throw new Error("Maximum redemptions must be a positive whole number.");
  if (startsAt && !Number.isFinite(startsAt.getTime())) throw new Error("Start date and time must be valid.");
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())) throw new Error("Expiration must be a valid future date and time.");
  if (startsAt && expiresAt && startsAt >= expiresAt) throw new Error("End date and time must be after the start date and time.");

  return { code, percentOff, maxRedemptions, startsAt, expiresAt, category, freeShipping };
}
