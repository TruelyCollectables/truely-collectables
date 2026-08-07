import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const EXPECTED_POSITIONS = 28;
const EXPECTED_ALL_IN_TOTAL = 528.52;
const RECEIPT_SCHEMA = "tcos.instacomp.ownerPurchaseLearningReceipt.v1";
const EVENT_SCHEMA = "tcos.instacomp-ai.ownerPurchaseLearningEvent.v1";

// Derived from the user-confirmed 2026-08-07 eBay Purchase History PDF.
// Listing IDs are stored only as SHA-256 fingerprints; plaintext eBay item IDs
// and order numbers are intentionally not committed to source control.
const VERIFIED_PURCHASES = [
  { itemHash: "7c9bc2f04c8433be8aba0005c578fcec7ef4b2dcf187a43d73b39dc8792a6041", purchasedOn: "2026-08-06", allIn: 23.37, quantity: 1 },
  { itemHash: "3a5b418f5ff5f7c1833308c7e6c3770e0ebc72b16a1eb4c7a731fd7f36a4a776", purchasedOn: "2026-08-06", allIn: 17.14, quantity: 12 },
  { itemHash: "95371a1774febe210cb95305d7dfcc27ff831a8f5d6a03f6751692e4b2e4e7c4", purchasedOn: "2026-08-06", allIn: 19.48, quantity: 1 },
  { itemHash: "025fdc0ea2d1d9af4a2634519ad6d2129ce4a09450d2347da37f6f5f42b88273", purchasedOn: "2026-08-06", allIn: 7.49, quantity: 11 },
  { itemHash: "c8b8d356442710d703b857f0b8c98fcf9fa9215a24d6edfd72dbec856299ed29", purchasedOn: "2026-08-06", allIn: 12.07, quantity: 15 },
  { itemHash: "a5a543fca991236ed7ea69744b72b8de2ce653ffe570e29fb299dde910140274", purchasedOn: "2026-08-06", allIn: 18.92, quantity: 10 },
  { itemHash: "8f8221ac2626874ef1dee4043fa4c45ce11d02beb9d6a37af84db62121b531a0", purchasedOn: "2026-08-06", allIn: 5.57, quantity: 10 },
  { itemHash: "bd0d617047547e9bcef682138ab17e1923134a5c442ccf0fbad8aec6588b4787", purchasedOn: "2026-08-04", allIn: 4.77, quantity: 2 },
  { itemHash: "32adc7535eff97493aa7db77f0f3a18bd3f5aeb6893a026c5325684bcce4321c", purchasedOn: "2026-08-03", allIn: 11.26, quantity: 17 },
  { itemHash: "0a589081122a19a68db69eada98a8032b3462142b4c6c9e7f5e1e0af2b699a54", purchasedOn: "2026-08-02", allIn: 23.95, quantity: 1 },
  { itemHash: "849060f656f4f59993491f043b9e7991761e116a7b75f717ac47b148b444728e", purchasedOn: "2026-08-02", allIn: 5.46, quantity: 1 },
  { itemHash: "3b5b2c0f633a77dc03858ef3fcc6cd47a46fba2795b3243f5a49ea879df5b2bc", purchasedOn: "2026-08-02", allIn: 14.74, quantity: 5 },
  { itemHash: "ad98a317b7af89bb91a37a91ae7e5e5d2c0bd961697761530e3eea5f93af99d7", purchasedOn: "2026-08-02", allIn: 23.37, quantity: 1 },
  { itemHash: "351b5504e54c3f62cbaf53e2db859016e216085f6e48ea8566c0f61233657214", purchasedOn: "2026-08-02", allIn: 20.13, quantity: 1 },
  { itemHash: "d60ca29726e6201e8180afa9a22caba059bad15c4d0d8048fe33900bc5eb5a3c", purchasedOn: "2026-08-02", allIn: 2.53, quantity: 1 },
  { itemHash: "0e8d41cc30b42ecd586ffc0ffedfcb621bd0b702fe8053916137022d8145f0de", purchasedOn: "2026-08-02", allIn: 99.51, quantity: 5 },
  { itemHash: "26d20ea61ac044b640735f2766218ef7a93c1f18e09927d8c7a66b0989fa49b9", purchasedOn: "2026-07-30", allIn: 3.13, quantity: 1 },
  { itemHash: "7d61958b260745a7a5db451a6116d045ceec5cd2fe5096435feb49c4c246f272", purchasedOn: "2026-07-29", allIn: 8.26, quantity: 1 },
  { itemHash: "b83d59930515472fc9d709276256f6b40bf0f8222d4dc83d8b5f16cf5b653b28", purchasedOn: "2026-07-28", allIn: 3.40, quantity: 1 },
  { itemHash: "e3a1898fcd0346916e59abb5a78e577ea4866f1b3ffb34eccd53775c6e35a416", purchasedOn: "2026-07-25", allIn: 4.08, quantity: 1 },
  { itemHash: "1d084a340a9b92c92d48ae6f86fe4c92af4f196ed688eb2f718f2d68577d1c6a", purchasedOn: "2026-07-25", allIn: 34.87, quantity: 1 },
  { itemHash: "8b73d3de7595c53bf5e1b77ee9dcd3c43e0ec2441b95564b47f7f37dc0edbba7", purchasedOn: "2026-07-25", allIn: 12.86, quantity: 5 },
  { itemHash: "eca051cfb73b6bb26c147bbdf6e0df51ed594e4a242bd1c1643e3bbe8c36ba4f", purchasedOn: "2026-07-23", allIn: 33.57, quantity: 92 },
  { itemHash: "3ecf91f8de937142f5795692f0492145bbd2c4b81e64c6edab3a6182f056fd1a", purchasedOn: "2026-07-23", allIn: 32.38, quantity: 20 },
  { itemHash: "340764461ca21f5e7324e4ddbae04f0d50f047415e5d28601092624c107b7ddf", purchasedOn: "2026-07-21", allIn: 20.56, quantity: 1 },
  { itemHash: "8bb12ee382702834b62c6effe0b4a5ac8b7ad6ba2e8c948277bbad02756a7906", purchasedOn: "2026-07-20", allIn: 61.83, quantity: 100 },
  { itemHash: "15d705819e1efd7cf8351e5f157d298c1d8df42b23b7c8bea99cf6f3478dbf81", purchasedOn: "2026-07-19", allIn: 0.31, quantity: 1 },
  { itemHash: "b930c249cb82d681fec76edf478eb4259565e84c1b756a5c50ad920dbeeb7f34", purchasedOn: "2026-07-19", allIn: 3.51, quantity: 1 },
] as const;

