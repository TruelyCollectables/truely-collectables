export const ALLOWED_SHIPPING_COUNTRIES = ["US"] as const;

type AllowedShippingCountry = (typeof ALLOWED_SHIPPING_COUNTRIES)[number];

export function normalizeShippingCountry(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

export function isAllowedShippingCountry(value: unknown) {
  const country = normalizeShippingCountry(value) as AllowedShippingCountry;

  return ALLOWED_SHIPPING_COUNTRIES.includes(country);
}
