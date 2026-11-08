export const ADMIN_EBAY_ENVIRONMENTS = ["production", "sandbox"] as const;

export type AdminEbayEnvironment = (typeof ADMIN_EBAY_ENVIRONMENTS)[number];

export function cleanAdminSettingsText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function adminSettingsEmailAddress(value: unknown) {
  const text = cleanAdminSettingsText(value);

  if (!text) return null;

  const displayAddressMatch = /<([^<>]+)>$/.exec(text);

  return (displayAddressMatch?.[1] || text).trim();
}

export function isValidAdminSettingsEmail(value: unknown) {
  const email = adminSettingsEmailAddress(value);

  if (!email) return true;
  if (email.length > 254 || /\s/.test(email)) return false;

  const parts = email.split("@");

  if (parts.length !== 2) return false;

  const [localPart, domain] = parts;

  return (
    localPart.length > 0 &&
    domain.length > 0 &&
    domain.includes(".") &&
    !domain.startsWith(".") &&
    !domain.endsWith(".")
  );
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
  supportEmail?: unknown;
  salesEmail?: unknown;
  offersEmail?: unknown;
  evidenceEmail?: unknown;
  evidenceFromEmail?: unknown;
  orderFromEmail?: unknown;
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

  const emailChecks = [
    ["Support Email", params.supportEmail, "valid email address"],
    ["Sales Email", params.salesEmail, "valid email address"],
    ["Offers Email", params.offersEmail, "valid email address"],
    ["Evidence Email", params.evidenceEmail, "valid email address"],
    [
      "Evidence From",
      params.evidenceFromEmail,
      "valid email address or Name <email> value",
    ],
    [
      "Order From",
      params.orderFromEmail,
      "valid email address or Name <email> value",
    ],
  ] as const;

  for (const [label, value, requirement] of emailChecks) {
    if (!isValidAdminSettingsEmail(value)) {
      return `${label} must be a ${requirement}.`;
    }
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
