import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  BeckettPriceGuideManifestSchema,
  BeckettPriceGuidePageSchema,
  KINGMAKER_BECKETT_BUNDLE_SCHEMA,
  validateBeckettEntry,
  type BeckettPriceGuideEntry,
  type BeckettPriceGuideManifest,
  type BeckettPriceGuidePage,
} from "../src/lib/kingmaker-beckett-price-guide";

const SOURCE_BUCKET = "tcos-kingmaker-price-guide-sources";
const BATCH_SIZE = 500;

type CliOptions = {
  bundleDirectory: string;
  apply: boolean;
  promote: boolean;
  archiveBundle: string | null;
  archivePdf: string | null;
};

function parseArgs(argv: string[]): CliOptions {
  let bundleDirectory = "";
  let archiveBundle: string | null = null;
  let archivePdf: string | null = null;
  let apply = false;
  let promote = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--bundle") bundleDirectory = argv[++index] || "";
    else if (arg === "--apply") apply = true;
    else if (arg === "--promote") promote = true;
    else if (arg === "--archive-bundle") archiveBundle = argv[++index] || null;
    else if (arg === "--archive-pdf") archivePdf = argv[++index] || null;
    else if (arg === "--help") {
      console.log(
        "Usage: npx tsx scripts/run-kingmaker-beckett-price-guide-import.ts --bundle <directory> [--apply] [--promote] [--archive-bundle <zip>] [--archive-pdf <pdf>]",
      );
      process.exit(0);
    }
  }

  if (!bundleDirectory) throw new Error("--bundle <directory> is required.");
  if (promote && !apply) throw new Error("--promote requires --apply.");
  return {
    bundleDirectory: resolve(bundleDirectory),
    apply,
    promote,
    archiveBundle: archiveBundle ? resolve(archiveBundle) : null,
    archivePdf: archivePdf ? resolve(archivePdf) : null,
  };
}

function requireFile(path: string) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`Required file is missing: ${path}`);
  }
  return path;
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "KINGMAKER Beckett import requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return {
    url,
    key,
    client: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

