import { createClient } from "@supabase/supabase-js";
import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE = "ebay_purchase_history_pdf_reconciliation";
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
  external_listing_id: string | null;
  title: string | null;
  marketplace_id: string | null;
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

    const { data: rawLots, error: lotsError } = await supabase
      .from("tcos_mi_purchase_lots")
      .select(
        "id,purchase_number,purchased_at,quantity_purchased,total_acquisition_cost,unit_cost_basis,metadata,collectible_identity_id",
      )
      .order("purchase_number", { ascending: true });
    if (lotsError) throw new Error(`Purchase Ledger read failed: ${lotsError.message}`);

    const lots = ((rawLots || []) as PurchaseLot[]).filter(
      (lot) => record(lot.metadata).beta_one_purchase_source === SOURCE,
    );
    const allInTotal = money(
      lots.reduce((sum, lot) => sum + Number(lot.total_acquisition_cost || 0), 0),
    );

    if (lots.length !== EXPECTED_POSITIONS || allInTotal !== EXPECTED_ALL_IN_TOTAL) {
      return Response.json(
        {
          success: false,
          error: "Owner-purchase learning source failed the reconciliation truth gate.",
          expectedPositions: EXPECTED_POSITIONS,
          eligible: lots.length,
          expectedAllInTotal: EXPECTED_ALL_IN_TOTAL,
          allInTotal,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const inboxIds = Array.from(
      new Set(
        lots
          .map((lot) => text(record(lot.metadata).purchase_inbox_id))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const inboxById = new Map<string, PurchaseInbox>();
    if (inboxIds.length) {
      const { data: inboxRows, error: inboxError } = await supabase
        .from("tcos_mi_purchase_inbox")
        .select("id,external_listing_id,title,marketplace_id")
        .in("id", inboxIds);
      if (inboxError) throw new Error(`Purchase Inbox read failed: ${inboxError.message}`);
      for (const row of (inboxRows || []) as PurchaseInbox[]) inboxById.set(row.id, row);
    }

    const alreadySynced = lots.filter((lot) => isSynced(record(lot.metadata))).length;
    const inFlight = lots.filter((lot) => isInFlight(record(lot.metadata)));

    if (mode === "inspect") {
      return Response.json(
        {
          success: true,
          schema: "tcos.instacomp.ownerPurchaseLearningSync.v1",
          mode,
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

      const inboxId = text(metadata.purchase_inbox_id);
      const inbox = inboxId ? inboxById.get(inboxId) || null : null;
      const candidateKey = `owner-ebay-purchase:${lot.id}`;
      const startedAt = new Date().toISOString();
      const sendingReceipt = {
        schema: RECEIPT_SCHEMA,
        status: "sending",
        eventType: "BUY",
        candidateKey,
        verificationSource: "owner_confirmed_ebay_purchase_history",
        purchaseTruthConfidence: 1,
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
        text(inbox?.title) ||
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
          ebayItemId: text(inbox?.external_listing_id) || text(metadata.ebay_item_id),
          sourceOrderHashSha256: text(metadata.external_order_hash_sha256),
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
      .select("id,metadata");
    if (verifyError) throw new Error(`Learning verification read failed: ${verifyError.message}`);
    const verified = (verifyRows || []).filter((row: any) => {
      const metadata = record(row.metadata);
      return (
        metadata.beta_one_purchase_source === SOURCE &&
        isSynced(metadata)
      );
    }).length;

    if (verified !== EXPECTED_POSITIONS) {
      throw new Error(
        `Learning verification failed closed: expected ${EXPECTED_POSITIONS} synced purchases, found ${verified}.`,
      );
    }

    return Response.json(
      {
        success: true,
        schema: "tcos.instacomp.ownerPurchaseLearningSync.v1",
        mode,
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
