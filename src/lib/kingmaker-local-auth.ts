import {
  ensureAccountStoreMembership as ensureSellerAccountStoreMembership,
  getAuthenticatedAccountFromRequest as getSellerAuthenticatedAccountFromRequest,
} from "./account-auth";
import { hasValidAdminRequest } from "./admin-request-auth";

export type KingmakerLocalAccount = {
  id: string;
  email: string;
  display_name: string;
};

const OWNER: KingmakerLocalAccount = {
  id: "kingmaker-local-owner",
  email: "sales@truelycollectables.com",
  display_name: "KINGMAKER Local Owner",
};

function hasBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  if (/^Bearer\s+kingmaker-local-admin-cookie$/i.test(authorization)) {
    return false;
  }
  return /^Bearer\s+\S+/i.test(authorization);
}

export async function getAuthenticatedAccountFromRequest(request: Request) {
  // KINGMAKER itself uses the local admin cookie and returns here without any
  // remote account lookup. The bearer fallback preserves legacy seller pages
  // that share a small set of these API routes.
  if (await hasValidAdminRequest(request)) return OWNER;
  if (!hasBearerToken(request)) return null;
  return getSellerAuthenticatedAccountFromRequest(request);
}

export async function ensureAccountStoreMembership(
  params: Parameters<typeof ensureSellerAccountStoreMembership>[0],
) {
  if (params.accountId === OWNER.id) {
    return { ok: true, authority: "kingmaker_local_admin_session" };
  }
  await ensureSellerAccountStoreMembership(params);
  return { ok: true, authority: "seller_account_membership" };
}
