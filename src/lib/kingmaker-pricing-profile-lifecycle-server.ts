import { createClient } from "@supabase/supabase-js";
import type { requireInstaCompJobActor } from "./instacomp-job-server";
import { kingmakerPricingProfileOwner } from "./kingmaker-pricing-profile-server";
import {
  normalizeCloneName,
  normalizeKingmakerPricingProfileMutation,
  resolveKingmakerPricingProfilePreset,
} from "./kingmaker-pricing-profile-lifecycle";

type Actor = Awaited<ReturnType<typeof requireInstaCompJobActor>>;

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

async function audit(actor: Actor, profileId: string | null, action: string, profileName: string, snapshot: unknown) {
  const { storeId, sellerAccountId } = kingmakerPricingProfileOwner(actor);
  const { error } = await client().from("tcos_kingmaker_pricing_profile_audit").insert({
    store_id: storeId,
    seller_account_id: sellerAccountId,
    profile_id: profileId,
    action,
    profile_name: profileName,
    snapshot,
  });
  if (error) throw error;
}

async function resetDefaults(actor: Actor, exceptId?: string) {
  let query = scope(
    client().from("tcos_kingmaker_pricing_profiles").update({ is_default: false }),
    actor,
  ).is("archived_at", null);
  if (exceptId) query = query.neq("id", exceptId);
  const { error } = await query;
  if (error) throw error;
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
  if (profile.isDefault) await resetDefaults(params.actor);
  const { storeId, sellerAccountId } = kingmakerPricingProfileOwner(params.actor);
  const { data, error } = await client().from("tcos_kingmaker_pricing_profiles").insert({
    store_id: storeId,
    seller_account_id: sellerAccountId,
    name: profile.name,
    marketplace_fee_pct: profile.marketplaceFeePct,
    payment_fee_pct: profile.paymentFeePct,
    payment_fixed_fee: profile.paymentFixedFee,
    estimated_shipping_cost: profile.estimatedShippingCost,
    target_margin_pct: profile.targetMarginPct,
    is_default: profile.isDefault,
  }).select("id,version").single();
  if (error) throw error;
  await audit(params.actor, data.id, "created", profile.name, { ...profile, presetId: preset.id });
  return { id: String(data.id), version: Number(data.version), profile };
}

export async function updateKingmakerPricingProfile(params: {
  actor: Actor;
  profileId: string;
  body: Record<string, unknown>;
}) {
  const profile = normalizeKingmakerPricingProfileMutation(params.body);
  if (profile.isDefault) await resetDefaults(params.actor, params.profileId);
  let query = scope(
    client().from("tcos_kingmaker_pricing_profiles").update({
      name: profile.name,
      marketplace_fee_pct: profile.marketplaceFeePct,
      payment_fee_pct: profile.paymentFeePct,
      payment_fixed_fee: profile.paymentFixedFee,
      estimated_shipping_cost: profile.estimatedShippingCost,
      target_margin_pct: profile.targetMarginPct,
      is_default: profile.isDefault,
      version: profile.expectedVersion ? profile.expectedVersion + 1 : undefined,
      updated_at: new Date().toISOString(),
    }).eq("id", params.profileId).is("archived_at", null),
    params.actor,
  );
  if (profile.expectedVersion) query = query.eq("version", profile.expectedVersion);
  const { data, error } = await query.select("id,version").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Pricing profile changed or was not found.");
  await audit(params.actor, params.profileId, profile.isDefault ? "defaulted" : "updated", profile.name, profile);
  return { id: String(data.id), version: Number(data.version), profile };
}

export async function cloneKingmakerPricingProfile(params: {
  actor: Actor;
  profileId: string;
  name?: unknown;
  isDefault?: boolean;
}) {
  const { data: source, error } = await scope(
    client().from("tcos_kingmaker_pricing_profiles")
      .select("name,marketplace_fee_pct,payment_fee_pct,payment_fixed_fee,estimated_shipping_cost,target_margin_pct")
      .eq("id", params.profileId).is("archived_at", null),
    params.actor,
  ).maybeSingle();
  if (error) throw error;
  if (!source) throw new Error("Pricing profile not found.");
  if (params.isDefault) await resetDefaults(params.actor);
  const { storeId, sellerAccountId } = kingmakerPricingProfileOwner(params.actor);
  const name = normalizeCloneName(params.name, source.name);
  const { data, error: insertError } = await client().from("tcos_kingmaker_pricing_profiles").insert({
    store_id: storeId,
    seller_account_id: sellerAccountId,
    name,
    marketplace_fee_pct: source.marketplace_fee_pct,
    payment_fee_pct: source.payment_fee_pct,
    payment_fixed_fee: source.payment_fixed_fee,
    estimated_shipping_cost: source.estimated_shipping_cost,
    target_margin_pct: source.target_margin_pct,
    is_default: params.isDefault === true,
  }).select("id,version").single();
  if (insertError) throw insertError;
  await audit(params.actor, data.id, "cloned", name, { sourceProfileId: params.profileId });
  return { id: String(data.id), version: Number(data.version), name };
}

export async function retireKingmakerPricingProfile(params: { actor: Actor; profileId: string }) {
  const { data, error } = await scope(
    client().from("tcos_kingmaker_pricing_profiles")
      .update({ archived_at: new Date().toISOString(), is_default: false })
      .eq("id", params.profileId).is("archived_at", null)
      .select("id,name,is_default").maybeSingle(),
    params.actor,
  );
  if (error) throw error;
  if (!data) throw new Error("Pricing profile not found.");
  await audit(params.actor, params.profileId, "retired", data.name, {});
  return { id: String(data.id), retired: true };
}
