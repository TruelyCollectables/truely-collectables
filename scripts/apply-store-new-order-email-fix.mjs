import { readFile, writeFile } from "node:fs/promises";

function requireOnce(source, fragment, label) {
  const first = source.indexOf(fragment);
  const last = source.lastIndexOf(fragment);
  if (first === -1) throw new Error(`Missing ${label}.`);
  if (first !== last) throw new Error(`Expected one ${label}.`);
  return first;
}

function replaceExact(source, before, after, label) {
  requireOnce(source, before, label);
  return source.replace(before, after);
}

function replaceBetween(source, start, end, replacement, label) {
  const startIndex = requireOnce(source, start, `${label} start`);
  const endIndex = source.indexOf(end, startIndex);
  if (endIndex === -1) throw new Error(`Missing ${label} end.`);
  return `${source.slice(0, startIndex)}${replacement}${source.slice(endIndex + end.length)}`;
}

const helperPath = "src/lib/order-notifications.ts";
const checkoutPath = "src/lib/checkout-order-finalization.ts";
const simulationPath = "scripts/run-order-notification-hardening-simulations.ts";

let helper = await readFile(helperPath, "utf8");
helper = replaceExact(
  helper,
  `  shippingName?: string | null;\n  carrier?: string | null;`,
  `  shippingName?: string | null;\n  audience?: "customer" | "store";\n  customerEmail?: string | null;\n  adminOrderUrl?: string | null;\n  carrier?: string | null;`,
  "notification payload audience fields",
);
helper = replaceExact(
  helper,
  `function subjectForNotification(\n  type: OrderNotificationType,\n  storeName: string,\n  orderId: number,\n) {\n  if (type === "payment_confirmation") {\n    return \`We received your \${storeName} order #\${orderId}\`;\n  }\n  if (type === "tracking_updated") {\n    return \`Tracking updated for \${storeName} order #\${orderId}\`;\n  }\n  return \`Your \${storeName} order #\${orderId} has shipped\`;\n}`,
  `function subjectForNotification(\n  type: OrderNotificationType,\n  storeName: string,\n  orderId: number,\n  payload: OrderNotificationPayload,\n) {\n  if (type === "payment_confirmation" && payload.audience === "store") {\n    return \`New paid \${storeName} order #\${orderId} — \${money(payload.total)}\`;\n  }\n  if (type === "payment_confirmation") {\n    return \`We received your \${storeName} order #\${orderId}\`;\n  }\n  if (type === "tracking_updated") {\n    return \`Tracking updated for \${storeName} order #\${orderId}\`;\n  }\n  return \`Your \${storeName} order #\${orderId} has shipped\`;\n}`,
  "notification subject helper",
);
helper = replaceExact(
  helper,
  `  if (row.notification_type === "payment_confirmation") {`,
  `  if (\n    row.notification_type === "payment_confirmation" &&\n    payload.audience === "store"\n  ) {\n    const htmlItems = items.length\n      ? \`<table style="width:100%;border-collapse:collapse;margin:18px 0;"><thead><tr><th style="text-align:left;padding-bottom:8px;">Item</th><th style="text-align:center;padding-bottom:8px;">Qty</th><th style="text-align:right;padding-bottom:8px;">Price</th></tr></thead><tbody>\${itemRows(items)}</tbody></table>\`\n      : "";\n    const textItems = items.length ? \`\\nItems:\\n\${textItemRows(items)}\\n\` : "";\n    const customerEmail = cleanInline(payload.customerEmail, "Not provided");\n    const shippingName = cleanInline(payload.shippingName, "Selected shipping");\n    const adminOrderUrl = cleanInline(payload.adminOrderUrl);\n    const action = adminOrderUrl\n      ? \`<p><a href="\${escapeOrderNotificationHtml(adminOrderUrl)}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px;">Open order in fulfillment</a></p>\`\n      : "";\n\n    return {\n      html: \`<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111;max-width:640px;margin:0 auto;"><h1>New paid order</h1><p><strong>Order #\${orderId}</strong> is ready for fulfillment.</p><p><strong>Customer:</strong> \${safeName}<br><strong>Email:</strong> \${escapeOrderNotificationHtml(customerEmail)}</p>\${htmlItems}<p><strong>Subtotal:</strong> \${money(payload.subtotal)}<br><strong>\${escapeOrderNotificationHtml(shippingName)}:</strong> \${money(payload.shippingAmount)}<br><strong>Total paid:</strong> \${money(payload.total)}</p>\${action}<p>— \${safeStore} order system</p></div>\`,\n      text: \`New paid order\\n\\nOrder #\${orderId} is ready for fulfillment.\\n\\nCustomer: \${name}\\nEmail: \${customerEmail}\\n\${textItems}\\nSubtotal: \${money(payload.subtotal)}\\n\${shippingName}: \${money(payload.shippingAmount)}\\nTotal paid: \${money(payload.total)}\${adminOrderUrl ? \`\\n\\nOpen order: \${adminOrderUrl}\` : ""}\\n\\n— \${params.storeName} order system\`,\n    };\n  }\n\n  if (row.notification_type === "payment_confirmation") {`,
  "store order notification renderer",
);
helper = replaceExact(
  helper,
  `  const subject = subjectForNotification(\n    params.notificationType,\n    storeName,\n    params.orderId,\n  );`,
  `  const subject = subjectForNotification(\n    params.notificationType,\n    storeName,\n    params.orderId,\n    params.payload,\n  );`,
  "notification subject call",
);
await writeFile(helperPath, helper);

