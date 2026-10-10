import "server-only";

import type { requireInstaCompJobActor } from "./instacomp-job-server";
import {
  cloneKingmakerMacPricingProfile,
  createKingmakerMacPricingProfile,
  retireKingmakerMacPricingProfile,
  updateKingmakerMacPricingProfile,
} from "./kingmaker-mac-server";
import { kingmakerPricingProfileOwner } from "./kingmaker-pricing-profile-server";
import {
  normalizeCloneName,
  normalizeKingmakerPricingProfileMutation,
  resolveKingmakerPricingProfilePreset,
} from "./kingmaker-pricing-profile-lifecycle";

type Actor = Awaited<ReturnType<typeof requireInstaCompJobActor>>;

function body(actor: Actor, profile: Record<string, unknown>) {
  const owner = kingmakerPricingProfileOwner(actor);
  return { ...owner, ...profile };
}

export async function createKingmakerPricingProfileFromPreset(params: { actor: Actor; presetId: unknown; name?: unknown; isDefault?: boolean }) {
  const preset = resolveKingmakerPricingProfilePreset(params.presetId);
  if (!preset) throw new Error("Unknown pricing profile preset.");
  const profile = normalizeKingmakerPricingProfileMutation({ ...preset, name: params.name || preset.name, isDefault: params.isDefault === true });
  const result = await createKingmakerMacPricingProfile(body(params.actor, profile));
  return { id: String(result.profile.id), version: Number(result.profile.version || 1), profile };
}

export async function updateKingmakerPricingProfile(params: { actor: Actor; profileId: string; body: Record<string, unknown> }) {
  const profile = normalizeKingmakerPricingProfileMutation(params.body);
  if (!profile.expectedVersion) throw new Error("Pricing profile expectedVersion is required.");
  const result = await updateKingmakerMacPricingProfile(params.profileId, body(params.actor, profile));
  return { id: String(result.profile.id), version: Number(result.profile.version), profile };
}

export async function cloneKingmakerPricingProfile(params: { actor: Actor; profileId: string; name?: unknown; isDefault?: boolean }) {
  const owner = kingmakerPricingProfileOwner(params.actor);
  const sourceName = String(params.name || "Pricing Profile");
  const name = normalizeCloneName(params.name, sourceName);
  const result = await cloneKingmakerMacPricingProfile(params.profileId, { ...owner, name, isDefault: params.isDefault === true });
  return { id: String(result.profile.id), version: Number(result.profile.version), name: String(result.profile.name) };
}

export async function retireKingmakerPricingProfile(params: { actor: Actor; profileId: string; expectedVersion: unknown }) {
  const expectedVersion = Number(params.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error("Pricing profile expectedVersion is required.");
  const owner = kingmakerPricingProfileOwner(params.actor);
  return retireKingmakerMacPricingProfile(params.profileId, owner.storeId, owner.sellerAccountId, expectedVersion);
}
