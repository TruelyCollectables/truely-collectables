import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { request as httpsRequest } from "node:https";
import { NextResponse } from "next/server";
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
          resolve({
            status,
            location,
            bytes: null,
            contentType: "",
            byteCount: 0,
          });
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
            contentType:
              headerValue(incoming.headers["content-type"]) ||
              "application/octet-stream",
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

async function fetchVerifiedSource(startUrl: string, expectedBytes: number) {
  let current = await validatePublicUrl(startUrl);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await requestPinnedSource(current);
    if (response.status >= 300 && response.status < 400) {
      if (!response.location || redirects === MAX_REDIRECTS) {
        throw new Error("Checklist source redirect chain was invalid or too long.");
      }
      current = await validatePublicUrl(
        new URL(response.location, current.url).toString(),
      );
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
    return json({
      ok: true,
      archiveReady: true,
      bucket: BUCKET,
      public: false,
      probeRemoved: true,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        archiveReady: false,
        error: error instanceof Error ? error.message : "Sentinel archive probe failed.",
      },
      503,
    );
  }
}

export async function POST(request: Request) {
  if (!isValidInstaCompSentinelArchiveRequest(request)) {
    return json({ ok: false, error: "Valid Sentinel archive authentication is required." }, 401);
  }

  try {
    const body = (await request.json()) as ImportPayload;
    const targetKey = text(body.targetKey, 500);
    const sourceUrl = text(body.sourceUrl, 4000);
    const expectedSha = text(body.sha256, 64).toLowerCase();
    const expectedBytes = Math.max(0, Math.min(Number(body.byteCount) || 0, MAX_BYTES));
    if (!targetKey || !sourceUrl || !/^[0-9a-f]{64}$/.test(expectedSha)) {
      return json({ ok: false, error: "Target key, public source URL, and SHA-256 are required." }, 400);
    }

    const source = await fetchVerifiedSource(sourceUrl, expectedBytes);
    const actualSha = createHash("sha256").update(source.bytes).digest("hex");
    if (actualSha !== expectedSha) {
      return json({ ok: false, error: "Central source SHA-256 did not match the Mac receipt." }, 409);
    }

    const contentType = text(body.contentType, 200) || source.contentType;
    const originalFileName = safeFileName(text(body.fileName, 300), contentType);
    const directory = `sources/${expectedSha.slice(0, 2)}/${expectedSha}`;
    const sourcePath = `${directory}/${expectedSha}.source`;
    const sourceReceiptId = createHash("sha256")
      .update(source.finalUrl, "utf8")
      .digest("hex")
      .slice(0, 24);
    const receiptPath = `receipts/${expectedSha}/${sourceReceiptId}.json`;
    const supabase = await ensurePrivateBucket();
    const archive = supabase.storage.from(BUCKET);

    let duplicate = false;
    const { error: sourceError } = await archive.upload(sourcePath, source.bytes, {
      contentType,
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

    const receipt = {
      schemaVersion: "instacomp.checklist-sentinel.archive.v1",
      receipt: `sentinel-archive:${expectedSha}:${sourceReceiptId}`,
      targetKey,
      sport: text(body.sport, 120) || null,
      year: text(body.year, 40) || null,
      season: text(body.season, 40) || null,
      manufacturer: text(body.manufacturer, 200) || null,
      product: text(body.product, 300) || null,
      source: text(body.source, 120) || "instacomp-ai-checklist-sentinel",
      sourceUrl,
      finalSourceUrl: source.finalUrl,
      sha256: expectedSha,
      byteCount: source.byteCount,
      contentType,
      originalFileName,
      storageBucket: BUCKET,
      storagePath: sourcePath,
      duplicate,
      archiveStatus: "private_source_archived_pending_registry_validation",
      archivedAt: new Date().toISOString(),
    };
    const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2) + "\n", "utf8");
    const { error: receiptError } = await archive.upload(receiptPath, receiptBytes, {
      contentType: "application/json",
      upsert: false,
      cacheControl: "0",
    });
    if (receiptError && !/already exists|duplicate|resource exists/i.test(receiptError.message)) {
      throw receiptError;
    }

    return json({
      ok: true,
      receipt: receipt.receipt,
      status: receipt.archiveStatus,
      duplicate,
      sha256: expectedSha,
      byteCount: source.byteCount,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Checklist source archive failed.",
      },
      500,
    );
  }
}
