export const ADMIN_EBAY_ENVIRONMENTS = ["production", "sandbox"] as const;

export type AdminEbayEnvironment = (typeof ADMIN_EBAY_ENVIRONMENTS)[number];

export function cleanAdminSettingsText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseAdminSellerCommissionPercent(value: unknown) {
  const rawValue = cleanAdminSettingsText(value);

  if (!rawValue) {
    return null;
  }

  const percent = Number(rawValue);

  return Number.isFinite(percent) && percent >= 0 && percent <= 100
    ? percent
    : null;
}

export function parseAdminEbayEnvironment(value: unknown) {
  const environment = cleanAdminSettingsText(value);

  if (!environment) {
    return null;
  }

  return ADMIN_EBAY_ENVIRONMENTS.includes(environment as AdminEbayEnvironment)
    ? (environment as AdminEbayEnvironment)
    : null;
}

export function adminStoreOperationalSettingsError(params: {
  sellerCommissionPercent: unknown;
  ebayEnvironment: unknown;
}) {
  if (parseAdminSellerCommissionPercent(params.sellerCommissionPercent) === null) {
    return "Seller commission percent must be a number from 0 to 100.";
  }

  if (
    cleanAdminSettingsText(params.ebayEnvironment) &&
    parseAdminEbayEnvironment(params.ebayEnvironment) === null
  ) {
    return "eBay environment must be production or sandbox.";
  }

  return null;
}

export function readableAdminStoreSettingsFailure(
  error: unknown,
  fallbackMessage: string,
) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim().slice(0, 240);
  }

  return fallbackMessage;
}