let checkout = await readFile(checkoutPath, "utf8");
checkout = replaceBetween(
  checkout,
  `  if (!isE2ETest) {`,
  `  }\n\n  return { orderId };`,
  `  if (!isE2ETest) {\n    const paymentNotificationPayload = {\n      orderId,\n      customerName,\n      total,\n      subtotal,\n      shippingAmount,\n      shippingName,\n      items: (ledgerOrderItems || []).map((item) => ({\n        title: String(item.title || "Item"),\n        quantity: Number(item.quantity || 1),\n        price: Number(item.price || 0),\n      })),\n    };\n\n    try {\n      await enqueueAndAttemptOrderNotification({\n        supabase,\n        storeId,\n        orderId,\n        notificationType: "payment_confirmation",\n        recipientEmail: customerEmail,\n        recipientName: customerName,\n        payload: paymentNotificationPayload,\n      });\n    } catch (notificationError: any) {\n      console.error(\n        "Payment confirmation notification failed:",\n        notificationError?.message || notificationError,\n      );\n    }\n\n    try {\n      const storeSettings = await getStoreSettings(supabase, storeId);\n      const baseSiteUrl = String(\n        process.env.NEXT_PUBLIC_SITE_URL || "https://truelycollectables.com",\n      ).replace(/\\/+$/, "");\n      await enqueueAndAttemptOrderNotification({\n        supabase,\n        storeId,\n        orderId,\n        notificationType: "payment_confirmation",\n        recipientEmail: storeSettings.salesEmail,\n        recipientName: "Fulfillment",\n        idempotencyKey: \`store_order_received/\${storeId}/\${orderId}\`,\n        payload: {\n          ...paymentNotificationPayload,\n          audience: "store",\n          customerEmail,\n          adminOrderUrl: \`${baseSiteUrl}/admin/orders/\${orderId}\`,\n        },\n      });\n    } catch (notificationError: any) {\n      console.error(\n        "Store new-order notification failed:",\n        notificationError?.message || notificationError,\n      );\n    }\n  }\n\n  return { orderId };`,
  "checkout notification block",
);
await writeFile(checkoutPath, checkout);

let simulation = await readFile(simulationPath, "utf8");
simulation = replaceExact(
  simulation,
  `assert.match(helper, /notificationType: OrderNotificationType/);`,
  `assert.match(helper, /notificationType: OrderNotificationType/);\nassert.match(helper, /payload\\.audience === "store"/);\nassert.match(helper, /New paid \\${storeName} order/);\nassert.match(helper, /Open order in fulfillment/);`,
  "helper store-alert assertions",
);
simulation = replaceExact(
  simulation,
  `assert.match(checkout, /if \\(!isE2ETest\\)/);`,
  `assert.match(checkout, /if \\(!isE2ETest\\)/);\nassert.match(checkout, /recipientEmail: storeSettings\\.salesEmail/);\nassert.match(checkout, /store_order_received\\//);\nassert.match(checkout, /audience: "store"/);\nassert.match(checkout, /adminOrderUrl/);`,
  "checkout store-alert assertions",
);
await writeFile(simulationPath, simulation);

for (const [label, source, fragments] of [
  ["notification helper", helper, ["payload.audience === \"store\"", "Open order in fulfillment"]],
  ["checkout", checkout, ["recipientEmail: storeSettings.salesEmail", "store_order_received/"]],
  ["simulation", simulation, ["audience: \"store\"", "adminOrderUrl"]],
]) {
  for (const fragment of fragments) {
    if (!source.includes(fragment)) throw new Error(`${label} is missing ${fragment}.`);
  }
}

console.log("Applied separate store new-order email alert.");
