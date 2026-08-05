import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";
import { POST as runInventoryInstaComp } from "../instacomp/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

function backEvidence(metadata: Record<string, unknown>) {
  const instaComp = record(metadata.instacomp);
  const ai = record(instaComp.ai);
  const candidates = [
    ai.backText,
    ai.back_text,
    ai.backOcr,
    ai.back_ocr,
    ai.backEvidence,
    ai.back_evidence,
    instaComp.backText,
    instaComp.backOcr,
    instaComp.backEvidence,
  ];
  return candidates
    .map((value) =>
      typeof value === "string" ? value : value ? JSON.stringify(value) : "",
    )
    .join(" ")
    .toLowerCase();
}

function stripPrizmClaims(value: unknown) {
  const raw = typeof value === "string" ? value : "";
  return raw
    .replace(/\bsilver\s+prizm\b/gi, "")
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
      .select("id,seller_account_id,status")
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
          error: "InstaComp blocked: a real stored front row and a real stored back row are required.",
          storedImageCount: selected.count,
        },
        { status: 409 },
      );
    }
    if (selected.front.url === selected.back.url) {
      return NextResponse.json(
        { error: "InstaComp blocked: the stored front and back point to the same image." },
        { status: 409 },
      );
    }

    const authorization = request.headers.get("authorization") || "";
    const forwarded = new NextRequest("http://localhost/api/account/seller/inventory/instacomp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify({
        inventoryItemId,
        aiCouncilTier: typeof body?.aiCouncilTier === "string" ? body.aiCouncilTier : "adaptive",
        forceIdentityRescan: true,
        requireFrontBackPair: true,
        expectedFrontImageUrl: selected.front.url,
        expectedBackImageUrl: selected.back.url,
      }),
    });
    const response = await runInventoryInstaComp(forwarded);
    const payload = await response.json().catch(() => ({}));

    let identityRules = {
      printRun: null as string | null,
      prizmBackEvidenceRequired: true,
      prizmBackEvidenceFound: false,
      forcedBaseCard: false,
    };

    if (response.ok && payload?.success === true) {
      const { data: scanned } = await supabase
        .from("inventory_items")
        .select("title,metadata")
        .eq("id", inventoryItemId)
        .eq("store_id", storeId)
        .maybeSingle();

      if (scanned) {
        const metadata = record(scanned.metadata);
        const instaComp = record(metadata.instacomp);
        const ai = record(instaComp.ai);
        const collectibleAsset = record(metadata.collectible_asset);
        const run =
          normalizedPrintRun(ai.serialNumber) ||
          normalizedPrintRun(ai.printRun) ||
          normalizedPrintRun(collectibleAsset.exact_serial_number) ||
          normalizedPrintRun(collectibleAsset.print_run);
        const candidateText = `${scanned.title || ""} ${text(ai.brand) || ""} ${text(ai.set) || ""} ${text(ai.parallel) || ""} ${text(ai.parallelName) || ""} ${text(collectibleAsset.parallel_name) || ""}`;
        const isWnbaPaniniOrSelect = /\bwnba\b/i.test(candidateText) && /\b(?:panini|select)\b/i.test(candidateText);
        const claimsPrizm = /\bprizm\b/i.test(candidateText);
        const hasPrizmOnBack = /\bprizm\b/i.test(backEvidence(metadata));
        const forcedBaseCard = isWnbaPaniniOrSelect && claimsPrizm && !hasPrizmOnBack;
        const nextTitle = forcedBaseCard
          ? stripPrizmClaims(scanned.title || "Untitled card")
          : scanned.title;

        const nextMetadata = {
          ...metadata,
          collectible_asset: {
            ...collectibleAsset,
            exact_serial_number: run,
            print_run: run,
            parallel_name: forcedBaseCard ? null : collectibleAsset.parallel_name,
          },
          instacomp: {
            ...instaComp,
            identityRuleApplied: forcedBaseCard
              ? "wnba_no_prizm_on_back_forced_base"
              : instaComp.identityRuleApplied,
            ai: {
              ...ai,
              serialNumber: run,
              printRun: run,
              parallel: forcedBaseCard ? null : ai.parallel,
              parallelName: forcedBaseCard ? null : ai.parallelName,
            },
          },
        };

        await supabase
          .from("inventory_items")
          .update({
            title: nextTitle,
            metadata: nextMetadata,
            updated_at: new Date().toISOString(),
          })
          .eq("id", inventoryItemId)
          .eq("store_id", storeId);

        identityRules = {
          printRun: run,
          prizmBackEvidenceRequired: true,
          prizmBackEvidenceFound: hasPrizmOnBack,
          forcedBaseCard,
        };
      }
    }

    return NextResponse.json(
      {
        ...payload,
        frontBackContract: {
          enforced: true,
          frontImageUrl: selected.front.url,
          backImageUrl: selected.back.url,
          storedImageCount: selected.count,
        },
        identityRules,
      },
      { status: response.status },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Front/back InstaComp failed." },
      { status: 500 },
    );
  }
}
