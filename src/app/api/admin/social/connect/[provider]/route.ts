import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { hasValidAdminRequest } from "@/src/lib/admin-request-auth";
import { configuredSiteOrigin } from "@/src/lib/site-origin";
import { getActiveStoreId } from "@/src/lib/stores";
import { createSocialOAuthState, type SocialProvider } from "@/src/lib/social-oauth";
import { SOCIAL_PROVIDERS, socialProviderConfigured } from "@/src/lib/social-publisher";

export const dynamic = "force-dynamic";

function callback(provider: SocialProvider) {
  return `${configuredSiteOrigin()}/api/admin/social/callback/${provider}`;
}

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  if (!(await hasValidAdminRequest(request))) return NextResponse.redirect(new URL("/admin/login?next=%2Fadmin%2Fsales", configuredSiteOrigin()));
  const { provider: raw } = await context.params;
  const provider = raw as SocialProvider;
  if (!SOCIAL_PROVIDERS.includes(provider)) return NextResponse.json({ error: "Unknown social provider." }, { status: 404 });
  if (!socialProviderConfigured(provider)) {
    return NextResponse.redirect(new URL(`/admin/sales?social=${provider}&status=not-configured`, configuredSiteOrigin()));
  }
  const state = createSocialOAuthState({ storeId: getActiveStoreId(), provider });
  let authorizeUrl: URL;
  if (provider === "facebook" || provider === "instagram") {
    const version = process.env.SOCIAL_META_GRAPH_VERSION || "v23.0";
    authorizeUrl = new URL(`https://www.facebook.com/${version}/dialog/oauth`);
    authorizeUrl.search = new URLSearchParams({
      client_id: String(process.env.META_APP_ID),
      redirect_uri: callback(provider),
      response_type: "code",
      scope: "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish",
      state,
    }).toString();
    return NextResponse.redirect(authorizeUrl);
  }

  if (provider === "threads") {
    authorizeUrl = new URL("https://threads.net/oauth/authorize");
    authorizeUrl.search = new URLSearchParams({
      client_id: String(process.env.THREADS_APP_ID),
      redirect_uri: callback(provider),
      response_type: "code",
      scope: "threads_basic,threads_content_publish",
      state,
    }).toString();
    return NextResponse.redirect(authorizeUrl);
  }

  if (provider === "pinterest") {
    authorizeUrl = new URL("https://www.pinterest.com/oauth/");
    authorizeUrl.search = new URLSearchParams({
      client_id: String(process.env.PINTEREST_APP_ID),
      redirect_uri: callback(provider),
      response_type: "code",
      scope: "user_accounts:read,boards:read,pins:read,pins:write",
      state,
    }).toString();
    return NextResponse.redirect(authorizeUrl);
  }

  if (provider === "tiktok") {
    authorizeUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
    authorizeUrl.search = new URLSearchParams({
      client_key: String(process.env.TIKTOK_CLIENT_KEY),
      redirect_uri: callback(provider),
      response_type: "code",
      scope: "user.info.basic,video.publish",
      state,
    }).toString();
    return NextResponse.redirect(authorizeUrl);
  }

  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  authorizeUrl = new URL("https://x.com/i/oauth2/authorize");
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: String(process.env.X_CLIENT_ID),
    redirect_uri: callback(provider),
    scope: "tweet.read tweet.write users.read offline.access",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set("tcos_social_x_pkce", verifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/admin/social/callback/x",
    maxAge: 600,
  });
  return response;
}
