export const BUYER_CARD_VERIFICATION_REQUIRED = false;
export const BUYER_ACCOUNT_ACTIVE_STATUS = "active";
export const BUYER_MEMBERSHIP_ACTIVE_STATUS = "active";

function normalized(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function isBuyerAccountType(...values: unknown[]) {
  return values.some((value) => normalized(value) === "buyer");
}

export function shouldActivateLegacyBuyerAccount(params: {
  accountStatus?: unknown;
  defaultAccountType?: unknown;
  authAccountType?: unknown;
}) {
  return (
    normalized(params.accountStatus) === "payment_verification_required" &&
    isBuyerAccountType(params.defaultAccountType, params.authAccountType)
  );
}
