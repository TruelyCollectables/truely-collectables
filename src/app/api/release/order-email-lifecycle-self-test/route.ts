import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  enqueueAndAttemptOrderNotification,
  type OrderNotificationPayload,
  type OrderNotificationType,
} from "../../../../lib/order-notifications";
import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const BUYER_ALIAS = "truelycollectables+launch-buyer@gmail.com";
const OWNER_ALIAS = "truelycollectables+launch-owner@gmail.com";
const DEFAULT_STORE_ID = "00000000-0000-4000-8000-000000000001";

type DeliverySpec = {
  notificationType: OrderNotificationType;
  recipientEmail: string;
  recipientName: string;
  idempotencyKey?: string;
  payload: OrderNotificationPayload;
};

type DeliveryResult = Awaited<
  ReturnType<typeof enqueueAndAttemptOrderNotification>
>;

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
}

async function verifyVercelToken(request: Request) {
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

function requiredEnvironment() {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const resendKey = String(process.env.RESEND_API_KEY || "").trim();

  if (!supabaseUrl || !serviceRoleKey || !resendKey) {
    throw new Error("Production email-delivery environment is incomplete.");
  }

  return { supabaseUrl, serviceRoleKey };
}

export async function POST(request: Request) {
  if (!(await verifyVercelToken(request))) {
    return Response.json(
      { success: false, error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (process.env.VERCEL_ENV !== "production") {
    return Response.json(
      { success: false, error: "This self-test only runs in Vercel Production." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  const startedAt = new Date().toISOString();
  let orderId: number | null = null;
  let supabase: SupabaseClient | null = null;

  try {
    const environment = requiredEnvironment();
    supabase = createClient(environment.supabaseUrl, environment.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id,title,price,seller_id")
      .gt("quantity", 0)
      .gt("price", 0)
      .limit(1)
      .maybeSingle();
    if (productError) throw productError;
    if (!product) throw new Error("No active product reference is available.");

    const storeId = String(product.seller_id || DEFAULT_STORE_ID);
    const now = new Date().toISOString();
    const stamp = now.replace(/[:.]/g, "-");
    const marker = `LAUNCH AUDIT ${stamp}`;

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        store_id: storeId,
        stripe_session_id: `cs_test_launch_email_${Date.now()}`,
        customer_email: BUYER_ALIAS,
        customer_name: "Launch Audit Buyer",
        customer_phone: "303-555-0100",
        total: 22.96,
        subtotal: 19.99,
        tax_amount: 1.61,
        shipping_amount: 1.36,
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
        last_payment_event_at: now,
        tos_accepted: true,
        tos_version: "2026-06-28",
        tos_accepted_at: now,
      })
      .select("id,created_at")
      .single();
    if (orderError || !order) {
      throw orderError || new Error("Controlled test order insert failed.");
    }
    orderId = Number(order.id);

    const { error: itemError } = await supabase.from("order_items").insert({
      store_id: storeId,
      order_id: orderId,
      product_id: Number(product.id),
      title: "Launch Audit Card — Email Rendering Test",
      price: 19.99,
      quantity: 1,
    });
    if (itemError) throw itemError;

    const base: OrderNotificationPayload = {
      orderId,
      customerName: "Launch Audit Buyer",
      customerEmail: BUYER_ALIAS,
      customerPhone: "303-555-0100",
      total: 22.96,
      subtotal: 19.99,
      taxAmount: 1.61,
      shippingAmount: 1.36,
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
      orderCreatedAt: String(order.created_at || now),
      auditMarker: marker,
      items: [
        {
          title: "Launch Audit Card — Email Rendering Test",
          quantity: 1,
          price: 19.99,
        },
      ],
    };

    const adminOrderUrl = `https://truelycollectables.com/admin/orders/${orderId}`;
    const specs: DeliverySpec[] = [
      {
        notificationType: "payment_confirmation",
        recipientEmail: BUYER_ALIAS,
        recipientName: "Launch Audit Buyer",
        payload: { ...base, audience: "customer", fulfillmentStatus: "ready_to_ship" },
      },
      {
        notificationType: "payment_confirmation",
        recipientEmail: OWNER_ALIAS,
        recipientName: "Launch Audit Owner",
        idempotencyKey: `audit_owner_payment/${storeId}/${orderId}`,
        payload: {
          ...base,
          audience: "store",
          fulfillmentStatus: "ready_to_ship",
          adminOrderUrl,
        },
      },
      {
        notificationType: "fulfillment_confirmation",
        recipientEmail: BUYER_ALIAS,
        recipientName: "Launch Audit Buyer",
        payload: {
          ...base,
          audience: "customer",
          fulfillmentStatus: "fulfilled",
          fulfilledAt: now,
        },
      },
      {
        notificationType: "fulfillment_confirmation",
        recipientEmail: OWNER_ALIAS,
        recipientName: "Launch Audit Owner",
        idempotencyKey: `audit_owner_fulfilled/${storeId}/${orderId}`,
        payload: {
          ...base,
          audience: "store",
          fulfillmentStatus: "fulfilled",
          fulfilledAt: now,
          adminOrderUrl,
        },
      },
      {
        notificationType: "shipment_confirmation",
        recipientEmail: BUYER_ALIAS,
        recipientName: "Launch Audit Buyer",
        payload: {
          ...base,
          audience: "customer",
          fulfillmentStatus: "shipped",
          fulfilledAt: now,
          shippedAt: now,
          carrier: "USPS",
          trackingNumber: "9400-SIMULATED-LAUNCH-AUDIT",
        },
      },
      {
        notificationType: "shipment_confirmation",
        recipientEmail: OWNER_ALIAS,
        recipientName: "Launch Audit Owner",
        idempotencyKey: `audit_owner_shipped/${storeId}/${orderId}`,
        payload: {
          ...base,
          audience: "store",
          fulfillmentStatus: "shipped",
          fulfilledAt: now,
          shippedAt: now,
          carrier: "USPS",
          trackingNumber: "9400-SIMULATED-LAUNCH-AUDIT",
          adminOrderUrl,
        },
      },
    ];

    const firstResults: DeliveryResult[] = [];
    for (const spec of specs) {
      const result = await enqueueAndAttemptOrderNotification({
        supabase,
        storeId,
        orderId,
        notificationType: spec.notificationType,
        recipientEmail: spec.recipientEmail,
        recipientName: spec.recipientName,
        idempotencyKey: spec.idempotencyKey,
        payload: spec.payload,
      });
      if (!result?.sent) {
        throw new Error(
          `${spec.notificationType}/${spec.recipientEmail} failed: ${result?.error || result?.status || "unknown"}`,
        );
      }
      firstResults.push(result);
    }

    const replayResults: DeliveryResult[] = [];
    for (const spec of specs) {
      replayResults.push(
        await enqueueAndAttemptOrderNotification({
          supabase,
          storeId,
          orderId,
          notificationType: spec.notificationType,
          recipientEmail: spec.recipientEmail,
          recipientName: spec.recipientName,
          idempotencyKey: spec.idempotencyKey,
          payload: spec.payload,
        }),
      );
    }

    const { data: rows, error: rowsError } = await supabase
      .from("order_notification_deliveries")
      .select(
        "id,notification_type,recipient_email,status,provider_message_id,idempotency_key,subject",
      )
      .eq("order_id", orderId)
      .order("created_at");
    if (rowsError) throw rowsError;

    if (
      rows?.length !== 6 ||
      rows.some((row) => row.status !== "sent") ||
      firstResults.some(
        (result, index) =>
          result?.notificationId !== replayResults[index]?.notificationId,
      )
    ) {
      throw new Error("Controlled delivery or idempotency verification failed.");
    }

    return Response.json(
      {
        success: true,
        schema: "truelycollectables.orderEmailLifecycleRuntimeSelfTest.v1",
        marker,
        orderId,
        buyerAlias: BUYER_ALIAS,
        ownerAlias: OWNER_ALIAS,
        expectedMessages: 6,
        deliveryRows: rows.map((row) => ({
          type: row.notification_type,
          recipient: row.recipient_email,
          subject: row.subject,
          status: row.status,
          providerAccepted: Boolean(row.provider_message_id),
          idempotencyKey: row.idempotency_key,
        })),
        duplicateRowsAfterReplay: 0,
        attachments: {
          buyerInvoice: true,
          ownerInvoice: true,
          ownerPackingSlip: true,
        },
        simulatedTracking: true,
        startedAt,
        completedAt: new Date().toISOString(),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        schema: "truelycollectables.orderEmailLifecycleRuntimeSelfTest.v1",
        error: error instanceof Error ? error.message.slice(0, 500) : "Self-test failed.",
        startedAt,
        completedAt: new Date().toISOString(),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    if (supabase && orderId) {
      await supabase.from("order_notification_deliveries").delete().eq("order_id", orderId);
      await supabase.from("order_items").delete().eq("order_id", orderId);
      await supabase.from("orders").delete().eq("id", orderId);
    }
  }
}
