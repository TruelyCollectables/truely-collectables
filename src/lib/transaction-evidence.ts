import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { createEvidencePdf } from "./evidence-pdf";
import { SOFTWARE_OWNER_NAME } from "./legal";
import {
  getStoreSettings,
  type StoreOperationalSettings,
} from "./store-settings";
import { isDryRunShippingReference } from "./shipping-dry-run";
import { getActiveStoreId } from "./stores";

type EvidenceOrderItem = {
  id: number;
  product_id: number | null;
  seller_account_id: string | null;
  title: string | null;
  price: number | null;
  quantity: number | null;
};

type EvidenceOrder = {
  id: number;
  created_at: string;
  customer_email: string | null;
  customer_name: string | null;
  total: number | null;
  status: string | null;
  stripe_session_id: string | null;
  shipping_method: string | null;
  shipping_name: string | null;
  shipping_amount: number | null;
  subtotal: number | null;
  item_count: number | null;
  fulfillment_status: string | null;
  tracking_number: string | null;
  carrier: string | null;
  shipped_at: string | null;
  shipping_address_line1: string | null;
  shipping_address_line2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_postal_code: string | null;
  shipping_country: string | null;
  tos_accepted?: boolean | null;
  tos_version?: string | null;
  tos_accepted_at?: string | null;
  tos_acceptance_event_id?: string | null;
  tos_ip_address?: string | null;
  tos_user_agent?: string | null;
  tos_ip_risk?: string | null;
  tos_ip_block_reason?: string | null;
  is_test?: boolean | null;
  test_run_id?: string | null;
  order_items?: EvidenceOrderItem[];
};

type EvidenceStripeSession = {
  id: string;
  payment_intent?: string | { id: string } | null;
  payment_status?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  metadata?: Record<string, string> | null;
};

type EvidenceStripeEvent = {
  id: string;
  type: string;
  created: number;
};

