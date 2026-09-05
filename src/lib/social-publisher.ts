import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptMarketplaceToken, encryptMarketplaceToken } from "./marketplace-token-crypto";
import { configuredSiteOrigin } from "./site-origin";
import type { SocialProvider } from "./social-oauth";

export const SOCIAL_PROVIDERS: SocialProvider[] = [
  "facebook",
  "instagram",
  "threads",
  "pinterest",
  "tiktok",
  "x",
];

export type SocialConnectionView = {
  provider: SocialProvider;
  label: string;
  configured: boolean;
  connected: boolean;
  status: string;
  accountLabel: string | null;
  lastError: string | null;
};

type CampaignRow = {
  id: string;
  store_id: string;
  name: string;
  percent_off: number;
  active: boolean;
  starts_at: string;
  ends_at: string | null;
  scope_type: "all" | "filter" | "products";
  scope: Record<string, unknown>;
};

type SocialPostRow = {
  id: string;
  store_id: string;
  campaign_id: string;
  provider: SocialProvider;
  status: "draft" | "scheduled" | "publishing" | "published" | "failed";
  title: string | null;
  text_content: string;
  hashtags: string[];
  link_url: string | null;
  image_url: string | null;
  image_storage_path: string | null;
  generator: string;
  scheduled_for: string | null;
  provider_post_id: string | null;
  provider_post_url: string | null;
  last_error: string | null;
};

const PROVIDER_LABELS: Record<SocialProvider, string> = {
  facebook: "Facebook Page",
  instagram: "Instagram",
  threads: "Threads",
  pinterest: "Pinterest",
  tiktok: "TikTok",
  x: "X",
};

function env(name: string) {
  return String(process.env[name] || "").trim();
}

export function socialProviderConfigured(provider: SocialProvider) {
  switch (provider) {
    case "facebook":
    case "instagram":
      return Boolean(env("META_APP_ID") && env("META_APP_SECRET"));
    case "threads":
      return Boolean(env("THREADS_APP_ID") && env("THREADS_APP_SECRET"));
    case "pinterest":
      return Boolean(env("PINTEREST_APP_ID") && env("PINTEREST_APP_SECRET"));
    case "tiktok":
      return Boolean(env("TIKTOK_CLIENT_KEY") && env("TIKTOK_CLIENT_SECRET"));
    case "x":
      return Boolean(env("X_CLIENT_ID"));
  }
}

export function socialProviderLabel(provider: SocialProvider) {
  return PROVIDER_LABELS[provider];
}

function scopeLabel(campaign: CampaignRow) {
  if (campaign.scope_type === "all") return "SITEWIDE SALE";
  if (campaign.scope_type === "products") {
    const count = Array.isArray(campaign.scope?.productIds) ? campaign.scope.productIds.length : 0;
    return count ? `${count} SELECT ITEMS` : "SELECT ITEMS";
  }
  const sections = Array.isArray(campaign.scope?.sections)
    ? campaign.scope.sections.map(String).filter(Boolean)
    : [];
  if (sections.length === 1) return `${sections[0].toUpperCase()} SALE`;
  return "SELECT INVENTORY";
}

function shortDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/Denver" }).format(date);
}

function defaultCopy(provider: SocialProvider, campaign: CampaignRow) {
  const percent = Number(campaign.percent_off);
  const scope = scopeLabel(campaign).toLowerCase();
  const end = shortDate(campaign.ends_at);
  const site = configuredSiteOrigin();
  const urgency = end ? ` through ${end}` : " now";
  const base = `${campaign.name}: Save ${percent}% on ${scope}${urgency}. Shop the sale at ${site}/shop`;
  if (provider === "x") return `${campaign.name} — ${percent}% OFF ${scope.toUpperCase()}${urgency}. ${site}/shop #SportsCards #Collectibles`;
  if (provider === "instagram") return `${campaign.name} 🔥\n\nSave ${percent}% on ${scope}${urgency}. No coupon code needed.\n\nShop: ${site}/shop\n\n#SportsCards #Collectibles #CardCollector #TruelyCollectables`;
  if (provider === "threads") return `${campaign.name} 🔥 ${percent}% off ${scope}${urgency}. No code needed. ${site}/shop`;
  if (provider === "pinterest") return `${campaign.name}: ${percent}% off ${scope}${urgency}. Shop sports cards and collectibles while the sale is live.`;
  if (provider === "tiktok") return `${campaign.name} 🔥 ${percent}% OFF ${scope.toUpperCase()}${urgency}. Shop Truely Collectables.`;
  return `${base}\n\nNo coupon code needed. Shop while the sale is live.`;
}

