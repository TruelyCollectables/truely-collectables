import { readFile, writeFile } from "node:fs/promises";

function requireOnce(source, fragment, label) {
  const first = source.indexOf(fragment);
  const last = source.lastIndexOf(fragment);
  if (first === -1) {
    throw new Error(`Missing ${label}.`);
  }
  if (first !== last) {
    throw new Error(`Expected one ${label}, found more than one.`);
  }
  return first;
}

function replaceExact(source, before, after, label) {
  requireOnce(source, before, label);
  return source.replace(before, after);
}

function replaceBetween(source, start, end, replacement, label) {
  const startIndex = requireOnce(source, start, `${label} start`);
  const endIndex = source.indexOf(end, startIndex);
  if (endIndex === -1) {
    throw new Error(`Missing ${label} end.`);
  }
  return `${source.slice(0, startIndex)}${replacement}${source.slice(
    endIndex + end.length,
  )}`;
}

const queuePath = "src/app/admin/orders/page.tsx";
const detailPath = "src/app/admin/orders/[id]/page.tsx";
const packingSlipPath = "src/app/admin/orders/[id]/packing-slip/page.tsx";
const simulationPath = "scripts/run-admin-shipping-actions-simulations.mjs";

let queue = await readFile(queuePath, "utf8");
queue = replaceExact(
  queue,
  `type OrderItem = {\n  id: number;\n  seller_account_id?: string | null;`,
  `type OrderItem = {\n  id: number;\n  order_id: number;\n  seller_account_id?: string | null;`,
  "fulfillment queue OrderItem type",
);
queue = replaceBetween(
  queue,
  `  const { data: orders, error } = await supabase`,
  `    .order("created_at", { ascending: false });`,
  `  const { data: orders, error: ordersError } = await supabase\n    .from("orders")\n    .select("*")\n    .eq("store_id", storeId)\n    .order("created_at", { ascending: false });\n\n  const orderIds = (orders || [])\n    .map((order) => Number(order.id))\n    .filter((orderId) => Number.isFinite(orderId));\n  const { data: orderItems, error: orderItemsError } =\n    orderIds.length === 0\n      ? { data: [], error: null }\n      : await supabase\n          .from("order_items")\n          .select("id,order_id,seller_account_id,title,quantity,price")\n          .in("order_id", orderIds);\n  const error = ordersError || orderItemsError;`,
  "fulfillment queue order query",
);
queue = replaceExact(
  queue,
  `  const typedOrders = (orders || []) as Order[];`,
  `  const orderItemsByOrderId = new Map<number, OrderItem[]>();\n  for (const item of (orderItems || []) as OrderItem[]) {\n    const orderId = Number(item.order_id);\n    const items = orderItemsByOrderId.get(orderId) || [];\n    items.push(item);\n    orderItemsByOrderId.set(orderId, items);\n  }\n  const typedOrders = ((orders || []) as Order[]).map((order) => ({\n    ...order,\n    order_items: orderItemsByOrderId.get(Number(order.id)) || [],\n  }));`,
  "fulfillment queue item grouping",
);
await writeFile(queuePath, queue);

let detail = await readFile(detailPath, "utf8");
detail = replaceBetween(
  detail,
  `  const { data: order, error } = await supabase`,
  `    .single();`,
  `  const { data: order, error: orderError } = await supabase\n    .from("orders")\n    .select("*")\n    .eq("id", id)\n    .eq("store_id", storeId)\n    .single();\n\n  const { data: orderItems, error: orderItemsError } = order\n    ? await supabase\n        .from("order_items")\n        .select("id,seller_account_id,title,quantity,price")\n        .eq("order_id", order.id)\n        .order("id", { ascending: true })\n    : { data: [], error: null };\n  const error = orderError || orderItemsError;`,
  "order detail query",
);
detail = replaceExact(
  detail,
  `  const typedOrder = order as Order;`,
  `  const typedOrder = {\n    ...(order as Order),\n    order_items: (orderItems || []) as OrderItem[],\n  } as Order;`,
  "order detail item attachment",
);
await writeFile(detailPath, detail);

