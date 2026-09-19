import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import {
  analyzeWithInstaCompAiLocal,
  hasConfiguredInstaCompAiLocal,
} from "../../../../../../lib/instacomp-ai-local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

async function requireSeller(request: Request) {
  const account = await getAuthenticatedAccountFromRequest(request);
  if (!account) return null;
  await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });
  return account;
}

function validateImage(file: File, label: string) {
  if (!ALLOWED_TYPES.has(String(file.type || "").toLowerCase())) return `${label} must be JPEG, PNG, or WebP.`;
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) return `${label} must be between 1 byte and 12 MB.`;
  return null;
}

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function exactRegistryIdentity(scan: Record<string, any>) {
  const checklist = scan?.checklist || {};
  if (
    String(checklist.outcome || "") !== "exact_match" ||
    !text(checklist.identity_id)
  ) {
    return null;
  }
  const identity =
    scan?.trusted_identity && typeof scan.trusted_identity === "object"
      ? scan.trusted_identity
      : checklist.identity && typeof checklist.identity === "object"
        ? checklist.identity
        : null;
  if (!identity) return null;

  const player = text(identity.player);
  const cardNumber = text(identity.card_number ?? identity.cardNumber);
  if (!player || !cardNumber) return null;

  const serialRun = Number(identity.serial_run ?? identity.serialRun);
  return {
    player,
    year: text(identity.year),
    brand: text(identity.manufacturer ?? identity.brand),
    setName: text(identity.set_name ?? identity.setName ?? identity.product),
    cardNumber,
    parallel: text(identity.parallel),
    serialNumber:
      Number.isInteger(serialRun) && serialRun > 0 ? `/${serialRun}` : null,
    team: text(identity.team),
    sport: text(identity.sport),
    isRookie: identity.rookie === true || identity.isRookie === true,
    isAuto: identity.autograph === true || identity.isAuto === true,
    isRelic: identity.memorabilia === true || identity.isRelic === true,
    confidence: 0.99,
    registryIdentityId: text(checklist.identity_id),
  };
}

function titleFromIdentity(identity: Record<string, any>) {
  const parts = [
    identity.year,
    identity.brand,
    identity.setName,
    identity.parallel && String(identity.parallel).toLowerCase() !== "base" ? identity.parallel : null,
    identity.player,
    identity.cardNumber ? `#${identity.cardNumber}` : null,
  ].filter(Boolean);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export async function POST(request: Request) {
  try {
    const account = await requireSeller(request);
    if (!account) return Response.json({ error: "Seller login is required." }, { status: 401 });
    const form = await request.formData();
    const front = form.get("front");
    const back = form.get("back");
    if (!(front instanceof File)) {
      return Response.json({ error: "A front card image is required." }, { status: 400 });
    }
    const frontError = validateImage(front, "Front image");
    const backError = back instanceof File ? validateImage(back, "Back image") : null;
    if (frontError || backError) {
      return Response.json({ error: frontError || backError }, { status: 400 });
    }

    const backFile = back instanceof File ? back : null;
    if (!hasConfiguredInstaCompAiLocal()) {
      return Response.json(
        { error: "InstaComp internal engine is not configured for this runtime. No paid external AI was called." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    const scan = await analyzeWithInstaCompAiLocal({
      front,
      back: backFile,
      timeoutMs: 45_000,
    });
    const identity = exactRegistryIdentity(scan as Record<string, any>);

    if (!identity) {
      return Response.json(
        {
          ok: true,
          usable: false,
          registryExact: false,
          identity: null,
          title: null,
          source: "mac_local_instacomp",
          internalScanId: text(scan.scan_id),
          checklistOutcome: text(scan.checklist?.outcome),
          needsReview: true,
          message:
            "InstaComp did not prove one exact Checklist Registry identity. Nothing was copied into the card fields; retry or review this card.",
          paidExternalAiCalled: false,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(
      {
        ok: true,
        usable: true,
        registryExact: true,
        title: titleFromIdentity(identity),
        identity,
        source: "mac_local_instacomp_registry_exact",
        internalScanId: text(scan.scan_id),
        registryIdentityId: identity.registryIdentityId,
        checklistOutcome: "exact_match",
        needsReview: String(scan.status || "") === "needs_review",
        paidExternalAiCalled: false,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
