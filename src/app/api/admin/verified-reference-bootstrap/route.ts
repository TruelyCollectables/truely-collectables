import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE_NAME,
  createAdminSessionValue,
} from "../../../../lib/admin-session";
import { POST as importVerifiedReferences } from "../verified-reference-import/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH_ID = "001";
const EXPECTED_RECORD_COUNT = 6;
const EXPECTED_SCAN_COUNT = 12;
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;
const EXPIRES_AT_MS = Date.parse("2026-07-29T06:00:00.000Z");
const EXPECTED_TOKEN_SHA256 =
  "b4b9acbafa059d5d83c21dc389519197530918a267767796760172ca088314f0";
const EXPECTED_CANONICAL_PAYLOAD_SHA256 =
  "a45674cf646134c0d8719d56a23e3a49fb6367d6dc27700e555522126bdbac39";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeHexEqual(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) {
    return false;
  }

  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function errorResponse(message: string, status: number, code: string) {
  return NextResponse.json(
    {
      success: false,
      error: message,
      code,
    },
    { status },
  );
}

export async function POST(request: Request) {
  if (Date.now() > EXPIRES_AT_MS) {
    return errorResponse(
      "The locked Batch 001 importer has expired.",
      410,
      "VERIFIED_REFERENCE_BOOTSTRAP_EXPIRED",
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(
      "The Batch 001 import request could not be read.",
      400,
      "VERIFIED_REFERENCE_BOOTSTRAP_FORM_INVALID",
    );
  }

  const token = String(formData.get("bootstrapToken") || "").trim();
  const payloadText = String(formData.get("verifiedReferenceJson") || "");

  if (!token || !payloadText) {
    return errorResponse(
      "The locked Batch 001 token or payload is missing.",
      400,
      "VERIFIED_REFERENCE_BOOTSTRAP_INPUT_MISSING",
    );
  }

  if (Buffer.byteLength(payloadText, "utf8") > MAX_PAYLOAD_BYTES) {
    return errorResponse(
      "The Batch 001 payload is too large.",
      413,
      "VERIFIED_REFERENCE_BOOTSTRAP_PAYLOAD_TOO_LARGE",
    );
  }

  if (!safeHexEqual(sha256(token), EXPECTED_TOKEN_SHA256)) {
    return errorResponse(
      "The locked Batch 001 token is invalid.",
      403,
      "VERIFIED_REFERENCE_BOOTSTRAP_TOKEN_INVALID",
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(payloadText) as Record<string, unknown>;
  } catch {
    return errorResponse(
      "The locked Batch 001 payload is not valid JSON.",
      400,
      "VERIFIED_REFERENCE_BOOTSTRAP_JSON_INVALID",
    );
  }

  const canonicalPayload = JSON.stringify(payload);
  if (
    !safeHexEqual(
      sha256(canonicalPayload),
      EXPECTED_CANONICAL_PAYLOAD_SHA256,
    )
  ) {
    return errorResponse(
      "The payload does not match the exact human-approved Batch 001 export.",
      403,
      "VERIFIED_REFERENCE_BOOTSTRAP_PAYLOAD_MISMATCH",
    );
  }

  const records = Array.isArray(payload.records) ? payload.records : [];
  if (
    payload.schema !== "tcos.instacomp.verifiedReferenceDatabase.v1" ||
    payload.batch !== BATCH_ID ||
    payload.recordCount !== EXPECTED_RECORD_COUNT ||
    payload.scanCount !== EXPECTED_SCAN_COUNT ||
    records.length !== EXPECTED_RECORD_COUNT
  ) {
    return errorResponse(
      "The payload is not the approved six-card Batch 001 export.",
      400,
      "VERIFIED_REFERENCE_BOOTSTRAP_BATCH_INVALID",
    );
  }

  const sessionValue = await createAdminSessionValue("cookie");
  const importFormData = new FormData();
  importFormData.set(
    "verifiedReferenceFile",
    new File(
      [payloadText],
      "instacomp-batch001-verified-reference-db.json",
      { type: "application/json" },
    ),
  );

  const internalRequest = new Request(
    new URL("/api/admin/verified-reference-import", request.url),
    {
      method: "POST",
      headers: {
        cookie: `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionValue)}`,
      },
      body: importFormData,
    },
  );

  const importResponse = await importVerifiedReferences(internalRequest);
  const result = (await importResponse.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (importResponse.ok && result?.success === true) {
    return NextResponse.redirect(
      new URL(
        "/seller/inventory?status=draft&source=instacomp&batch=001",
        request.url,
      ),
      303,
    );
  }

  return NextResponse.json(
    result || {
      success: false,
      error: "The verified-reference import did not return a readable result.",
      code: "VERIFIED_REFERENCE_BOOTSTRAP_IMPORT_FAILED",
    },
    { status: importResponse.status || 500 },
  );
}