let packingSlip = await readFile(packingSlipPath, "utf8");
packingSlip = replaceBetween(
  packingSlip,
  `  const { data: order, error } = await supabase`,
  `    .single();`,
  `  const { data: order, error: orderError } = await supabase\n    .from("orders")\n    .select("*")\n    .eq("id", id)\n    .eq("store_id", storeId)\n    .single();\n\n  const { data: orderItems, error: orderItemsError } = order\n    ? await supabase\n        .from("order_items")\n        .select("id,title,quantity,price")\n        .eq("order_id", order.id)\n        .order("id", { ascending: true })\n    : { data: [], error: null };\n  const error = orderError || orderItemsError;`,
  "packing slip query",
);
packingSlip = replaceExact(
  packingSlip,
  `  const typedOrder = order as Order;`,
  `  const typedOrder = {\n    ...(order as Order),\n    order_items: (orderItems || []) as OrderItem[],\n  } as Order;`,
  "packing slip item attachment",
);
await writeFile(packingSlipPath, packingSlip);

let simulation = await readFile(simulationPath, "utf8");
simulation = replaceExact(
  simulation,
  `  simulationsPage: await readFile(\n    new URL("../src/app/admin/shipping/simulations/page.tsx", import.meta.url),\n    "utf8",\n  ),\n};`,
  `  simulationsPage: await readFile(\n    new URL("../src/app/admin/shipping/simulations/page.tsx", import.meta.url),\n    "utf8",\n  ),\n  fulfillmentQueue: await readFile(\n    new URL("../src/app/admin/orders/page.tsx", import.meta.url),\n    "utf8",\n  ),\n  orderDetail: await readFile(\n    new URL("../src/app/admin/orders/[id]/page.tsx", import.meta.url),\n    "utf8",\n  ),\n  packingSlip: await readFile(\n    new URL(\n      "../src/app/admin/orders/[id]/packing-slip/page.tsx",\n      import.meta.url,\n    ),\n    "utf8",\n  ),\n};`,
  "shipping simulation source map",
);
simulation = replaceExact(
  simulation,
  `const failed = [];`,
  `scenario("fulfillment pages avoid ambiguous orders/order_items embeds", () => {\n  for (const [name, source] of [\n    ["fulfillment queue", sources.fulfillmentQueue],\n    ["order detail", sources.orderDetail],\n    ["packing slip", sources.packingSlip],\n  ]) {\n    assert(\n      !source.includes("order_items ("),\n      "Expected " + name + " to avoid an ambiguous embedded order_items relationship.",\n    );\n    assert(\n      source.includes('.from("order_items")'),\n      "Expected " + name + " to load order_items explicitly.",\n    );\n    assert(\n      source.includes('.select("*")'),\n      "Expected " + name + " to load its order row without a relationship embed.",\n    );\n  }\n\n  assert(\n    sources.fulfillmentQueue.includes('.in("order_id", orderIds)'),\n    "Expected the fulfillment queue to fetch items for all loaded order IDs.",\n  );\n  assert(\n    sources.orderDetail.includes('.eq("order_id", order.id)'),\n    "Expected the order detail to fetch items for the selected order.",\n  );\n  assert(\n    sources.packingSlip.includes('.eq("order_id", order.id)'),\n    "Expected the packing slip to fetch items for the selected order.",\n  );\n});\n\nconst failed = [];`,
  "fulfillment relationship regression",
);
await writeFile(simulationPath, simulation);

for (const [name, source] of [
  ["fulfillment queue", queue],
  ["order detail", detail],
  ["packing slip", packingSlip],
]) {
  if (source.includes("order_items (")) {
    throw new Error(`${name} still contains an ambiguous order_items embed.`);
  }
  if (!source.includes('.from("order_items")')) {
    throw new Error(`${name} does not explicitly query order_items.`);
  }
}

console.log("Applied explicit order_items loading to all fulfillment surfaces.");
