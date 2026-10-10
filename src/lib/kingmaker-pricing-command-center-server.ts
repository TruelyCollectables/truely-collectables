import "server-only";

import type { requireInstaCompJobActor } from "./instacomp-job-server";
import {
  createKingmakerMacPricingSavedView,
  getKingmakerMacPricingCommandCenter,
  getKingmakerMacPricingSavedViews,
  retireKingmakerMacPricingSavedView,
} from "./kingmaker-mac-server";
import { kingmakerPricingProfileOwner } from "./kingmaker-pricing-profile-server";

type Actor = Awaited<ReturnType<typeof requireInstaCompJobActor>>;
type SavedViewInput = { name?: unknown; filters?: unknown; isDefault?: unknown };

function boundedNumber(value: unknown, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : null;
}
function boundedText(value: unknown, maximum: number) { return typeof value === "string" ? value.trim().slice(0, maximum) : ""; }
function normalizeFilters(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>; const filters: Record<string, unknown> = {};
  const status = boundedText(input.status, 40); if (["ready","review_required","insufficient_evidence"].includes(status)) filters.status = status;
  const identityId = boundedText(input.identityId, 200); if (identityId) filters.identityId = identityId;
  const profileId = boundedText(input.profileId, 100); if (profileId) filters.profileId = profileId;
  const minConfidence = boundedNumber(input.minConfidence, 0, 1); if (minConfidence !== null) filters.minConfidence = minConfidence;
  const minProfit = boundedNumber(input.minProfit, -1_000_000, 1_000_000); if (minProfit !== null) filters.minProfit = minProfit;
  for (const key of ["from","to"] as const) { const raw = boundedText(input[key], 40); const parsed = Date.parse(raw); if (raw && Number.isFinite(parsed)) filters[key] = new Date(parsed).toISOString(); }
  return filters;
}

export async function listKingmakerPricingSavedViews(actor: Actor) {
  const owner = kingmakerPricingProfileOwner(actor);
  return (await getKingmakerMacPricingSavedViews(owner.storeId, owner.sellerAccountId)).views;
}

export async function createKingmakerPricingSavedView(actor: Actor, input: SavedViewInput) {
  const name = String(input.name || "").trim().slice(0,80); if (!name) throw new Error("Saved view name is required.");
  const owner = kingmakerPricingProfileOwner(actor);
  const payload = await createKingmakerMacPricingSavedView({ ...owner, name, filters: normalizeFilters(input.filters), isDefault: input.isDefault === true });
  return payload.view;
}

export async function retireKingmakerPricingSavedView(actor: Actor, viewId: string, expectedVersion: unknown) {
  const version = Number(expectedVersion); if (!Number.isInteger(version) || version < 1) throw new Error("Saved view expectedVersion is required.");
  const owner = kingmakerPricingProfileOwner(actor);
  return retireKingmakerMacPricingSavedView(viewId, owner.storeId, owner.sellerAccountId, version);
}

export async function getKingmakerPricingCommandCenterSnapshot(actor: Actor) {
  const owner = kingmakerPricingProfileOwner(actor);
  return (await getKingmakerMacPricingCommandCenter(owner.storeId, owner.sellerAccountId)).snapshot;
}