async function* readNdjson(path: string) {
  const input = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let lineNumber = 0;
  for await (const line of input) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      yield { lineNumber, value: JSON.parse(trimmed) as unknown };
    } catch (error) {
      throw new Error(
        `${basename(path)} line ${lineNumber} is invalid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

async function validateBundle(bundleDirectory: string) {
  const manifestPath = requireFile(join(bundleDirectory, "manifest.json"));
  const manifest = BeckettPriceGuideManifestSchema.parse(
    JSON.parse(readFileSync(manifestPath, "utf8")),
  );
  if (manifest.schema !== KINGMAKER_BECKETT_BUNDLE_SCHEMA) {
    throw new Error(`Unsupported bundle schema ${manifest.schema}.`);
  }
  if (manifest.guide.priceGuideEndPage > manifest.guide.pageCount) {
    throw new Error("Price-guide end page exceeds the PDF page count.");
  }

  const pagesPath = requireFile(join(bundleDirectory, manifest.files.pages));
  const entriesPath = requireFile(join(bundleDirectory, manifest.files.entries));
  const pages: BeckettPriceGuidePage[] = [];
  const pageNumbers = new Set<number>();
  for await (const { lineNumber, value } of readNdjson(pagesPath)) {
    const page = BeckettPriceGuidePageSchema.parse(value);
    if (pageNumbers.has(page.pageNumber)) {
      throw new Error(`Duplicate page ${page.pageNumber} on pages line ${lineNumber}.`);
    }
    pageNumbers.add(page.pageNumber);
    pages.push(page);
  }

  const entries: BeckettPriceGuideEntry[] = [];
  const sourceRowKeys = new Set<string>();
  const statusCounts = { accepted: 0, review: 0, rejected: 0 };
  for await (const { lineNumber, value } of readNdjson(entriesPath)) {
    const entry = validateBeckettEntry(manifest, value);
    if (!pageNumbers.has(entry.pageNumber)) {
      throw new Error(
        `Entry line ${lineNumber} references missing page ${entry.pageNumber}.`,
      );
    }
    if (sourceRowKeys.has(entry.sourceRowKey)) {
      throw new Error(`Duplicate sourceRowKey on entries line ${lineNumber}.`);
    }
    sourceRowKeys.add(entry.sourceRowKey);
    statusCounts[entry.validationStatus] += 1;
    entries.push(entry);
  }

  const actualCounts = {
    pages: pages.length,
    entries: entries.length,
    ...statusCounts,
  };
  for (const key of Object.keys(actualCounts) as Array<keyof typeof actualCounts>) {
    if (actualCounts[key] !== manifest.counts[key]) {
      throw new Error(
        `Manifest count mismatch for ${key}: expected ${manifest.counts[key]}, read ${actualCounts[key]}.`,
      );
    }
  }

  return { manifest, pages, entries };
}

function storagePath(params: {
  sourceSha256: string;
  filename: string;
  kind: "source" | "bundle";
}) {
  const safeName = basename(params.filename).replace(/[^A-Za-z0-9._-]+/g, "-");
  return `tcos/kingmaker/beckett/v1/${params.sourceSha256.slice(0, 2)}/${params.sourceSha256}/${params.kind}-${safeName}`;
}

async function uploadFileStreaming(params: {
  url: string;
  key: string;
  path: string;
  filePath: string;
  contentType: string;
}) {
  const objectUrl = `${params.url.replace(/\/$/, "")}/storage/v1/object/${SOURCE_BUCKET}/${params.path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const response = await fetch(objectUrl, {
    method: "POST",
    headers: {
      apikey: params.key,
      authorization: `Bearer ${params.key}`,
      "content-type": params.contentType,
      "x-upsert": "false",
    },
    body: createReadStream(params.filePath) as unknown as BodyInit,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  if (!response.ok && response.status !== 409) {
    const message = await response.text();
    throw new Error(
      `Private source upload failed (${response.status}): ${message.slice(0, 500)}`,
    );
  }
  return { bucket: SOURCE_BUCKET, objectPath: params.path };
}

async function upsertBatches(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
) {
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict, ignoreDuplicates: false });
    if (error) {
      throw new Error(
        `${table} batch ${offset}-${offset + batch.length - 1} failed: ${error.message}`,
      );
    }
  }
}

function bundleFingerprint(manifest: BeckettPriceGuideManifest) {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

async function applyBundle(
  bundle: Awaited<ReturnType<typeof validateBundle>>,
  options: CliOptions,
) {
  const { url, key, client: supabase } = serviceClient();
  let sourceArchive: { bucket: string; objectPath: string } | null = null;
  let bundleArchive: { bucket: string; objectPath: string } | null = null;

  if (options.archivePdf) {
    sourceArchive = await uploadFileStreaming({
      url,
      key,
      path: storagePath({
        sourceSha256: bundle.manifest.guide.sourceSha256,
        filename: requireFile(options.archivePdf),
        kind: "source",
      }),
      filePath: options.archivePdf,
      contentType: "application/pdf",
    });
  }
  if (options.archiveBundle) {
    bundleArchive = await uploadFileStreaming({
      url,
      key,
      path: storagePath({
        sourceSha256: bundle.manifest.guide.sourceSha256,
        filename: requireFile(options.archiveBundle),
        kind: "bundle",
      }),
      filePath: options.archiveBundle,
      contentType: "application/zip",
    });
  }

  const { data: guide, error: guideError } = await supabase
    .from("tcos_kingmaker_price_guides")
    .upsert(
      {
        source: "beckett",
        title: bundle.manifest.guide.title,
        sport: bundle.manifest.guide.sport,
        issue_code: bundle.manifest.guide.issueCode || null,
        edition_date: bundle.manifest.guide.editionDate,
        original_filename: bundle.manifest.guide.originalFilename,
        source_sha256: bundle.manifest.guide.sourceSha256,
        page_count: bundle.manifest.guide.pageCount,
        price_guide_start_page: bundle.manifest.guide.priceGuideStartPage,
        price_guide_end_page: bundle.manifest.guide.priceGuideEndPage,
        parser_version: bundle.manifest.parserVersion,
        extraction_status: "validation_required",
        redistribution_allowed: false,
        source_storage_bucket: sourceArchive?.bucket || null,
        source_storage_object_path: sourceArchive?.objectPath || null,
        bundle_storage_bucket: bundleArchive?.bucket || null,
        bundle_storage_object_path: bundleArchive?.objectPath || null,
        metadata: {
          extraction: bundle.manifest.extraction,
          counts: bundle.manifest.counts,
        },
      },
      { onConflict: "source_sha256" },
    )
    .select("id")
    .single();
  if (guideError || !guide) {
    throw new Error(`Could not persist price guide: ${guideError?.message || "missing row"}`);
  }

  const fingerprint = bundleFingerprint(bundle.manifest);
  const { data: run, error: runError } = await supabase
    .from("tcos_kingmaker_price_import_runs")
    .upsert(
      {
        guide_id: guide.id,
        run_key: `${bundle.manifest.guide.sourceSha256}:${bundle.manifest.parserVersion}:${fingerprint}`,
        parser_version: bundle.manifest.parserVersion,
        status: "running",
        pages_seen: bundle.pages.length,
        entries_seen: bundle.entries.length,
        metadata: { bundleFingerprint: fingerprint },
      },
      { onConflict: "run_key" },
    )
    .select("id")
    .single();
  if (runError || !run) {
    throw new Error(`Could not persist import run: ${runError?.message || "missing row"}`);
  }

  try {
    await upsertBatches(
      supabase,
      "tcos_kingmaker_price_pages",
      bundle.pages.map((page) => ({
        guide_id: guide.id,
        import_run_id: run.id,
        page_number: page.pageNumber,
        printed_page_number: page.printedPageNumber || null,
        section_name: page.sectionName || null,
        image_sha256: page.imageSha256 || null,
        ocr_engine: page.ocrEngine,
        ocr_confidence: page.ocrConfidence ?? null,
        ocr_text: page.ocrText || null,
        layout: page.layout,
        status: page.status,
        metadata: page.metadata,
      })),
      "guide_id,page_number",
    );

    await upsertBatches(
      supabase,
      "tcos_kingmaker_price_entries",
      bundle.entries.map((entry) => ({
        guide_id: guide.id,
        import_run_id: run.id,
        page_number: entry.pageNumber,
        row_order: entry.rowOrder,
        source_row_key: entry.sourceRowKey,
        entry_kind: entry.entryKind,
        release_year: entry.releaseYear || null,
        season: entry.season || null,
        manufacturer: entry.manufacturer || null,
        brand: entry.brand || null,
        product: entry.product || null,
        set_name: entry.setName || null,
        parallel_name: entry.parallelName || null,
        card_number: entry.cardNumber || null,
        player_name: entry.playerName || null,
        team_name: entry.teamName || null,
        rookie_designation: entry.rookieDesignation ?? null,
        autograph_designation: entry.autographDesignation ?? null,
        memorabilia_designation: entry.memorabiliaDesignation ?? null,
        short_print_designation: entry.shortPrintDesignation ?? null,
        error_designation: entry.errorDesignation ?? null,
        variation: entry.variation || null,
        serial_run: entry.serialRun ?? null,
        condition_basis: entry.conditionBasis || null,
        value_low: entry.valueLow ?? null,
        value_high: entry.valueHigh ?? null,
        currency: entry.currency,
        multiplier_low: entry.multiplierLow ?? null,
        multiplier_high: entry.multiplierHigh ?? null,
        raw_text: entry.rawText,
        parse_confidence: entry.parseConfidence,
        validation_status: entry.validationStatus,
        validation_reasons: entry.validationReasons,
        entity_key: entry.entityKey || null,
        metadata: entry.metadata,
      })),
      "guide_id,source_row_key",
    );

    const { data: matchResult, error: matchError } = await supabase.rpc(
      "tcos_match_kingmaker_price_entries",
      { p_guide_id: guide.id },
    );
    if (matchError) throw new Error(`Identity matching failed: ${matchError.message}`);

    let promotionResult: unknown = null;
    if (options.promote) {
      const { data, error } = await supabase.rpc(
        "tcos_promote_kingmaker_price_entries",
        { p_guide_id: guide.id },
      );
      if (error) throw new Error(`Observation promotion failed: ${error.message}`);
      promotionResult = data;
    }

    const accepted = Number((matchResult as { accepted?: number } | null)?.accepted || 0);
    const status =
      accepted > 0 && bundle.manifest.counts.review === 0
        ? "succeeded"
        : "validation_required";
    const { error: completionError } = await supabase
      .from("tcos_kingmaker_price_import_runs")
      .update({
        status,
        pages_accepted: bundle.pages.filter((page) => page.status === "accepted").length,
        entries_accepted: accepted,
        entries_review: Math.max(0, bundle.entries.length - accepted),
        entries_rejected: bundle.manifest.counts.rejected,
        completed_at: new Date().toISOString(),
        metadata: { bundleFingerprint: fingerprint, matchResult, promotionResult },
      })
      .eq("id", run.id);
    if (completionError) throw new Error(`Could not finalize import: ${completionError.message}`);

    return {
      guideId: guide.id,
      importRunId: run.id,
      status,
      matchResult,
      promotionResult,
      sourceArchive,
      bundleArchive,
    };
  } catch (error) {
    await supabase
      .from("tcos_kingmaker_price_import_runs")
      .update({
        status: "failed",
        error_code: "beckett_import_failed",
        error_message: error instanceof Error ? error.message : String(error),
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const bundle = await validateBundle(options.bundleDirectory);
  const validation = {
    ok: true,
    mode: options.apply ? "apply" : "validate_only",
    guide: bundle.manifest.guide,
    parserVersion: bundle.manifest.parserVersion,
    counts: bundle.manifest.counts,
    bundleFingerprint: bundleFingerprint(bundle.manifest),
  };
  if (!options.apply) {
    console.log(JSON.stringify(validation, null, 2));
    return;
  }
  const persistence = await applyBundle(bundle, options);
  console.log(JSON.stringify({ ...validation, persistence }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