function defaultTitle(provider: SocialProvider, campaign: CampaignRow) {
  if (provider === "pinterest" || provider === "tiktok") {
    return `${campaign.name} — ${Number(campaign.percent_off)}% Off`;
  }
  return null;
}

function hashtagList(provider: SocialProvider) {
  if (provider === "instagram") return ["SportsCards", "Collectibles", "CardCollector", "TruelyCollectables"];
  if (provider === "tiktok") return ["SportsCards", "Collectibles", "CardTok"];
  return ["SportsCards", "Collectibles"];
}

function outputText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

async function aiDrafts(campaign: CampaignRow) {
  const paidEnabled = /^(1|true|yes)$/i.test(env("SOCIAL_ENABLE_PAID_OPENAI_SOCIAL_AI"));
  if (!paidEnabled) return null;
  const key = env("OPENAI_API_KEY");
  if (!key) return null;
  const model = env("SOCIAL_POST_OPENAI_MODEL") || env("OPENAI_MODEL") || env("INSTACOMP_OPENAI_FALLBACK_MODEL") || "gpt-4.1-mini";
  const site = configuredSiteOrigin();
  const prompt = `Create platform-specific organic social posts for a sports-card ecommerce sale. Return ONLY valid JSON with keys facebook, instagram, threads, pinterest, tiktok, x. Each value must be an object with title (string or null), text (string), hashtags (array of strings).\nSale name: ${campaign.name}\nDiscount: ${campaign.percent_off}%\nScope: ${scopeLabel(campaign)}\nStarts: ${campaign.starts_at}\nEnds: ${campaign.ends_at || "no fixed end"}\nShop URL: ${site}/shop\nRules: never invent inventory, players, scarcity, free shipping, coupon codes, or dollar savings. Say no code is needed. X text <= 260 characters. Pinterest title <= 100 characters. TikTok title <= 90 characters. Instagram may use line breaks. Keep tone energetic but credible. Do not use more than 5 hashtags.`;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: prompt, max_output_tokens: 1800 }),
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const text = outputText(payload).trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    if (!text) return null;
    const parsed = JSON.parse(text) as Record<string, any>;
    return parsed;
  } catch {
    return null;
  }
}

async function loadCampaign(supabase: SupabaseClient, storeId: string, campaignId: string) {
  const { data, error } = await supabase
    .from("store_sales_campaigns")
    .select("id,store_id,name,percent_off,active,starts_at,ends_at,scope_type,scope")
    .eq("store_id", storeId)
    .eq("id", campaignId)
    .single();
  if (error || !data) throw new Error(error?.message || "Sale campaign not found");
  return data as CampaignRow;
}

async function saleGraphic(params: { campaign: CampaignRow }) {
  return {
    imageUrl: `${configuredSiteOrigin()}/api/social-sale-image/${encodeURIComponent(params.campaign.id)}`,
    storagePath: null,
  };
}

