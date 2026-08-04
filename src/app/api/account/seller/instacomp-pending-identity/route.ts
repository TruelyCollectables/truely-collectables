import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/account-auth";
import { buildPendingListingIdentity } from "../../../../../lib/instacomp-pending-listing-identity";
import { resolveInstaCompChecklistFirstFromRegistry } from "../../../../../lib/instacomp-checklist-first-server";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function textValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function booleanValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "yes", "1", "auto", "autograph", "relic", "memorabilia"].includes(normalized)) return true;
      if (["false", "no", "0", "none", "base"].includes(normalized)) return false;
    }
  }
  return null;
}

function positiveInteger(...values: unknown[]) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function checklistInput(metadata: JsonRecord) {
  const instaComp = recordValue(metadata.instacomp);
  const ai = recordValue(instaComp.ai);
  const card = recordValue(metadata.card);
  const collectible = recordValue(metadata.collectible_asset);
  const verified = recordValue(metadata.verified_reference);

  return {
    year: textValue(ai.year, ai.season, card.year, card.season, verified.year),
    manufacturer: textValue(
      ai.manufacturer,
      ai.manufacturerName,
      card.manufacturer,
      verified.manufacturer,
    ),
    brand: textValue(ai.brand, card.brand, verified.brand),
    product: textValue(ai.product, ai.productName, card.product, verified.product),
    setName: textValue(
      ai.setName,
      ai.set_name,
      ai.set,
      card.setName,
      card.set_name,
      verified.setName,
    ),
    cardNumber: textValue(
      ai.cardNumber,
      ai.card_number,
      card.cardNumber,
      card.card_number,
      verified.cardNumber,
      verified.card_number,
    ),
    player: textValue(
      ai.player,
      ai.playerName,
      ai.subject,
      card.player,
      verified.player,
    ),
    team: textValue(ai.team, ai.teamName, card.team, verified.team),
    sport: textValue(ai.sport, card.sport, verified.sport),
    league: textValue(ai.league, card.league, verified.league),
    parallel: textValue(ai.parallel, card.parallel, verified.parallel),
    variation: textValue(ai.variation, card.variation, verified.variation),
    serialRun: positiveInteger(
      ai.serialRun,
      ai.printRun,
      collectible.serial_run,
      collectible.title_print_run,
      verified.serialRun,
    ),
    isAuto: booleanValue(
      ai.isAuto,
      ai.autograph,
      ai.autographStatus,
      card.isAuto,
      verified.isAuto,
    ),
    isRelic: booleanValue(
      ai.isRelic,
      ai.memorabilia,
      ai.memorabiliaStatus,
      card.isRelic,
      verified.isRelic,
    ),
  };
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ error: "Unauthorized" }, { status: 401 });

    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const body = (await request.json().catch(() => null)) as
      | { inventoryItemId?: unknown }
      | null;
    const inventoryItemId = textValue(body?.inventoryItemId);
    if (!inventoryItemId) {
      return Response.json({ error: "inventoryItemId is required." }, { status: 400 });
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const { data: row, error } = await supabase
      .from("inventory_items")
      .select("id,seller_account_id,metadata")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .maybeSingle();

    if (error) throw error;
    if (!row) return Response.json({ error: "Pending listing not found." }, { status: 404 });

    const isStoreOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    if (!isStoreOwner && row.seller_account_id !== account.id) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const metadata = recordValue(row.metadata);
    const input = checklistInput(metadata);
    const decision = await resolveInstaCompChecklistFirstFromRegistry(input);
    const identity = buildPendingListingIdentity({ input, decision });
    const instaComp = recordValue(metadata.instacomp);

    const nextMetadata = {
      ...metadata,
      instacomp: {
        ...instaComp,
        checklistIdentity: {
          status: identity.status,
          source: identity.source,
          aiIdentificationRequired: identity.aiIdentificationRequired,
          registryIdentityId: identity.registryIdentityId,
          registryFingerprintSha256: identity.registryFingerprintSha256,
          lockedFields: identity.lockedFields,
          reasons: identity.reasons,
          checkedAt: new Date().toISOString(),
        },
      },
    };

    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ metadata: nextMetadata })
      .eq("id", inventoryItemId)
      .eq("store_id", storeId);
    if (updateError) throw updateError;

    if (identity.status !== "identified") {
      return Response.json(
        {
          success: false,
          error: "Checklist Registry identity must be resolved before marketplace comps can run.",
          identity,
        },
        { status: 409 },
      );
    }

    return Response.json({ success: true, identity });
  } catch (error: unknown) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not verify the pending-listing Registry identity.",
      },
      { status: 500 },
    );
  }
}
