import { createClient } from "@supabase/supabase-js";
import type { requireInstaCompJobActor } from "./instacomp-job-server";
import { kingmakerPricingProfileOwner } from "./kingmaker-pricing-profile-server";
import {
  normalizeCloneName,
  normalizeKingmakerPricingProfileMutation,
  resolveKingmakerPricingProfilePreset,
} from "./kingmaker-pricing-profile-lifecycle";

type Actor = Awaited<ReturnType<typeof requireInstaCompJobActor>>;

type AtomicProfileResult = {
  id: string;
  version: number;
  retired?: boolean;
};

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Pricing profile lifecycle requires service-role access.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function scope(query: any, actor: Actor) {
  const { storeId, sellerAccountId } = kingmakerPricingProfileOwner(actor);
  query = query.eq("store_id", storeId);
  return sellerAccountId
    ? query.eq("seller_account_id", sellerAccountId)
    : query.is("seller_account_id", null);
}

function rpcError(error: { code?: string | null; message?: string | null } | null) {
  const code = String(error?.code || "unknown");
  const message = String(error?.message || "Pricing profile atomic operation failed.");
  throw new Error(`KINGMAKER_PRICING_PROFILE_RPC_FAILED:${code}:${message}`);
}

function atomicResult(data: unknown): AtomicProfileResult {
  const row = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
  const id = String(row?.id || "").trim();
  const version = Number(row?.version);
  if (!id || !Number.isInteger(version) || version < 1) {
    throw new Error("KINGMAKER_PRICING_PROFILE_RPC_RESULT_INVALID");
  }
  return {
    id,
    version,
    retired: row?.retired === true,
  };
}

export async function createKingmakerPricingProfileFromPreset(params: {
  actor: Actor;
  presetId: unknown;
  name?: unknown;
  isDefault?: boolean;
}) {
  const preset = resolveKingmakerPricingProfilePreset(params.presetId);
  if (!preset) throw new Error("Unknown pricing profile preset.");
  const profile = normalizeKingmakerPricingProfileMutation({
    ...preset,
    name: params.name || preset.name,
    isDefault: params.isDefault === true,
  });
  const { storeId, sellerAccountId } = kingmakerPricingProfileOwner(params.actor);
  const { data, error } = await client().rpc(
    "tcos_create_kingmaker_pricing_profile_atomic",
    {
      p_store_id: storeId,
      p_seller_account_id: sellerAccountId,
      p_name: profile.name,
      p_marketplace_fee_pct: profile.marketplaceFeePct,
      p_payment_fee_pct: profile.paymentFeePct,
      p_payment_fixed_fee: profile.paymentFixedFee,
      p_estimated_shipping_cost: profile.estimatedShippingCost,
      p_target_margin_pct: profile.targetMarginPct,
      p_is_default: profile.isDefault,
      p_audit_snapshot: { ...profile, presetId: preset.id },
    },
  );
  if (error) rpcError(error);
  const result = atomicResult(data);
  return { id: result.id, version: result.version, profile };
}

export async function updateKingmakerPricingProfile(params: {
  actor: Actor;
  profileId: string;
  body: Record<string, unknown>;
}) {
  const profile = normalizeKingmakerPricingProfileMutation(params.body);
  if (!profile.expectedVersion) {
    throw new Error("Pricing profile expectedVersion is required.");
  }
  const { storeId, sellerAccountId } = kingmakerPricingProfileOwner(params.actor);
  const { data, error } = await client().rpc(
    "tcos_update_kingmaker_pricing_profile_atomic",
    {
      p_store_id: storeId,
      p_seller_account_id: sellerAccountId,
      p_profile_id: params.profileId,
      p_expected_version: profile.expectedVersion,
      p_name: profile.name,
      p_marketplace_fee_pct: profile.marketplaceFeePct,
      p_payment_fee_pct: profile.paymentFeePct,
      p_payment_fixed_fee: profile.paymentFixedFee,
      p_estimated_shipping_cost: profile.estimatedShippingCost,
      p_target_margin_pct: profile.targetMarginPct,
      p_is_default: profile.isDefault,
      p_audit_snapshot: profile,
    },
  );
  if (error) rpcError(error);
  const result = atomicResult(data);
  return { id: result.id, version: result.version, profile };
}

export async function cloneKingmakerPricingProfile(params: {
  actor: Actor;
  profileId: string;
  name?: unknown;
  isDefault?: boolean;
}) {
  const { data: source, error: sourceError } = await scope(
    client()
      .from("tcos_kingmaker_pricing_profiles")
      .select("name")
      .eq("id", params.profileId)
      .is("archived_at", null),
    params.actor,
  ).maybeSingle();
  if (sourceError) throw new Error(`KINGMAKER_PRICING_PROFILE_SOURCE_FAILED:${sourceError.code || "unknown"}`);
  if (!source) throw new Error("Pricing profile not found.");

  const { storeId, sellerAccountId } = kingmakerPricingProfileOwner(params.actor);
  const name = normalizeCloneName(params.name, String(source.name));
  const { data, error } = await client().rpc(
    "tcos_clone_kingmaker_pricing_profile_atomic",
    {
      p_store_id: storeId,
      p_seller_account_id: sellerAccountId,
      p_source_profile_id: params.profileId,
      p_name: name,
      p_is_default: params.isDefault === true,
    },
  );
  if (error) rpcError(error);
  const result = atomicResult(data);
  return { id: result.id, version: result.version, name };
}

export async function retireKingmakerPricingProfile(params: {
  actor: Actor;
  profileId: string;
  expectedVersion: unknown;
}) {
  const expectedVersion = Number(params.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error("Pricing profile expectedVersion is required.");
  }
  const { storeId, sellerAccountId } = kingmakerPricingProfileOwner(params.actor);
  const { data, error } = await client().rpc(
    "tcos_retire_kingmaker_pricing_profile_atomic",
    {
      p_store_id: storeId,
      p_seller_account_id: sellerAccountId,
      p_profile_id: params.profileId,
      p_expected_version: expectedVersion,
    },
  );
  if (error) rpcError(error);
  const result = atomicResult(data);
  return { id: result.id, version: result.version, retired: result.retired === true };
}
