import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PLATFORM_SHORT_NAME,
  PLATFORM_SOFTWARE_NAME,
  SOFTWARE_OWNER_NAME,
} from "./legal";
import {
  getStoreSettings,
  type StoreOperationalSettings,
} from "./store-settings";

type CaseOrderItem = {
  id: number;
  product_id: number | null;
  seller_account_id: string | null;
  title: string | null;
  price: number | string | null;
  quantity: number | string | null;
};

type CaseOrder = {
  id: number;
  account_id?: string | null;
  created_at: string | null;
  customer_email: string | null;
  customer_name?: string | null;
  total: number | string | null;
  status: string | null;
  shipping_method: string | null;
  shipping_name: string | null;
  shipping_amount: number | string | null;
  subtotal: number | string | null;
  item_count: number | null;
  fulfillment_status: string | null;
  tracking_number: string | null;
  carrier: string | null;
  shipped_at: string | null;
  contains_seller_items?: boolean | null;
  seller_item_count?: number | null;
  store_item_count?: number | null;
  shipping_address_line1?: string | null;
  shipping_address_line2?: string | null;
  shipping_city?: string | null;
  shipping_state?: string | null;
  shipping_postal_code?: string | null;
  shipping_country?: string | null;
  tos_accepted?: boolean | null;
  tos_version?: string | null;
  tos_accepted_at?: string | null;
  tos_acceptance_event_id?: string | null;
  tos_ip_address?: string | null;
  tos_user_agent?: string | null;
  tos_ip_risk?: string | null;
  tos_ip_block_reason?: string | null;
  order_items?: CaseOrderItem[];
};