type PurchaseLot = {
  id: string;
  purchase_number: number | null;
  purchased_at: string;
  quantity_purchased: number | null;
  total_acquisition_cost: number | null;
  unit_cost_basis: number | null;
  source_url: string | null;
  metadata: Record<string, unknown> | null;
  collectible_identity_id: string | null;
};

type PurchaseInbox = {
  id: string;
  external_listing_id: string | null;
  title: string | null;
  purchase_lot_id: string | null;
  purchased_at: string | null;
  quantity: number | null;
  total_paid: number | null;
  metadata: Record<string, unknown> | null;
};

type LearningTarget = {
  lot: PurchaseLot;
  title: string;
  itemHash: string;
  allIn: number;
  quantity: number;
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

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function money(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? roundMoney(parsed) : 0;
}

function sha(value: unknown) {
  return createHash("sha256").update(String(value || "").trim()).digest("hex");
}

function dateOnly(value: unknown) {
  const parsed = new Date(String(value || ""));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : "";
}

function itemIdFromUrl(value: unknown) {
  return (
    String(value || "").match(/\/itm\/(?:[^/?]+\/)?(\d{9,15})(?:[/?]|$)/i)?.[1] ||
    null
  );
}

function candidateItemIds(lot: PurchaseLot) {
  const metadata = record(lot.metadata);
  return [
    metadata.ebay_item_id,
    metadata.external_listing_id,
    metadata.ebay_legacy_item_id,
    itemIdFromUrl(lot.source_url),
  ]
    .map((value) => text(value))
    .filter((value): value is string => Boolean(value));
}

function candidateTitle(lot: PurchaseLot, inbox: PurchaseInbox | null) {
  const metadata = record(lot.metadata);
  return (
    text(inbox?.title) ||
    text(metadata.source_listing_title) ||
    text(metadata.purchase_title) ||
    text(metadata.original_title)
  );
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

function learningReceipt(metadata: Record<string, any>) {
  return record(metadata.owner_purchase_learning);
}

function isSynced(metadata: Record<string, any>) {
  const value = learningReceipt(metadata);
  return value.schema === RECEIPT_SCHEMA && value.status === "synced";
}

function isInFlight(metadata: Record<string, any>) {
  const value = learningReceipt(metadata);
  return value.schema === RECEIPT_SCHEMA && value.status === "sending";
}

async function postTrustedBuyEvent(params: {
  baseUrl: string;
  headers: Record<string, string>;
  candidateKey: string;
  payload: Record<string, unknown>;
}) {
  const response = await fetch(`${params.baseUrl}/v1/training/deal-hunter/feedback`, {
    method: "POST",
    headers: params.headers,
    body: JSON.stringify({
      eventType: "BUY",
      candidateKey: params.candidateKey,
      payload: params.payload,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
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
}

async function deriveTargets(supabase: any) {
  const [lotRead, inboxRead] = await Promise.all([
    supabase
      .from("tcos_mi_purchase_lots")
      .select(
        "id,purchase_number,purchased_at,quantity_purchased,total_acquisition_cost,unit_cost_basis,source_url,metadata,collectible_identity_id",
      )
      .order("purchase_number", { ascending: false })
      .limit(5000),
    supabase
      .from("tcos_mi_purchase_inbox")
      .select(
        "id,external_listing_id,title,purchase_lot_id,purchased_at,quantity,total_paid,metadata",
      )
      .limit(5000),
  ]);
  if (lotRead.error) throw new Error(`Purchase Ledger read failed: ${lotRead.error.message}`);
  if (inboxRead.error) throw new Error(`Purchase Inbox read failed: ${inboxRead.error.message}`);

  const lots = (lotRead.data || []) as PurchaseLot[];
  const inboxRows = (inboxRead.data || []) as PurchaseInbox[];
  const inboxByItemHash = new Map<string, PurchaseInbox>();
  const inboxByLotId = new Map<string, PurchaseInbox>();

  for (const row of inboxRows) {
    const listingId = text(row.external_listing_id);
    if (listingId) inboxByItemHash.set(sha(listingId), row);
    if (row.purchase_lot_id) inboxByLotId.set(String(row.purchase_lot_id), row);
  }

  const targets: LearningTarget[] = [];
  const usedLotIds = new Set<string>();
  const diagnostics: Array<Record<string, unknown>> = [];

  for (const expected of VERIFIED_PURCHASES) {
    const inbox = inboxByItemHash.get(expected.itemHash) || null;

    let candidates = lots.filter((lot) =>
      candidateItemIds(lot).some((itemId) => sha(itemId) === expected.itemHash),
    );

    if (!candidates.length && inbox?.purchase_lot_id) {
      candidates = lots.filter(
        (lot) => String(lot.id) === String(inbox.purchase_lot_id),
      );
    }

    if (!candidates.length && inbox) {
      candidates = lots.filter((lot) => {
        const title = candidateTitle(lot, inbox);
        return (
          dateOnly(lot.purchased_at) === expected.purchasedOn &&
          Math.abs(money(lot.total_acquisition_cost) - expected.allIn) <= 0.02 &&
          Number(lot.quantity_purchased || 0) === expected.quantity &&
          Boolean(title && text(inbox.title) && title === text(inbox.title))
        );
      });
    }

    candidates = candidates.filter(
      (lot) =>
        dateOnly(lot.purchased_at) === expected.purchasedOn &&
        Math.abs(money(lot.total_acquisition_cost) - expected.allIn) <= 0.02 &&
        Number(lot.quantity_purchased || 0) === expected.quantity,
    );

    if (candidates.length !== 1) {
      diagnostics.push({
        itemHashPrefix: expected.itemHash.slice(0, 12),
        purchasedOn: expected.purchasedOn,
        allIn: expected.allIn,
        quantity: expected.quantity,
        candidateCount: candidates.length,
        inboxMatched: Boolean(inbox),
      });
      continue;
    }

    const lot = candidates[0];
    if (usedLotIds.has(lot.id)) {
      diagnostics.push({
        itemHashPrefix: expected.itemHash.slice(0, 12),
        error: "canonical_lot_reused",
        purchaseNumber: lot.purchase_number,
      });
      continue;
    }

    const linkedInbox = inbox || inboxByLotId.get(lot.id) || null;
    const title = candidateTitle(lot, linkedInbox);
    if (!title) {
      diagnostics.push({
        itemHashPrefix: expected.itemHash.slice(0, 12),
        error: "missing_source_title",
        purchaseNumber: lot.purchase_number,
      });
      continue;
    }

    usedLotIds.add(lot.id);
    targets.push({
      lot,
      title,
      itemHash: expected.itemHash,
      allIn: expected.allIn,
      quantity: expected.quantity,
    });
  }

  const allInTotal = money(
    targets.reduce((sum, target) => sum + money(target.lot.total_acquisition_cost), 0),
  );
  const truthGatePassed =
    diagnostics.length === 0 &&
    targets.length === EXPECTED_POSITIONS &&
    usedLotIds.size === EXPECTED_POSITIONS &&
    allInTotal === EXPECTED_ALL_IN_TOTAL;

  return { targets, diagnostics, allInTotal, truthGatePassed };
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

    const { targets, diagnostics, allInTotal, truthGatePassed } =
      await deriveTargets(supabase);

    if (!truthGatePassed) {
      return Response.json(
        {
          success: false,
          truthGatePassed: false,
          error: "Owner-confirmed eBay PDF rows no longer reconcile 28/28 to the canonical Purchase Ledger.",
          expectedPositions: EXPECTED_POSITIONS,
          matchedPositions: targets.length,
          expectedAllInTotal: EXPECTED_ALL_IN_TOTAL,
          allInTotal,
          diagnostics,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const alreadySynced = targets.filter(({ lot }) =>
      isSynced(record(lot.metadata)),
    ).length;
    const inFlight = targets.filter(({ lot }) =>
      isInFlight(record(lot.metadata)),
    );

    if (mode === "inspect") {
      return Response.json(
        {
          success: true,
          truthGatePassed: true,
          schema: "tcos.instacomp.ownerPurchaseLearningSync.v1",
          mode,
          source: "user_confirmed_ebay_purchase_history_pdf_20260807",
          eligible: targets.length,
          units: targets.reduce((sum, target) => sum + target.quantity, 0),
          allInTotal,
          alreadySynced,
          pending: targets.length - alreadySynced - inFlight.length,
          inFlight: inFlight.length,
          verified: alreadySynced,
          purchaseTruth: "owner_confirmed_100_percent",
          identityBoundary:
            "Purchase listing, date, quantity, and ALL-IN cost are trusted. Exact visual/checklist identity stays Registry-gated.",
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
          eligible: targets.length,
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

    for (const target of targets) {
      const { lot, title, itemHash, allIn, quantity } = target;
      const metadata = record(lot.metadata);
      if (isSynced(metadata)) continue;

      const candidateKey = `owner-ebay-purchase:${lot.id}`;
      const startedAt = new Date().toISOString();
      const sendingReceipt = {
        schema: RECEIPT_SCHEMA,
        status: "sending",
        eventType: "BUY",
        candidateKey,
        verificationSource: "owner_confirmed_ebay_purchase_history_pdf",
        purchaseTruthConfidence: 1,
        sourceItemHashSha256: itemHash,
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

      const unit = money(lot.unit_cost_basis || allIn / quantity);
      await postTrustedBuyEvent({
        baseUrl,
        headers,
        candidateKey,
        payload: {
          schema_version: EVENT_SCHEMA,
          source: "owner_confirmed_ebay_purchase_history_pdf",
          verificationSource: "owner_confirmed_purchase_ledger_reconciliation",
          ownerConfirmed: true,
          purchaseTruth: true,
          truthConfidence: 1,
          purchaseLotId: lot.id,
          purchaseNumber: Number(lot.purchase_number || 0),
          title,
          marketplace: "eBay",
          sourceItemHashSha256: itemHash,
          purchasedAt: lot.purchased_at,
          quantity,
          allInTotal: allIn,
          allInUnitCost: unit,
          currency: text(metadata.currency) || "USD",
          allInPriceAuthoritative: true,
          identityTruthStatus: lot.collectible_identity_id
            ? "structured_market_intel_identity_present"
            : "pending_exact_registry_identity",
          exactRegistryIdentityTrainingAllowed: false,
          note:
            "Trusted owner purchase example. Do not convert eBay receipt/title evidence into visual exact-card identity truth without Registry-backed image evidence.",
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

    const targetIds = targets.map(({ lot }) => lot.id);
    const { data: verifyRows, error: verifyError } = await supabase
      .from("tcos_mi_purchase_lots")
      .select("id,metadata")
      .in("id", targetIds);
    if (verifyError) {
      throw new Error(`Learning verification read failed: ${verifyError.message}`);
    }
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
        source: "user_confirmed_ebay_purchase_history_pdf_20260807",
        eligible: targets.length,
        units: targets.reduce((sum, target) => sum + target.quantity, 0),
        allInTotal,
        sent,
        alreadySynced: targets.length - sent,
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
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
