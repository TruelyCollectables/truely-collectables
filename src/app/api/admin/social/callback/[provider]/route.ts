import { NextResponse } from "next/server";
import { hasValidAdminRequest } from "@/src/lib/admin-request-auth";
import { configuredSiteOrigin } from "@/src/lib/site-origin";
import { getActiveStoreId } from "@/src/lib/stores";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { parseSocialOAuthState, type SocialProvider } from "@/src/lib/social-oauth";
import { SOCIAL_PROVIDERS, upsertSocialConnection } from "@/src/lib/social-publisher";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function redirect(provider: string, status: string, message?: string) {
  const url = new URL("/admin/sales", configuredSiteOrigin());
  url.searchParams.set("social", provider);
  url.searchParams.set("status", status);
  if (message) url.searchParams.set("message", message.slice(0, 180));
  return NextResponse.redirect(url);
}

async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(25000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(payload?.error?.message || payload?.error_description || payload?.message || `HTTP ${response.status}`);
  return payload;
}

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  if (!(await hasValidAdminRequest(request))) return NextResponse.redirect(new URL("/admin/login?next=%2Fadmin%2Fsales", configuredSiteOrigin()));
  const { provider: raw } = await context.params;
  const provider = raw as SocialProvider;
  if (!SOCIAL_PROVIDERS.includes(provider)) return NextResponse.json({ error: "Unknown social provider." }, { status: 404 });
  const url = new URL(request.url);
  const callbackError = url.searchParams.get("error_description") || url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const stateText = url.searchParams.get("state");
  if (callbackError) return redirect(provider, "error", callbackError);
  if (!code || !stateText) return redirect(provider, "error", "Authorization code or state was missing.");

  try {
    const state = parseSocialOAuthState(stateText);
    const storeId = getActiveStoreId();
    if (state.storeId !== storeId || state.provider !== provider) throw new Error("OAuth state belongs to another store or provider");
    const supabase = createSupabaseServerClient({ admin: true });
    const callbackUri = `${configuredSiteOrigin()}/api/admin/social/callback/${provider}`;

    if (provider === "facebook" || provider === "instagram") {
      const version = process.env.SOCIAL_META_GRAPH_VERSION || "v23.0";
      const token = await json(`https://graph.facebook.com/${version}/oauth/access_token?${new URLSearchParams({ client_id: String(process.env.META_APP_ID), client_secret: String(process.env.META_APP_SECRET), redirect_uri: callbackUri, code })}`);
      let userToken = String(token.access_token || "");
      try {
        const longToken = await json(`https://graph.facebook.com/${version}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: String(process.env.META_APP_ID), client_secret: String(process.env.META_APP_SECRET), fb_exchange_token: userToken })}`);
        if (longToken.access_token) userToken = String(longToken.access_token);
      } catch { /* page token below is still usable */ }
      const pages = await json(`https://graph.facebook.com/${version}/me/accounts?${new URLSearchParams({ fields: "id,name,access_token,instagram_business_account{id,username}", access_token: userToken })}`);
      const options = Array.isArray(pages.data) ? pages.data : [];
      const preferred = String(process.env.META_PAGE_ID || "");
      const page = options.find((item: any) => String(item.id) === preferred) || options[0];
      if (!page?.id || !page?.access_token) throw new Error("No manageable Facebook Page was returned. Grant Pages permissions and try again.");
      const expires = token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : null;
      await upsertSocialConnection({
        supabase, storeId, provider: "facebook", accountId: String(page.id), accountLabel: String(page.name || "Facebook Page"),
        accessToken: String(page.access_token), accessTokenExpiresAt: expires,
        scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
        metadata: { page_id: String(page.id), page_options: options.map((item: any) => ({ id: item.id, name: item.name })) },
      });
      if (page.instagram_business_account?.id) {
        await upsertSocialConnection({
          supabase, storeId, provider: "instagram", accountId: String(page.instagram_business_account.id),
          accountLabel: page.instagram_business_account.username ? `@${page.instagram_business_account.username}` : String(page.name || "Instagram"),
          accessToken: String(page.access_token), accessTokenExpiresAt: expires,
          scopes: ["instagram_basic", "instagram_content_publish"],
          metadata: { facebook_page_id: String(page.id), username: page.instagram_business_account.username || null },
        });
      }
      return redirect(provider, "connected", page.instagram_business_account?.id ? "Facebook Page and linked Instagram are connected." : "Facebook Page connected. No linked Instagram professional account was returned.");
    }

    if (provider === "threads") {
      const token = await json("https://graph.threads.net/oauth/access_token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: String(process.env.THREADS_APP_ID), client_secret: String(process.env.THREADS_APP_SECRET), grant_type: "authorization_code", redirect_uri: callbackUri, code }),
      });
      let accessToken = String(token.access_token || "");
      let expiresIn = Number(token.expires_in || 0);
      try {
        const longToken = await json(`https://graph.threads.net/access_token?${new URLSearchParams({ grant_type: "th_exchange_token", client_secret: String(process.env.THREADS_APP_SECRET), access_token: accessToken })}`);
        if (longToken.access_token) accessToken = String(longToken.access_token);
        if (longToken.expires_in) expiresIn = Number(longToken.expires_in);
      } catch { /* short-lived token can still complete connection */ }
      const me = await json(`https://graph.threads.net/v1.0/me?${new URLSearchParams({ fields: "id,username", access_token: accessToken })}`);
      await upsertSocialConnection({ supabase, storeId, provider, accountId: String(me.id || token.user_id || ""), accountLabel: me.username ? `@${me.username}` : "Threads", accessToken, accessTokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null, scopes: ["threads_basic", "threads_content_publish"], metadata: { username: me.username || null } });
      return redirect(provider, "connected");
    }

    if (provider === "pinterest") {
      const credentials = Buffer.from(`${process.env.PINTEREST_APP_ID}:${process.env.PINTEREST_APP_SECRET}`).toString("base64");
      const token = await json("https://api.pinterest.com/v5/oauth/token", {
        method: "POST", headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callbackUri }),
      });
      const accessToken = String(token.access_token || "");
      const [me, boards] = await Promise.all([
        json("https://api.pinterest.com/v5/user_account", { headers: { Authorization: `Bearer ${accessToken}` } }),
        json("https://api.pinterest.com/v5/boards?page_size=100", { headers: { Authorization: `Bearer ${accessToken}` } }),
      ]);
      const boardOptions = Array.isArray(boards.items) ? boards.items : [];
      const preferred = String(process.env.PINTEREST_DEFAULT_BOARD_ID || "");
      const board = boardOptions.find((item: any) => String(item.id) === preferred) || boardOptions[0] || null;
      await upsertSocialConnection({
        supabase, storeId, provider, accountId: String(me.id || ""), accountLabel: me.username ? `@${me.username}` : "Pinterest",
        accessToken, refreshToken: token.refresh_token || null,
        accessTokenExpiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : null,
        refreshTokenExpiresAt: token.refresh_token_expires_in ? new Date(Date.now() + Number(token.refresh_token_expires_in) * 1000).toISOString() : null,
        scopes: String(token.scope || "user_accounts:read,boards:read,pins:read,pins:write").split(/[ ,]+/).filter(Boolean),
        metadata: { username: me.username || null, board_id: board?.id || null, board_name: board?.name || null, board_options: boardOptions.map((item: any) => ({ id: item.id, name: item.name })) },
        status: board ? "connected" : "needs_configuration",
      });
      return redirect(provider, board ? "connected" : "needs-configuration", board ? undefined : "Connected, but create/select a Pinterest board before posting.");
    }

    if (provider === "tiktok") {
      const token = await json("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_key: String(process.env.TIKTOK_CLIENT_KEY), client_secret: String(process.env.TIKTOK_CLIENT_SECRET), code, grant_type: "authorization_code", redirect_uri: callbackUri }),
      });
      const accessToken = String(token.access_token || "");
      const me = await json("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,username", { headers: { Authorization: `Bearer ${accessToken}` } });
      const user = me.data?.user || {};
      await upsertSocialConnection({ supabase, storeId, provider, accountId: String(token.open_id || user.open_id || ""), accountLabel: user.display_name || user.username || "TikTok", accessToken, refreshToken: token.refresh_token || null, accessTokenExpiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : null, refreshTokenExpiresAt: token.refresh_expires_in ? new Date(Date.now() + Number(token.refresh_expires_in) * 1000).toISOString() : null, scopes: String(token.scope || "user.info.basic,video.publish").split(",").filter(Boolean), metadata: { username: user.username || null, privacy_level: "SELF_ONLY", unaudited_safe_default: true } });
      return redirect(provider, "connected", "TikTok connected with SELF_ONLY as the safe default until the app's Content Posting audit/settings allow broader visibility.");
    }

    const verifier = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("tcos_social_x_pkce="))?.slice("tcos_social_x_pkce=".length);
    if (!verifier) throw new Error("X PKCE verifier cookie is missing or expired. Restart connection.");
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    if (process.env.X_CLIENT_SECRET) headers.Authorization = `Basic ${Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString("base64")}`;
    const body = new URLSearchParams({ code, grant_type: "authorization_code", redirect_uri: callbackUri, code_verifier: decodeURIComponent(verifier), client_id: String(process.env.X_CLIENT_ID) });
    const token = await json("https://api.x.com/2/oauth2/token", { method: "POST", headers, body });
    const accessToken = String(token.access_token || "");
    const me = await json("https://api.x.com/2/users/me", { headers: { Authorization: `Bearer ${accessToken}` } });
    await upsertSocialConnection({ supabase, storeId, provider, accountId: String(me.data?.id || ""), accountLabel: me.data?.username ? `@${me.data.username}` : "X", accessToken, refreshToken: token.refresh_token || null, accessTokenExpiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : null, scopes: String(token.scope || "tweet.read tweet.write users.read offline.access").split(" ").filter(Boolean), metadata: { username: me.data?.username || null, text_only_v1: true } });
    const response = redirect(provider, "connected", "X connected. This first version publishes the sale copy/link; media upload can be enabled later without changing campaigns.");
    response.cookies.set("tcos_social_x_pkce", "", { path: "/api/admin/social/callback/x", maxAge: 0 });
    return response;
  } catch (error) {
    return redirect(provider, "error", error instanceof Error ? error.message : "Social authorization failed.");
  }
}
