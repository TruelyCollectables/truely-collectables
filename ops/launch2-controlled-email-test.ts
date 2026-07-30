import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const [exactAppInput, envJsonInput, evidenceDirInput] = process.argv.slice(2);
if (!exactAppInput || !envJsonInput || !evidenceDirInput) {
  throw new Error("Usage: tsx launch2-controlled-email-test.ts <exactAppDir> <productionEnvJson> <evidenceDir>");
}

const exactAppDir = path.resolve(exactAppInput);
const envJsonPath = path.resolve(envJsonInput);
const evidenceDir = path.resolve(evidenceDirInput);
const exactMainSha = String(process.env.EXPECTED_MAIN_SHA || "").trim();
const runId = String(process.env.GITHUB_RUN_ID || Date.now());
if (!/^[0-9a-f]{40}$/.test(exactMainSha)) throw new Error("EXPECTED_MAIN_SHA is invalid.");

const productionEnv = JSON.parse(fs.readFileSync(envJsonPath, "utf8")) as Record<string, string>;
for (const [key, value] of Object.entries(productionEnv)) {
  if (typeof value === "string") process.env[key] = value;
}

const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const resendApiKey = String(process.env.RESEND_API_KEY || "").trim();
if (!/^https:\/\//.test(supabaseUrl)) throw new Error("Production Supabase URL is unavailable.");
if (!serviceRoleKey) throw new Error("Production Supabase service-role key is unavailable.");
if (!resendApiKey) throw new Error("Production Resend key is unavailable.");

const orderNotificationsUrl = pathToFileURL(
  path.join(exactAppDir, "src", "lib", "order-notifications.ts"),
).href;
const { enqueueAndAttemptOrderNotification } = await import(orderNotificationsUrl);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: store, error: storeError } = await supabase
  .from("stores")
  .select("id,display_name,status")
  .eq("status", "active")
  .order("created_at", { ascending: true })
  .limit(1)
  .maybeSingle();
if (storeError) throw storeError;
if (!store?.id) throw new Error("No active Production store was found.");

const { data: order, error: orderError } = await supabase
  .from("orders")
  .select("*")
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (orderError) throw orderError;
if (!order?.id) throw new Error("No Production order exists for the controlled email rendering test.");

const { data: orderItems, error: itemError } = await supabase
  .from("order_items")
  .select("title,quantity,price")
  .eq("order_id", order.id)
  .order("id", { ascending: true });
if (itemError) throw itemError;

const items = (orderItems || []).map((item) => ({
  title: String(item.title || "Collectible"),
  quantity: Math.max(1, Math.floor(Number(item.quantity || 1))),
  price: Number(item.price || 0),
}));
if (!items.length) {
  items.push({ title: "Launch Audit Collectible", quantity: 1, price: Number(order.total || 0) });
}

const buyerEmail = "truelycollectables+launch-buyer@gmail.com";
const ownerEmail = "truelycollectables+launch-owner@gmail.com";
const marker = `LAUNCH AUDIT ${exactMainSha.slice(0, 7)} RUN ${runId}`;
const simulatedTracking = `LAUNCH-AUDIT-${exactMainSha.slice(0, 7).toUpperCase()}-${runId}`;
const now = new Date().toISOString();

const basePayload = {
  orderId: Number(order.id),
  customerName: String(order.customer_name || "Launch Audit Customer"),
  customerEmail: buyerEmail,
  customerPhone: String(order.customer_phone || "(303) 555-0100"),
  total: Number(order.total || 0),
  subtotal: Number(order.subtotal ?? order.total ?? 0),
  taxAmount: Number(order.tax_amount || 0),
  shippingAmount: Number(order.shipping_amount || 0),
  shippingName: String(order.shipping_method || order.shipping_name || "USPS Ground Advantage"),
  shippingService: String(order.shipping_method || order.shipping_name || "USPS Ground Advantage"),
  shippingAddress: {
    line1: String(order.shipping_address_line1 || "Launch Audit Address"),
    line2: order.shipping_address_line2 ? String(order.shipping_address_line2) : null,
    city: String(order.shipping_city || "Denver"),
    state: String(order.shipping_state || "CO"),
    postalCode: String(order.shipping_postal_code || "80202"),
    country: String(order.shipping_country || "US"),
  },
  destinationSummary: `${String(order.shipping_city || "Denver")}, ${String(order.shipping_state || "CO")} ${String(order.shipping_postal_code || "80202")}`,
  paymentStatus: String(order.status || "paid"),
  fulfillmentStatus: String(order.fulfillment_status || "ready_to_ship"),
  orderCreatedAt: String(order.created_at || now),
  fulfilledAt: String(order.fulfilled_at || now),
  shippedAt: now,
  adminOrderUrl: `https://truelycollectables.com/admin/orders/${order.id}`,
  carrier: "USPS",
  trackingNumber: simulatedTracking,
  auditMarker: marker,
  items,
};

