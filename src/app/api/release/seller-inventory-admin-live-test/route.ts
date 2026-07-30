import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { getActiveStoreId } from "../../../../lib/stores";
import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";
import { inventoryEngine } from "../../../../modules/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
}

async function verifyVercelToken(request: Request) {
  const token = bearerToken(request);
  if (!token) return false;

  try {
    const response = await fetch("https://api.vercel.com/v2/teams?limit=100", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { teams?: unknown };
    return releaseRuntimeTeamIsAllowed(payload.teams);
  } catch {
    return false;
  }
}

function json(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function cleanEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function validDisposableCredentials(email: string, password: string) {
  return email.endsWith("@example.com") && password.length >= 20;
}

async function deleteAccountRows(accountId: string) {
  const supabase = createSupabaseServerClient({ admin: true });
  const cleanupErrors: string[] = [];
  const { data: inventoryRows, error: inventoryReadError } = await supabase
    .from("inventory_items")
    .select("id,legacy_product_id")
    .eq("seller_account_id", accountId);

  if (inventoryReadError) cleanupErrors.push(inventoryReadError.message);

  const inventoryIds = (inventoryRows || [])
    .map((row) => String(row.id || ""))
    .filter(Boolean);
  const productIds = (inventoryRows || [])
    .map((row) => Number(row.legacy_product_id))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (inventoryIds.length > 0) {
    for (const table of ["inventory_attributes", "inventory_images"]) {
      const { error } = await supabase
        .from(table)
        .delete()
        .in("inventory_item_id", inventoryIds);
      if (error && !["42P01", "42703"].includes(String(error.code || ""))) {
        cleanupErrors.push(`${table}: ${error.message}`);
      }
    }

    const { error } = await supabase
      .from("inventory_items")
      .delete()
      .in("id", inventoryIds);
    if (error) cleanupErrors.push(`inventory_items: ${error.message}`);
  }

  const { error: productDeleteError } = productIds.length
    ? await supabase.from("products").delete().in("id", productIds)
    : await supabase.from("products").delete().eq("seller_account_id", accountId);
  if (productDeleteError) {
    cleanupErrors.push(`products: ${productDeleteError.message}`);
  }

  for (const cleanup of [
    await supabase.from("account_auth_events").delete().eq("account_id", accountId),
    await supabase
      .from("account_store_memberships")
      .delete()
      .eq("account_id", accountId),
    await supabase.from("account_profiles").delete().eq("id", accountId),
  ]) {
    if (cleanup.error && !["42P01", "42703"].includes(String(cleanup.error.code || ""))) {
      cleanupErrors.push(cleanup.error.message);
    }
  }

  const { error: userDeleteError } = await supabase.auth.admin.deleteUser(accountId);
  if (userDeleteError && !/not found/i.test(userDeleteError.message)) {
    cleanupErrors.push(`auth: ${userDeleteError.message}`);
  }

  return cleanupErrors;
}

async function createDisposableSeller(params: {
  email: string;
  password: string;
  label: string;
}) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase.auth.admin.createUser({
    email: params.email,
    password: params.password,
    email_confirm: true,
    user_metadata: {
      display_name: params.label,
      tcos_account_type: "seller",
      live_test: true,
    },
  });

  if (error || !data.user) {
    throw new Error(error?.message || `Could not create ${params.label}.`);
  }

  return data.user;
}

export async function POST(request: Request) {
  if (!(await verifyVercelToken(request))) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const action = String(body.action || "");

    if (action === "setup") {
      const sellerAEmail = cleanEmail(body.sellerAEmail);
      const sellerAPassword = String(body.sellerAPassword || "");
      const sellerBEmail = cleanEmail(body.sellerBEmail);
      const sellerBPassword = String(body.sellerBPassword || "");
      const marker = String(body.marker || "").trim().slice(0, 80);

      if (
        !validDisposableCredentials(sellerAEmail, sellerAPassword) ||
        !validDisposableCredentials(sellerBEmail, sellerBPassword) ||
        !marker.startsWith("TCOS SELLER ADMIN LIVE TEST ")
      ) {
        return json(
          {
            success: false,
            error:
              "Setup requires two disposable @example.com sellers, 20+ character passwords, and the locked live-test marker.",
          },
          400,
        );
      }

      let sellerAId = "";
      let sellerBId = "";

      try {
        const sellerA = await createDisposableSeller({
          email: sellerAEmail,
          password: sellerAPassword,
          label: "TCOS Seller Admin Live Test A",
        });
        sellerAId = sellerA.id;
        const sellerB = await createDisposableSeller({
          email: sellerBEmail,
          password: sellerBPassword,
          label: "TCOS Seller Admin Live Test B",
        });
        sellerBId = sellerB.id;

        const supabase = createSupabaseServerClient({ admin: true });
        const { data: imageRow } = await supabase
          .from("products")
          .select("image_url")
          .eq("store_id", getActiveStoreId())
          .not("image_url", "is", null)
          .limit(1)
          .maybeSingle();
        const imageUrl =
          typeof imageRow?.image_url === "string" ? imageRow.image_url : null;

        const first = await inventoryEngine.createSellerDraftProduct({
          sellerAccountId: sellerAId,
          title: `${marker} ALPHA`,
          description: "Disposable seller inventory administration proof item alpha.",
          category: "sports_cards",
          condition: "near_mint",
          price: 11.11,
          quantity: 1,
          imageUrl,
          sku: `TCOS-SELLER-PROOF-A-${Date.now()}`,
        });
        const second = await inventoryEngine.createSellerDraftProduct({
          sellerAccountId: sellerAId,
          title: `${marker} BRAVO`,
          description: "Disposable seller inventory administration proof item bravo.",
          category: "sports_cards",
          condition: "near_mint",
          price: 22.22,
          quantity: 2,
          imageUrl,
          sku: `TCOS-SELLER-PROOF-B-${Date.now()}`,
        });

        return json({
          success: true,
          action,
          marker,
          sellers: {
            a: { id: sellerAId, email: sellerAEmail },
            b: { id: sellerBId, email: sellerBEmail },
          },
          items: [
            {
              inventoryItemId: first.inventoryItemId,
              legacyProductId: first.legacyProductId,
              title: first.title,
            },
            {
              inventoryItemId: second.inventoryItemId,
              legacyProductId: second.legacyProductId,
              title: second.title,
            },
          ],
        });
      } catch (error) {
        const cleanupErrors: string[] = [];
        if (sellerAId) cleanupErrors.push(...(await deleteAccountRows(sellerAId)));
        if (sellerBId) cleanupErrors.push(...(await deleteAccountRows(sellerBId)));
        return json(
          {
            success: false,
            error: error instanceof Error ? error.message : "Setup failed.",
            cleanupErrors,
          },
          500,
        );
      }
    }

    if (action === "cleanup") {
      const userIds = Array.isArray(body.userIds)
        ? body.userIds.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
      if (userIds.length === 0 || userIds.length > 4) {
        return json({ success: false, error: "One to four userIds are required." }, 400);
      }

      const cleanupErrors: string[] = [];
      for (const userId of userIds) {
        cleanupErrors.push(...(await deleteAccountRows(userId)));
      }

      return json({
        success: cleanupErrors.length === 0,
        action,
        userIds,
        cleanupErrors,
      }, cleanupErrors.length === 0 ? 200 : 500);
    }

    return json(
      { success: false, error: "Unknown action.", allowed: ["setup", "cleanup"] },
      400,
    );
  } catch (error) {
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Live test failed.",
      },
      500,
    );
  }
}
