import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedAccountFromRequest } from "../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../lib/stores";

export const dynamic = "force-dynamic";

const MAX_IMPORT_ROWS = 500;
const MAX_CSV_LENGTH = 400_000;

type CsvRow = Record<string, string>;

type ImportableCollectionItem = {
  account_id: string;
  store_id: string;
  title: string;
  category: string | null;
  item_type: string;
  image_url: string | null;
  acquisition_source: string | null;
  acquisition_price: number | null;
  estimated_value: number | null;
  value_confidence: string | null;
  grade_company: string | null;
  grade_value: string | null;
  certification_number: string | null;
  condition: string | null;
  ownership_status: string;
  visibility: string;
  notes: string | null;
  metadata: Record<string, unknown>;
};

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function cleanNullableText(value: unknown) {
  const text = cleanText(value);
  return text.length > 0 ? text : null;
}

function cleanMoney(value: unknown) {
  const text = cleanText(value).replace(/[$,]/g, "");
  if (!text) return null;

  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function cleanSource(value: unknown) {
  const text = cleanText(value).toLowerCase().replace(/[^a-z0-9 _.-]/g, "");
  return text.slice(0, 80) || "csv_upload";
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeKey(value: unknown) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function duplicateKey(params: {
  title: string;
  category: string | null;
  certificationNumber: string | null;
  sourceMarketplace?: string | null;
  sourceItemId?: string | null;
}) {
  const sourceKey =
    params.sourceMarketplace && params.sourceItemId
      ? `source:${normalizeKey(params.sourceMarketplace)}:${normalizeKey(
          params.sourceItemId,
        )}`
      : "";

  if (sourceKey.length > 8) return sourceKey;

  return [
    "item",
    normalizeKey(params.title),
    normalizeKey(params.category),
    normalizeKey(params.certificationNumber),
  ].join(":");
}

function splitCsvRows(csvText: string) {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const nextChar = csvText[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((cell) => cell.trim().length > 0)) rows.push(row);

  return rows;
}

function parseCsv(csvText: string) {
  const rows = splitCsvRows(csvText);
  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map(normalizeHeader);

  return rows.slice(1).map((row) =>
    headers.reduce<CsvRow>((record, header, index) => {
      if (header) record[header] = cleanText(row[index]);
      return record;
    }, {}),
  );
}

function firstValue(row: CsvRow, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[normalizeHeader(alias)];
    if (cleanText(value)) return cleanText(value);
  }

  return "";
}

function toCollectionItem(params: {
  row: CsvRow;
  accountId: string;
  storeId: string;
  sourceMarketplace: string;
  rowNumber: number;
}) {
  const title = firstValue(params.row, [
    "title",
    "item title",
    "name",
    "product name",
    "listing title",
    "description",
  ]);
  const sourceItemId = cleanNullableText(
    firstValue(params.row, [
      "source item id",
      "source id",
      "item id",
      "listing id",
      "sku",
      "custom label",
      "inventory id",
    ]),
  );
  const listingUrl = cleanNullableText(
    firstValue(params.row, ["listing url", "url", "product url", "item url"]),
  );

  if (!title) {
    return {
      item: null,
      error: `Row ${params.rowNumber}: title is required`,
    };
  }

  const category = cleanNullableText(
    firstValue(params.row, ["category", "type", "item type", "sport", "department"]),
  );
  const estimatedValue = cleanMoney(
    firstValue(params.row, [
      "estimated value",
      "value",
      "current value",
      "market value",
      "price",
      "list price",
      "asking price",
    ]),
  );
  const acquisitionPrice = cleanMoney(
    firstValue(params.row, [
      "acquisition price",
      "price paid",
      "cost",
      "purchase price",
      "paid",
    ]),
  );
  const notes = cleanNullableText(
    firstValue(params.row, ["notes", "note", "memo", "description"]),
  );

  return {
    item: {
      account_id: params.accountId,
      store_id: params.storeId,
      title,
      category,
      item_type:
        cleanNullableText(firstValue(params.row, ["item type", "collectable type"])) ||
        "collectable",
      image_url: cleanNullableText(
        firstValue(params.row, ["image url", "image", "photo", "photo url"]),
      ),
      acquisition_source:
        cleanNullableText(firstValue(params.row, ["acquisition source", "source"])) ||
        params.sourceMarketplace,
      acquisition_price: acquisitionPrice,
      estimated_value: estimatedValue,
      value_confidence: estimatedValue === null ? null : "imported",
      grade_company: cleanNullableText(
        firstValue(params.row, ["grade company", "grader", "grading company"]),
      ),
      grade_value: cleanNullableText(firstValue(params.row, ["grade", "grade value"])),
      certification_number: cleanNullableText(
        firstValue(params.row, [
          "certification number",
          "cert number",
          "cert",
          "serial number",
        ]),
      ),
      condition: cleanNullableText(
        firstValue(params.row, ["condition", "item condition"]),
      ),
      ownership_status: "owned",
      visibility: "private",
      notes,
      metadata: {
        import_source: "collector_csv",
        source_marketplace: params.sourceMarketplace,
        source_item_id: sourceItemId,
        listing_url: listingUrl,
        imported_row_number: params.rowNumber,
        imported_at: new Date().toISOString(),
        raw_row: params.row,
      },
    } satisfies ImportableCollectionItem,
    error: null,
  };
}

function isMissingImportTables(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("account_collection_items")
  );
}

function isMissingImportJobTable(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("account_collection_import_jobs")
  );
}

