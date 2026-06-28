export const SOFTWARE_OWNER_NAME = "Dag Danky Holdings LLC";
export const PLATFORM_SOFTWARE_NAME = "Totally Collectibles OS";
export const PLATFORM_SHORT_NAME = "TCOS";
export const PLATFORM_DOMAIN = "TotallyCollectibles.com";
export const FLAGSHIP_STORE_ID = "00000000-0000-4000-8000-000000000001";
export const STORE_BRAND_NAME = "Truely Collectables";
export const STORE_LEGAL_NAME = "Truely Collectables LLC";
export const TERMS_OF_SERVICE_VERSION = "2026-06-27";
export const TERMS_OF_SERVICE_PATH = "/terms";
export const SELLER_TERMS_OF_SERVICE_VERSION = "2026-06-27";
export const SELLER_TERMS_OF_SERVICE_PATH = "/seller-terms";
export const SELLER_COMMISSION_RATE = 0.05;

export function hasAcceptedTerms(value: unknown): boolean {
  return value === true || value === "true" || value === "on";
}
