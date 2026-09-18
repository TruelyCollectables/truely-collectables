import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/account-auth";
import {
  getConfiguredInstaCompMacKey,
  getConfiguredInstaCompMacUrl,
  isTrustedInstaCompMacUrl,
} from "../../../../../lib/instacomp-mac-credentials";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function first(...values: unknown[]) {
  for (const value of values) {
    const result = text(value);
    if (result) return result;
  }
  return "";
}

function identityFromMetadata(metadata: Record<string, any>) {
  const instaComp = record(metadata.instacomp);
  const ai = record(instaComp.ai);
  const stored = record(instaComp.identity);
  const checklist = record(instaComp.checklistIdentity);
  const checklistIdentity = record(checklist.identity);
  const cardIdentity = record(metadata.card_identity);
  const legacyCardIdentity = record(metadata.cardIdentity);
  const saleIdentity = record(metadata.sale_identity);
  const sources = [ai, stored, checklistIdentity, cardIdentity, legacyCardIdentity, saleIdentity];
  const pick = (...keys: string[]) => {
    for (const source of sources) {
      for (const key of keys) {
        const value = text(source[key]);
        if (value) return value;
      }
    }
    return "";
  };
  const truthy = (...keys: string[]) => sources.some((source) => keys.some((key) => source[key] === true));
  return {
    player: pick("player"),
    year: pick("year"),
    manufacturer: pick("manufacturer"),
    brand: pick("brand", "manufacturer"),
    product: pick("product", "setName", "set_name"),
    setName: pick("setName", "set_name", "product"),
    subset: pick("subset"),
    cardNumber: pick("cardNumber", "card_number"),
    parallel: pick("parallel") || "Base",
    serialNumber: pick("serialNumber", "serial_number", "serialRun", "serial_run"),
    gradingCompany: pick("gradingCompany", "grading_company"),
    gradeValue: pick("gradeValue", "grade_value", "grade"),
    isAuto: truthy("isAuto", "is_auto", "autograph"),
    isRelic: truthy("isRelic", "is_relic", "relic"),
    registryIdentityId: first(checklist.identityId, checklist.identity_id, instaComp.registryIdentityId),
    registryFingerprintSha256: first(checklist.fingerprintSha256, checklist.fingerprint_sha256, instaComp.registryFingerprintSha256),
    trustedForIdentity: instaComp.trustedForIdentity === true || instaComp.humanVerified === true,
    scanId: first(instaComp.scanId),
  };
}

function priceGuideCoverage(value: unknown) {
  if (!Array.isArray(value)) return null;
  const found = value.find((row) => record(row).source === "ebay_price_guide");
  return found ? record(found) : null;
}