export async function generateSocialCampaign(params: { supabase: SupabaseClient; storeId: string; campaignId: string }) {
  const campaign = await loadCampaign(params.supabase, params.storeId, params.campaignId);
  const [graphic, generated] = await Promise.all([
    saleGraphic({ campaign }),
    aiDrafts(campaign),
  ]);
  const now = new Date().toISOString();
  const linkUrl = `${configuredSiteOrigin()}/shop`;
  const drafts = SOCIAL_PROVIDERS.map((provider) => {
    const ai = generated?.[provider];
    const text = String(ai?.text || defaultCopy(provider, campaign)).trim();
    const title = ai?.title == null ? defaultTitle(provider, campaign) : String(ai.title).trim().slice(0, 100) || null;
    const hashtags = Array.isArray(ai?.hashtags)
      ? ai.hashtags.map((value: unknown) => String(value).replace(/^#/, "").trim()).filter(Boolean).slice(0, 5)
      : hashtagList(provider);
    return {
      store_id: params.storeId,
      campaign_id: campaign.id,
      provider,
      status: "draft",
      title,
      text_content: provider === "x" ? text.slice(0, 280) : text.slice(0, 2200),
      hashtags,
      link_url: linkUrl,
      image_url: graphic.imageUrl,
      image_storage_path: graphic.storagePath,
      generator: generated ? "openai" : "template",
      scheduled_for: null,
      provider_post_id: null,
      provider_post_url: null,
      last_error: null,
      generated_at: now,
      updated_at: now,
    };
  });
  const existingResult = await params.supabase
    .from("store_social_posts")
    .select("provider,status")
    .eq("store_id", params.storeId)
    .eq("campaign_id", campaign.id);
  if (existingResult.error) throw new Error(existingResult.error.message);
  const publishedProviders = new Set(
    (existingResult.data || [])
      .filter((row: any) => row.status === "published")
      .map((row: any) => String(row.provider)),
  );
  const writableDrafts = drafts.filter((draft) => !publishedProviders.has(draft.provider));
  if (writableDrafts.length) {
    const { error } = await params.supabase
      .from("store_social_posts")
      .upsert(writableDrafts, { onConflict: "store_id,campaign_id,provider" });
    if (error) throw new Error(error.message);
  }
  const finalResult = await params.supabase
    .from("store_social_posts")
    .select("*")
    .eq("store_id", params.storeId)
    .eq("campaign_id", campaign.id)
    .order("provider", { ascending: true });
  if (finalResult.error) throw new Error(finalResult.error.message);
  return { campaign, drafts: finalResult.data || [], generator: generated ? "openai" : "template", imageUrl: graphic.imageUrl };
}

export async function listSocialConnections(params: { supabase: SupabaseClient; storeId: string }) {
  const { data, error } = await params.supabase
    .from("store_social_connections")
    .select("provider,connection_status,provider_account_label,last_error")
    .eq("store_id", params.storeId);
  if (error) throw new Error(error.message);
  const byProvider = new Map((data || []).map((row: any) => [row.provider, row]));
  return SOCIAL_PROVIDERS.map((provider): SocialConnectionView => {
    const row: any = byProvider.get(provider);
    return {
      provider,
      label: socialProviderLabel(provider),
      configured: socialProviderConfigured(provider),
      connected: row?.connection_status === "connected",
      status: row?.connection_status || "disconnected",
      accountLabel: row?.provider_account_label || null,
      lastError: row?.last_error || null,
    };
  });
}

export async function getSocialCampaignState(params: { supabase: SupabaseClient; storeId: string; campaignId?: string | null }) {
  const connections = await listSocialConnections(params);
  if (!params.campaignId) return { connections, drafts: [], attempts: [] };
  const [draftResult, attemptResult] = await Promise.all([
    params.supabase
      .from("store_social_posts")
      .select("*")
      .eq("store_id", params.storeId)
      .eq("campaign_id", params.campaignId)
      .order("provider", { ascending: true }),
    params.supabase
      .from("store_social_publish_attempts")
      .select("id,provider,outcome,provider_post_url,error_message,attempted_at")
      .eq("store_id", params.storeId)
      .eq("campaign_id", params.campaignId)
      .order("attempted_at", { ascending: false })
      .limit(40),
  ]);
  if (draftResult.error) throw new Error(draftResult.error.message);
  if (attemptResult.error) throw new Error(attemptResult.error.message);
  return { connections, drafts: draftResult.data || [], attempts: attemptResult.data || [] };
}

export async function saveSocialDraft(params: { supabase: SupabaseClient; storeId: string; postId: string; title?: unknown; text?: unknown; hashtags?: unknown; generator?: unknown }) {
  const title = params.title == null ? null : String(params.title).trim().slice(0, 100) || null;
  const text = String(params.text || "").trim();
  if (!text) throw new Error("Post text cannot be empty");
  const hashtags = Array.isArray(params.hashtags)
    ? params.hashtags.map(String).map((value) => value.replace(/^#/, "").trim()).filter(Boolean).slice(0, 8)
    : [];
  const generator = ["template", "template-fallback", "cloudflare-workers-ai", "openai"].includes(String(params.generator || ""))
    ? String(params.generator)
    : "template";
  const { data, error } = await params.supabase
    .from("store_social_posts")
    .update({ title, text_content: text.slice(0, 2200), hashtags, generator, status: "draft", scheduled_for: null, last_error: null, updated_at: new Date().toISOString() })
    .eq("store_id", params.storeId)
    .eq("id", params.postId)
    .in("status", ["draft", "failed", "scheduled"])
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Published or actively publishing posts cannot be edited back into drafts.");
  return data;
}

export async function upsertSocialConnection(params: {
  supabase: SupabaseClient;
  storeId: string;
  provider: SocialProvider;
  accountId: string | null;
  accountLabel: string | null;
  scopes?: string[];
  accessToken: string;
  refreshToken?: string | null;
  accessTokenExpiresAt?: string | null;
  refreshTokenExpiresAt?: string | null;
  metadata?: Record<string, unknown>;
  status?: "connected" | "needs_configuration";
}) {
  const now = new Date().toISOString();
  const { data: connection, error } = await params.supabase
    .from("store_social_connections")
    .upsert({
      store_id: params.storeId,
      provider: params.provider,
      connection_status: params.status || "connected",
      provider_account_id: params.accountId,
      provider_account_label: params.accountLabel,
      oauth_scope: params.scopes || [],
      token_storage_key: `store_social_connection_tokens:${params.storeId}:${params.provider}`,
      access_token_expires_at: params.accessTokenExpiresAt || null,
      refresh_token_expires_at: params.refreshTokenExpiresAt || null,
      provider_metadata: params.metadata || {},
      last_error: null,
      connected_at: now,
      updated_at: now,
    }, { onConflict: "store_id,provider" })
    .select("id")
    .single();
  if (error || !connection?.id) throw new Error(error?.message || "Social connection could not be saved");
  const { error: tokenError } = await params.supabase
    .from("store_social_connection_tokens")
    .upsert({
      connection_id: connection.id,
      store_id: params.storeId,
      provider: params.provider,
      encrypted_access_token: encryptMarketplaceToken(params.accessToken),
      encrypted_refresh_token: params.refreshToken ? encryptMarketplaceToken(params.refreshToken) : null,
      updated_at: now,
    }, { onConflict: "store_id,provider" });
  if (tokenError) throw new Error(tokenError.message);
  return connection.id as string;
}

async function connectionBundle(params: { supabase: SupabaseClient; storeId: string; provider: SocialProvider }) {
  const { data: connection, error } = await params.supabase
    .from("store_social_connections")
    .select("id,connection_status,provider_account_id,provider_account_label,provider_metadata,access_token_expires_at,oauth_scope")
    .eq("store_id", params.storeId)
    .eq("provider", params.provider)
    .single();
  if (error || !connection || connection.connection_status !== "connected") throw new Error(`${socialProviderLabel(params.provider)} is not connected`);
  const { data: tokens, error: tokenError } = await params.supabase
    .from("store_social_connection_tokens")
    .select("encrypted_access_token,encrypted_refresh_token")
    .eq("store_id", params.storeId)
    .eq("provider", params.provider)
    .single();
  if (tokenError || !tokens?.encrypted_access_token) throw new Error(`${socialProviderLabel(params.provider)} access token is missing`);

  let accessToken = decryptMarketplaceToken(tokens.encrypted_access_token);
  let refreshToken = tokens.encrypted_refresh_token ? decryptMarketplaceToken(tokens.encrypted_refresh_token) : null;
  const expiresAt = connection.access_token_expires_at ? new Date(String(connection.access_token_expires_at)).getTime() : 0;
  const needsRefresh = params.provider === "x" && refreshToken && (!expiresAt || expiresAt <= Date.now() + 2 * 60_000);
  if (needsRefresh) {
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    if (env("X_CLIENT_SECRET")) headers.Authorization = `Basic ${Buffer.from(`${env("X_CLIENT_ID")}:${env("X_CLIENT_SECRET")}`).toString("base64")}`;
    const refreshed = await jsonFetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers,
      body: new URLSearchParams({ refresh_token: String(refreshToken), grant_type: "refresh_token", client_id: env("X_CLIENT_ID") }),
    });
    accessToken = String(refreshed.access_token || "");
    refreshToken = refreshed.refresh_token ? String(refreshed.refresh_token) : refreshToken;
    if (!accessToken) throw new Error("X token refresh returned no access token");
    const accessTokenExpiresAt = refreshed.expires_in ? new Date(Date.now() + Number(refreshed.expires_in) * 1000).toISOString() : null;
    const scope = String(refreshed.scope || "").split(" ").filter(Boolean);
    const now = new Date().toISOString();
    const tokenUpdate = await params.supabase
      .from("store_social_connection_tokens")
      .update({ encrypted_access_token: encryptMarketplaceToken(accessToken), encrypted_refresh_token: refreshToken ? encryptMarketplaceToken(refreshToken) : null, updated_at: now })
      .eq("store_id", params.storeId)
      .eq("provider", params.provider);
    if (tokenUpdate.error) throw new Error(tokenUpdate.error.message);
    const connectionUpdate = await params.supabase
      .from("store_social_connections")
      .update({ access_token_expires_at: accessTokenExpiresAt, oauth_scope: scope.length ? scope : connection.oauth_scope || [], last_error: null, updated_at: now })
      .eq("id", connection.id)
      .eq("store_id", params.storeId);
    if (connectionUpdate.error) throw new Error(connectionUpdate.error.message);
  }
  return { connection, accessToken, refreshToken };
}

async function jsonFetch(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    const message = payload?.error?.message || payload?.message || payload?.error_description || `HTTP ${response.status}`;
    throw new Error(String(message).slice(0, 500));
  }
  return payload;
}

async function providerPublish(post: SocialPostRow, bundle: Awaited<ReturnType<typeof connectionBundle>>) {
  const text = post.text_content;
  const metadata = (bundle.connection.provider_metadata || {}) as Record<string, any>;
  switch (post.provider) {
    case "facebook": {
      const version = env("SOCIAL_META_GRAPH_VERSION") || "v23.0";
      const pageId = String(bundle.connection.provider_account_id || metadata.page_id || "");
      if (!pageId) throw new Error("Facebook Page ID is missing");
      const body = new URLSearchParams({ url: String(post.image_url || ""), caption: text, access_token: bundle.accessToken });
      const payload = await jsonFetch(`https://graph.facebook.com/${version}/${encodeURIComponent(pageId)}/photos`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
      return { id: String(payload.id || payload.post_id || ""), url: payload.post_id ? `https://www.facebook.com/${payload.post_id}` : null, metadata: payload };
    }
    case "instagram": {
      const version = env("SOCIAL_META_GRAPH_VERSION") || "v23.0";
      const accountId = String(bundle.connection.provider_account_id || "");
      if (!accountId || !post.image_url) throw new Error("Instagram business account or sale image is missing");
      const create = await jsonFetch(`https://graph.facebook.com/${version}/${encodeURIComponent(accountId)}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ image_url: post.image_url, caption: text, access_token: bundle.accessToken }),
      });
      const publish = await jsonFetch(`https://graph.facebook.com/${version}/${encodeURIComponent(accountId)}/media_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ creation_id: String(create.id), access_token: bundle.accessToken }),
      });
      return { id: String(publish.id || ""), url: null, metadata: publish };
    }
    case "threads": {
      const accountId = String(bundle.connection.provider_account_id || "me");
      const params = new URLSearchParams({ media_type: post.image_url ? "IMAGE" : "TEXT", text, access_token: bundle.accessToken });
      if (post.image_url) params.set("image_url", post.image_url);
      const create = await jsonFetch(`https://graph.threads.net/v1.0/${encodeURIComponent(accountId)}/threads`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params });
      const publish = await jsonFetch(`https://graph.threads.net/v1.0/${encodeURIComponent(accountId)}/threads_publish`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ creation_id: String(create.id), access_token: bundle.accessToken }) });
      return { id: String(publish.id || ""), url: null, metadata: publish };
    }
    case "pinterest": {
      const boardId = String(metadata.board_id || "");
      if (!boardId || !post.image_url) throw new Error("Choose a Pinterest board before publishing");
      const payload = await jsonFetch("https://api.pinterest.com/v5/pins", {
        method: "POST",
        headers: { Authorization: `Bearer ${bundle.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          board_id: boardId,
          title: post.title || text.slice(0, 100),
          description: text.slice(0, 800),
          link: post.link_url || configuredSiteOrigin(),
          media_source: { source_type: "image_url", url: post.image_url, is_standard: true },
        }),
      });
      return { id: String(payload.id || ""), url: payload.id ? `https://www.pinterest.com/pin/${payload.id}/` : null, metadata: payload };
    }
    case "tiktok": {
      if (!post.image_url) throw new Error("TikTok photo post needs a public sale image");
      const creator = await jsonFetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", { method: "POST", headers: { Authorization: `Bearer ${bundle.accessToken}`, "Content-Type": "application/json; charset=UTF-8" }, body: "{}" });
      const privacyOptions = creator?.data?.privacy_level_options || [];
      const requested = String(metadata.privacy_level || "SELF_ONLY");
      const privacy = privacyOptions.includes(requested) ? requested : privacyOptions.includes("SELF_ONLY") ? "SELF_ONLY" : privacyOptions[0];
      if (!privacy) throw new Error("TikTok did not return an allowed privacy level");
      const payload = await jsonFetch("https://open.tiktokapis.com/v2/post/publish/content/init/", {
        method: "POST",
        headers: { Authorization: `Bearer ${bundle.accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({
          post_mode: "DIRECT_POST",
          media_type: "PHOTO",
          post_info: { title: (post.title || text).slice(0, 90), description: text.slice(0, 2200), privacy_level: privacy, disable_comment: false, auto_add_music: true },
          source_info: { source: "PULL_FROM_URL", photo_images: [post.image_url], photo_cover_index: 0 },
        }),
      });
      return { id: String(payload?.data?.publish_id || ""), url: null, metadata: payload };
    }
    case "x": {
      let mediaId: string | null = null;
      let mediaMetadata: Record<string, unknown> | null = null;
      if (post.image_url) {
        const imageResponse = await fetch(post.image_url, { signal: AbortSignal.timeout(30000) });
        if (!imageResponse.ok) throw new Error(`X sale image download failed: HTTP ${imageResponse.status}`);
        const contentType = String(imageResponse.headers.get("content-type") || "image/png").split(";")[0].trim().toLowerCase();
        if (!["image/jpeg", "image/png", "image/webp", "image/bmp", "image/pjpeg", "image/tiff"].includes(contentType)) throw new Error(`X sale image type is unsupported: ${contentType}`);
        const bytes = Buffer.from(await imageResponse.arrayBuffer());
        if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error("X sale image must be between 1 byte and 5 MB");
        const uploaded = await jsonFetch("https://api.x.com/2/media/upload", {
          method: "POST",
          headers: { Authorization: `Bearer ${bundle.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ media: bytes.toString("base64"), media_category: "tweet_image", media_type: contentType, shared: false }),
        });
        mediaId = String(uploaded?.data?.id || "");
        if (!mediaId) throw new Error("X media upload returned no media ID");
        mediaMetadata = uploaded;
      }
      const body: Record<string, unknown> = { text: text.slice(0, 280) };
      if (mediaId) body.media = { media_ids: [mediaId] };
      const payload = await jsonFetch("https://api.x.com/2/tweets", {
        method: "POST",
        headers: { Authorization: `Bearer ${bundle.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const id = String(payload?.data?.id || "");
      return { id, url: id ? `https://x.com/i/web/status/${id}` : null, metadata: { post: payload, media: mediaMetadata } };
    }
  }
}

export async function publishSocialPost(params: { supabase: SupabaseClient; storeId: string; postId: string }) {
  const { data, error } = await params.supabase
    .from("store_social_posts")
    .select("*")
    .eq("store_id", params.storeId)
    .eq("id", params.postId)
    .single();
  if (error || !data) throw new Error(error?.message || "Social post not found");
  const post = data as SocialPostRow;
  if (post.status === "published") return { post, alreadyPublished: true };
  const claimResult = await params.supabase
    .from("store_social_posts")
    .update({ status: "publishing", last_error: null, updated_at: new Date().toISOString() })
    .eq("id", post.id)
    .eq("store_id", params.storeId)
    .in("status", ["draft", "scheduled", "failed"])
    .select("id")
    .maybeSingle();
  if (claimResult.error) throw new Error(claimResult.error.message);
  if (!claimResult.data) {
    return { provider: post.provider, ok: true, skipped: true, reason: "already_claimed_or_published" };
  }
  try {
    const bundle = await connectionBundle({ supabase: params.supabase, storeId: params.storeId, provider: post.provider });
    const result = await providerPublish(post, bundle);
    const now = new Date().toISOString();
    await Promise.all([
      params.supabase.from("store_social_posts").update({ status: "published", scheduled_for: null, provider_post_id: result.id || null, provider_post_url: result.url || null, last_error: null, published_at: now, updated_at: now }).eq("id", post.id).eq("store_id", params.storeId),
      params.supabase.from("store_social_publish_attempts").insert({ store_id: params.storeId, post_id: post.id, campaign_id: post.campaign_id, provider: post.provider, outcome: "published", provider_post_id: result.id || null, provider_post_url: result.url || null, response_metadata: result.metadata || {} }),
    ]);
    return { provider: post.provider, ok: true, id: result.id || null, url: result.url || null };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Social publishing failed";
    const now = new Date().toISOString();
    await Promise.all([
      params.supabase.from("store_social_posts").update({ status: "failed", last_error: message.slice(0, 500), updated_at: now }).eq("id", post.id).eq("store_id", params.storeId),
      params.supabase.from("store_social_publish_attempts").insert({ store_id: params.storeId, post_id: post.id, campaign_id: post.campaign_id, provider: post.provider, outcome: "failed", error_message: message.slice(0, 500), response_metadata: {} }),
    ]);
    return { provider: post.provider, ok: false, error: message };
  }
}

export async function publishOrScheduleSocialPosts(params: { supabase: SupabaseClient; storeId: string; postIds: string[]; scheduledFor?: string | null }) {
  const ids = [...new Set(params.postIds.map(String).filter(Boolean))].slice(0, SOCIAL_PROVIDERS.length);
  if (!ids.length) throw new Error("Select at least one social post");
  const when = params.scheduledFor ? new Date(params.scheduledFor) : null;
  if (when && !Number.isFinite(when.getTime())) throw new Error("Scheduled time is invalid");
  if (when && when.getTime() > Date.now() + 30_000) {
    const { data, error } = await params.supabase
      .from("store_social_posts")
      .update({ status: "scheduled", scheduled_for: when.toISOString(), last_error: null, updated_at: new Date().toISOString() })
      .eq("store_id", params.storeId)
      .in("id", ids)
      .in("status", ["draft", "failed", "scheduled"])
      .select("id,provider,status,scheduled_for");
    if (error) throw new Error(error.message);
    return { scheduled: true, results: data || [] };
  }
  const results = [];
  for (const postId of ids) results.push(await publishSocialPost({ supabase: params.supabase, storeId: params.storeId, postId }));
  return { scheduled: false, results };
}

export async function processDueSocialPosts(params: { supabase: SupabaseClient; storeId: string; limit?: number }) {
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  await params.supabase
    .from("store_social_posts")
    .update({ status: "scheduled", last_error: "Recovered stale scheduled publish claim.", updated_at: new Date().toISOString() })
    .eq("store_id", params.storeId)
    .eq("status", "publishing")
    .not("scheduled_for", "is", null)
    .lt("updated_at", staleBefore);
  const { data, error } = await params.supabase
    .from("store_social_posts")
    .select("id,provider")
    .eq("store_id", params.storeId)
    .eq("status", "scheduled")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(Math.min(Math.max(params.limit || 12, 1), 30));
  if (error) throw new Error(error.message);
  const results = [];
  for (const row of data || []) results.push(await publishSocialPost({ supabase: params.supabase, storeId: params.storeId, postId: row.id }));
  return { due: (data || []).length, results };
}

export async function disconnectSocialProvider(params: { supabase: SupabaseClient; storeId: string; provider: SocialProvider }) {
  const { data: connection } = await params.supabase.from("store_social_connections").select("id").eq("store_id", params.storeId).eq("provider", params.provider).maybeSingle();
  if (connection?.id) await params.supabase.from("store_social_connection_tokens").delete().eq("connection_id", connection.id);
  const { error } = await params.supabase
    .from("store_social_connections")
    .upsert({ store_id: params.storeId, provider: params.provider, connection_status: "disconnected", provider_account_id: null, provider_account_label: null, oauth_scope: [], token_storage_key: null, access_token_expires_at: null, refresh_token_expires_at: null, provider_metadata: {}, last_error: null, connected_at: null, updated_at: new Date().toISOString() }, { onConflict: "store_id,provider" });
  if (error) throw new Error(error.message);
}
