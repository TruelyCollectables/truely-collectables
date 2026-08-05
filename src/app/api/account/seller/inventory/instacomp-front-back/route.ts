import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { assertSafeInstaCompRemoteImageUrl } from "../../../../../../lib/instacomp-provider-safety";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";
import { POST as runInstaCompScan } from "../../../../instacomp/scan/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

type ImageRow = {
  image_url: string | null;
  alt_text: string | null;
  sort_order: number | null;
  is_primary: boolean | null;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizedPrintRun(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/(?:\d+\s*)?\/\s*(\d{1,6})\b/);
  return match ? `/${Number(match[1])}` : null;
}

function evidenceText(value: unknown) {
  if (typeof value === "string") return value;
  if (!value) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function backEvidence(ai: Record<string, unknown>) {
  return [
    ai.backText,
    ai.back_text,
    ai.backOcr,
    ai.back_ocr,
    ai.backEvidence,
    ai.back_evidence,
    ai.backVisibleText,
    ai.back_visible_text,
  ]
    .map(evidenceText)
    .join(" ")
    .toLowerCase();
}

function stripPrizmClaims(value: unknown) {
  const raw = typeof value === "string" ? value : "";
  return raw
    .replace(/\b(?:base\s+)?(?:green|silver|red|blue|gold|orange|purple|pink)?\s*prizm\b/gi, "Base")
    .replace(/\bprizm\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,;:])/g, "$1")
    .trim();
}

function pair(rows: ImageRow[]) {
  const images = rows
    .map((row) => ({
      url: text(row.image_url),
      alt: text(row.alt_text),
      order: Number(row.sort_order || 0),
      primary: row.is_primary === true,
    }))
    .filter((row): row is { url: string; alt: string | null; order: number; primary: boolean } => Boolean(row.url))
    .sort((left, right) => {
      if (left.primary !== right.primary) return left.primary ? -1 : 1;
      return left.order - right.order;
    });

  const front =
    images.find((image) => /\bfront\b/i.test(image.alt || "")) ||
    images.find((image) => image.primary) ||
    images[0] ||
    null;
  const back =
    images.find((image) => /\bback\b/i.test(image.alt || "") && image.url !== front?.url) ||
    images.find((image) => !image.primary && image.url !== front?.url) ||
    images.find((image) => image.url !== front?.url) ||
    null;

  return { front, back, count: images.length };
}

async function downloadStoredImage(url: string, side: "front" | "back") {
  const safeUrl = assertSafeInstaCompRemoteImageUrl(url);
  const response = await fetch(safeUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(25_000),
    headers: { "User-Agent": "TCOS-InstaComp-FrontBack/1.0" },
  });
  if (!response.ok) throw new Error(`${side} image returned HTTP ${response.status}.`);
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`${side} image is empty or larger than 12MB.`);
  }
  const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const allowed = type === "image/jpeg" || type === "image/png" || type === "image/webp";
  if (!allowed) throw new Error(`${side} image is not a JPEG, PNG, or WebP file.`);
  const extension = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  return new File([bytes], `${side}.${extension}`, { type });
}

