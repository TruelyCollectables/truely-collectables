import "server-only";

import { createSupabaseServerClient } from "./supabase-server";

type JsonRecord = Record<string, unknown>;

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export type EndMarketIntelListingOptions = {
  endedAt?: string;
  onlyIfActive?: boolean;
  metadata?: JsonRecord;
};

/**
 * Marks a Market Intel listing ended using only columns that exist in the
 * installed Beta One schema. Source-specific end details are kept in metadata
 * because the live table intentionally has no top-level `ended_at` column.
 */
export async function endMarketIntelListing(
  listingId: string,
  options: EndMarketIntelListingOptions = {},
) {
  const id = String(listingId || "").trim();
  if (!id) throw new Error("A listing ID is required.");

  const endedAt = options.endedAt || new Date().toISOString();
  const parsedEndedAt = new Date(endedAt);
  if (Number.isNaN(parsedEndedAt.getTime())) {
    throw new Error("The listing end timestamp is invalid.");
  }
  const normalizedEndedAt = parsedEndedAt.toISOString();

  const supabase = createSupabaseServerClient({ admin: true });
  let lookup = supabase
    .from("tcos_mi_listings")
    .select("id,original_title,quantity,listing_status,metadata")
    .eq("id", id);
  if (options.onlyIfActive) lookup = lookup.eq("listing_status", "active");

  const { data: rows, error: lookupError } = await lookup.limit(1);
  if (lookupError) throw new Error(lookupError.message);
  const listing = rows?.[0] || null;
  if (!listing) {
    throw new Error(
      options.onlyIfActive
        ? "Listing was not found or is no longer active."
        : "Listing was not found.",
    );
  }

  let update = supabase
    .from("tcos_mi_listings")
    .update({
      listing_status: "ended",
      last_seen_at: normalizedEndedAt,
      metadata: {
        ...recordValue(listing.metadata),
        ...(options.metadata || {}),
        ended_at: normalizedEndedAt,
      },
    })
    .eq("id", id);
  if (options.onlyIfActive) update = update.eq("listing_status", "active");

  const { data: updatedRows, error: updateError } = await update
    .select("id,original_title,quantity,listing_status")
    .limit(1);
  if (updateError) throw new Error(updateError.message);
  const updated = updatedRows?.[0] || null;
  if (!updated) {
    throw new Error(
      options.onlyIfActive
        ? "Listing was not found or is no longer active."
        : "Listing could not be marked ended.",
    );
  }

  return {
    id: String(updated.id),
    originalTitle: String(updated.original_title || ""),
    quantity: Number(updated.quantity || 0),
    listingStatus: String(updated.listing_status || "ended"),
    endedAt: normalizedEndedAt,
  };
}
