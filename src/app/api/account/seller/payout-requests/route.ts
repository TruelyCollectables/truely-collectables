import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedAccountFromRequest } from "../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../lib/stores";

export const dynamic = "force-dynamic";

type SellerPayoutLedgerRow = {
  id: string;
  seller_payable_amount: number | string | null;
  payout_status: string | null;
};

type EligibleLedgerAllocationRow = SellerPayoutLedgerRow & {
  remaining_payable_amount: number;
};

type SellerPayoutRequestRow = {
  id: string;
  requested_amount: number | string | null;
  estimated_processor_fee_rate: number | string | null;
  estimated_processor_fee_amount: number | string | null;
  estimated_net_amount: number | string | null;
  final_processor_fee_amount: number | string | null;
  final_net_amount: number | string | null;
  provider_payout_reference: string | null;
  provider_payout_status: string | null;
  status: string | null;
  request_note: string | null;
  admin_note: string | null;
  requested_at: string | null;
  reviewed_at: string | null;
  completed_at: string | null;
  created_at: string | null;
};

type SellerPayoutRequestEntryRow = {
  payout_request_id: string;
  seller_payout_ledger_entry_id: string;
  amount_requested: number | string | null;
};

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
}

function moneyNumber(value: number | string | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isMissingPayoutRequestTables(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("seller_payout_requests") ||
    message.includes("seller_payout_request_entries") ||
    message.includes("seller_payout_ledger_entries")
  );
}

function unavailableResponse() {
  return Response.json(
    {
      error:
        "Seller cash-out requests are not available until payout request migrations are applied.",
    },
    { status: 503 },
  );
}