export async function POST(request: NextRequest) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });

    const body = await request.json().catch(() => ({}));
    const inventoryItemId = String(body?.inventoryItemId || "").trim();
    if (!inventoryItemId) {
      return NextResponse.json({ error: "Choose a pending card to scan." }, { status: 400 });
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";

    let itemQuery = supabase
      .from("inventory_items")
      .select("id,seller_account_id,status,title,metadata")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .eq("status", "draft");
    itemQuery = isOwner
      ? itemQuery.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : itemQuery.eq("seller_account_id", account.id);
    const { data: item, error: itemError } = await itemQuery.maybeSingle();
    if (itemError) throw itemError;
    if (!item) return NextResponse.json({ error: "Pending card was not found." }, { status: 404 });

    const { data: rows, error: imageError } = await supabase
      .from("inventory_images")
      .select("image_url,alt_text,sort_order,is_primary")
      .eq("inventory_item_id", inventoryItemId)
      .order("sort_order", { ascending: true });
    if (imageError) throw imageError;

    const selected = pair((rows || []) as ImageRow[]);
    if (!selected.front?.url || !selected.back?.url) {
      return NextResponse.json(
        {
          error: "InstaComp blocked: a real stored front and back are required.",
          storedImageCount: selected.count,
        },
        { status: 409 },
      );
    }
    if (selected.front.url === selected.back.url) {
      return NextResponse.json(
        { error: "InstaComp blocked: front and back point to the same image." },
        { status: 409 },
      );
    }

    const [frontFile, backFile] = await Promise.all([
      downloadStoredImage(selected.front.url, "front"),
      downloadStoredImage(selected.back.url, "back"),
    ]);

    const formData = new FormData();
    formData.set("frontImage", frontFile);
    formData.set("backImage", backFile);
    formData.set(
      "aiCouncilTier",
      typeof body?.aiCouncilTier === "string" ? body.aiCouncilTier : "adaptive",
    );
    const authorization = request.headers.get("authorization") || "";
    const scanRequest = new NextRequest("http://localhost/api/instacomp/scan", {
      method: "POST",
      headers: authorization ? { authorization } : undefined,
      body: formData,
    });
    const scanResponse = await runInstaCompScan(scanRequest);
    const scanPayload = await scanResponse.json().catch(() => ({}));
    if (!scanResponse.ok || scanPayload?.ok !== true || !scanPayload?.ai) {
      return NextResponse.json(
        {
          error: scanPayload?.error || "Front-and-back identity scan failed.",
          code: scanPayload?.code || null,
          identityComplete: false,
        },
        { status: scanResponse.status || 500 },
      );
    }

    const metadata = record(item.metadata);
    const currentInstaComp = record(metadata.instacomp);
    const collectibleAsset = record(metadata.collectible_asset);
    const ai = record(scanPayload.ai);
    const run =
      normalizedPrintRun(ai.serialNumber) ||
      normalizedPrintRun(ai.printRun) ||
      normalizedPrintRun(collectibleAsset.exact_serial_number) ||
      normalizedPrintRun(collectibleAsset.print_run);
    const candidateText = `${item.title || ""} ${text(ai.brand) || ""} ${text(ai.setName) || ""} ${text(ai.set) || ""} ${text(ai.parallel) || ""} ${text(ai.parallelName) || ""}`;
    const isWnbaPaniniOrSelect =
      /\bwnba\b/i.test(candidateText) && /\b(?:panini|select)\b/i.test(candidateText);
    const claimsPrizm = /\bprizm\b/i.test(candidateText);
    const hasPrizmOnBack = /\bprizm\b/i.test(backEvidence(ai));
    const forcedBaseCard = isWnbaPaniniOrSelect && claimsPrizm && !hasPrizmOnBack;
    const nextTitle = forcedBaseCard ? stripPrizmClaims(item.title) : item.title;
    const checkedAt = new Date().toISOString();

    const nextMetadata = {
      ...metadata,
      collectible_asset: {
        ...collectibleAsset,
        exact_serial_number: run,
        print_run: run,
        parallel_name: forcedBaseCard ? null : collectibleAsset.parallel_name,
      },
      instacomp: {
        ...currentInstaComp,
        schema: "truely.instacompInventoryIdentity.v1",
        scanId: scanPayload.scanId || null,
        ai: {
          ...ai,
          serialNumber: run,
          printRun: run,
          parallel: forcedBaseCard ? null : ai.parallel,
          parallelName: forcedBaseCard ? null : ai.parallelName,
        },
        review: scanPayload.review || null,
        identitySource: "fresh_front_back_scan",
        identityComplete: true,
        identityRuleApplied: forcedBaseCard
          ? "wnba_no_prizm_on_back_forced_base"
          : null,
        hasBackImage: true,
        humanVerified: false,
        trustedForIdentity: false,
        pricingStatus: "identity_complete_pricing_pending",
        pricingReason: "Identity saved successfully. Live pricing is pending and cannot fail the card identity.",
        scannedAt: checkedAt,
      },
    };

    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({
        title: nextTitle,
        metadata: nextMetadata,
        updated_at: checkedAt,
      })
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .eq("status", "draft");
    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      identityComplete: true,
      pricingStatus: "identity_complete_pricing_pending",
      scanId: scanPayload.scanId || null,
      ai: nextMetadata.instacomp.ai,
      review: scanPayload.review || null,
      frontBackContract: {
        enforced: true,
        frontImageUrl: selected.front.url,
        backImageUrl: selected.back.url,
        storedImageCount: selected.count,
      },
      identityRules: {
        printRun: run,
        prizmBackEvidenceRequired: true,
        prizmBackEvidenceFound: hasPrizmOnBack,
        forcedBaseCard,
      },
      nothingPublished: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Front/back identity scan failed.",
        identityComplete: false,
      },
      { status: 500 },
    );
  }
}
