import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { importChecklistArtifact } from "../src/lib/checklist-registry/server";
import type { ChecklistSourceArtifact } from "../src/lib/checklist-registry/source-adapter";

type Seed = {
  title: string;
  sport?: string;
  category?: string;
  universe?: string;
  year: string;
  sourcePage?: string;
  url: string;
};

type Manufacturer = {
  id: string;
  name: string;
  seedPath: string;
  officialHosts: string[];
  registryMode: "validate_and_import_supported";
  universes: string[];
};

type Policy = {
  schema: string;
  defaultMaxSourcesPerManufacturer?: number;
  manufacturers: Manufacturer[];
};

type CatalogRow = {
  status?: string | null;
  source_sha256?: string | null;
  validation_counts?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

class QuarantineError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const POLICY_PATH = resolve(
  process.cwd(),
  process.env.CHECKLIST_MANUFACTURER_POLICY ||
    "data/official-checklist-manufacturers.json",
);
const OUTPUT = resolve(
  process.cwd(),
  process.env.CHECKLIST_DISCOVERY_OUTPUT ||
    ".checklist-discovery/official-manufacturer-update-receipt.json",
);
const TEMP_ROOT = resolve(
  process.cwd(),
  ".checklist-discovery/official-manufacturer-tmp",
);
const APPLY = process.env.CHECKLIST_DISCOVERY_AUTO_IMPORT === "true";
const MAX_BYTES = Math.max(
  1_000_000,
  Number(process.env.CHECKLIST_MAX_DOWNLOAD_BYTES || 50_000_000),
);
const REQUESTED_MAX = Number(
  process.env.CHECKLIST_DISCOVERY_MAX_SOURCES_PER_MANUFACTURER || "0",
);
const SELECTED = new Set(
  (process.env.CHECKLIST_DISCOVERY_MANUFACTURERS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

function dbClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Official checklist update requires Supabase service-role access.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function hostAllowed(host: string, allowed: string[]) {
  const value = host.toLowerCase();
  return allowed.some(
    (candidate) =>
      value === candidate.toLowerCase() ||
      value.endsWith(`.${candidate.toLowerCase()}`),
  );
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function cleanFilename(url: string, fallback: string) {
  try {
    const file = decodeURIComponent(
      new URL(url).pathname.split("/").filter(Boolean).at(-1) || "",
    );
    if (file) return file.replace(/[^a-zA-Z0-9._-]+/g, "-");
  } catch {
    // Use fallback.
  }
  return `${fallback.replace(/[^a-zA-Z0-9._-]+/g, "-") || "official-checklist"}.bin`;
}

function normalizedMimeType(url: string, header: string) {
  const type = header.split(";")[0].trim().toLowerCase();
  if (type && type !== "application/octet-stream") return type;
  const extension = extname(new URL(url).pathname).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".csv") return "text/csv";
  if (extension === ".tsv") return "text/tab-separated-values";
  if (extension === ".txt") return "text/plain";
  if ([".html", ".htm"].includes(extension)) return "text/html";
  if (extension === ".json") return "application/json";
  if (extension === ".xml") return "application/xml";
  if (extension === ".xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (extension === ".xls") return "application/vnd.ms-excel";
  if (extension === ".zip") return "application/zip";
  return type || "application/octet-stream";
}

async function downloadOfficialSource(
  manufacturer: Manufacturer,
  sourceUrl: string,
) {
  const requested = new URL(sourceUrl);
  if (
    requested.protocol !== "https:" ||
    !hostAllowed(requested.hostname, manufacturer.officialHosts)
  ) {
    throw new QuarantineError(
      "official_host_not_allowlisted",
      `Source is not on the ${manufacturer.name} official host allowlist.`,
    );
  }

  const response = await fetch(sourceUrl, {
    headers: {
      Accept:
        "application/pdf,text/plain,text/csv,text/tab-separated-values,text/html,application/json,application/xml,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip,*/*",
      "Cache-Control": "no-cache",
      "User-Agent":
        "TCOS-Official-Manufacturer-Checklist-Updater/1.0 (+private registry automation; contact sales@truelycollectables.com)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const finalUrl = response.url || sourceUrl;
  const finalParsed = new URL(finalUrl);
  if (!hostAllowed(finalParsed.hostname, manufacturer.officialHosts)) {
    throw new QuarantineError(
      "official_redirect_host_violation",
      `Official source redirected outside the allowlist to ${finalParsed.hostname}.`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error("Downloaded official checklist was empty.");
  if (bytes.byteLength > MAX_BYTES) {
    throw new QuarantineError(
      "official_source_too_large",
      `Official source exceeds the ${MAX_BYTES}-byte download limit.`,
    );
  }
  return {
    bytes,
    finalUrl,
    mimeType: normalizedMimeType(
      finalUrl,
      response.headers.get("content-type") || "",
    ),
  };
}

function extractPdf(bytes: Uint8Array, filename: string) {
  mkdirSync(TEMP_ROOT, { recursive: true });
  const filePath = resolve(TEMP_ROOT, `${sha256(bytes)}-${filename}.pdf`);
  writeFileSync(filePath, bytes);
  try {
    return execFileSync(
      "pdftotext",
      ["-layout", "-nopgbrk", filePath, "-"],
      {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: 180_000,
      },
    ).trim();
  } finally {
    rmSync(filePath, { force: true });
  }
}

function extractContent(params: {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
}) {
  if (params.mimeType === "application/pdf") {
    const text = extractPdf(params.bytes, params.filename.replace(/\.pdf$/i, ""));
    if (text.length < 50) {
      throw new QuarantineError(
        "official_pdf_text_missing",
        `PDF extraction produced only ${text.length} characters.`,
      );
    }
    return { content: text, mimeType: "text/plain" };
  }

  if (
    params.mimeType.startsWith("text/") ||
    params.mimeType === "application/json" ||
    params.mimeType === "application/xml" ||
    params.mimeType.endsWith("+json") ||
    params.mimeType.endsWith("+xml")
  ) {
    const text = Buffer.from(params.bytes).toString("utf8").trim();
    if (text.length < 20) {
      throw new QuarantineError(
        "official_text_incomplete",
        `Official source contained only ${text.length} text characters.`,
      );
    }
    return { content: text, mimeType: params.mimeType };
  }

  throw new QuarantineError(
    "official_adapter_or_extractor_required",
    `Official ${params.mimeType} source is archived but requires a deterministic extractor or manufacturer adapter before import.`,
  );
}

function limitedIssues(
  values: Array<{ code: string; severity: string; message: string }>,
) {
  return values.slice(0, 100).map((value) => ({
    code: value.code,
    severity: value.severity,
    message: value.message.slice(0, 500),
  }));
}

function seedUniverse(seed: Seed) {
  return seed.universe || seed.category || seed.sport || null;
}

function priorCardCount(row: CatalogRow | null) {
  const value = row?.validation_counts?.cards;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function readCatalog(
  db: ReturnType<typeof dbClient>,
  sourceUrl: string,
) {
  const { data, error } = await db
    .from("checklist_source_catalog")
    .select("status,source_sha256,validation_counts,metadata")
    .eq("source_url", sourceUrl)
    .maybeSingle();
  if (error) throw new Error(`Could not read checklist source catalog: ${error.message}`);
  return (data || null) as CatalogRow | null;
}

async function writeCatalog(
  db: ReturnType<typeof dbClient>,
  values: Record<string, unknown>,
) {
  const { error } = await db
    .from("checklist_source_catalog")
    .upsert(values, { onConflict: "source_url" });
  if (error) throw new Error(`Could not update checklist source catalog: ${error.message}`);
}

function safeMetadata(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function statusForError(error: unknown) {
  if (error instanceof QuarantineError) {
    return { status: "quarantined", code: error.code, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  const adapterRequired =
    /adapter|unsupported|could not resolve|no checklist source/i.test(message);
  return {
    status: adapterRequired ? "quarantined" : "failed",
    code: adapterRequired
      ? "official_manufacturer_adapter_required"
      : "official_manufacturer_update_failure",
    message,
  };
}

async function processSource(params: {
  db: ReturnType<typeof dbClient>;
  manufacturer: Manufacturer;
  seed: Seed;
}) {
  const checkedAt = new Date().toISOString();
  const downloaded = await downloadOfficialSource(
    params.manufacturer,
    params.seed.url,
  );
  const digest = sha256(downloaded.bytes);
  const catalog = await readCatalog(params.db, downloaded.finalUrl);

  if (
    ["imported", "unchanged"].includes(catalog?.status || "") &&
    catalog?.source_sha256 === digest
  ) {
    await writeCatalog(params.db, {
      manufacturer: params.manufacturer.name,
      sport: params.seed.sport || null,
      source_url: downloaded.finalUrl,
      source_sha256: digest,
      status: catalog?.status === "imported" ? "imported" : "unchanged",
      last_seen_at: checkedAt,
      last_checked_at: checkedAt,
      metadata: {
        ...safeMetadata(catalog?.metadata),
        universe: seedUniverse(params.seed),
        seedUrl: params.seed.url,
        finalUrl: downloaded.finalUrl,
      },
    });
    return {
      sourceUrl: downloaded.finalUrl,
      title: params.seed.title,
      status: "unchanged",
      sha256: digest,
    };
  }

  const filename = cleanFilename(downloaded.finalUrl, params.seed.title);
  const extracted = extractContent({
    bytes: downloaded.bytes,
    mimeType: downloaded.mimeType,
    filename,
  });
  const artifact: ChecklistSourceArtifact = {
    sourceUrl: downloaded.finalUrl,
    originalFilename: filename,
    mimeType: extracted.mimeType,
    content: extracted.content,
    archiveContent: downloaded.bytes,
    archiveFilename: filename,
    archiveMimeType: downloaded.mimeType,
    retrievedAt: checkedAt,
    authority: "official_manufacturer",
    redistributionAllowed: false,
  };

  const validation = await importChecklistArtifact({
    artifact,
    validateOnly: true,
  });
  const validationErrors = validation.plan.validation.issues.filter(
    (issue) => issue.severity === "error",
  );
  const counts = validation.plan.validation.counts;
  const release = validation.plan.release;
  const releaseName = [release.season || release.releaseYear, release.product]
    .filter(Boolean)
    .join(" ");
  const common = {
    manufacturer: release.manufacturer || params.manufacturer.name,
    sport: release.sport || params.seed.sport || null,
    source_url: downloaded.finalUrl,
    source_sha256: digest,
    release_slug: release.releaseSlug,
    release_name: releaseName || params.seed.title,
    adapter_id: validation.adapter.id,
    adapter_version: validation.adapter.version,
    last_seen_at: checkedAt,
    last_checked_at: checkedAt,
    validation_counts: counts,
    issue_summary: limitedIssues(validation.plan.validation.issues),
    metadata: {
      ...safeMetadata(catalog?.metadata),
      universe: seedUniverse(params.seed),
      seedUrl: params.seed.url,
      finalUrl: downloaded.finalUrl,
      sourcePage: params.seed.sourcePage || null,
      sourceTitle: params.seed.title,
      sourceYear: params.seed.year,
      originalMimeType: downloaded.mimeType,
      originalFilename: filename,
      sourceSizeBytes: downloaded.bytes.byteLength,
      updater: "official-manufacturer-v1",
    },
  };

  if (!validation.ok || validationErrors.length || counts.cards < 1) {
    await writeCatalog(params.db, {
      ...common,
      status: "quarantined",
      issue_summary: [
        ...limitedIssues(validationErrors),
        ...(counts.cards < 1
          ? [
              {
                code: "official_source_has_no_checklist_rows",
                severity: "error",
                message:
                  "Official source did not produce any checklist card rows.",
              },
            ]
          : []),
      ].slice(0, 100),
    });
    return {
      sourceUrl: downloaded.finalUrl,
      title: params.seed.title,
      status: "quarantined",
      release: releaseName,
      counts,
      errors: limitedIssues(validationErrors),
    };
  }

  const previousCards = priorCardCount(catalog);
  if (
    previousCards !== null &&
    previousCards >= 20 &&
    counts.cards < Math.floor(previousCards * 0.7)
  ) {
    await writeCatalog(params.db, {
      ...common,
      status: "quarantined",
      issue_summary: [
        {
          code: "official_source_card_count_regression",
          severity: "error",
          message: `Changed official source fell from ${previousCards} to ${counts.cards} checklist rows and requires review.`,
        },
      ],
    });
    return {
      sourceUrl: downloaded.finalUrl,
      title: params.seed.title,
      status: "quarantined",
      release: releaseName,
      counts,
      previousCards,
      reason: "official_source_card_count_regression",
    };
  }

  if (!APPLY) {
    await writeCatalog(params.db, { ...common, status: "validated" });
    return {
      sourceUrl: downloaded.finalUrl,
      title: params.seed.title,
      status: "validated",
      release: releaseName,
      counts,
    };
  }

  const imported = await importChecklistArtifact({ artifact });
  if (!imported.ok || imported.validatedOnly) {
    throw new Error("Validated official checklist did not complete Registry persistence.");
  }
  await writeCatalog(params.db, {
    ...common,
    status: "imported",
    imported_at: checkedAt,
  });
  return {
    sourceUrl: downloaded.finalUrl,
    title: params.seed.title,
    status: "imported",
    release: releaseName,
    counts,
    persistence: imported.persistence,
  };
}

async function main() {
  const policy = JSON.parse(readFileSync(POLICY_PATH, "utf8")) as Policy;
  if (policy.schema !== "tcos.officialManufacturerChecklistPolicy.v1") {
    throw new Error(`Unsupported manufacturer policy schema: ${policy.schema}`);
  }
  const maximum = Math.max(
    1,
    Math.min(
      500,
      REQUESTED_MAX || policy.defaultMaxSourcesPerManufacturer || 150,
    ),
  );
  const manufacturers = policy.manufacturers.filter(
    (manufacturer) => SELECTED.size === 0 || SELECTED.has(manufacturer.id),
  );
  if (!manufacturers.length) throw new Error("No configured manufacturers were selected.");

  const db = dbClient();
  const startedAt = new Date().toISOString();
  const manufacturerReceipts: Array<Record<string, unknown>> = [];
  const totals = {
    selected: 0,
    unchanged: 0,
    validated: 0,
    imported: 0,
    quarantined: 0,
    failed: 0,
    sets: 0,
    cards: 0,
    parallels: 0,
    identities: 0,
  };

  for (const manufacturer of manufacturers) {
    const seeds = JSON.parse(
      readFileSync(resolve(process.cwd(), manufacturer.seedPath), "utf8"),
    ) as Seed[];
    const selectedSeeds = seeds.slice(0, maximum);
    const results: Array<Record<string, unknown>> = [];
    totals.selected += selectedSeeds.length;

    for (const seed of selectedSeeds) {
      try {
        const result = await processSource({ db, manufacturer, seed });
        results.push(result);
        const status = String(result.status);
        if (status in totals) {
          (totals as Record<string, number>)[status] += 1;
        }
        const counts = result.counts as Record<string, number> | undefined;
        if (counts) {
          totals.sets += counts.sets || 0;
          totals.cards += counts.cards || 0;
          totals.parallels += counts.parallels || 0;
          totals.identities += counts.identities || 0;
        }
      } catch (error) {
        const checkedAt = new Date().toISOString();
        const classified = statusForError(error);
        if (classified.status === "quarantined") totals.quarantined += 1;
        else totals.failed += 1;
        try {
          await writeCatalog(db, {
            manufacturer: manufacturer.name,
            sport: seed.sport || null,
            source_url: seed.url,
            status: classified.status,
            last_seen_at: checkedAt,
            last_checked_at: checkedAt,
            issue_summary: [
              {
                code: classified.code,
                severity: "error",
                message: classified.message.slice(0, 500),
              },
            ],
            metadata: {
              universe: seedUniverse(seed),
              seedUrl: seed.url,
              sourceTitle: seed.title,
              sourceYear: seed.year,
              updater: "official-manufacturer-v1",
            },
          });
        } catch {
          // Preserve the primary failure in the receipt even if catalog logging fails.
        }
        results.push({
          sourceUrl: seed.url,
          title: seed.title,
          status: classified.status,
          code: classified.code,
          message: classified.message,
        });
      }
    }

    manufacturerReceipts.push({
      manufacturerId: manufacturer.id,
      manufacturer: manufacturer.name,
      seedPath: manufacturer.seedPath,
      availableSources: seeds.length,
      selectedSources: selectedSeeds.length,
      results,
    });
  }

  const receipt = {
    schema: "tcos.checklist.officialManufacturerUpdateReceipt.v1",
    startedAt,
    completedAt: new Date().toISOString(),
    mode: APPLY ? "apply" : "validate_only",
    sourcePolicy: "official_manufacturer_only",
    maximumSourcesPerManufacturer: maximum,
    totals,
    manufacturers: manufacturerReceipts,
  };
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(TEMP_ROOT, { recursive: true, force: true });
  });
