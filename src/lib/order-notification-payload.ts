import type {
  OrderNotificationItem,
  OrderNotificationPayload,
} from "./order-notifications";

type OrderLike = {
  id: number;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  total?: number | string | null;
  subtotal?: number | string | null;
  tax_amount?: number | string | null;
  shipping_amount?: number | string | null;
  shipping_name?: string | null;
  shipping_method?: string | null;
  shipping_address_line1?: string | null;
  shipping_address_line2?: string | null;
  shipping_city?: string | null;
  shipping_state?: string | null;
  shipping_postal_code?: string | null;
  shipping_country?: string | null;
  status?: string | null;
  payment_status?: string | null;
  fulfillment_status?: string | null;
  created_at?: string | null;
  fulfilled_at?: string | null;
  shipped_at?: string | null;
  carrier?: string | null;
  tracking_number?: string | null;
};

export function buildOrderNotificationPayload(params: {
  order: OrderLike;
  items?: OrderNotificationItem[] | null;
  audience?: "customer" | "store";
  adminOrderUrl?: string | null;
  auditMarker?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  fulfilledAt?: string | null;
  shippedAt?: string | null;
}): OrderNotificationPayload {
  const { order } = params;
  const cityStatePostal = [
    order.shipping_city,
    order.shipping_state,
    order.shipping_postal_code,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    orderId: Number(order.id),
    customerName: order.customer_name || null,
    customerEmail: order.customer_email || null,
    customerPhone: order.customer_phone || null,
    total: Number(order.total || 0),
    subtotal: Number(order.subtotal || 0),
    taxAmount: Number(order.tax_amount || 0),
    shippingAmount: Number(order.shipping_amount || 0),
    shippingName: order.shipping_name || order.shipping_method || null,
    shippingService: order.shipping_name || order.shipping_method || null,
    shippingAddress: {
      line1: order.shipping_address_line1 || null,
      line2: order.shipping_address_line2 || null,
      city: order.shipping_city || null,
      state: order.shipping_state || null,
      postalCode: order.shipping_postal_code || null,
      country: order.shipping_country || null,
    },
    destinationSummary:
      cityStatePostal || order.shipping_country || "Destination not saved",
    paymentStatus: order.payment_status || order.status || null,
    fulfillmentStatus: order.fulfillment_status || null,
    orderCreatedAt: order.created_at || null,
    fulfilledAt: params.fulfilledAt || order.fulfilled_at || null,
    shippedAt: params.shippedAt || order.shipped_at || null,
    carrier: params.carrier || order.carrier || null,
    trackingNumber: params.trackingNumber || order.tracking_number || null,
    audience: params.audience,
    adminOrderUrl: params.adminOrderUrl || null,
    auditMarker: params.auditMarker || null,
    items: Array.isArray(params.items) ? params.items : [],
  };
}
