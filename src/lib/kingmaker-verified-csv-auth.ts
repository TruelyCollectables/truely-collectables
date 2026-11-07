import { getAuthenticatedAccountFromRequest as sellerAccount, ensureAccountStoreMembership as sellerMembership } from "./account-auth";
import { hasValidAdminRequest } from "./admin-request-auth";
export async function getAuthenticatedAccountFromRequest(request: Request) {
  if (await hasValidAdminRequest(request)) return { id: "kingmaker-local-owner", email: "sales@truelycollectables.com" };
  if (/^Bearer\s+kingmaker-local-admin-cookie$/i.test(request.headers.get("authorization") || "")) return null;
  return sellerAccount(request);
}
export async function ensureAccountStoreMembership(params: Parameters<typeof sellerMembership>[0]) {
  if (params.accountId === "kingmaker-local-owner") return;
  return sellerMembership(params);
}
