import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import {
  analyzeWithInstaCompAiLocal,
  analyzeWithInstaCompAiLocalSecondary,
  hasConfiguredInstaCompAiLocal,
  instaCompAiLocalScanToAi,
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

    let identity: Record<string, any> | null = null;
    let source = "";
    const localErrors: string[] = [];

    try {
      const scan = await analyzeWithInstaCompAiLocal({
        front,
        back: backFile,
        timeoutMs: 40_000,
      });
      const local = instaCompAiLocalScanToAi(scan);
      if (local) {
        identity = local as Record<string, any>;
        source = "mac_local_instacomp";
      }
    } catch (error) {
      localErrors.push(error instanceof Error ? error.message : String(error));
    }

    const primaryComplete = Boolean(identity?.player && identity?.cardNumber);
    if (!primaryComplete) {
      try {
        const secondary = await analyzeWithInstaCompAiLocalSecondary({
          front,
          back: backFile,
          timeoutMs: 12_000,
        }) as Record<string, any>;
        if (secondary.player || secondary.cardNumber) {
          identity = secondary;
          source = "mac_local_secondary_witness";
        }
      } catch (error) {
        localErrors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (!identity) {
      return Response.json(
        {
          error: "InstaComp internal identification could not complete. Review the card manually or retry; no paid external AI was called.",
          localError: localErrors.join(" | ") || null,
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    const usable = Boolean(identity.player && identity.cardNumber);
    return Response.json({
      ok: true,
      usable,
      title: titleFromIdentity(identity),
      identity,
      source,
      localError: localErrors.join(" | ") || null,
      needsReview: !usable || Number(identity.confidence || 0) < 0.8,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
