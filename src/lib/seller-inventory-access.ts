const STORE_OWNER_EMAILS = new Set([
  "sales@truelycollectables.com",
  "sales@trulycollectables.com",
]);

export function normalizeSellerAccountEmail(
  value: string | null | undefined,
) {
  return String(value || "").trim().toLowerCase();
}

export function isStoreOwnerSellerAccount(
  email: string | null | undefined,
) {
  return STORE_OWNER_EMAILS.has(normalizeSellerAccountEmail(email));
}

export function canManageSellerInventoryRow(params: {
  accountId: string;
  accountEmail: string | null | undefined;
  sellerAccountId: string | null | undefined;
}) {
  if (params.sellerAccountId === params.accountId) return true;

  return (
    isStoreOwnerSellerAccount(params.accountEmail) &&
    (params.sellerAccountId === null || params.sellerAccountId === undefined)
  );
}