const cases = [
  { notificationType: "payment_confirmation", audience: "customer", recipientEmail: buyerEmail, recipientName: basePayload.customerName },
  { notificationType: "payment_confirmation", audience: "store", recipientEmail: ownerEmail, recipientName: "Truely Collectables Owner" },
  { notificationType: "fulfillment_confirmation", audience: "customer", recipientEmail: buyerEmail, recipientName: basePayload.customerName },
  { notificationType: "fulfillment_confirmation", audience: "store", recipientEmail: ownerEmail, recipientName: "Truely Collectables Owner" },
  { notificationType: "shipment_confirmation", audience: "customer", recipientEmail: buyerEmail, recipientName: basePayload.customerName },
  { notificationType: "shipment_confirmation", audience: "store", recipientEmail: ownerEmail, recipientName: "Truely Collectables Owner" },
  { notificationType: "tracking_updated", audience: "customer", recipientEmail: buyerEmail, recipientName: basePayload.customerName },
  { notificationType: "tracking_updated", audience: "store", recipientEmail: ownerEmail, recipientName: "Truely Collectables Owner" },
] as const;

const results: Array<Record<string, unknown>> = [];
const keys: string[] = [];
for (const testCase of cases) {
  const idempotencyKey = `launch-audit/${exactMainSha}/${runId}/${testCase.notificationType}/${testCase.audience}`;
  keys.push(idempotencyKey);
  const payload = { ...basePayload, audience: testCase.audience };
  const first = await enqueueAndAttemptOrderNotification({
    supabase,
    storeId: String(store.id),
    orderId: Number(order.id),
    notificationType: testCase.notificationType,
    recipientEmail: testCase.recipientEmail,
    recipientName: testCase.recipientName,
    payload,
    idempotencyKey,
  });
  if (!first?.sent || first.status !== "sent" || !first.providerMessageId) {
    throw new Error(`Controlled ${testCase.notificationType}/${testCase.audience} email was not accepted: ${JSON.stringify(first)}`);
  }

  const replay = await enqueueAndAttemptOrderNotification({
    supabase,
    storeId: String(store.id),
    orderId: Number(order.id),
    notificationType: testCase.notificationType,
    recipientEmail: testCase.recipientEmail,
    recipientName: testCase.recipientName,
    payload,
    idempotencyKey,
  });
  if (
    replay?.notificationId !== first.notificationId ||
    replay?.providerMessageId !== first.providerMessageId ||
    replay?.status !== "sent"
  ) {
    throw new Error(`Idempotent replay diverged for ${testCase.notificationType}/${testCase.audience}.`);
  }

  results.push({
    notificationType: testCase.notificationType,
    audience: testCase.audience,
    recipientEmail: testCase.recipientEmail,
    notificationId: first.notificationId,
    providerMessageId: first.providerMessageId,
    status: first.status,
    idempotentReplayPassed: true,
    idempotencyKey,
  });
}

const { data: rows, error: rowError } = await supabase
  .from("order_notification_deliveries")
  .select("id,notification_type,recipient_email,subject,status,idempotency_key,attempt_count,provider_message_id,sent_at,last_error,payload")
  .eq("store_id", store.id)
  .in("idempotency_key", keys)
  .order("created_at", { ascending: true });
if (rowError) throw rowError;
if ((rows || []).length !== cases.length) {
  throw new Error(`Expected ${cases.length} unique notification rows; found ${(rows || []).length}.`);
}
for (const row of rows || []) {
  if (row.status !== "sent" || !row.provider_message_id || row.last_error) {
    throw new Error(`Notification persistence failed for ${row.idempotency_key}.`);
  }
  if (!String(row.subject || "").includes(marker)) {
    throw new Error(`Audit marker is missing from subject for ${row.idempotency_key}.`);
  }
}

fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(
  path.join(evidenceDir, "controlled-order-email-provider-receipt.json"),
  JSON.stringify(
    {
      ok: true,
      exactMainSha,
      orderId: Number(order.id),
      storeId: String(store.id),
      marker,
      buyerEmail,
      ownerEmail,
      simulatedTracking,
      providerAcceptedCount: results.length,
      uniquePersistedCount: (rows || []).length,
      duplicateSendCount: 0,
      actualInboxReceiptVerified: false,
      databaseCleanupPendingInboxVerification: true,
      results,
      persistedRows: (rows || []).map((row) => ({
        id: row.id,
        notificationType: row.notification_type,
        recipientEmail: row.recipient_email,
        subject: row.subject,
        status: row.status,
        idempotencyKey: row.idempotency_key,
        attemptCount: row.attempt_count,
        providerMessageId: row.provider_message_id,
        sentAt: row.sent_at,
        lastError: row.last_error,
        auditMarker: row.payload?.auditMarker || null,
      })),
      prohibitedRealWorldEventsCreated: false,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(`CONTROLLED_ORDER_EMAIL_PROVIDER_ACCEPTANCE=${results.length}`);
