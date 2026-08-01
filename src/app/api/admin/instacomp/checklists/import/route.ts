import { NextRequest, NextResponse } from "next/server";
import { requireInstaCompJobActor } from "@/src/lib/instacomp-job-server";
import { importChecklistArtifact } from "@/src/lib/checklist-registry/server";
import type { ChecklistSourceAuthority } from "@/src/lib/checklist-registry/source-adapter";
import {
  CHECKLIST_SOURCE_ALLOWED_MIME_TYPES,
  CHECKLIST_SOURCE_MAX_BYTES,
  type ChecklistSourceMimeType,
} from "@/src/lib/checklist-registry/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const AUTHORITIES = new Set<ChecklistSourceAuthority>([
  "official_manufacturer",
  "approved_distributor",
  "approved_reference_dataset",
  "manual_official_file",
]);

function isAllowedMimeType(value: string): value is ChecklistSourceMimeType {
  return CHECKLIST_SOURCE_ALLOWED_MIME_TYPES.some((mimeType) => mimeType === value);
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    if (actor.type !== "admin") {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Only the store owner can import Checklist Registry sources.",
        },
        { status: 403 },
      );
    }

    const form = await request.formData();
    const sourceFile = form.get("sourceFile");
    const sourceUrl = String(form.get("sourceUrl") || "").trim();
    const authority = String(
      form.get("authority") || "manual_official_file",
    ) as ChecklistSourceAuthority;
    const validateOnly = String(form.get("validateOnly") || "") === "true";
    const redistributionAllowed =
      String(form.get("redistributionAllowed") || "") === "true";

    if (!(sourceFile instanceof File) || sourceFile.size <= 0) {
      return NextResponse.json(
        { ok: false, error: "Choose a checklist source file." },
        { status: 400 },
      );
    }
    if (sourceFile.size > CHECKLIST_SOURCE_MAX_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: "Checklist source files must be 50 MiB or smaller.",
        },
        { status: 413 },
      );
    }
    if (!sourceUrl) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Record the official source URL or a manual source reference.",
        },
        { status: 400 },
      );
    }
    if (!AUTHORITIES.has(authority)) {
      return NextResponse.json(
        { ok: false, error: "Unsupported checklist source authority." },
        { status: 400 },
      );
    }

    const mimeType = (sourceFile.type || "application/json").toLowerCase();
    if (!isAllowedMimeType(mimeType)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Unsupported checklist MIME type: ${mimeType}`,
        },
        { status: 415 },
      );
    }

    const result = await importChecklistArtifact({
      validateOnly,
      artifact: {
        sourceUrl,
        originalFilename: sourceFile.name || "checklist-source.json",
        mimeType,
        content: new Uint8Array(await sourceFile.arrayBuffer()),
        retrievedAt: new Date().toISOString(),
        authority,
        redistributionAllowed,
      },
    });

    return NextResponse.json(result, {
      status: result.ok ? 200 : 422,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    console.error("Checklist Registry import failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Checklist Registry import failed.",
      },
      { status: 500 },
    );
  }
}
