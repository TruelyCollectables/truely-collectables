import type { SupabaseClient } from "@supabase/supabase-js";
import { PLATFORM_DOMAIN } from "./legal";
import { DEFAULT_STORE, getActiveStoreId } from "./stores";
import { configuredStripeMode } from "./stripe-credentials";

type StoreRow = {
  id?: string | null;
  slug?: string | null;
  display_name?: string | null;
  legal_name?: string | null;
  status?: string | null;
  primary_domain?: string | null;
};

type StoreSettingsRow = {
  support_email?: string | null;
  sales_email?: string | null;
  offers_email?: string | null;
  evidence_email?: string | null;
  evidence_from_email?: string | null;
  order_from_email?: string | null;
  stripe_mode?: string | null;
  stripe_account_id?: string | null;
  ebay_environment?: string | null;
  ebay_account_label?: string | null;
  seller_commission_rate?: number | string | null;
  metadata?: Record<string, unknown> | null;
};

export type StoreOperationalSettings = {
  storeId: string;
  slug: string;
  displayName: string;
  legalName: string | null;
  status: string;
  primaryDomain: string | null;
  supportEmail: string;
  salesEmail: string;
  offersEmail: string;
  evidenceEmail: string | null;
  evidenceFromEmail: string;
  orderFromEmail: string;
  stripeMode: string;
  stripeAccountId: string | null;
  ebayEnvironment: string;
  ebayAccountLabel: string | null;
  ebaySyncEnabled: boolean;
  sellerCommissionRate: number;
  metadata: Record<string, unknown>;
  source: "database" | "fallback";
};

function configured(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function emailDomain(primaryDomain: string | null | undefined) {
  const rawValue = configured(primaryDomain) || PLATFORM_DOMAIN;

  try {
    const normalized = rawValue.includes("://")
      ? new URL(rawValue).hostname
      : rawValue;

    return normalized
      .replace(/^www\./i, "")
      .replace(/\/.*$/, "")
      .toLowerCase();
  } catch {
    return PLATFORM_DOMAIN.toLowerCase();
  }
}

function fallbackEmail(localPart: string, domain: string) {
  return `${localPart}@${domain}`;
}

function metadataBoolean(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
  fallback: boolean,
) {
  const value = metadata?.[key];

  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }

  return fallback;
}

export function resolveStoreSettings(input: {
  store?: StoreRow | null;
  settings?: StoreSettingsRow | null;
  source?: StoreOperationalSettings["source"];
} = {}): StoreOperationalSettings {
  const storeId = input.store?.id || getActiveStoreId();
  const slug = input.store?.slug || DEFAULT_STORE.slug;
  const displayName = input.store?.display_name || DEFAULT_STORE.displayName;
  const legalName = input.store?.legal_name ?? DEFAULT_STORE.legalName;
  const primaryDomain = input.store?.primary_domain ?? null;
  const fallbackDomain = emailDomain(primaryDomain);
  const salesEmail =
    configured(input.settings?.sales_email) || fallbackEmail("sales", fallbackDomain);
  const offersEmail =
    configured(input.settings?.offers_email) || fallbackEmail("offers", fallbackDomain);

  return {
    storeId,
    slug,
    displayName,
    legalName,
    status: input.store?.status || "active",
    primaryDomain,
    supportEmail:
      configured(input.settings?.support_email) ||
      configured(process.env.TECHNICAL_SUPPORT_EMAIL) ||
      fallbackEmail("support", fallbackDomain),
    salesEmail,
    offersEmail,
    evidenceEmail:
      configured(input.settings?.evidence_email) ||
      configured(process.env.TRANSACTION_EVIDENCE_EMAIL),
    evidenceFromEmail:
      configured(input.settings?.evidence_from_email) ||
      configured(process.env.TRANSACTION_EVIDENCE_FROM) ||
      `${displayName} Evidence <${salesEmail}>`,
    orderFromEmail:
      configured(input.settings?.order_from_email) ||
      `${displayName} <${salesEmail}>`,
    stripeMode:
      configured(input.settings?.stripe_mode) ||
      configuredStripeMode(),
    stripeAccountId: configured(input.settings?.stripe_account_id),
    ebayEnvironment:
      configured(input.settings?.ebay_environment) ||
      process.env.EBAY_ENVIRONMENT ||
      "production",
    ebayAccountLabel:
      configured(input.settings?.ebay_account_label) ||
      `${displayName} eBay`,
    ebaySyncEnabled: metadataBoolean(
      input.settings?.metadata,
      "ebay_sync_enabled",
      true,
    ),
    sellerCommissionRate: Number(input.settings?.seller_commission_rate ?? 0.08),
    metadata: input.settings?.metadata || {},
    source: input.source || (input.settings ? "database" : "fallback"),
  };
}

export async function getStoreSettings(
  supabase: SupabaseClient,
  storeId = getActiveStoreId(),
): Promise<StoreOperationalSettings> {
  const { data: store } = await supabase
    .from("stores")
    .select("id,slug,display_name,legal_name,status,primary_domain")
    .eq("id", storeId)
    .maybeSingle();

  const { data: settings, error } = await supabase
    .from("store_settings")
    .select(
      "support_email,sales_email,offers_email,evidence_email,evidence_from_email,order_from_email,stripe_mode,stripe_account_id,ebay_environment,ebay_account_label,seller_commission_rate,metadata",
    )
    .eq("store_id", storeId)
    .maybeSingle();

  if (error) {
    return resolveStoreSettings({
      store: store as StoreRow | null,
      source: "fallback",
    });
  }

  return resolveStoreSettings({
    store: store as StoreRow | null,
    settings: settings as StoreSettingsRow | null,
    source: settings ? "database" : "fallback",
  });
}
