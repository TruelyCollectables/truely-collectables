import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { enqueueAndAttemptOrderNotification } from "../src/lib/order-notifications";
import { buildOrderNotificationAttachments } from "../src/lib/order-notification-documents";

const outputPath = process.env.LAUNCH_EMAIL_RECEIPT_PATH;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!outputPath || !supabaseUrl || !serviceRoleKey || !process.env.RESEND_API_KEY) {
  throw new Error("Controlled email proof is missing its Production environment or receipt path.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const buyer = "truelycollectables+launch-buyer@gmail.com";
const owner = "truelycollectables+launch-owner@gmail.com";
const marker = `LAUNCH AUDIT ${new Date().toISOString().replace(/[:.]/g, "-")}`;
const simulatedTracking = "9400-SIMULATED-LAUNCH-AUDIT";

const { data: product, error: productError } = await supabase
  .from("products")
  .select("id,seller_id,title,price")
  .gt("price", 0)
  .not("seller_id", "is", null)
  .limit(1)
  .single();
if (productError || !product) throw productError || new Error("No safe product reference exists.");

const storeId = String(product.seller_id);
const createdAt = new Date().toISOString();
const subtotal = 19.99;
const shippingAmount = 1.36;
const taxAmount = 1.61;
const total = 22.96;
const orderInsert = {
  store_id: storeId,
  customer_email: buyer,
  customer_name: "Launch Audit Buyer",
  customer_phone: "303-555-0100",
  total,
  subtotal,
  tax_amount: taxAmount,
  shipping_amount: shippingAmount,
  shipping_name: "Tracked Card Letter — Limited USPS scan visibility",
  shipping_method: "STANDARD_ENVELOPE",
  item_count: 1,
  status: "paid",
  payment_status: "paid",
  fulfillment_status: "ready_to_ship",
  shipping_address_line1: "123 Launch Audit Way",
  shipping_address_line2: "Suite 2",
  shipping_city: "Denver",
  shipping_state: "CO",
  shipping_postal_code: "80202",
  shipping_country: "US",
  contains_seller_items: false,
  seller_item_count: 0,
  store_item_count: 1,
  is_test: true,
  test_run_id: marker,
  stripe_session_id: `cs_test_launch_${Date.now()}`,
  last_payment_event_at: createdAt,
  tos_accepted: true,
  tos_version: "2026-06-28",
  tos_accepted_at: createdAt,
};

const { data: order, error: orderError } = await supabase
  .from("orders")
  .insert(orderInsert)
  .select("id,created_at")
  .single();
if (orderError || !order) throw orderError || new Error("Controlled order insert failed.");
const orderId = Number(order.id);

try {
  const { error: itemError } = await supabase.from("order_items").insert({
    store_id: storeId,
    order_id: orderId,
    product_id: Number(product.id),
    title: "Launch Audit Card — Email Rendering Test",
    price: subtotal,
    quantity: 1,
    is_test: true,
    test_run_id: marker,
  });
  if (itemError) throw itemError;

  const base = {
    orderId,
    customerName: "Launch Audit Buyer",
    customerEmail: buyer,
    customerPhone: "303-555-0100",
    total,
    subtotal,
    taxAmount,
    shippingAmount,
    shippingName: "Tracked Card Letter — Limited USPS scan visibility",
    shippingService: "Tracked Card Letter",
    shippingAddress: {
      line1: "123 Launch Audit Way",
      line2: "Suite 2",
      city: "Denver",
      state: "CO",
      postalCode: "80202",
      country: "US",
    },
    destinationSummary: "Denver CO 80202",
    paymentStatus: "paid",
    orderCreatedAt: String(order.created_at || createdAt),
    auditMarker: marker,
    items: [{ title: "Launch Audit Card — Email Rendering Test", quantity: 1, price: subtotal }],
  };

  const customerAttachments = buildOrderNotificationAttachments({
    payload: { ...base, audience: "customer" },
    storeName: "Truely Collectables",
    notificationType: "payment_confirmation",
  });
  const ownerAttachments = buildOrderNotificationAttachments({
    payload: { ...base, audience: "store" },
    storeName: "Truely Collectables",
    notificationType: "payment_confirmation",
  });
  if (customerAttachments.length !== 1 || !customerAttachments[0].filename.includes("invoice")) {
    throw new Error("Buyer invoice attachment contract failed.");
  }
  if (
    ownerAttachments.length !== 2 ||
    !ownerAttachments.some((item) => item.filename.includes("invoice")) ||
    !ownerAttachments.some((item) => item.filename.includes("packing-slip"))
  ) {
    throw new Error("Owner invoice and packing-slip attachment contract failed.");
  }
  for (const attachment of [...customerAttachments, ...ownerAttachments]) {
    const rendered = Buffer.from(attachment.content, "base64").toString("utf8");
    if (
      !rendered.includes(`Order #${orderId}`) ||
      !rendered.includes("123 Launch Audit Way") ||
      rendered.includes("undefined") ||
      rendered.includes("{{")
    ) {
      throw new Error(`Rendered attachment failed: ${attachment.filename}`);
    }
  }

  const fulfilledAt = new Date().toISOString();
  const specs = [
    {
      type: "payment_confirmation",
      recipient: buyer,
      name: "Launch Audit Buyer",
      payload: { ...base, audience: "customer", fulfillmentStatus: "ready_to_ship" },
    },
    {
      type: "payment_confirmation",
      recipient: owner,
      name: "Launch Audit Owner",
      idempotencyKey: `audit_owner_payment/${storeId}/${orderId}`,
      payload: {
        ...base,
        audience: "store",
        fulfillmentStatus: "ready_to_ship",
        adminOrderUrl: `https://truelycollectables.com/admin/orders/${orderId}`,
      },
    },
    {
      type: "fulfillment_confirmation",
      recipient: buyer,
      name: "Launch Audit Buyer",
      payload: { ...base, audience: "customer", fulfillmentStatus: "fulfilled", fulfilledAt },
    },
    {
      type: "fulfillment_confirmation",
      recipient: owner,
      name: "Launch Audit Owner",
      idempotencyKey: `audit_owner_fulfilled/${storeId}/${orderId}`,
      payload: {
        ...base,
        audience: "store",
        fulfillmentStatus: "fulfilled",
        fulfilledAt,
        adminOrderUrl: `https://truelycollectables.com/admin/orders/${orderId}`,
      },
    },
    {
      type: "shipment_confirmation",
      recipient: buyer,
      name: "Launch Audit Buyer",
      payload: {
        ...base,
        audience: "customer",
        fulfillmentStatus: "shipped",
        fulfilledAt,
        shippedAt: fulfilledAt,
        carrier: "USPS",
        trackingNumber: simulatedTracking,
      },
    },
    {
      type: "shipment_confirmation",
      recipient: owner,
      name: "Launch Audit Owner",
      idempotencyKey: `audit_owner_shipped/${storeId}/${orderId}`,
      payload: {
        ...base,
        audience: "store",
        fulfillmentStatus: "shipped",
        fulfilledAt,
        shippedAt: fulfilledAt,
        carrier: "USPS",
        trackingNumber: simulatedTracking,
        adminOrderUrl: `https://truelycollectables.com/admin/orders/${orderId}`,
      },
    },
  ];

  const firstResults = [];
  for (const spec of specs) {
    const result = await enqueueAndAttemptOrderNotification({
      supabase,
      storeId,
      orderId,
      notificationType: spec.type as never,
      recipientEmail: spec.recipient,
      recipientName: spec.name,
      idempotencyKey: spec.idempotencyKey,
      payload: spec.payload as never,
    });
    if (!result || result.sent !== true) {
      throw new Error(`${spec.type}/${spec.recipient} was not provider-accepted: ${JSON.stringify(result)}`);
    }
    firstResults.push(result);
  }

  const replayResults = [];
  for (const spec of specs) {
    replayResults.push(
      await enqueueAndAttemptOrderNotification({
        supabase,
        storeId,
        orderId,
        notificationType: spec.type as never,
        recipientEmail: spec.recipient,
        recipientName: spec.name,
        idempotencyKey: spec.idempotencyKey,
        payload: spec.payload as never,
      }),
    );
  }

  const { data: deliveries, error: deliveryError } = await supabase
    .from("order_notification_deliveries")
    .select("id,notification_type,recipient_email,subject,status,provider_message_id,idempotency_key")
    .eq("order_id", orderId)
    .order("created_at");
  if (deliveryError) throw deliveryError;
  if (
    deliveries?.length !== 6 ||
    deliveries.some(
      (row) =>
        row.status !== "sent" ||
        !row.provider_message_id ||
        !String(row.subject || "").includes(marker),
    )
  ) {
    throw new Error(`Expected exactly six sent marked deliveries: ${JSON.stringify(deliveries)}`);
  }
  if (firstResults.some((result, index) => result.notificationId !== replayResults[index]?.notificationId)) {
    throw new Error("Idempotency replay returned a different notification row.");
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        ok: true,
        exactMainSha: process.env.EXPECTED_MAIN_SHA,
        marker,
        orderId,
        buyerAlias: buyer,
        ownerAlias: owner,
        expectedMessages: 6,
        subjects: deliveries.map((row) => row.subject),
        deliveryRows: deliveries.map((row) => ({
          type: row.notification_type,
          recipient: row.recipient_email,
          status: row.status,
          providerAccepted: Boolean(row.provider_message_id),
          idempotencyKey: row.idempotency_key,
        })),
        duplicateRowsAfterReplay: 0,
        attachments: {
          buyerInvoice: customerAttachments.map((item) => item.filename),
          ownerInvoiceAndPackingSlip: ownerAttachments.map((item) => item.filename),
          renderingValidated: true,
        },
        simulatedTracking,
        realPayment: false,
        realPostagePurchase: false,
        sentAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} finally {
  await supabase.from("order_notification_deliveries").delete().eq("order_id", orderId);
  await supabase.from("order_items").delete().eq("order_id", orderId);
  const { error: cleanupError } = await supabase.from("orders").delete().eq("id", orderId);
  if (cleanupError) throw cleanupError;
}