async function createImportJob(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  accountId: string;
  storeId: string;
  sourceMarketplace: string;
  fileName: string | null;
}) {
  const { data, error } = await params.supabase
    .from("account_collection_import_jobs")
    .insert({
      account_id: params.accountId,
      store_id: params.storeId,
      import_type: "csv",
      source_marketplace: params.sourceMarketplace,
      status: "processing",
      file_name: params.fileName,
    })
    .select("id")
    .single();

  if (error) {
    if (isMissingImportJobTable(error)) return null;
    throw error;
  }

  return data?.id ? String(data.id) : null;
}

async function updateImportJob(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  jobId: string | null;
  rowCount: number;
  importedCount: number;
  skippedCount: number;
  errorCount: number;
  errors: string[];
}) {
  if (!params.jobId) return;

  const status =
    params.errorCount > 0 ? "completed_with_errors" : ("completed" as const);

  const { error } = await params.supabase
    .from("account_collection_import_jobs")
    .update({
      status,
      row_count: params.rowCount,
      imported_count: params.importedCount,
      skipped_count: params.skippedCount,
      error_count: params.errorCount,
      completed_at: new Date().toISOString(),
      metadata: {
        errors: params.errors.slice(0, 50),
      },
    })
    .eq("id", params.jobId);

  if (error && !isMissingImportJobTable(error)) {
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const csvText = cleanText(body.csvText);
    const sourceMarketplace = cleanSource(body.sourceMarketplace);
    const fileName = cleanNullableText(body.fileName);

    if (!csvText) {
      return Response.json({ error: "CSV text is required" }, { status: 400 });
    }

    if (csvText.length > MAX_CSV_LENGTH) {
      return Response.json(
        { error: "CSV import is too large for one upload. Limit this batch to 500 rows." },
        { status: 400 },
      );
    }

    const rows = parseCsv(csvText);

    if (rows.length === 0) {
      return Response.json(
        { error: "CSV must include a header row and at least one item row." },
        { status: 400 },
      );
    }

    if (rows.length > MAX_IMPORT_ROWS) {
      return Response.json(
        { error: `CSV import limit is ${MAX_IMPORT_ROWS} rows per upload.` },
        { status: 400 },
      );
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const importJobId = await createImportJob({
      supabase,
      accountId: account.id,
      storeId,
      sourceMarketplace,
      fileName,
    });

    const existingResult = await supabase
      .from("account_collection_items")
      .select("title,category,certification_number,metadata")
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .eq("is_active", true)
      .limit(2000);

    if (existingResult.error) {
      if (isMissingImportTables(existingResult.error)) {
        return Response.json(
          {
            error:
              "Collection imports are not available until the collector migrations are applied.",
          },
          { status: 503 },
        );
      }

      throw existingResult.error;
    }

    const seenKeys = new Set<string>();

    for (const existingItem of existingResult.data || []) {
      const metadata = (existingItem.metadata || {}) as Record<string, unknown>;
      seenKeys.add(
        duplicateKey({
          title: String(existingItem.title || ""),
          category: String(existingItem.category || ""),
          certificationNumber: String(existingItem.certification_number || ""),
          sourceMarketplace: cleanNullableText(metadata.source_marketplace),
          sourceItemId: cleanNullableText(metadata.source_item_id),
        }),
      );
    }

    const errors: string[] = [];
    const skipped: string[] = [];
    const itemsToInsert: ImportableCollectionItem[] = [];

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const { item, error } = toCollectionItem({
        row,
        accountId: account.id,
        storeId,
        sourceMarketplace,
        rowNumber,
      });

      if (error || !item) {
        errors.push(error || `Row ${rowNumber}: could not be imported`);
        return;
      }

      const metadata = item.metadata;
      const key = duplicateKey({
        title: item.title,
        category: item.category,
        certificationNumber: item.certification_number,
        sourceMarketplace: cleanNullableText(metadata.source_marketplace),
        sourceItemId: cleanNullableText(metadata.source_item_id),
      });

      if (seenKeys.has(key)) {
        skipped.push(`Row ${rowNumber}: duplicate skipped (${item.title})`);
        return;
      }

      seenKeys.add(key);
      itemsToInsert.push({
        ...item,
        metadata: {
          ...metadata,
          import_job_id: importJobId,
        },
      });
    });

    let importedItems: unknown[] = [];

    if (itemsToInsert.length > 0) {
      const { data, error } = await supabase
        .from("account_collection_items")
        .insert(itemsToInsert)
        .select(
          "id,title,category,item_type,image_url,acquisition_source,acquisition_price,estimated_value,value_confidence,grade_company,grade_value,certification_number,condition,ownership_status,visibility,is_favorite,notes,created_at",
        );

      if (error) {
        if (isMissingImportTables(error)) {
          return Response.json(
            {
              error:
                "Collection imports are not available until the collector migrations are applied.",
            },
            { status: 503 },
          );
        }

        throw error;
      }

      importedItems = data || [];
    }

    await updateImportJob({
      supabase,
      jobId: importJobId,
      rowCount: rows.length,
      importedCount: importedItems.length,
      skippedCount: skipped.length,
      errorCount: errors.length,
      errors,
    });

    return Response.json({
      success: true,
      importJobId,
      summary: {
        rows: rows.length,
        imported: importedItems.length,
        skipped: skipped.length,
        errors: errors.length,
      },
      importedItems,
      skipped: skipped.slice(0, 25),
      errors: errors.slice(0, 25),
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not import collection CSV" },
      { status: 500 },
    );
  }
}