type OrderReviewCase = {
  id: string;
  order_id: number;
  seller_account_id: string | null;
  case_type: string | null;
  status: string | null;
  severity: string | null;
  title: string | null;
  description: string | null;
  opened_by: string | null;
  hold_seller_payouts: boolean | null;
  hold_order_fulfillment: boolean | null;
  outcome_summary: string | null;
  metadata: Record<string, unknown> | null;
  opened_at: string | null;
  closed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type OrderReviewCaseEvent = {
  id: string;
  event_type: string | null;
  previous_status: string | null;
  new_status: string | null;
  note: string | null;
  actor_type: string | null;
  ip_address: string | null;
  user_agent: string | null;
  identity_risk: string | null;
  identity_evidence: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
};

type EvidenceReport = {
  id: string;
  stripe_session_id: string | null;
  status: string | null;
  emailed_to: string | null;
  email_sent_at: string | null;
  email_error: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type SellerPayoutLedgerEntry = {
  id: string;
  seller_account_id: string | null;
  order_item_id: number | null;
  product_id: number | null;
  gross_item_amount: number | string | null;
  shipping_allocated_amount: number | string | null;
  total_basis_amount: number | string | null;
  platform_fee_rate: number | string | null;
  platform_fee_amount: number | string | null;
  seller_payable_amount: number | string | null;
  payout_status: string | null;
  source_type: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

type PlatformFeeLedgerEntry = {
  id: string;
  order_item_id: number | null;
  product_id: number | null;
  seller_account_id: string | null;
  fee_owner_name: string | null;
  source_type: string | null;
  total_basis_amount: number | string | null;
  platform_fee_rate: number | string | null;
  platform_fee_amount: number | string | null;
  fee_status: string | null;
  created_at: string | null;
};

type AccountProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  account_status: string | null;
  default_account_type: string | null;
};

type OptionalError = {
  table: string;
  message: string;
};

export type OrderReviewCasePacketData = {
  reviewCase: OrderReviewCase;
  order: CaseOrder;
  storeSettings: StoreOperationalSettings;
  evidenceReports: EvidenceReport[];
  caseEvents: OrderReviewCaseEvent[];
  sellerPayoutRows: SellerPayoutLedgerEntry[];
  platformFeeRows: PlatformFeeLedgerEntry[];
  profilesById: Map<string, AccountProfile>;
  optionalErrors: OptionalError[];
};

function money(value: number | string | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function line(label: string, value: unknown) {
  const normalized =
    value === null || value === undefined || value === "" ? "Not saved" : value;

  return `${label}: ${normalized}`;
}

function section(title: string) {
  return [title, "----------------------------------------------"];
}

function safeJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

function sellerScopeRows(
  reviewCase: OrderReviewCase,
  rows: SellerPayoutLedgerEntry[],
) {
  if (!reviewCase.seller_account_id) return rows;

  return rows.filter(
    (row) => row.seller_account_id === reviewCase.seller_account_id,
  );
}

function profileLabel(
  profilesById: Map<string, AccountProfile>,
  accountId: string | null | undefined,
) {
  if (!accountId) return "Not saved";
  const profile = profilesById.get(accountId);
  return profile?.email || profile?.display_name || accountId;
}

async function getProfiles(
  supabase: SupabaseClient,
  accountIds: Array<string | null | undefined>,
) {
  const ids = Array.from(
    new Set(
      accountIds
        .map((accountId) => String(accountId || "").trim())
        .filter(Boolean),
    ),
  );
  const profilesById = new Map<string, AccountProfile>();

  if (ids.length === 0) return profilesById;

  const { data, error } = await supabase
    .from("account_profiles")
    .select("id,email,display_name,account_status,default_account_type")
    .in("id", ids);

  if (error) return profilesById;

  for (const profile of (data || []) as AccountProfile[]) {
    profilesById.set(profile.id, profile);
  }

  return profilesById;
}

export function orderReviewCasePacketFilename(
  orderId: number | string,
  caseId: string,
) {
  return `order-review-case-order-${orderId}-${caseId}.pdf`;
}

export function orderReviewCasePacketHtml(reportText: string) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Order Review Case Packet</title>
</head>
<body>
  <pre>${escapeHtml(reportText)}</pre>
</body>
</html>`;
}

export async function loadOrderReviewCasePacketData(params: {
  supabase: SupabaseClient;
  storeId: string;
  caseId: string;
}): Promise<OrderReviewCasePacketData> {
  const { data: reviewCaseData, error: reviewCaseError } = await params.supabase
    .from("order_review_cases")
    .select("*")
    .eq("id", params.caseId)
    .eq("store_id", params.storeId)
    .single();

  if (reviewCaseError || !reviewCaseData) {
    throw new Error(reviewCaseError?.message || "Order review case not found.");
  }

  const reviewCase = reviewCaseData as OrderReviewCase;
  const storeSettings = await getStoreSettings(params.supabase, params.storeId);
  const { data: orderData, error: orderError } = await params.supabase
    .from("orders")
    .select(
      `
      *,
      order_items (
        id,
        product_id,
        seller_account_id,
        title,
        price,
        quantity
      )
    `,
    )
    .eq("id", reviewCase.order_id)
    .eq("store_id", params.storeId)
    .single();

  if (orderError || !orderData) {
    throw new Error(orderError?.message || "Order not found for case packet.");
  }

  const optionalErrors: OptionalError[] = [];
  const [
    evidenceReportsResult,
    caseEventsResult,
    sellerPayoutRowsResult,
    platformFeeRowsResult,
  ] = await Promise.all([
    params.supabase
      .from("transaction_evidence_reports")
      .select(
        "id,stripe_session_id,status,emailed_to,email_sent_at,email_error,created_at,updated_at",
      )
      .eq("order_id", reviewCase.order_id)
      .eq("store_id", params.storeId)
      .order("created_at", { ascending: false }),
    params.supabase
      .from("order_review_case_events")
      .select(
        "id,event_type,previous_status,new_status,note,actor_type,ip_address,user_agent,identity_risk,identity_evidence,metadata,created_at",
      )
      .eq("case_id", reviewCase.id)
      .eq("store_id", params.storeId)
      .order("created_at", { ascending: true }),
    params.supabase
      .from("seller_payout_ledger_entries")
      .select(
        "id,seller_account_id,order_item_id,product_id,gross_item_amount,shipping_allocated_amount,total_basis_amount,platform_fee_rate,platform_fee_amount,seller_payable_amount,payout_status,source_type,metadata,created_at,updated_at",
      )
      .eq("order_id", reviewCase.order_id)
      .eq("store_id", params.storeId),
    params.supabase
      .from("platform_fee_ledger_entries")
      .select(
        "id,order_item_id,product_id,seller_account_id,fee_owner_name,source_type,total_basis_amount,platform_fee_rate,platform_fee_amount,fee_status,created_at",
      )
      .eq("order_id", reviewCase.order_id)
      .eq("store_id", params.storeId),
  ]);

  if (evidenceReportsResult.error) {
    optionalErrors.push({
      table: "transaction_evidence_reports",
      message: evidenceReportsResult.error.message,
    });
  }

  if (caseEventsResult.error) {
    optionalErrors.push({
      table: "order_review_case_events",
      message: caseEventsResult.error.message,
    });
  }

  if (sellerPayoutRowsResult.error) {
    optionalErrors.push({
      table: "seller_payout_ledger_entries",
      message: sellerPayoutRowsResult.error.message,
    });
  }

  if (platformFeeRowsResult.error) {
    optionalErrors.push({
      table: "platform_fee_ledger_entries",
      message: platformFeeRowsResult.error.message,
    });
  }

  const order = orderData as CaseOrder;
  const sellerPayoutRows =
    (sellerPayoutRowsResult.data || []) as SellerPayoutLedgerEntry[];
  const platformFeeRows =
    (platformFeeRowsResult.data || []) as PlatformFeeLedgerEntry[];
  const profilesById = await getProfiles(params.supabase, [
    order.account_id,
    reviewCase.seller_account_id,
    ...sellerPayoutRows.map((row) => row.seller_account_id),
    ...(order.order_items || []).map((item) => item.seller_account_id),
  ]);

  return {
    reviewCase,
    order,
    storeSettings,
    evidenceReports: (evidenceReportsResult.data || []) as EvidenceReport[],
    caseEvents: (caseEventsResult.data || []) as OrderReviewCaseEvent[],
    sellerPayoutRows,
    platformFeeRows,
    profilesById,
    optionalErrors,
  };
}

export function buildOrderReviewCasePacketText(
  data: OrderReviewCasePacketData,
) {
  const { reviewCase, order, profilesById, storeSettings } = data;
  const scopedPayoutRows = sellerScopeRows(reviewCase, data.sellerPayoutRows);
  const heldPayoutRows = scopedPayoutRows.filter((row) =>
    String(row.payout_status || "").startsWith("hold_"),
  );
  const sellerPayableTotal = scopedPayoutRows.reduce(
    (sum, row) => sum + Number(row.seller_payable_amount || 0),
    0,
  );
  const platformFeeTotal = data.platformFeeRows.reduce(
    (sum, row) => sum + Number(row.platform_fee_amount || 0),
    0,
  );
  const lines: string[] = [];

  lines.push("ORDER REVIEW CASE PACKET");
  lines.push("==============================================");
  lines.push(line("Generated At", new Date().toISOString()));
  lines.push(line("Software Owner", SOFTWARE_OWNER_NAME));
  lines.push(line("Platform", `${PLATFORM_SOFTWARE_NAME} (${PLATFORM_SHORT_NAME})`));
  lines.push(line("Storefront", storeSettings.displayName));
  lines.push(line("Store Legal Name", storeSettings.legalName));
  lines.push(line("Store Domain", storeSettings.primaryDomain));
  lines.push(line("Packet Purpose", "Chargeback, return, dispute, fraud, authenticity, shipping, payout, and legal review support"));
  lines.push("");

  lines.push(...section("CASE SUMMARY"));
  lines.push(line("Case ID", reviewCase.id));
  lines.push(line("Order ID", reviewCase.order_id));
  lines.push(line("Case Type", label(reviewCase.case_type)));
  lines.push(line("Status", label(reviewCase.status)));
  lines.push(line("Severity", label(reviewCase.severity)));
  lines.push(line("Title", reviewCase.title));
  lines.push(line("Description", reviewCase.description));
  lines.push(line("Opened By", reviewCase.opened_by));
  lines.push(line("Opened At", reviewCase.opened_at));
  lines.push(line("Updated At", reviewCase.updated_at));
  lines.push(line("Closed At", reviewCase.closed_at));
  lines.push(line("Outcome Summary", reviewCase.outcome_summary));
  lines.push(line("Seller Scope", profileLabel(profilesById, reviewCase.seller_account_id) || "All seller-owned rows"));
  lines.push(line("Hold Seller Payouts", reviewCase.hold_seller_payouts));
  lines.push(line("Hold Order Fulfillment", reviewCase.hold_order_fulfillment));
  lines.push("");

  lines.push(...section("ORDER SUMMARY"));
  lines.push(line("Order ID", order.id));
  lines.push(line("Order Created At", order.created_at));
  lines.push(line("Buyer Account", profileLabel(profilesById, order.account_id)));
  lines.push(line("Customer Name", order.customer_name));
  lines.push(line("Customer Email", order.customer_email));
  lines.push(line("Payment Status", label(order.status)));
  lines.push(line("Fulfillment Status", label(order.fulfillment_status)));
  lines.push(line("Total Paid", money(order.total)));
  lines.push(line("Subtotal", money(order.subtotal)));
  lines.push(line("Shipping Paid", money(order.shipping_amount)));
  lines.push(line("Item Count", order.item_count));
  lines.push(line("Seller Item Count", order.seller_item_count));
  lines.push(line("Store Item Count", order.store_item_count));
  lines.push("");

  lines.push(...section("SHIPMENT"));
  lines.push(line("Ship To", order.customer_name || order.customer_email));
  lines.push(line("Address Line 1", order.shipping_address_line1));
  lines.push(line("Address Line 2", order.shipping_address_line2));
  lines.push(line("City", order.shipping_city));
  lines.push(line("State", order.shipping_state));
  lines.push(line("Postal Code", order.shipping_postal_code));
  lines.push(line("Country", order.shipping_country));
  lines.push(line("Shipping Method", order.shipping_name || order.shipping_method));
  lines.push(line("Carrier", order.carrier));
  lines.push(line("Tracking Number", order.tracking_number));
  lines.push(line("Shipped At", order.shipped_at));
  lines.push("");

  lines.push(...section("TERMS AND IDENTITY"));
  lines.push(line("TOS Accepted", order.tos_accepted));
  lines.push(line("TOS Version", order.tos_version));
  lines.push(line("TOS Accepted At", order.tos_accepted_at));
  lines.push(line("TOS Acceptance Event ID", order.tos_acceptance_event_id));
  lines.push(line("Server Observed IP", order.tos_ip_address));
  lines.push(line("IP Risk", order.tos_ip_risk));
  lines.push(line("IP Block Reason", order.tos_ip_block_reason));
  lines.push(line("User Agent", order.tos_user_agent));
  lines.push("");

  lines.push(...section("ORDER ITEMS"));
  if (!order.order_items?.length) {
    lines.push("No order items saved.");
  } else {
    for (const item of order.order_items) {
      lines.push(line("Order Item ID", item.id));
      lines.push(line("Product ID", item.product_id));
      lines.push(line("Title", item.title));
      lines.push(line("Seller Owner", profileLabel(profilesById, item.seller_account_id) || "Store inventory"));
      lines.push(line("Quantity", item.quantity));
      lines.push(line("Unit Price", money(item.price)));
      lines.push(
        line(
          "Line Total",
          money(Number(item.price || 0) * Number(item.quantity || 0)),
        ),
      );
      lines.push("");
    }
  }

  lines.push(...section("SELLER PAYOUT HOLD CONTEXT"));
  lines.push(line("Scoped Payout Rows", scopedPayoutRows.length));
  lines.push(line("Held Payout Rows", heldPayoutRows.length));
  lines.push(line("Scoped Seller Payable Total", money(sellerPayableTotal)));
  if (scopedPayoutRows.length === 0) {
    lines.push("No seller payout rows found for this case scope.");
  } else {
    for (const row of scopedPayoutRows) {
      lines.push(line("Payout Row ID", row.id));
      lines.push(line("Seller", profileLabel(profilesById, row.seller_account_id)));
      lines.push(line("Order Item ID", row.order_item_id));
      lines.push(line("Status", label(row.payout_status)));
      lines.push(line("Source Type", label(row.source_type)));
      lines.push(line("Gross Item Amount", money(row.gross_item_amount)));
      lines.push(line("Shipping Basis", money(row.shipping_allocated_amount)));
      lines.push(line("Total Basis", money(row.total_basis_amount)));
      lines.push(line("Platform Fee Rate", `${(Number(row.platform_fee_rate || 0) * 100).toFixed(2)}%`));
      lines.push(line("Platform Fee Amount", money(row.platform_fee_amount)));
      lines.push(line("Seller Payable Amount", money(row.seller_payable_amount)));
      lines.push(line("Created At", row.created_at));
      lines.push(line("Updated At", row.updated_at));
      lines.push(line("Metadata", safeJson(row.metadata)));
      lines.push("");
    }
  }

  lines.push(...section(`${SOFTWARE_OWNER_NAME.toUpperCase()} FEE CONTEXT`));
  lines.push(line("Platform Fee Rows", data.platformFeeRows.length));
  lines.push(line("Platform Fee Total", money(platformFeeTotal)));
  if (data.platformFeeRows.length === 0) {
    lines.push("No platform fee rows found for this order.");
  } else {
    for (const row of data.platformFeeRows) {
      lines.push(line("Fee Row ID", row.id));
      lines.push(line("Fee Owner", row.fee_owner_name));
      lines.push(line("Source Type", label(row.source_type)));
      lines.push(line("Seller", profileLabel(profilesById, row.seller_account_id)));
      lines.push(line("Order Item ID", row.order_item_id));
      lines.push(line("Total Basis", money(row.total_basis_amount)));
      lines.push(line("Platform Fee Rate", `${(Number(row.platform_fee_rate || 0) * 100).toFixed(2)}%`));
      lines.push(line("Platform Fee Amount", money(row.platform_fee_amount)));
      lines.push(line("Fee Status", label(row.fee_status)));
      lines.push(line("Created At", row.created_at));
      lines.push("");
    }
  }

  lines.push(...section("TRANSACTION EVIDENCE REPORTS"));
  if (data.evidenceReports.length === 0) {
    lines.push("No transaction evidence report was found for this order.");
  } else {
    for (const report of data.evidenceReports) {
      lines.push(line("Evidence Report ID", report.id));
      lines.push(line("Stripe Session ID", report.stripe_session_id));
      lines.push(line("Status", label(report.status)));
      lines.push(line("Emailed To", report.emailed_to));
      lines.push(line("Email Sent At", report.email_sent_at));
      lines.push(line("Email Error", report.email_error));
      lines.push(line("Created At", report.created_at));
      lines.push(line("Updated At", report.updated_at));
      lines.push("");
    }
  }

  lines.push(...section("CASE EVENT HISTORY"));
  if (data.caseEvents.length === 0) {
    lines.push("No case event history found.");
  } else {
    for (const event of data.caseEvents) {
      lines.push(line("Event ID", event.id));
      lines.push(line("Event Type", label(event.event_type)));
      lines.push(line("Previous Status", label(event.previous_status)));
      lines.push(line("New Status", label(event.new_status)));
      lines.push(line("Actor Type", label(event.actor_type)));
      lines.push(line("Created At", event.created_at));
      lines.push(line("IP Address", event.ip_address));
      lines.push(line("Identity Risk", label(event.identity_risk)));
      lines.push(line("User Agent", event.user_agent));
      lines.push(line("Note", event.note));
      lines.push(line("Identity Evidence", safeJson(event.identity_evidence)));
      lines.push(line("Metadata", safeJson(event.metadata)));
      lines.push("");
    }
  }

  if (data.optionalErrors.length > 0) {
    lines.push(...section("PACKET CONTEXT WARNINGS"));
    for (const error of data.optionalErrors) {
      lines.push(line(error.table, error.message));
    }
    lines.push("");
  }

  lines.push(...section("PACKET CERTIFICATION NOTES"));
  lines.push("This packet is generated automatically from TCOS order records, order review case records, case audit events, seller payout ledger rows, platform fee ledger rows, transaction evidence references, and saved TOS/IP evidence.");
  lines.push("Use this packet with payment processor records, shipping proof, customer messages, marketplace records, payout processor records, and legal counsel review when responding to chargebacks, returns, disputes, fraud claims, or court requests.");
  lines.push("Case closure alone does not move funds. Seller payout release, reversal, recovery, or processor payout actions must follow the payout ledger controls, processor rules, and applicable law.");

  return lines.join("\n");
}

export async function buildAndSaveOrderReviewCasePacket(params: {
  supabase: SupabaseClient;
  storeId: string;
  caseId: string;
}) {
  const packetData = await loadOrderReviewCasePacketData(params);
  const reportText = buildOrderReviewCasePacketText(packetData);
  const reportHtml = orderReviewCasePacketHtml(reportText);
  const now = new Date().toISOString();
  const payload = {
    store_id: params.storeId,
    case_id: packetData.reviewCase.id,
    order_id: packetData.reviewCase.order_id,
    seller_account_id: packetData.reviewCase.seller_account_id,
    status: "ready",
    report_text: reportText,
    report_html: reportHtml,
    metadata: {
      case_type: packetData.reviewCase.case_type,
      case_status: packetData.reviewCase.status,
      case_severity: packetData.reviewCase.severity,
      optional_errors: packetData.optionalErrors,
      generated_at: now,
    },
    updated_at: now,
  };

  const { data: existingPacket, error: existingError } = await params.supabase
    .from("order_review_case_packets")
    .select("id,email_sent_at,emailed_to")
    .eq("store_id", params.storeId)
    .eq("case_id", packetData.reviewCase.id)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existingPacket?.id) {
    const { error } = await params.supabase
      .from("order_review_case_packets")
      .update({
        ...payload,
        status: existingPacket.email_sent_at ? "email_sent" : "ready",
        emailed_to: existingPacket.emailed_to,
        email_sent_at: existingPacket.email_sent_at,
        email_error: null,
      })
      .eq("id", existingPacket.id)
      .eq("store_id", params.storeId);

    if (error) throw new Error(error.message);

    return {
      packetId: String(existingPacket.id),
      packetData,
      reportText,
      reportHtml,
    };
  }

  const { data: insertedPacket, error } = await params.supabase
    .from("order_review_case_packets")
    .insert(payload)
    .select("id")
    .single();

  if (error || !insertedPacket?.id) {
    throw new Error(error?.message || "Could not save order review case packet.");
  }

  return {
    packetId: String(insertedPacket.id),
    packetData,
    reportText,
    reportHtml,
  };
}
