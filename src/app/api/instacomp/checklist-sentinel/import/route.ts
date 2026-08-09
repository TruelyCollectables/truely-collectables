import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { request as httpsRequest } from "node:https";
import { NextResponse } from "next/server";
import { importChecklistArtifact } from "../../../../../lib/checklist-registry/server";
import type { ChecklistSourceAuthority } from "../../../../../lib/checklist-registry/source-adapter";
import { CHECKLIST_SOURCE_ALLOWED_MIME_TYPES } from "../../../../../lib/checklist-registry/storage";
import { requireInstaCompJobSupabase } from "../../../../../lib/instacomp-job-server";
import { isValidInstaCompSentinelArchiveRequest } from "../../../../../lib/instacomp-sentinel-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BUCKET = "instacomp-checklist-sentinel";
const MAX_BYTES = 50_000_000;
const MAX_REDIRECTS = 5;

type ImportPayload = {
  targetKey?: unknown;
  sport?: unknown;
  year?: unknown;
  season?: unknown;
  manufacturer?: unknown;
  product?: unknown;
  sourceUrl?: unknown;
  sha256?: unknown;
  source?: unknown;
  byteCount?: unknown;
  contentType?: unknown;
  fileName?: unknown;
};

type NormalizedImport = {
  targetKey: string;
  sport: string;
  year: string;
  season: string;
  manufacturer: string;
  product: string;
  sourceUrl: string;
  expectedSha: string;
  expectedBytes: number;
  sourceName: string;
  contentType: string;
  fileName: string;
};

type SourceBytes = {
  bytes: Buffer;
  finalUrl: string;
  contentType: string;
  byteCount: number;
  proofMode: "central_refetch" | "trusted_mac_relay";
};

function text(value: unknown, max: number) {
  return String(value ?? "").normalize("NFKC").trim().slice(0, max);
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 2 || b === 88 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function isPrivateIp(address: string) {
  if (isIP(address) === 4) return isPrivateIpv4(address);
  if (isIP(address) !== 6) return true;
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpv4(normalized.slice("::ffff:".length));
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8") ||
    normalized.startsWith("2001:10") ||
    /^fe[89ab]/.test(normalized)
  );
}

type PublicAddress = { address: string; family: 4 | 6 };

type ValidatedPublicUrl = {
  url: URL;
  addresses: PublicAddress[];
};

async function validatePublicUrl(value: string): Promise<ValidatedPublicUrl> {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Checklist source must use HTTPS.");
  if (url.username || url.password) throw new Error("Checklist source credentials are forbidden.");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error("Checklist source host is not public.");
  }
  const rawRecords = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true, verbatim: true });
  const addresses = rawRecords
    .filter(
      (record): record is PublicAddress =>
        (record.family === 4 || record.family === 6) && !isPrivateIp(record.address),
    )
    .map((record) => ({ address: record.address, family: record.family }));
  if (!addresses.length || addresses.length !== rawRecords.length) {
    throw new Error("Checklist source resolved to a private or restricted address.");
  }
  return { url, addresses };
}

function pinnedLookup(addresses: PublicAddress[]): LookupFunction {
  let next = 0;
  return ((
    _hostname: string,
    options: { family?: number } | number,
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string,
      family: number,
    ) => void,
  ) => {
    const requestedFamily =
      typeof options === "number" ? options : Number(options?.family || 0);
    const eligible = requestedFamily
      ? addresses.filter((record) => record.family === requestedFamily)
      : addresses;
    const selected = eligible[next % Math.max(eligible.length, 1)];
    next += 1;
    if (!selected) {
      const error = new Error("No validated public address matched the requested family.") as NodeJS.ErrnoException;
      error.code = "ENOTFOUND";
      callback(error, "", 0);
      return;
    }
    callback(null, selected.address, selected.family);
  }) as LookupFunction;
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

