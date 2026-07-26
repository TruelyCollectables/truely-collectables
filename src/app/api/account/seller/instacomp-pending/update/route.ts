import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown, maxLength: number) {
  if (value === undefined) return undefined;
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function quantityValue(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100_000
    ? parsed
    : null;
}

function requestedIds(body: any) {
  const values = Array.isArray(body?.itemIds)
    ? body.itemIds
    : body?.inventoryItemId
      ? [body.inventoryItemId]
      : [];
  return Array.from(
    new Set(values.map((value: unknown) => String(value || "").trim()).filter(Boolean)),
  ).slice(0, 500);
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const body = await request.json().catch(() => ({}));
    const itemIds = requestedIds(body);
    if (!itemIds.length) {
      return Response.json(
        { error: "Choose one or more InstaComp pending listings." },
        { status: 400 },
      );
    }

    const title = textValue(body?.title, 240);
    const description = textValue(body?.description, 5000);
    const quantity =
      Object.prototype.hasOwnProperty.call(body, "quantity")
        ? quantityValue(body.quantity)
        : undefined;

    if (
      Object.prototype.hasOwnProperty.call(body, "quantity") &&
      quantity === null
    ) {
      return Response.json(
        { error: "Quantity must be a whole number from 1 to 100,000." },
        { status: 400 },
      );
    }

    if (title === undefined && description === undefined && quantity === undefined) {
      return Response.json(
        { error: "Provide a title, description, or quantity to update." },
        { status: 400 },
      );
    }

    if (itemIds.length > 1 && (title !== undefined || description !== undefined)) {
      return Response.json(
        { error: "Bulk edits may change quantity only. Edit title or description one card at a time." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isStoreOwnerAccount =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";

    let query = supabase
      .from("inventory_items")
      .select(
        "id,legacy_product_id,seller_account_id,title,description,status,quantity,metadata",
      )
      .eq("store_id", storeId)
      .in("id", itemIds);
    query = isStoreOwnerAccount
      ? query.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : query.eq("seller_account_id", account.id);

    const { data: rows, error: rowsError } = await query;
    if (rowsError) throw rowsError;

    const results: Array<Record<string, unknown>> = [];
    const returnedIds = new Set((rows || []).map((row: any) => row.id));

    for (const missingId of itemIds.filter((id) => !returnedIds.has(id))) {
      results.push({ inventoryItemId: missingId, success: false, error: "Not found or not owned by this seller." });
    }

    for (const row of rows || []) {
      try {
        if (row.status !== "draft") {
          throw new Error("Only private InstaComp drafts can be edited here.");
        }

        const metadata = recordValue(row.metadata);
        const instaComp = recordValue(metadata.instacomp);
        if (!instaComp.source && !instaComp.scanId) {
          throw new Error("This draft is not an InstaComp pending listing.");
        }

        const collectibleAsset = recordValue(metadata.collectible_asset);
        const ai = recordValue(instaComp.ai);
        const exactSerialNumber = String(
          collectibleAsset.exact_serial_number || ai.serialNumber || "",
        ).trim();
        const gradingCertNumber = String(
          collectibleAsset.grading_cert_number ||
            ai.gradingCertNumber ||
            ai.certificationNumber ||
            "",
        ).trim();
        const uniquePhysicalCopy = Boolean(exactSerialNumber || gradingCertNumber);

        if (quantity !== undefined && uniquePhysicalCopy && quantity !== 1) {
          throw new Error(
            "This serial/cert-tracked physical copy must stay quantity 1. Add another physical copy as its own asset.",
          );
        }

        const nextTitle = title === undefined ? row.title : title;
        const nextDescription =
          description === undefined ? row.description : description;
        const nextQuantity = quantity === undefined ? Number(row.quantity || 1) : quantity;
        if (!nextTitle) throw new Error("Title is required.");

        const now = new Date().toISOString();
        const sellerEdits = Array.isArray(metadata.seller_edits)
          ? metadata.seller_edits.slice(-24)
          : [];
        const nextMetadata = {
          ...metadata,
          seller_edits: [
            ...sellerEdits,
            {
              edited_at: now,
              edited_by: account.email,
              title_changed: title !== undefined,
              description_changed: description !== undefined,
              quantity_changed: quantity !== undefined,
              quantity: nextQuantity,
            },
          ],
        };

        const updates = await Promise.all([
          supabase
            .from("inventory_items")
            .update({
              title: nextTitle,
              description: nextDescription,
              quantity: nextQuantity,
              metadata: nextMetadata,
              updated_at: now,
            })
            .eq("id", row.id)
            .eq("store_id", storeId),
          row.legacy_product_id
            ? supabase
                .from("products")
                .update({
                  title: nextTitle,
                  description: nextDescription,
                  quantity: nextQuantity,
                  updated_at: now,
                })
                .eq("id", row.legacy_product_id)
                .eq("store_id", storeId)
            : Promise.resolve({ error: null }),
        ]);

        if (updates[0].error) throw updates[0].error;
        if (updates[1].error) throw updates[1].error;

        results.push({
          inventoryItemId: row.id,
          success: true,
          title: nextTitle,
          quantity: nextQuantity,
          uniquePhysicalCopy,
        });
      } catch (error: any) {
        results.push({
          inventoryItemId: row.id,
          success: false,
          error: error?.message || "Could not update this pending listing.",
        });
      }
    }

    return Response.json({
      success: results.every((result) => result.success === true),
      updated: results.filter((result) => result.success === true).length,
      failed: results.filter((result) => result.success !== true).length,
      results,
    });
  } catch (error: any) {
    return Response.json(
      { error: error?.message || "Could not update InstaComp pending listings." },
      { status: 500 },
    );
  }
}
