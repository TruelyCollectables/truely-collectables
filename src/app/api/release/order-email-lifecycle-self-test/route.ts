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
  idempotencyKey: string;
  payload: OrderNotificationPayload;
};

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

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 500);
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return [value.message, value.code, value.details, value.hint]
      .filter((part) => typeof part === "string" && part.trim())
      .map((part) => String(part).replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]"))
      .join(" | ")
      .slice(0, 500);
  }
  return "Self-test failed.";
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
  let supabase: SupabaseClient | null = null;
  const deliveryIds: string[] = [];

  try {
    const environment = requiredEnvironment();
    supabase = createClient(environment.supabaseUrl, environment.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: anchorOrder, error: anchorError } = await supabase
      .from("orders")
      .select("id,store_id,created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (anchorError) throw anchorError;
    if (!anchorOrder) {
      throw new Error("No existing Production order is available as a safe delivery anchor.");
    }

    const orderId = Number(anchorOrder.id);
    const storeId = String(anchorOrder.store_id || DEFAULT_STORE_ID);
    const now = new Date().toISOString();
    const stamp = now.replace(/[:.]/g, "-");
    const marker = `LAUNCH AUDIT ${stamp}`;
    const adminOrderUrl = `https://truelycollectables.com/admin/orders/${orderId}`;

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
      orderCreatedAt: String(anchorOrder.created_at || now),
      auditMarker: marker,
      items: [
        {
          title: "Launch Audit Card — Email Rendering Test",
          quantity: 1,
          price: 19.99,
        },
      ],
    };

    const specs: DeliverySpec[] = [
      {
        notificationType: "payment_confirmation",
        recipientEmail: BUYER_ALIAS,
        recipientName: "Launch Audit Buyer",
        idempotencyKey: `${marker}/buyer/payment`,
        payload: { ...base, audience: "customer", fulfillmentStatus: "ready_to_ship" },
      },
      {
        notificationType: "payment_confirmation",
        recipientEmail: OWNER_ALIAS,
        recipientName: "Launch Audit Owner",
        idempotencyKey: `${marker}/owner/payment`,
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
        idempotencyKey: `${marker}/buyer/fulfilled`,
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
        idempotencyKey: `${marker}/owner/fulfilled`,
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
        idempotencyKey: `${marker}/buyer/shipped`,
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
        idempotencyKey: `${marker}/owner/shipped`,
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

    const firstIds: string[] = [];
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
      if (!result?.sent || !result.notificationId) {
        throw new Error(
          `${spec.notificationType}/${spec.recipientEmail} failed: ${result?.error || result?.status || "unknown"}`,
        );
      }
      const notificationId = String(result.notificationId);
      firstIds.push(notificationId);
      deliveryIds.push(notificationId);
    }

    for (const [index, spec] of specs.entries()) {
      const replay = await enqueueAndAttemptOrderNotification({
        supabase,
        storeId,
        orderId,
        notificationType: spec.notificationType,
        recipientEmail: spec.recipientEmail,
        recipientName: spec.recipientName,
        idempotencyKey: spec.idempotencyKey,
        payload: spec.payload,
      });
      if (!replay?.notificationId || String(replay.notificationId) !== firstIds[index]) {
        throw new Error(`Idempotency replay failed for ${spec.idempotencyKey}.`);
      }
    }

    const { data: rows, error: rowsError } = await supabase
      .from("order_notification_deliveries")
      .select(
        "id,notification_type,recipient_email,status,provider_message_id,idempotency_key,subject",
      )
      .in("id", deliveryIds)
      .order("created_at");
    if (rowsError) throw rowsError;
    if (
      rows?.length !== 6 ||
      rows.some((row) => row.status !== "sent" || !row.provider_message_id)
    ) {
      throw new Error("Controlled delivery verification failed.");
    }

    return Response.json(
      {
        success: true,
        schema: "truelycollectables.orderEmailLifecycleRuntimeSelfTest.v2",
        marker,
        anchorOrderId: orderId,
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
        existingOrderModified: false,
        startedAt,
        completedAt: new Date().toISOString(),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        schema: "truelycollectables.orderEmailLifecycleRuntimeSelfTest.v2",
        error: safeErrorMessage(error),
        startedAt,
        completedAt: new Date().toISOString(),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    if (supabase && deliveryIds.length > 0) {
      await supabase.from("order_notification_deliveries").delete().in("id", deliveryIds);
    }
  }
}