function publicRequest(row: SellerPayoutRequestRow) {
  return {
    id: row.id,
    requestedAmount: moneyNumber(row.requested_amount),
    estimatedProcessorFeeRate: moneyNumber(row.estimated_processor_fee_rate),
    estimatedProcessorFeeAmount: moneyNumber(
      row.estimated_processor_fee_amount,
    ),
    estimatedNetAmount: moneyNumber(row.estimated_net_amount),
    finalProcessorFeeAmount: moneyNumber(row.final_processor_fee_amount),
    finalNetAmount: moneyNumber(row.final_net_amount),
    providerPayoutReference: row.provider_payout_reference || null,
    providerPayoutStatus: row.provider_payout_status || null,
    status: row.status || "requested",
    requestNote: row.request_note || null,
    adminNote: row.admin_note || null,
    requestedAt: row.requested_at,
    reviewedAt: row.reviewed_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

async function loadSellerPayoutBalance(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  storeId: string;
  sellerAccountId: string;
}) {
  const { data: ledgerRows, error: ledgerError } = await params.supabase
    .from("seller_payout_ledger_entries")
    .select("id,seller_payable_amount,payout_status")
    .eq("store_id", params.storeId)
    .eq("seller_account_id", params.sellerAccountId);

  if (ledgerError) throw ledgerError;

  const ledger = (ledgerRows || []) as SellerPayoutLedgerRow[];
  const heldAmount = ledger
    .filter((row) => String(row.payout_status || "").startsWith("hold_"))
    .reduce((sum, row) => sum + moneyNumber(row.seller_payable_amount), 0);
  const eligibleAmount = ledger
    .filter((row) => row.payout_status === "eligible")
    .reduce((sum, row) => sum + moneyNumber(row.seller_payable_amount), 0);
  const paidAmount = ledger
    .filter((row) => row.payout_status === "paid")
    .reduce((sum, row) => sum + moneyNumber(row.seller_payable_amount), 0);

  const { data: requests, error: requestError } = await params.supabase
    .from("seller_payout_requests")
    .select(
      "id,requested_amount,estimated_processor_fee_rate,estimated_processor_fee_amount,estimated_net_amount,final_processor_fee_amount,final_net_amount,provider_payout_reference,provider_payout_status,status,request_note,admin_note,requested_at,reviewed_at,completed_at,created_at",
    )
    .eq("store_id", params.storeId)
    .eq("seller_account_id", params.sellerAccountId)
    .order("created_at", { ascending: false });

  if (requestError) throw requestError;

  const requestRows = (requests || []) as SellerPayoutRequestRow[];
  const { data: requestEntries, error: requestEntryError } =
    await params.supabase
      .from("seller_payout_request_entries")
      .select(
        "payout_request_id,seller_payout_ledger_entry_id,amount_requested",
      )
      .eq("store_id", params.storeId)
      .eq("seller_account_id", params.sellerAccountId);

  if (requestEntryError) throw requestEntryError;

  const requestStatusById = new Map(
    requestRows.map((row) => [row.id, row.status || "requested"]),
  );
  const committedStatuses = new Set([
    "requested",
    "approved",
    "processing",
    "paid",
  ]);
  const committedAllocationByLedgerId = new Map<string, number>();

  for (const entry of (requestEntries || []) as SellerPayoutRequestEntryRow[]) {
    const requestStatus = requestStatusById.get(entry.payout_request_id);

    if (!committedStatuses.has(requestStatus || "")) continue;

    const ledgerEntryId = entry.seller_payout_ledger_entry_id;
    committedAllocationByLedgerId.set(
      ledgerEntryId,
      roundMoney(
        (committedAllocationByLedgerId.get(ledgerEntryId) || 0) +
          moneyNumber(entry.amount_requested),
      ),
    );
  }

  const eligibleLedgerRows = ledger
    .filter((row) => row.payout_status === "eligible")
    .map((row) => {
      const payable = moneyNumber(row.seller_payable_amount);
      const committed = committedAllocationByLedgerId.get(row.id) || 0;

      return {
        ...row,
        remaining_payable_amount: roundMoney(Math.max(0, payable - committed)),
      };
    })
    .filter((row) => row.remaining_payable_amount > 0);
  const availableToRequestAmount = eligibleLedgerRows.reduce(
    (sum, row) => sum + row.remaining_payable_amount,
    0,
  );
  const openRequestAmount = requestRows
    .filter((row) =>
      ["requested", "approved", "processing"].includes(
        row.status || "requested",
      ),
    )
    .reduce((sum, row) => sum + moneyNumber(row.requested_amount), 0);
  const paidRequestAmount = requestRows
    .filter((row) => row.status === "paid")
    .reduce((sum, row) => sum + moneyNumber(row.requested_amount), 0);

  return {
    heldAmount: roundMoney(heldAmount),
    eligibleAmount: roundMoney(eligibleAmount),
    openRequestAmount: roundMoney(openRequestAmount),
    availableToRequestAmount: roundMoney(availableToRequestAmount),
    paidAmount: roundMoney(paidAmount + paidRequestAmount),
    requestCount: requestRows.length,
    requests: requestRows.slice(0, 25).map(publicRequest),
    eligibleLedgerRows,
  };
}

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const balance = await loadSellerPayoutBalance({
      supabase,
      storeId,
      sellerAccountId: account.id,
    });

    return Response.json({
      success: true,
      balance: {
        heldAmount: balance.heldAmount,
        eligibleAmount: balance.eligibleAmount,
        openRequestAmount: balance.openRequestAmount,
        availableToRequestAmount: balance.availableToRequestAmount,
        paidAmount: balance.paidAmount,
        requestCount: balance.requestCount,
      },
      requests: balance.requests,
    });
  } catch (error: any) {
    if (isMissingPayoutRequestTables(error)) return unavailableResponse();

    return Response.json(
      { error: error.message || "Could not load seller payout requests" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const requestedAmount = roundMoney(moneyNumber(body.amount));
    const requestNote = String(body.note || "").trim().slice(0, 500) || null;

    if (requestedAmount <= 0) {
      return Response.json(
        { error: "Cash-out amount must be greater than zero." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const balance = await loadSellerPayoutBalance({
      supabase,
      storeId,
      sellerAccountId: account.id,
    });

    if (requestedAmount > balance.availableToRequestAmount) {
      return Response.json(
        {
          error:
            "Requested amount exceeds the seller balance currently eligible for cash-out.",
          availableToRequestAmount: balance.availableToRequestAmount,
        },
        { status: 400 },
      );
    }

    let remaining = requestedAmount;
    const allocationRows = [];

    for (const row of balance.eligibleLedgerRows as EligibleLedgerAllocationRow[]) {
      if (remaining <= 0) break;

      const amountRequested = roundMoney(
        Math.min(row.remaining_payable_amount, remaining),
      );

      if (amountRequested <= 0) continue;

      allocationRows.push({
        store_id: storeId,
        seller_account_id: account.id,
        seller_payout_ledger_entry_id: row.id,
        amount_requested: amountRequested,
      });
      remaining = roundMoney(remaining - amountRequested);
    }

    if (remaining > 0) {
      return Response.json(
        {
          error:
            "Eligible seller payout rows could not cover the requested cash-out amount.",
          availableToRequestAmount: balance.availableToRequestAmount,
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const { data: payoutRequest, error: requestError } = await supabase
      .from("seller_payout_requests")
      .insert({
        store_id: storeId,
        seller_account_id: account.id,
        requested_amount: requestedAmount,
        estimated_processor_fee_rate: 0,
        estimated_processor_fee_amount: 0,
        estimated_net_amount: requestedAmount,
        status: "requested",
        request_note: requestNote,
        requested_at: now,
        metadata: {
          cash_out_fee_note:
            "Processor cash-out fees are charged by the payout provider and may be applied before final payout.",
        },
      })
      .select("id")
      .single();

    if (requestError || !payoutRequest) throw requestError;

    const entryRows = allocationRows.map((row) => ({
      ...row,
      payout_request_id: payoutRequest.id,
    }));

    if (entryRows.length > 0) {
      const { error: entryError } = await supabase
        .from("seller_payout_request_entries")
        .insert(entryRows);

      if (entryError) throw entryError;
    }

    return Response.json({
      success: true,
      payoutRequestId: payoutRequest.id,
      requestedAmount,
      estimatedNetAmount: requestedAmount,
    });
  } catch (error: any) {
    if (isMissingPayoutRequestTables(error)) return unavailableResponse();

    return Response.json(
      { error: error.message || "Could not request seller cash-out" },
      { status: 500 },
    );
  }
}
