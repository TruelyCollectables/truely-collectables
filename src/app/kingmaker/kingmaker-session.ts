"use client";

export const KINGMAKER_LOCAL_BEARER = "kingmaker-local-admin-cookie";

export type KingmakerLocalSession = {
  access_token: string;
};

export async function getKingmakerLocalSession(
  _minimumValiditySeconds = 0,
  _forceRefresh = false,
): Promise<KingmakerLocalSession> {
  // The browser already sends the HttpOnly admin cookie on same-origin API
  // requests. This marker preserves the existing fetch call shape without
  // importing or refreshing the legacy seller/Supabase client session.
  return { access_token: KINGMAKER_LOCAL_BEARER };
}