async function requestPinnedSource(target: ValidatedPublicUrl) {
  return new Promise<{
    status: number;
    location: string;
    bytes: Buffer | null;
    contentType: string;
    byteCount: number;
  }>((resolve, reject) => {
    const request = httpsRequest(
      target.url,
      {
        method: "GET",
        headers: {
          accept: "*/*",
          "user-agent": "InstaComp-AI-Checklist-Sentinel/1.0",
        },
        lookup: pinnedLookup(target.addresses),
        servername: target.url.hostname,
      },
      (incoming) => {
        const status = Number(incoming.statusCode || 0);
        const location = headerValue(incoming.headers.location);
        if (status >= 300 && status < 400) {
          incoming.resume();
          resolve({ status, location, bytes: null, contentType: "", byteCount: 0 });
          return;
        }
        if (status < 200 || status >= 300) {
          incoming.resume();
          reject(new Error(`Checklist source returned HTTP ${status}.`));
          return;
        }
        const declared = Number(headerValue(incoming.headers["content-length"]) || 0);
        if (declared > MAX_BYTES) {
          incoming.destroy(new Error("Checklist source exceeds the 50 MB limit."));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        incoming.on("data", (chunk: Buffer | Uint8Array) => {
          const bytes = Buffer.from(chunk);
          total += bytes.byteLength;
          if (total > MAX_BYTES) {
            incoming.destroy(new Error("Checklist source exceeds the 50 MB limit."));
            return;
          }
          chunks.push(bytes);
        });
        incoming.on("end", () => {
          if (!total) {
            reject(new Error("Checklist source was empty."));
            return;
          }
          resolve({
            status,
            location: "",
            bytes: Buffer.concat(chunks, total),
            contentType: headerValue(incoming.headers["content-type"]) || "application/octet-stream",
            byteCount: total,
          });
        });
        incoming.on("error", reject);
      },
    );
    request.setTimeout(180_000, () => {
      request.destroy(new Error("Checklist source request timed out."));
    });
    request.on("error", reject);
    request.end();
  });
}

async function fetchVerifiedSource(startUrl: string, expectedBytes: number): Promise<SourceBytes> {
  let current = await validatePublicUrl(startUrl);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await requestPinnedSource(current);
    if (response.status >= 300 && response.status < 400) {
      if (!response.location || redirects === MAX_REDIRECTS) {
        throw new Error("Checklist source redirect chain was invalid or too long.");
      }
      current = await validatePublicUrl(new URL(response.location, current.url).toString());
      continue;
    }
    if (!response.bytes) throw new Error("Checklist source returned no bytes.");
    if (expectedBytes > 0 && response.byteCount !== expectedBytes) {
      throw new Error("Checklist source byte count changed after Mac validation.");
    }
    return {
      bytes: response.bytes,
      finalUrl: current.url.toString(),
      contentType: response.contentType,
      byteCount: response.byteCount,
      proofMode: "central_refetch",
    };
  }
  throw new Error("Checklist source could not be fetched.");
}

function safeFileName(value: string, contentType: string) {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
  if (cleaned && cleaned.includes(".")) return cleaned;
  const extension = contentType.includes("pdf")
    ? ".pdf"
    : contentType.includes("zip")
      ? ".zip"
      : contentType.includes("json")
        ? ".json"
        : contentType.includes("html")
          ? ".html"
          : contentType.includes("csv")
            ? ".csv"
            : contentType.includes("sheet") || contentType.includes("excel")
              ? ".xlsx"
              : ".bin";
  return `${cleaned || "checklist-source"}${extension}`;
}

function normalizedMimeType(value: string) {
  return value.split(";", 1)[0].trim().toLowerCase();
}

function sourceAuthority(sourceUrl: string): ChecklistSourceAuthority {
  const host = new URL(sourceUrl).hostname.toLowerCase();
  if (
    host === "topps.com" ||
    host.endsWith(".topps.com") ||
    host === "upperdeck.com" ||
    host.endsWith(".upperdeck.com") ||
    host === "paniniamerica.net" ||
    host.endsWith(".paniniamerica.net") ||
    host === "leaftradingcards.com" ||
    host.endsWith(".leaftradingcards.com")
  ) {
    return "official_manufacturer";
  }
  return "approved_reference_dataset";
}

async function ensurePrivateBucket() {
  const supabase = requireInstaCompJobSupabase();
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await supabase.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: MAX_BYTES,
    });
    if (error && !/already exists|duplicate/i.test(error.message)) throw error;
  }
  return supabase;
}

function normalizeImportPayload(body: ImportPayload): NormalizedImport {
  return {
    targetKey: text(body.targetKey, 500),
    sport: text(body.sport, 120),
    year: text(body.year, 40),
    season: text(body.season, 40),
    manufacturer: text(body.manufacturer, 200),
    product: text(body.product, 300),
    sourceUrl: text(body.sourceUrl, 4000),
    expectedSha: text(body.sha256, 64).toLowerCase(),
    expectedBytes: Math.max(0, Math.min(Number(body.byteCount) || 0, MAX_BYTES)),
    sourceName: text(body.source, 120) || "instacomp-ai-checklist-sentinel",
    contentType: text(body.contentType, 200),
    fileName: text(body.fileName, 300),
  };
}

