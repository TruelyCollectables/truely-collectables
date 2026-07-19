import { createClient, type PostgrestError } from "@supabase/supabase-js";

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function missingRelation(error: PostgrestError | null) {
  return Boolean(
    error &&
      ["42P01", "PGRST205"].includes(String(error.code || "")),
  );
}

function missingColumn(error: PostgrestError | null) {
  return Boolean(
    error &&
      ["42703", "PGRST204"].includes(String(error.code || "")),
  );
}

function duplicateCount(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates.size;
}

export async function runMarketIntelMigrationPreflight() {
  const supabase = createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const requiredRelations = [
    "instacomp_scan_jobs",
    "instacomp_scan_items",
    "account_collection_items",
    "account_profiles",
    "stores",
    "ebay_tokens",
    "products",
    "inventory_items",
    "inventory_images",
    "inventory_attributes",
    "tcos_mi_subjects",
    "tcos_mi_marketplaces",
    "tcos_mi_collectible_identities",
    "tcos_mi_watchlist",
    "tcos_mi_listings",
    "tcos_mi_sold_comps",
    "tcos_mi_market_values",
    "tcos_mi_deal_scores",
    "tcos_mi_purchase_lots",
    "tcos_mi_inventory_sales",
    "tcos_mi_purchase_performance",
  ];

  const missingRequiredRelations: string[] = [];
  const inaccessibleRelations: Array<{ relation: string; code: string; message: string }> = [];

  for (const relation of requiredRelations) {
    const { error } = await supabase
      .from(relation)
      .select("*", { count: "exact", head: true });
    if (!error) continue;
    if (missingRelation(error)) {
      missingRequiredRelations.push(relation);
    } else {
      inaccessibleRelations.push({
        relation,
        code: String(error.code || "unknown"),
        message: error.message,
      });
    }
  }

  const conflicts: Array<{ check: string; count: number; scannedRows?: number }> = [];
  const optionalChecks: Array<{ check: string; status: string }> = [];

  const financial = await supabase
    .from("financial_adjustment_ledger_entries")
    .select("provider,entry_type")
    .range(0, 9999);
  if (missingRelation(financial.error)) {
    optionalChecks.push({ check: "financial_adjustment_constraints", status: "table_not_installed" });
  } else if (financial.error) {
    inaccessibleRelations.push({
      relation: "financial_adjustment_ledger_entries",
      code: String(financial.error.code || "unknown"),
      message: financial.error.message,
    });
  } else {
    const allowedProviders = new Set(["stripe", "tcos_internal"]);
    const allowedEntryTypes = new Set([
      "customer_refund",
      "platform_fee_reversal",
      "seller_payable_reversal",
      "seller_recovery_required",
      "dispute_hold",
      "dispute_funds_withdrawn",
      "dispute_funds_reinstated",
      "chargeback_loss",
      "dispute_won",
      "seller_protection_reimbursement",
    ]);
    const invalid = (financial.data || []).filter(
      (row) =>
        !allowedProviders.has(String(row.provider || "")) ||
        !allowedEntryTypes.has(String(row.entry_type || "")),
    ).length;
    if (invalid) {
      conflicts.push({
        check: "financial_adjustment_rows_outside_new_constraints",
        count: invalid,
        scannedRows: financial.data?.length || 0,
      });
    }
  }

  const jobs = await supabase
    .from("instacomp_scan_jobs")
    .select("requested_concurrency")
    .range(0, 9999);
  if (jobs.error) {
    inaccessibleRelations.push({
      relation: "instacomp_scan_jobs.requested_concurrency",
      code: String(jobs.error.code || "unknown"),
      message: jobs.error.message,
    });
  } else {
    const invalid = (jobs.data || []).filter((row) => {
      const value = Number(row.requested_concurrency);
      return !Number.isFinite(value) || value < 1 || value > 12;
    }).length;
    if (invalid) {
      conflicts.push({
        check: "instacomp_jobs_outside_concurrency_1_to_12",
        count: invalid,
        scannedRows: jobs.data?.length || 0,
      });
    }
  }

  const purchaseLots = await supabase
    .from("tcos_mi_purchase_lots")
    .select("source_listing_id")
    .not("source_listing_id", "is", null)
    .range(0, 9999);
  if (purchaseLots.error) {
    inaccessibleRelations.push({
      relation: "tcos_mi_purchase_lots.source_listing_id",
      code: String(purchaseLots.error.code || "unknown"),
      message: purchaseLots.error.message,
    });
  } else {
    const duplicates = duplicateCount(
      (purchaseLots.data || []).map((row) => String(row.source_listing_id || "")),
    );
    if (duplicates) {
      conflicts.push({
        check: "duplicate_purchase_lot_source_listing_ids",
        count: duplicates,
        scannedRows: purchaseLots.data?.length || 0,
      });
    }
  }

  const identityCandidates = await supabase
    .from("tcos_mi_identity_candidates")
    .select("direct_url,marketplace_id,external_listing_id")
    .range(0, 9999);
  if (missingRelation(identityCandidates.error)) {
    optionalChecks.push({ check: "identity_candidate_uniqueness", status: "table_will_be_created" });
  } else if (identityCandidates.error && !missingColumn(identityCandidates.error)) {
    inaccessibleRelations.push({
      relation: "tcos_mi_identity_candidates",
      code: String(identityCandidates.error.code || "unknown"),
      message: identityCandidates.error.message,
    });
  } else if (!identityCandidates.error) {
    const directUrlDuplicates = duplicateCount(
      (identityCandidates.data || []).map((row) => String(row.direct_url || "")),
    );
    const externalDuplicates = duplicateCount(
      (identityCandidates.data || []).map((row) =>
        row.external_listing_id
          ? `${row.marketplace_id || ""}|${row.external_listing_id}`
          : "",
      ),
    );
    if (directUrlDuplicates) {
      conflicts.push({
        check: "duplicate_identity_candidate_direct_urls",
        count: directUrlDuplicates,
        scannedRows: identityCandidates.data?.length || 0,
      });
    }
    if (externalDuplicates) {
      conflicts.push({
        check: "duplicate_identity_candidate_marketplace_listing_ids",
        count: externalDuplicates,
        scannedRows: identityCandidates.data?.length || 0,
      });
    }
  }

  const purchaseInbox = await supabase
    .from("tcos_mi_purchase_inbox")
    .select("marketplace_id,external_order_id,external_listing_id")
    .range(0, 9999);
  if (missingRelation(purchaseInbox.error)) {
    optionalChecks.push({ check: "purchase_inbox_uniqueness", status: "table_will_be_created" });
  } else if (purchaseInbox.error && !missingColumn(purchaseInbox.error)) {
    inaccessibleRelations.push({
      relation: "tcos_mi_purchase_inbox",
      code: String(purchaseInbox.error.code || "unknown"),
      message: purchaseInbox.error.message,
    });
  } else if (!purchaseInbox.error) {
    const duplicates = duplicateCount(
      (purchaseInbox.data || []).map((row) =>
        row.external_order_id && row.external_listing_id
          ? `${row.marketplace_id || ""}|${row.external_order_id}|${row.external_listing_id}`
          : "",
      ),
    );
    if (duplicates) {
      conflicts.push({
        check: "duplicate_purchase_inbox_order_listing_keys",
        count: duplicates,
        scannedRows: purchaseInbox.data?.length || 0,
      });
    }
  }

  const passed =
    missingRequiredRelations.length === 0 &&
    inaccessibleRelations.length === 0 &&
    conflicts.length === 0;

  const result = {
    preflight: "tcos.marketIntel.migrationDataPreflight.v1",
    passed,
    requiredRelationCount: requiredRelations.length,
    missingRequiredRelations,
    inaccessibleRelations,
    conflicts,
    optionalChecks,
    dataChanged: false,
    credentialsDisplayed: false,
  };

  console.log(JSON.stringify(result, null, 2));
  if (!passed) process.exitCode = 1;
  return result;
}

if (import.meta.url === new URL(process.argv[1] || "", "file:").href) {
  runMarketIntelMigrationPreflight().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
