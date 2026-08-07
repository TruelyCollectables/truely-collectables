import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const EXPECTED_ORDER_HASHES = new Set([
  "0801f6d8f7d5c6d75f480895169ad81d632d93f18b38c27df4cc380323090821",
  "5a5991524fa9acfd8dbb462cfaa9c8a1e0a057bd1977e7dd784060d323895bdb",
  "5ea3dc93db0c1b5b1a6178b1975c4de1bc0a1dd207a5ea7834f52e7188f4b1c9",
  "08973dda32e6ce2be4b8ebb7936f87092f86a17ab9fcb970c04c385c0b6932ab",
  "50dd91cb3343e85e0054443bd824f3eebd221475152f75b7d2e4c0d37a94a155",
  "e9cbb7d47e9788d139901c151ceb7ba828f8a42b857825304b82e5f71a38705a",
  "a040a23340a41ebdef6191fc640dec1d40569832f078b4a987dcade38a73ba8e",
  "759794aaf7e3e0071ce3a1fc270f3758714103558796f0f062971069834d5f9c",
  "b138931b1a42b8f943f4a1796fd81fdbe5d03b90242f37409a945ff47e635888",
  "968a2b0db00d023c7d7c70f9ddfc73f9141f1faec14faa6e16001a7efe403706",
  "87d248edf449251b855bf20ed9f140397b81edc37ec6b4a55b88b7fb5c90782c",
  "01806de13bb3b1334c73152afde1cffc7fa85000d06da6ac682b468f8bcd5e1f",
  "82e9bfa02f28ebe12ea29d79e41a82dba7605ce707fded0511b1b6223631b818",
  "accf4909164619d8f8a9e8741c247b98cbf3150b7ad9aadc2c77498035ba4d78",
  "42905016278441b82ae38caeb568d254221e6ac054e7d29ea0a53a264ac5f91d",
  "44d641deb737ffe158b4e57b55eb5604db1c0135c253f7f8adcd100952c08691",
  "59beb36cb3b94fb6674310d10761ab2411e70c35cc574f5c0428c5e4264c4dd2",
  "38acc32838f76f84706094296e51eec59fcf2d40f7e5fb4c91c270d0e22d7be5",
  "6da3952584541d60f62be91cf5e3347cacaea8de23a316582a14d4934299c0bf",
  "7cca87655edb6c06add807f09e0a6c5349133af97c890e97ae3c137d175fc13d",
  "293065c9c01f1a22b7c59234f9a75ac3f88b372ecda458eacf5ab255f906aff9",
  "b36036a4b340d1393282bba568e75886ff8af085fe8ff7e7b59db7566c1130d9",
  "19ad41fce4ef315dcd02e6a1ba202015a1382790f1a12386b88e8d888aa228fc",
  "b13eedb8abea93f56a3c49a72d472d9ccec8159c127fb40db9ef8792a98bc263",
  "53f65eb404ebf78f26cff6a213fdb2166b2c6b072f91582928d9be3966b6862c",
]);
const EXPECTED_ORDERS = 25;
const EXPECTED_POSITIONS = 28;
const EXPECTED_ALL_IN_TOTAL = 528.52;
const RECEIPT_SCHEMA = "tcos.instacomp.ownerPurchaseLearningReceipt.v1";
const EVENT_SCHEMA = "tcos.instacomp-ai.ownerPurchaseLearningEvent.v1";

type PurchaseLot = {
  id: string;
  purchase_number: number | null;
  purchased_at: string;
  quantity_purchased: number | null;
  total_acquisition_cost: number | null;
  unit_cost_basis: number | null;
  metadata: Record<string, unknown> | null;
  collectible_identity_id: string | null;
};

