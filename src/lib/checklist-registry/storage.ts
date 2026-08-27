import { createHash } from "node:crypto";

export const CHECKLIST_SOURCE_BUCKET = "tcos-checklist-source-files" as const;
export const CHECKLIST_SOURCE_PATH_SCHEMA = "tcos.checklist.sourcePath.v1" as const;
export const CHECKLIST_SOURCE_MAX_BYTES = 50 * 1024 * 1024;

export const CHECKLIST_SOURCE_ALLOWED_MIME_TYPES = [
  "text/csv",
  "text/tab-separated-values",
  "text/html",
  "application/json",
  "application/xml",
  "text/xml",
  "application/pdf",
  "application/zip",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export type ChecklistSourceMimeType =
  (typeof CHECKLIST_SOURCE_ALLOWED_MIME_TYPES)[number];

export type ChecklistSourceStorageInput = {
  manufacturerSlug: string;
  releaseSlug: string;
  originalFilename: string;
  mimeType: string;
  content: string | Uint8Array;
};

export type ChecklistSourceStorageReceipt = {
  schema: typeof CHECKLIST_SOURCE_PATH_SCHEMA;
  bucket: typeof CHECKLIST_SOURCE_BUCKET;
  objectPath: string;
  sha256: string;
  sizeBytes: number;
  mimeType: ChecklistSourceMimeType;
  originalFilename: string;
  isPublic: false;
};

function bytesOf(content: string | Uint8Array) {
  return typeof content === "string" ? Buffer.from(content, "utf8") : content;
}

function normalizeSlug(value: string, field: string) {
  const normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function safeFilename(value: string) {
  const filename = value
    .normalize("NFKC")
    .split(/[\\/]/)
    .pop()
    ?.trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!filename || filename === "." || filename === "..") {
    throw new Error("originalFilename is required");
  }

  return filename.toLowerCase();
}

function requireAllowedMimeType(value: string): ChecklistSourceMimeType {
  const mimeType = value.trim().toLowerCase();
  if (!CHECKLIST_SOURCE_ALLOWED_MIME_TYPES.includes(mimeType as ChecklistSourceMimeType)) {
    throw new Error(`Unsupported checklist source MIME type: ${value}`);
  }
  return mimeType as ChecklistSourceMimeType;
}

export function buildChecklistSourceStorageReceipt(
  input: ChecklistSourceStorageInput,
): ChecklistSourceStorageReceipt {
  const bytes = bytesOf(input.content);
  const sizeBytes = bytes.byteLength;
  if (sizeBytes === 0) throw new Error("Checklist source file is empty");
  if (sizeBytes > CHECKLIST_SOURCE_MAX_BYTES) {
    throw new Error(
      `Checklist source file exceeds ${CHECKLIST_SOURCE_MAX_BYTES} bytes`,
    );
  }

  const manufacturerSlug = normalizeSlug(
    input.manufacturerSlug,
    "manufacturerSlug",
  );
  const releaseSlug = normalizeSlug(input.releaseSlug, "releaseSlug");
  const originalFilename = safeFilename(input.originalFilename);
  const mimeType = requireAllowedMimeType(input.mimeType);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const objectPath = [
    CHECKLIST_SOURCE_PATH_SCHEMA.replaceAll(".", "/"),
    manufacturerSlug,
    releaseSlug,
    sha256.slice(0, 2),
    `${sha256}-${originalFilename}`,
  ].join("/");

  return {
    schema: CHECKLIST_SOURCE_PATH_SCHEMA,
    bucket: CHECKLIST_SOURCE_BUCKET,
    objectPath,
    sha256,
    sizeBytes,
    mimeType,
    originalFilename,
    isPublic: false,
  };
}
