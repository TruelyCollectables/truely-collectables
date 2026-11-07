import {
  FLAGSHIP_STORE_ID,
  STORE_BRAND_NAME,
  STORE_LEGAL_NAME,
} from "./legal";

export const DEFAULT_STORE_ID = FLAGSHIP_STORE_ID;
export const DEFAULT_STORE_SLUG = "truely-collectables";

export const DEFAULT_STORE = {
  id: DEFAULT_STORE_ID,
  slug: DEFAULT_STORE_SLUG,
  displayName: STORE_BRAND_NAME,
  legalName: STORE_LEGAL_NAME,
} as const;

export type StoreContext = typeof DEFAULT_STORE;

export function getDefaultStoreContext(): StoreContext {
  return DEFAULT_STORE;
}

export function getActiveStoreContext(): StoreContext {
  return getDefaultStoreContext();
}

export function getDefaultStoreId(): string {
  return DEFAULT_STORE_ID;
}

export function getActiveStoreId(): string {
  return getActiveStoreContext().id;
}