type PurchaseInbox = {
  id: string;
  external_order_id: string | null;
  external_listing_id: string | null;
  title: string | null;
  marketplace_id: string | null;
  purchase_lot_id: string | null;
};

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function money(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function sha(value: unknown) {
  return createHash("sha256").update(String(value || "").trim()).digest("hex");
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
}

async function authorized(request: Request) {
  const token = bearerToken(request);
  if (!token) return false;
  try {
    const response = await fetch("https://api.vercel.com/v2/teams?limit=100", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { teams?: unknown };
    return releaseRuntimeTeamIsAllowed(payload.teams);
  } catch {
    return false;
  }
}

function macBaseUrl() {
  const configured = String(process.env.INSTACOMP_AI_LOCAL_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+\.truelycollectables\.com$/i.test(configured)) {
    throw new Error(
      "Production InstaComp Mac tunnel URL is missing or not on truelycollectables.com.",
    );
  }
  return configured;
}

function macHeaders() {
  const key = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
  if (!key) throw new Error("Production InstaComp Mac shared key is missing.");
  return {
    "X-InstaComp-AI-Key": key,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function receipt(metadata: Record<string, any>) {
  return record(metadata.owner_purchase_learning);
}

function isSynced(metadata: Record<string, any>) {
  const value = receipt(metadata);
  return value.schema === RECEIPT_SCHEMA && value.status === "synced";
}

function isInFlight(metadata: Record<string, any>) {
  const value = receipt(metadata);
  return value.schema === RECEIPT_SCHEMA && value.status === "sending";
}

async function postTrustedBuyEvent(params: {
  baseUrl: string;
  headers: Record<string, string>;
  candidateKey: string;
  payload: Record<string, unknown>;
}) {
  const response = await fetch(
    `${params.baseUrl}/v1/training/deal-hunter/feedback`,
    {
      method: "POST",
      headers: params.headers,
      body: JSON.stringify({
        eventType: "BUY",
        candidateKey: params.candidateKey,
        payload: params.payload,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body = await response.text();
  let parsed: any = null;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = { raw: body.slice(0, 1000) };
  }
  if (
    !response.ok ||
    parsed?.ok !== true ||
    parsed?.trusted !== true ||
    String(parsed?.event_type || "").toUpperCase() !== "BUY"
  ) {
    throw new Error(
      `Physical Mac rejected trusted BUY learning event: HTTP ${response.status} ${JSON.stringify(parsed).slice(0, 1200)}`,
    );
  }
  return parsed;
}

export async function POST(request: Request) {
  if (!(await authorized(request))) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const mode = String(url.searchParams.get("mode") || "inspect").toLowerCase();
    if (!new Set(["inspect", "sync"]).has(mode)) {
      return Response.json(
        { success: false, error: "mode must be inspect or sync" },
        { status: 400 },
      );
    }

    const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!supabaseUrl || !serviceRole) {
      throw new Error("Production Supabase service role is not configured.");
    }
    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // The reconciliation reused 28 pre-existing ledger lots, so the source marker lives
    // most reliably in the original eBay order identity, not on a newly inserted lot.
    // Match only the 25 uploaded order fingerprints; plaintext order numbers never live
    // in source control.
    const { data: rawInbox, error: inboxError } = await supabase
      .from("tcos_mi_purchase_inbox")
      .select(
        "id,external_order_id,external_listing_id,title,marketplace_id,purchase_lot_id",
      );
    if (inboxError) throw new Error(`Purchase Inbox read failed: ${inboxError.message}`);

    const matchedInbox = ((rawInbox || []) as PurchaseInbox[]).filter((row) => {
      const orderId = text(row.external_order_id);
      return Boolean(orderId && EXPECTED_ORDER_HASHES.has(sha(orderId)));
    });
    const observedOrderHashes = new Set(
      matchedInbox
        .map((row) => text(row.external_order_id))
        .filter((value): value is string => Boolean(value))
        .map(sha),
    );
    const linkedLotIds = matchedInbox
      .map((row) => text(row.purchase_lot_id))
      .filter((value): value is string => Boolean(value));
    const uniqueLotIds = Array.from(new Set(linkedLotIds));

    const inboxByLotId = new Map<string, PurchaseInbox>();
    for (const row of matchedInbox) {
      const lotId = text(row.purchase_lot_id);
      if (lotId) inboxByLotId.set(lotId, row);
    }

    let lots: PurchaseLot[] = [];
    if (uniqueLotIds.length) {
      const { data: rawLots, error: lotsError } = await supabase
        .from("tcos_mi_purchase_lots")
        .select(
          "id,purchase_number,purchased_at,quantity_purchased,total_acquisition_cost,unit_cost_basis,metadata,collectible_identity_id",
        )
        .in("id", uniqueLotIds)
        .order("purchase_number", { ascending: true });
      if (lotsError) throw new Error(`Purchase Ledger read failed: ${lotsError.message}`);
      lots = (rawLots || []) as PurchaseLot[];
    }

    const allInTotal = money(
      lots.reduce((sum, lot) => sum + Number(lot.total_acquisition_cost || 0), 0),
    );
    const truthGatePassed =
      matchedInbox.length === EXPECTED_POSITIONS &&
      observedOrderHashes.size === EXPECTED_ORDERS &&
      linkedLotIds.length === EXPECTED_POSITIONS &&
      uniqueLotIds.length === EXPECTED_POSITIONS &&
      lots.length === EXPECTED_POSITIONS &&
      allInTotal === EXPECTED_ALL_IN_TOTAL;

    if (!truthGatePassed) {
      const diagnostic = {
        success: mode === "inspect",
        truthGatePassed: false,
        error: "Owner-purchase learning source failed the reconciliation truth gate.",
        expectedOrders: EXPECTED_ORDERS,
        matchedOrders: observedOrderHashes.size,
        expectedPositions: EXPECTED_POSITIONS,
        matchedInboxRows: matchedInbox.length,
        linkedInboxRows: linkedLotIds.length,
        distinctLinkedLots: uniqueLotIds.length,
        fetchedLots: lots.length,
        expectedAllInTotal: EXPECTED_ALL_IN_TOTAL,
        allInTotal,
      };
      return Response.json(diagnostic, {
        status: mode === "inspect" ? 200 : 409,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const alreadySynced = lots.filter((lot) => isSynced(record(lot.metadata))).length;
    const inFlight = lots.filter((lot) => isInFlight(record(lot.metadata)));

    if (mode === "inspect") {
      return Response.json(
        {
          success: true,
          truthGatePassed: true,
          schema: "tcos.instacomp.ownerPurchaseLearningSync.v1",
          mode,
          matchedOrders: observedOrderHashes.size,
          eligible: lots.length,
          allInTotal,
          alreadySynced,
          pending: lots.length - alreadySynced - inFlight.length,
          inFlight: inFlight.length,
          verified: alreadySynced,
          purchaseTruth: "owner_confirmed_100_percent",
          identityBoundary:
            "Purchase, title, quantity, date, and ALL-IN cost are trusted. Exact visual/checklist identity remains gated until Registry evidence exists.",
          checkedAt: new Date().toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (inFlight.length) {
      return Response.json(
        {
          success: false,
          error:
            "A prior learning write is marked in-flight. Sync stopped rather than risk duplicating a trusted learning event.",
          eligible: lots.length,
          allInTotal,
          alreadySynced,
          inFlight: inFlight.length,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const baseUrl = macBaseUrl();
    const headers = macHeaders();
    let sent = 0;

    for (const lot of lots) {
      const metadata = record(lot.metadata);
      if (isSynced(metadata)) continue;

      const inbox = inboxByLotId.get(lot.id) || null;
      if (!inbox) {
        throw new Error(
          `Purchase #${lot.purchase_number || "?"} lost its reconciled Purchase Inbox linkage.`,
        );
      }
      const orderId = text(inbox.external_order_id);
      const orderHash = orderId ? sha(orderId) : null;
      if (!orderHash || !EXPECTED_ORDER_HASHES.has(orderHash)) {
        throw new Error(
          `Purchase #${lot.purchase_number || "?"} failed its eBay order-fingerprint check.`,
        );
      }

      const candidateKey = `owner-ebay-purchase:${lot.id}`;
      const startedAt = new Date().toISOString();
      const sendingReceipt = {
        schema: RECEIPT_SCHEMA,
        status: "sending",
        eventType: "BUY",
        candidateKey,
        verificationSource: "owner_confirmed_ebay_purchase_history",
        purchaseTruthConfidence: 1,
        sourceOrderHashSha256: orderHash,
        startedAt,
      };

      const { error: sendingError } = await supabase
        .from("tcos_mi_purchase_lots")
        .update({
          metadata: {
            ...metadata,
            owner_purchase_learning: sendingReceipt,
          },
        })
        .eq("id", lot.id);
      if (sendingError) {
        throw new Error(
          `Could not reserve Purchase #${lot.purchase_number || "?"} for exactly-once learning: ${sendingError.message}`,
        );
      }

      const quantity = Math.max(1, Number(lot.quantity_purchased || 1));
      const total = money(lot.total_acquisition_cost);
      const unit = money(lot.unit_cost_basis || total / quantity);
      const title =
        text(inbox.title) ||
        text(metadata.source_listing_title) ||
        `eBay Purchase #${lot.purchase_number || "unknown"}`;

      await postTrustedBuyEvent({
        baseUrl,
        headers,
        candidateKey,
        payload: {
          schema_version: EVENT_SCHEMA,
          source: "owner_confirmed_ebay_purchase_history",
          verificationSource: "owner_confirmed_purchase_ledger_reconciliation",
          ownerConfirmed: true,
          purchaseTruth: true,
          truthConfidence: 1,
          purchaseLotId: lot.id,
          purchaseNumber: Number(lot.purchase_number || 0),
          title,
          marketplace: "eBay",
          ebayItemId: text(inbox.external_listing_id) || text(metadata.ebay_item_id),
          sourceOrderHashSha256: orderHash,
          purchasedAt: lot.purchased_at,
          quantity,
          allInTotal: total,
          allInUnitCost: unit,
          currency: text(metadata.currency) || "USD",
          allInPriceAuthoritative: true,
          identityTruthStatus: lot.collectible_identity_id
            ? "structured_market_intel_identity_present"
            : "pending_exact_registry_identity",
          exactRegistryIdentityTrainingAllowed: false,
          note:
            "Trusted owner purchase example. Do not convert this title-only purchase receipt into visual exact-card identity truth without Registry-backed image evidence.",
        },
      });

      const { error: syncedError } = await supabase
        .from("tcos_mi_purchase_lots")
        .update({
          metadata: {
            ...metadata,
            owner_purchase_learning: {
              ...sendingReceipt,
              status: "synced",
              syncedAt: new Date().toISOString(),
              localDecisionLearning: true,
              identityTrainingMutated: false,
            },
          },
        })
        .eq("id", lot.id);
      if (syncedError) {
        throw new Error(
          `Mac accepted Purchase #${lot.purchase_number || "?"}, but its durable ledger learning receipt could not be finalized: ${syncedError.message}`,
        );
      }
      sent += 1;
    }

    const { data: verifyRows, error: verifyError } = await supabase
      .from("tcos_mi_purchase_lots")
      .select("id,metadata")
      .in("id", uniqueLotIds);
    if (verifyError) throw new Error(`Learning verification read failed: ${verifyError.message}`);
    const verified = (verifyRows || []).filter((row: any) =>
      isSynced(record(row.metadata)),
    ).length;

    if (verified !== EXPECTED_POSITIONS) {
      throw new Error(
        `Learning verification failed closed: expected ${EXPECTED_POSITIONS} synced purchases, found ${verified}.`,
      );
    }

    return Response.json(
      {
        success: true,
        truthGatePassed: true,
        schema: "tcos.instacomp.ownerPurchaseLearningSync.v1",
        mode,
        matchedOrders: observedOrderHashes.size,
        eligible: lots.length,
        allInTotal,
        sent,
        alreadySynced: lots.length - sent,
        verified,
        inFlight: 0,
        purchaseTruth: "owner_confirmed_100_percent",
        learningLayer: "trusted_deal_hunter_purchase_decision_memory",
        identityBoundary:
          "All purchase facts are trusted. Visual exact-card identity remains fail-closed until Registry-backed image evidence exists.",
        completedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