function mergeProviderCoverage(current: unknown, replacement: Record<string, any> | null) {
  const rows = Array.isArray(current)
    ? current.filter((row) => record(row).source !== "ebay_price_guide")
    : [];
  return replacement ? [replacement, ...rows] : rows;
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ error: "Seller login is required." }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });

    const body = await request.json().catch(() => ({}));
    const inventoryItemId = text(body.inventoryItemId);
    const force = body.force === true;
    if (!inventoryItemId) return Response.json({ error: "Inventory item is required." }, { status: 400 });

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isOwner = ["sales@truelycollectables.com", "sales@trulycollectables.com"].includes(
      String(account.email || "").toLowerCase(),
    );
    let query = supabase
      .from("inventory_items")
      .select("id,title,seller_account_id,metadata")
      .eq("store_id", storeId)
      .eq("id", inventoryItemId);
    query = isOwner
      ? query.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : query.eq("seller_account_id", account.id);
    const { data: item, error: readError } = await query.maybeSingle();
    if (readError) throw readError;
    if (!item) return Response.json({ error: "Inventory item not found." }, { status: 404 });

    const metadata = record(item.metadata);
    const instaComp = record(metadata.instacomp);
    const priorCoverage = record(instaComp.priceGuideCoverage);
    const priorStatus = text(priorCoverage.status || instaComp.priceGuideStatus);
    const terminalStatus = ["live", "no_matches", "identity_mismatch"].includes(priorStatus);
    if (!force && text(instaComp.priceGuideCheckedAt) && terminalStatus) {
      return Response.json({
        ok: true,
        inventoryItemId,
        cached: true,
        priceGuide: instaComp.priceGuide && typeof instaComp.priceGuide === "object" ? instaComp.priceGuide : null,
        priceGuideCoverage: priorCoverage,
        checkedAt: instaComp.priceGuideCheckedAt,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const identity = identityFromMetadata(metadata);
    const missing = [
      !identity.year ? "year" : null,
      !identity.player ? "player" : null,
      !identity.cardNumber ? "card number" : null,
    ].filter(Boolean);
    if (missing.length) {
      return Response.json({
        ok: false,
        inventoryItemId,
        status: "identity_incomplete",
        error: `Price Guide waits for exact identity: ${missing.join(", ")}.`,
      }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }

    const baseUrl = getConfiguredInstaCompMacUrl();
    const key = getConfiguredInstaCompMacKey();
    if (!baseUrl || !key || !isTrustedInstaCompMacUrl(baseUrl)) {
      return Response.json({ error: "The authenticated InstaComp Mac market bridge is not configured." }, { status: 503 });
    }

    const response = await fetch(`${baseUrl}/v1/market-comp/search`, {
      method: "POST",
      headers: {
        "X-InstaComp-AI-Key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        exact_title: first(item.title, `${identity.year} ${identity.brand} ${identity.player} #${identity.cardNumber}`),
        identity: {
          player: identity.player,
          year: identity.year,
          manufacturer: identity.manufacturer,
          brand: identity.brand,
          product: identity.product,
          setName: identity.setName,
          subset: identity.subset || null,
          cardNumber: identity.cardNumber,
          parallel: identity.parallel,
          serialNumber: identity.serialNumber || null,
          gradingCompany: identity.gradingCompany || null,
          gradeValue: identity.gradeValue || null,
          isAuto: identity.isAuto,
          isRelic: identity.isRelic,
        },
        scan_id: identity.scanId || null,
        registry_identity_id: identity.registryIdentityId || null,
        registry_fingerprint_sha256: identity.registryFingerprintSha256 || null,
        research_id: identity.scanId || `price-guide-${inventoryItemId}`,
        operator_certified_identity: identity.trustedForIdentity,
        include_active: true,
        include_price_guide: true,
        include_130point: false,
        include_fanatics: false,
        max_sold: 20,
        max_active: 20,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(200_000),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok || payload.ok !== true) {
      throw new Error(text(payload.detail || payload.error) || `Mac market search failed (${response.status}).`);
    }

    const coverage = priceGuideCoverage(payload.providerCoverage) || {
      source: "ebay_price_guide",
      label: "eBay Price Guide",
      status: payload.priceGuide ? "live" : "no_matches",
      resultCount: Number(payload.priceGuide?.soldCount || 0),
      message: payload.priceGuide ? "eBay Price Guide snapshot captured." : "eBay Price Guide checked; no exact-card dataset was available.",
    };
    const checkedAt = text(payload.priceGuide?.capturedAt) || new Date().toISOString();

    // The browser-backed Price Guide lookup can take a while. Re-read metadata
    // before writing so a seller edit made during the lookup is never clobbered
    // by the older metadata snapshot captured at request start.
    const { data: latestItem, error: latestError } = await supabase
      .from("inventory_items")
      .select("metadata")
      .eq("store_id", storeId)
      .eq("id", inventoryItemId)
      .single();
    if (latestError) throw latestError;
    const latestMetadata = record(latestItem?.metadata);
    const latestInstaComp = record(latestMetadata.instacomp);
    const nextInstaComp = {
      ...latestInstaComp,
      priceGuide: payload.priceGuide && typeof payload.priceGuide === "object" ? payload.priceGuide : null,
      priceGuideCheckedAt: checkedAt,
      priceGuideStatus: text(coverage.status) || (payload.priceGuide ? "live" : "no_matches"),
      priceGuideMessage: text(coverage.message) || null,
      priceGuideCoverage: coverage,
      providerCoverage: mergeProviderCoverage(latestInstaComp.providerCoverage, coverage),
    };
    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({
        metadata: { ...latestMetadata, instacomp: nextInstaComp },
        updated_at: new Date().toISOString(),
      })
      .eq("store_id", storeId)
      .eq("id", inventoryItemId);
    if (updateError) throw updateError;

    return Response.json({
      ok: true,
      inventoryItemId,
      cached: false,
      priceGuide: nextInstaComp.priceGuide,
      priceGuideCoverage: coverage,
      checkedAt,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not refresh eBay Price Guide." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
