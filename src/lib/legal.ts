export const SOFTWARE_OWNER_NAME = "Dag Danky Holdings LLC";
export const PLATFORM_SOFTWARE_NAME = "Totally Collectibles OS";
export const PLATFORM_SHORT_NAME = "TCOS";
export const PLATFORM_DOMAIN = "TotallyCollectibles.com";
export const FLAGSHIP_STORE_ID = "00000000-0000-4000-8000-000000000001";
export const STORE_BRAND_NAME = "Truely Collectables";
export const STORE_LEGAL_NAME = "Truely Collectables LLC";
export const STORE_SUPPORT_EMAIL = "sales@truelycollectables.com";
export const STORE_SUPPORT_PHONE = "(720) 284-3384";
export const STORE_SUPPORT_PHONE_E164 = "+17202843384";
export const STORE_ADDRESS_STREET = "17606 Peyton Dr";
export const STORE_ADDRESS_CITY = "Parker";
export const STORE_ADDRESS_REGION = "CO";
export const STORE_ADDRESS_POSTAL_CODE = "80134";
export const STORE_ADDRESS_COUNTRY = "US";
export const STORE_ADDRESS_FORMATTED = `${STORE_ADDRESS_STREET}, ${STORE_ADDRESS_CITY}, ${STORE_ADDRESS_REGION} ${STORE_ADDRESS_POSTAL_CODE}`;
export const TERMS_OF_SERVICE_VERSION = "2026-06-28";
export const TERMS_OF_SERVICE_PATH = "/terms";
export const PRIVACY_POLICY_VERSION = "2026-07-25";
export const PRIVACY_POLICY_PATH = "/privacy";
export const SHIPPING_POLICY_PATH = "/shipping";
export const RETURNS_POLICY_PATH = "/returns";
export const CONTACT_PATH = "/contact";
export const ABOUT_PATH = "/about";
export const SELLER_TERMS_OF_SERVICE_VERSION = "2026-06-27";
export const SELLER_TERMS_OF_SERVICE_PATH = "/seller-terms";
export const SELLER_COMMISSION_RATE = 0.08;

export function hasAcceptedTerms(value: unknown): boolean {
  return value === true || value === "true" || value === "on";
}