async function requestInput(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (/^multipart\/form-data\b/i.test(contentType)) {
    const form = await request.formData();
    const sourceFile = form.get("sourceFile");
    if (!(sourceFile instanceof File) || sourceFile.size <= 0) {
      throw new Error("Trusted Mac relay sourceFile is required.");
    }
    if (sourceFile.size > MAX_BYTES) {
      throw new Error("Checklist source exceeds the 50 MB limit.");
    }
    const input = normalizeImportPayload({
      targetKey: form.get("targetKey"),
      sport: form.get("sport"),
      year: form.get("year"),
      season: form.get("season"),
      manufacturer: form.get("manufacturer"),
      product: form.get("product"),
      sourceUrl: form.get("sourceUrl"),
      sha256: form.get("sha256"),
      source: form.get("source"),
      byteCount: form.get("byteCount"),
      contentType: sourceFile.type || form.get("contentType"),
      fileName: sourceFile.name || form.get("fileName"),
    });
    await validatePublicUrl(input.sourceUrl);
    const bytes = Buffer.from(await sourceFile.arrayBuffer());
    return {
      input,
      source: {
        bytes,
        finalUrl: input.sourceUrl,
        contentType: sourceFile.type || input.contentType || "application/octet-stream",
        byteCount: bytes.byteLength,
        proofMode: "trusted_mac_relay" as const,
      },
    };
  }

  const input = normalizeImportPayload((await request.json()) as ImportPayload);
  const source = await fetchVerifiedSource(input.sourceUrl, input.expectedBytes);
  return { input, source };
}

export async function GET(request: Request) {
  if (!isValidInstaCompSentinelArchiveRequest(request)) {
    return json({ ok: false, error: "Valid Sentinel archive authentication is required." }, 401);
  }
  try {
    const supabase = await ensurePrivateBucket();
    const archive = supabase.storage.from(BUCKET);
    const probePath = `health/${randomUUID()}.txt`;
    const { error: uploadError } = await archive.upload(
      probePath,
      Buffer.from("instacomp-sentinel-storage-probe\n", "utf8"),
      { contentType: "text/plain", upsert: false, cacheControl: "0" },
    );
    if (uploadError) throw uploadError;
    const { error: removeError } = await archive.remove([probePath]);
    if (removeError) throw removeError;
    return json({ ok: true, archiveReady: true, bucket: BUCKET, public: false, probeRemoved: true });
  } catch (error) {
    return json(
      { ok: false, archiveReady: false, error: error instanceof Error ? error.message : "Sentinel archive probe failed." },
      503,
    );
  }
}

