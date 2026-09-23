import { NextRequest, NextResponse } from "next/server";
import { POST as runExactMacIdentity } from "../../../kingmaker/instacomp-front-back-exact/route";
import { listMacKingmakerInventory } from "../../../../../lib/kingmaker-mac-scan-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function serialRun(value: unknown) {
  const match = String(value ?? "").match(/\/(\d{1,6})\b/);
  const parsed = match ? Number(match[1]) : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function forwardedHeaders(request: Request) {
  const headers = new Headers();
  for (const name of [
    "authorization",
    "cookie",
    "x-instacomp-request-id",
    "idempotency-key",
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("content-type", "application/json");
  return headers;
}

function exactIdentityFromMacItem(item: JsonRecord | null) {
  if (!item) return null;
  const metadata = record(item.metadata);
  const instacomp = record(metadata.instacomp);
  const checklistDecision = record(instacomp.checklistDecision);
  const checklistIdentity = record(instacomp.checklistIdentity);
  const orientation = record(instacomp.imageOrientation);
  const ai = Object.keys(record(instacomp.identity)).length
    ? record(instacomp.identity)
    : record(instacomp.ai);

  const registryIdentityId =
    text(instacomp.registryIdentityId) ||
    text(checklistIdentity.registryIdentityId) ||
    text(checklistIdentity.identityId);
  const registryFingerprintSha256 =
    text(instacomp.registryFingerprintSha256) ||
    text(checklistIdentity.registryFingerprintSha256) ||
    text(checklistIdentity.fingerprintSha256);

  const exact =
    instacomp.identityComplete === true &&
    instacomp.trustedForIdentity === true &&
    checklistDecision.status === "exact_match" &&
    (checklistIdentity.status === "exact_match" ||
      checklistIdentity.status === "identified") &&
    Boolean(registryIdentityId) &&
    Boolean(registryFingerprintSha256) &&
    text(ai.player ?? ai.playerName) &&
    text(ai.year) &&
    text(ai.cardNumber ?? ai.card_number) &&
    text(orientation.status) === "completed" &&
    instacomp.imageOrientationPersisted === true &&
    instacomp.imagePersistenceVerified === true;

  if (!exact) return null;
  return {
    status: "identified" as const,
    source: "checklist_registry" as const,
    aiIdentificationRequired: false,
    registryIdentityId,
    registryFingerprintSha256,
    checkedAt: new Date().toISOString(),
    lockedFields: {
      year: text(ai.year),
      manufacturer: text(ai.manufacturer),
      brand: text(ai.brand),
      product: text(ai.product),
      setName: text(ai.setName ?? ai.set_name),
      subset: text(ai.subset),
      cardNumber: text(ai.cardNumber ?? ai.card_number),
      player: text(ai.player ?? ai.playerName),
      team: text(ai.team),
      sport: text(ai.sport),
      league: text(ai.league),
      parallel:
        text(ai.checklistParallel ?? ai.parallel ?? ai.parallelName) || "Base",
      variation: text(ai.variation),
      serialRun: serialRun(ai.serialRun ?? ai.printRun ?? ai.serialNumber),
      isAuto:
        typeof ai.isAuto === "boolean"
          ? ai.isAuto
          : typeof ai.autograph === "boolean"
            ? ai.autograph
            : null,
      isRelic:
        typeof ai.isRelic === "boolean"
          ? ai.isRelic
          : typeof ai.memorabilia === "boolean"
            ? ai.memorabilia
            : null,
    },
    reasons: ["mac_commercial_inventory_exact_registry_receipt"],
  };
}

function exactIdentityFromPayload(payload: JsonRecord) {
  const checklist = record(payload.checklistDecision);
  const macReceipt = record(payload.macReceipt);
  const ai = record(payload.ai);
  const registryIdentityId = text(payload.registryIdentityId);
  const registryFingerprintSha256 = text(payload.registryFingerprintSha256);

  const exact =
    payload.identityComplete === true &&
    checklist.status === "exact_match" &&
    macReceipt.checklistOutcome === "exact_match" &&
    Boolean(registryIdentityId) &&
    Boolean(registryFingerprintSha256);

  if (!exact) return null;
  return {
    status: "identified" as const,
    source: "checklist_registry" as const,
    aiIdentificationRequired: false,
    registryIdentityId,
    registryFingerprintSha256,
    checkedAt: new Date().toISOString(),
    lockedFields: {
      year: text(ai.year),
      manufacturer: text(ai.manufacturer),
      brand: text(ai.brand),
      product: text(ai.product),
      setName: text(ai.setName),
      cardNumber: text(ai.cardNumber ?? ai.card_number),
      player: text(ai.player ?? ai.playerName),
      team: text(ai.team),
      sport: text(ai.sport),
      league: text(ai.league),
      parallel: text(ai.checklistParallel ?? ai.parallel) || "Base",
      variation: text(ai.variation),
      serialRun: serialRun(ai.printRun ?? ai.serialNumber),
      isAuto: typeof ai.isAuto === "boolean" ? ai.isAuto : null,
      isRelic: typeof ai.isRelic === "boolean" ? ai.isRelic : null,
    },
    reasons: ["mac_registry_exact_identity_required_and_confirmed"],
  };
}
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as JsonRecord;
  const inventoryItemId = text(body.inventoryItemId);
  if (!inventoryItemId) {
    return NextResponse.json(
      {
        success: false,
        error: "inventoryItemId is required.",
        code: "INVALID_REQUEST",
        identityComplete: false,
      },
      { status: 400 },
    );
  }

  // The Mac commercial-inventory receipt is the identity authority. If it
  // already contains a complete exact Registry receipt for this physical card,
  // pricing does not need to rerun front/back recognition.
  try {
    const { items } = await listMacKingmakerInventory(5_000);
    const macItem =
      items.find((item) => item.inventoryItemId === inventoryItemId) || null;
    const identity = exactIdentityFromMacItem(
      macItem ? (macItem as unknown as JsonRecord) : null,
    );
    if (identity) {
      return NextResponse.json(
        {
          success: true,
          identityComplete: true,
          identity,
          title: text(macItem?.title),
          registryIdentityId: identity.registryIdentityId,
          registryFingerprintSha256: identity.registryFingerprintSha256,
          sourceOfTruth: "mac_local",
          verificationPath: "mac_commercial_inventory_exact_receipt",
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }
  } catch {
    // Fall through to the physical front/back exact certification path. A Mac
    // bridge timeout must never manufacture an exact identity.
  }

  const exactRequest = new NextRequest(
    new URL("/api/kingmaker/instacomp-front-back-exact", request.url),
    {
      method: "POST",
      headers: forwardedHeaders(request),
      body: JSON.stringify({ inventoryItemId }),
    },
  );
  const response = await runExactMacIdentity(exactRequest);
  const payload = (await response.json().catch(() => ({}))) as JsonRecord;

  if (payload.success !== true && response.status >= 400) {
    return NextResponse.json(
      {
        ...payload,
        success: false,
        identityComplete: false,
      },
      { status: response.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const identity = exactIdentityFromPayload(payload);
  if (!identity) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Exact Mac-local Checklist Registry identity is required before this card can leave Verification or run pricing.",
        code: "CHECKLIST_IDENTITY_REQUIRED",
        identityComplete: false,
        identity: {
          status: "review_required",
          source: "checklist_registry",
          aiIdentificationRequired: true,
          registryIdentityId: null,
          registryFingerprintSha256: null,
          reasons: [
            "mac_registry_uuid_and_fingerprint_required",
            "orientation_or_visual_title_is_not_identity",
          ],
        },
        scan: payload,
      },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    {
      success: true,
      identityComplete: true,
      identity,
      title: text(payload.title),
      registryIdentityId: identity.registryIdentityId,
      registryFingerprintSha256: identity.registryFingerprintSha256,
      sourceOfTruth: "mac_local",
      scan: payload,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
