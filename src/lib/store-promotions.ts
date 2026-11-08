export const PROMOTION_CODE_PATTERN = /^[A-Za-z0-9-]{3,32}$/;

export function normalizePromotionCode(value: unknown) {
  return String(value || "").trim();
}

export function validatePromotionInput(input: {
  code: unknown;
  percentOff: unknown;
  maxRedemptions?: unknown;
  expiresAt?: unknown;
}) {
  const code = normalizePromotionCode(input.code);
  const percentOff = Number(input.percentOff);
  const maxRedemptions = input.maxRedemptions
    ? Number(input.maxRedemptions)
    : null;
  const expiresAt = input.expiresAt
    ? new Date(String(input.expiresAt))
    : null;

  if (!PROMOTION_CODE_PATTERN.test(code)) {
    throw new Error("Use 3-32 letters, numbers, or dashes for the coupon code.");
  }
  if (!Number.isFinite(percentOff) || percentOff <= 0 || percentOff > 100) {
    throw new Error("Discount percent must be greater than 0 and no more than 100.");
  }
  if (
    maxRedemptions !== null &&
    (!Number.isInteger(maxRedemptions) || maxRedemptions <= 0)
  ) {
    throw new Error("Maximum redemptions must be a positive whole number.");
  }
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())) {
    throw new Error("Expiration must be a valid future date and time.");
  }

  return { code, percentOff, maxRedemptions, expiresAt };
}
