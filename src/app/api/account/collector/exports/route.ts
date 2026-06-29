import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedAccountFromRequest } from "../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../lib/stores";

export const dynamic = "force-dynamic";

type ExportFormat = "csv" | "catalog_json";

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function collectionCsv(items: any[]) {
  const headers = [
    "title",
    "category",
    "item_type",
    "condition",
    "grade_company",
    "grade_value",
    "certification_number",
    "estimated_value",
    "acquisition_source",
    "acquisition_price",
    "image_url",
    "notes",
    "created_at",
  ];

  const rows = items.map((item) =>
    headers.map((header) => csvCell(item[header])).join(","),
  );

  return [headers.join(","), ...rows].join("\r\n");
}

function downloadResponse(params: {
  body: string;
  contentType: string;
  fileName: string;
}) {
  return new Response(params.body, {
    status: 200,
    headers: {
      "Content-Type": params.contentType,
      "Content-Disposition": `attachment; filename="${params.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

function isMissingExportTables(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("account_collection_items") ||
    message.includes("account_collection_export_jobs")
  );
}

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const format =
      url.searchParams.get("format") === "catalog_json"
        ? "catalog_json"
        : ("csv" as ExportFormat);
    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();

    const [collectionResult, wishListResult, profileResult] = await Promise.all([
      supabase
        .from("account_collection_items")
        .select("*")
        .eq("account_id", account.id)
        .eq("store_id", storeId)
        .eq("is_active", true)
        .order("created_at", { ascending: false }),
      supabase
        .from("account_wish_list_items")
        .select("*")
        .eq("account_id", account.id)
        .eq("store_id", storeId)
        .order("created_at", { ascending: false }),
      supabase
        .from("account_collector_profiles")
        .select("*")
        .eq("account_id", account.id)
        .eq("store_id", storeId)
        .maybeSingle(),
    ]);

    const error =
      collectionResult.error || wishListResult.error || profileResult.error;

    if (error) {
      if (isMissingExportTables(error)) {
        return Response.json(
          {
            error:
              "Collection exports are not available until the collector migrations are applied.",
          },
          { status: 503 },
        );
      }

      throw error;
    }

    const collectionItems = collectionResult.data ?? [];
    const wishListItems = wishListResult.data ?? [];
    const exportedAt = new Date().toISOString();
    const fileName =
      format === "catalog_json"
        ? `tcos-collection-catalog-${exportedAt.slice(0, 10)}.json`
        : `tcos-collection-${exportedAt.slice(0, 10)}.csv`;

    await supabase.from("account_collection_export_jobs").insert({
      account_id: account.id,
      store_id: storeId,
      export_type: format,
      status: "completed",
      file_name: fileName,
      item_count: collectionItems.length,
      completed_at: exportedAt,
      metadata: {
        wish_list_count: wishListItems.length,
        generated_inline: true,
      },
    });

    if (format === "catalog_json") {
      return downloadResponse({
        fileName,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify(
          {
            exported_at: exportedAt,
            account_id: account.id,
            store_id: storeId,
            profile: profileResult.data ?? null,
            collection_items: collectionItems,
            wish_list_items: wishListItems,
            media_manifest: collectionItems
              .filter((item) => item.image_url)
              .map((item) => ({
                collection_item_id: item.id,
                title: item.title,
                image_url: item.image_url,
              })),
          },
          null,
          2,
        ),
      });
    }

    return downloadResponse({
      fileName,
      contentType: "text/csv; charset=utf-8",
      body: collectionCsv(collectionItems),
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not export collection" },
      { status: 500 },
    );
  }
}