function money(value: number | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function line(label: string, value: unknown) {
  const normalized =
    value === null || value === undefined || value === "" ? "Not saved" : value;

  return `${label}: ${normalized}`;
}

function safeJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function reportHtml(reportText: string) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Transaction Evidence Report</title>
</head>
<body>
  <pre>${escapeHtml(reportText)}</pre>
</body>
</html>`;
}

function buildReportText(input: {
  order: EvidenceOrder;
  stripeSession: EvidenceStripeSession;
  stripeEvent: EvidenceStripeEvent;
  settings: StoreOperationalSettings;
}) {
  const { order, stripeSession, stripeEvent, settings } = input;
  const metadata = stripeSession.metadata || {};
  const dryRunShipping = isDryRunShippingReference(order.tracking_number);
  const paymentIntent =
    typeof stripeSession.payment_intent === "string"
      ? stripeSession.payment_intent
      : stripeSession.payment_intent?.id;

  const sections: string[] = [];

  sections.push("TRANSACTION EVIDENCE REPORT");
  sections.push("==============================================");
  sections.push(line("Generated At", new Date().toISOString()));
  sections.push(line("Software Owner", SOFTWARE_OWNER_NAME));
  sections.push(line("Storefront", settings.displayName));
  sections.push(line("Store Legal Name", settings.legalName));
  sections.push(line("Store Domain", settings.primaryDomain));
  sections.push(line("Report Purpose", "Chargeback, fraud review, and legal evidence packet"));
  sections.push("");

  sections.push("ORDER SUMMARY");
  sections.push("----------------------------------------------");
  sections.push(line("Order ID", order.id));
  sections.push(line("Order Created At", order.created_at));
  sections.push(line("Order Status", order.status));
  sections.push(line("Fulfillment Status", order.fulfillment_status));
  sections.push(line("Total Paid", money(order.total)));
  sections.push(line("Subtotal", money(order.subtotal)));
  sections.push(line("Shipping Paid", money(order.shipping_amount)));
  sections.push(line("Item Count", order.item_count));
  sections.push("");

  sections.push("CUSTOMER");
  sections.push("----------------------------------------------");
  sections.push(line("Customer Name", order.customer_name));
  sections.push(line("Customer Email", order.customer_email));
  sections.push("");

  sections.push("SHIP TO");
  sections.push("----------------------------------------------");
  sections.push(line("Name", order.customer_name || order.customer_email));
  sections.push(line("Address Line 1", order.shipping_address_line1));
  sections.push(line("Address Line 2", order.shipping_address_line2));
  sections.push(line("City", order.shipping_city));
  sections.push(line("State", order.shipping_state));
  sections.push(line("Postal Code", order.shipping_postal_code));
  sections.push(line("Country", order.shipping_country));
  sections.push(line("Shipping Method", order.shipping_name || order.shipping_method));
  if (dryRunShipping) {
    sections.push(
      line(
        "Shipping Evidence Warning",
        "TCOS dry-run tracking reference hidden; do not use as carrier proof.",
      ),
    );
    sections.push(line("Carrier", "Hidden because tracking is dry-run"));
    sections.push(line("Tracking Number", "Hidden because tracking is dry-run"));
    sections.push(line("Shipped At", "Not used as evidence while tracking is dry-run"));
  } else {
    sections.push(line("Carrier", order.carrier));
    sections.push(line("Tracking Number", order.tracking_number));
    sections.push(line("Shipped At", order.shipped_at));
  }
  sections.push("");

  sections.push("ITEMS PURCHASED");
  sections.push("----------------------------------------------");
  if (!order.order_items?.length) {
    sections.push("No order items saved.");
  } else {
    for (const item of order.order_items) {
      sections.push(line("Item ID", item.id));
      sections.push(line("Product ID", item.product_id));
      sections.push(line("Title", item.title));
      sections.push(line("Seller Owner", item.seller_account_id || "Store inventory"));
      sections.push(line("Quantity", item.quantity));
      sections.push(line("Unit Price", money(item.price)));
      sections.push(
        line(
          "Line Total",
          money(Number(item.price || 0) * Number(item.quantity || 0)),
        ),
      );
      sections.push("");
    }
  }

  sections.push("PAYMENT AND STRIPE");
  sections.push("----------------------------------------------");
  sections.push(line("Stripe Session ID", stripeSession.id));
  sections.push(line("Stripe Payment Intent", paymentIntent));
  sections.push(line("Stripe Payment Status", stripeSession.payment_status));
  sections.push(line("Stripe Amount Total", money(Number(stripeSession.amount_total || 0) / 100)));
  sections.push(line("Stripe Currency", stripeSession.currency));
  sections.push(line("Stripe Event ID", stripeEvent.id));
  sections.push(line("Stripe Event Type", stripeEvent.type));
  sections.push(
    line("Stripe Event Created", new Date(stripeEvent.created * 1000).toISOString()),
  );
  sections.push(line("Stripe Signature Verified", "Yes"));
  sections.push(line("Checkout Type", metadata.type || "cart"));
  sections.push(line("Offer ID", metadata.offer_id));
  sections.push("");

  sections.push("SHIPPING COVERAGE");
  sections.push("----------------------------------------------");
  sections.push(line("Coverage Provider", metadata.shipping_coverage_provider));
  sections.push(line("Coverage Required", metadata.shipping_coverage_required));
  sections.push(
    line("Seller Protected", metadata.shipping_coverage_seller_protected),
  );
  sections.push(line("Coverage Status", metadata.shipping_coverage_status));
  sections.push(line("Coverage Type", metadata.shipping_coverage_type));
  sections.push(line("Covered Amount", metadata.shipping_coverage_amount));
  sections.push(line("Buyer Coverage Charge", metadata.shipping_coverage_buyer_charge));
  sections.push("");

  sections.push("TERMS AND IDENTITY EVIDENCE");
  sections.push("----------------------------------------------");
  sections.push(line("TOS Accepted", order.tos_accepted));
  sections.push(line("TOS Version", order.tos_version));
  sections.push(line("TOS Accepted At", order.tos_accepted_at));
  sections.push(line("TOS Acceptance Event ID", order.tos_acceptance_event_id));
  sections.push(line("Server Observed IP", order.tos_ip_address || metadata.tos_ip_address));
  sections.push(line("User Agent", order.tos_user_agent || metadata.tos_user_agent));
  sections.push(line("IP Risk", order.tos_ip_risk || metadata.tos_ip_risk));
  sections.push(
    line("IP Block Reason", order.tos_ip_block_reason || metadata.tos_ip_block_reason),
  );
  sections.push("");

  sections.push("RAW STRIPE SESSION METADATA");
  sections.push("----------------------------------------------");
  sections.push(safeJson(metadata));
  sections.push("");

  sections.push("REPORT CERTIFICATION NOTES");
  sections.push("----------------------------------------------");
  sections.push("This report is generated automatically from TCOS order records, Stripe webhook data, and TOS acceptance identity evidence saved at transaction time.");
  sections.push("Use this packet with payment processor evidence, shipping proof, customer communication, and any marketplace records when responding to chargebacks or legal disputes.");

  return sections.join("\n");
}

async function sendEvidenceEmail(input: {
  reportId: string;
  order: EvidenceOrder;
  reportText: string;
  pdf: Buffer;
  settings: StoreOperationalSettings;
}) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const evidenceEmail = input.settings.evidenceEmail;

  if (!resendApiKey || !evidenceEmail) {
    return {
      sent: false,
      to: evidenceEmail || null,
      error: resendApiKey ? "TRANSACTION_EVIDENCE_EMAIL is not configured" : "RESEND_API_KEY is not configured",
    };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: input.settings.evidenceFromEmail,
      to: evidenceEmail,
      subject: `${input.settings.displayName} Transaction Evidence Report - Order #${input.order.id}`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
          <h1>Transaction Evidence Report</h1>
          <p><strong>Order:</strong> #${input.order.id}</p>
          <p><strong>Customer:</strong> ${input.order.customer_email || "Not saved"}</p>
          <p><strong>Total:</strong> ${money(input.order.total)}</p>
          <p>The PDF evidence packet is attached.</p>
        </div>
      `,
      text: input.reportText,
      attachments: [
        {
          filename: evidenceFilename(input.order.id, input.reportId),
          content: input.pdf.toString("base64"),
        },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      sent: false,
      to: evidenceEmail,
      error: JSON.stringify(data),
    };
  }

  return {
    sent: true,
    to: evidenceEmail,
    error: null,
  };
}

export function evidenceFilename(orderId: number | string, reportId: string) {
  return `transaction-evidence-order-${orderId}-${reportId}.pdf`;
}

async function getEvidenceOrder(
  supabase: SupabaseClient,
  orderId: number,
  storeId: string = getActiveStoreId(),
) {
  const { data: order, error } = await supabase
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
    .eq("id", orderId)
    .eq("store_id", storeId)
    .single();

  if (error || !order) {
    throw new Error(error?.message || "Order not found for evidence report");
  }

  return order as EvidenceOrder;
}

export async function createTransactionEvidenceReport(input: {
  supabase: SupabaseClient;
  orderId: number;
  stripeSession: Stripe.Checkout.Session;
  stripeEvent: Stripe.Event;
  storeId?: string;
}) {
  const { supabase, orderId, stripeSession, stripeEvent } = input;
  const storeId = input.storeId ?? getActiveStoreId();
  const typedOrder = await getEvidenceOrder(supabase, orderId, storeId);
  const storeSettings = await getStoreSettings(supabase, storeId);

  const existing = await supabase
    .from("transaction_evidence_reports")
    .select("id,email_sent_at")
    .eq("stripe_session_id", stripeSession.id)
    .eq("store_id", storeId)
    .maybeSingle();

  const reportText = buildReportText({
    order: typedOrder,
    stripeSession,
    stripeEvent,
    settings: storeSettings,
  });
  const html = reportHtml(reportText);
  const pdf = createEvidencePdf(reportText);

  const reportPayload = {
    store_id: storeId,
    order_id: typedOrder.id,
    stripe_session_id: stripeSession.id,
    stripe_event_id: stripeEvent.id,
    customer_email: typedOrder.customer_email,
    total: typedOrder.total,
    status: "ready",
    report_json: {
      order: typedOrder,
      stripeSession: {
        id: stripeSession.id,
        payment_status: stripeSession.payment_status,
        amount_total: stripeSession.amount_total,
        currency: stripeSession.currency,
        metadata: stripeSession.metadata,
      },
      stripeEvent: {
        id: stripeEvent.id,
        type: stripeEvent.type,
        created: stripeEvent.created,
      },
    },
    report_text: reportText,
    report_html: html,
  };

  let reportId = existing.data?.id as string | undefined;

  if (reportId) {
    const { error } = await supabase
      .from("transaction_evidence_reports")
      .update(reportPayload)
      .eq("id", reportId)
      .eq("store_id", storeId);

    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await supabase
      .from("transaction_evidence_reports")
      .insert(reportPayload)
      .select("id")
      .single();

    if (error || !data?.id) {
      throw new Error(error?.message || "Evidence report insert failed");
    }

    reportId = String(data.id);
  }

  if (!typedOrder.is_test && !existing.data?.email_sent_at && reportId) {
    const email = await sendEvidenceEmail({
      reportId,
      order: typedOrder,
      reportText,
      pdf,
      settings: storeSettings,
    });

    await supabase
      .from("transaction_evidence_reports")
      .update({
        emailed_to: email.to,
        email_sent_at: email.sent ? new Date().toISOString() : null,
        email_error: email.error,
      })
      .eq("id", reportId)
      .eq("store_id", storeId);
  }

  return reportId;
}

export async function refreshTransactionEvidenceReportForOrder(input: {
  supabase: SupabaseClient;
  orderId: number;
  storeId?: string;
}) {
  const { supabase, orderId } = input;
  const storeId = input.storeId ?? getActiveStoreId();
  const typedOrder = await getEvidenceOrder(supabase, orderId, storeId);

  const { data: existing, error } = await supabase
    .from("transaction_evidence_reports")
    .select("id, stripe_session_id, stripe_event_id, report_json")
    .eq("order_id", orderId)
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!existing) {
    return null;
  }

  const reportJson = (existing.report_json || {}) as any;
  const savedSession = reportJson.stripeSession || {};
  const savedEvent = reportJson.stripeEvent || {};
  const stripeSession: EvidenceStripeSession = {
    id: existing.stripe_session_id || savedSession.id || "not_saved",
    payment_status: savedSession.payment_status || null,
    amount_total: savedSession.amount_total || null,
    currency: savedSession.currency || null,
    metadata: savedSession.metadata || {},
  };
  const stripeEvent: EvidenceStripeEvent = {
    id: existing.stripe_event_id || savedEvent.id || "not_saved",
    type: savedEvent.type || "not_saved",
    created:
      typeof savedEvent.created === "number"
        ? savedEvent.created
        : Math.floor(Date.now() / 1000),
  };
  const reportText = buildReportText({
    order: typedOrder,
    stripeSession,
    stripeEvent,
    settings: await getStoreSettings(supabase, storeId),
  });
  const html = reportHtml(reportText);

  const { error: updateError } = await supabase
    .from("transaction_evidence_reports")
    .update({
      customer_email: typedOrder.customer_email,
      total: typedOrder.total,
      report_json: {
        ...reportJson,
        order: typedOrder,
      },
      report_text: reportText,
      report_html: html,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .eq("store_id", storeId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return String(existing.id);
}