export async function POST(request: Request) {
  if (!isValidInstaCompSentinelArchiveRequest(request)) {
    return json({ ok: false, error: "Valid Sentinel archive authentication is required." }, 401);
  }

  try {
    const { input, source } = await requestInput(request);
    const { targetKey, sourceUrl, expectedSha, expectedBytes } = input;
    if (!targetKey || !sourceUrl || !/^[0-9a-f]{64}$/.test(expectedSha)) {
      return json({ ok: false, error: "Target key, public source URL, and SHA-256 are required." }, 400);
    }
    if (source.byteCount <= 0 || source.byteCount > MAX_BYTES) {
      return json({ ok: false, error: "Checklist source byte count is invalid." }, 400);
    }
    if (expectedBytes > 0 && source.byteCount !== expectedBytes) {
      return json({ ok: false, error: "Trusted relay byte count did not match the Mac receipt." }, 409);
    }

    const actualSha = createHash("sha256").update(source.bytes).digest("hex");
    if (actualSha !== expectedSha) {
      return json({ ok: false, error: "Checklist source SHA-256 did not match the Mac receipt." }, 409);
    }

    const mimeType = normalizedMimeType(input.contentType || source.contentType);
    const originalFileName = safeFileName(input.fileName, mimeType);
    const directory = `sources/${expectedSha.slice(0, 2)}/${expectedSha}`;
    const sourcePath = `${directory}/${expectedSha}.source`;
    const sourceReceiptId = createHash("sha256").update(source.finalUrl, "utf8").digest("hex").slice(0, 24);
    const receiptPath = `receipts/${expectedSha}/${sourceReceiptId}.json`;
    const supabase = await ensurePrivateBucket();
    const archive = supabase.storage.from(BUCKET);

    let duplicate = false;
    const { error: sourceError } = await archive.upload(sourcePath, source.bytes, {
      contentType: mimeType || "application/octet-stream",
      upsert: false,
      cacheControl: "0",
    });
    if (sourceError) {
      if (/already exists|duplicate|resource exists/i.test(sourceError.message)) {
        const { data: existing, error: existingError } = await archive.download(sourcePath);
        if (existingError || !existing) {
          throw existingError || new Error("Existing Sentinel archive object could not be verified.");
        }
        const existingBytes = Buffer.from(await existing.arrayBuffer());
        const existingSha = createHash("sha256").update(existingBytes).digest("hex");
        if (existingBytes.byteLength !== source.byteCount || existingSha !== expectedSha) {
          throw new Error("Existing Sentinel archive object does not match its SHA path.");
        }
        duplicate = true;
      } else {
        throw sourceError;
      }
    }

    let registryImported = false;
    let registryAdapter: { id: string; version: string } | null = null;
    let registryCounts: Record<string, number> | null = null;
    let registryIssues: Array<{ code?: string; severity?: string; message?: string }> = [];
    let registryError: string | null = null;

    if (CHECKLIST_SOURCE_ALLOWED_MIME_TYPES.includes(mimeType as never)) {
      try {
        const registry = await importChecklistArtifact({
          artifact: {
            sourceUrl: source.finalUrl,
            originalFilename: originalFileName,
            mimeType,
            content: new Uint8Array(source.bytes),
            retrievedAt: new Date().toISOString(),
            authority: sourceAuthority(source.finalUrl),
            redistributionAllowed: false,
            targetContext: {
              targetKey: input.targetKey,
              sport: input.sport || null,
              year: input.year || null,
              season: input.season || null,
              manufacturer: input.manufacturer || null,
              product: input.product || null,
            },
          },
        });
        registryImported = registry.ok === true && registry.validatedOnly === false && Boolean(registry.persistence);
        registryAdapter = registry.adapter;
        registryCounts = registry.plan?.validation?.counts || null;
        registryIssues = Array.isArray(registry.plan?.validation?.issues)
          ? registry.plan.validation.issues.slice(0, 50)
          : [];
        if (!registryImported) {
          registryError = "Checklist Registry validation did not approve this source for persistence.";
        }
      } catch (error) {
        registryError = error instanceof Error ? error.message.slice(0, 1000) : "Checklist Registry validation failed.";
      }
    } else {
      registryError = `Unsupported Checklist Registry MIME type: ${mimeType || "unknown"}`;
    }

    const archiveStatus = registryImported
      ? "registry_imported"
      : "private_source_archived_pending_registry_validation";
    const receipt = {
      schemaVersion: "instacomp.checklist-sentinel.archive.v2",
      receipt: `sentinel-archive:${expectedSha}:${sourceReceiptId}`,
      targetKey,
      sport: input.sport || null,
      year: input.year || null,
      season: input.season || null,
      manufacturer: input.manufacturer || null,
      product: input.product || null,
      source: input.sourceName,
      sourceUrl,
      finalSourceUrl: source.finalUrl,
      sha256: expectedSha,
      byteCount: source.byteCount,
      contentType: mimeType,
      originalFileName,
      storageBucket: BUCKET,
      storagePath: sourcePath,
      duplicate,
      sourceProofMode: source.proofMode,
      archiveStatus,
      registryImported,
      registryAdapter,
      registryCounts,
      registryIssues,
      registryError,
      archivedAt: new Date().toISOString(),
    };
    const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2) + "\n", "utf8");
    const { error: receiptError } = await archive.upload(receiptPath, receiptBytes, {
      contentType: "application/json",
      upsert: true,
      cacheControl: "0",
    });
    if (receiptError) throw receiptError;

    return json({
      ok: true,
      receipt: receipt.receipt,
      status: receipt.archiveStatus,
      duplicate,
      sha256: expectedSha,
      byteCount: source.byteCount,
      sourceProofMode: source.proofMode,
      registryImported,
      registryAdapter,
      registryCounts,
      registryIssues,
      registryError,
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Checklist source archive failed." },
      500,
    );
  }
}
