import { readFile, writeFile } from "node:fs/promises";

const path = "scripts/smoke-admin-runtime.mjs";
let source = await readFile(path, "utf8");
const anchor = `  {
    path: "/admin/order-notifications",
    auth: true,
    expectedText: "Order Notification Delivery",
  },`;
const replacement = `${anchor}
  {
    path: "/admin/sales-history",
    auth: true,
    expectedText: "Sold Collectibles",
  },`;
if (!source.includes('/admin/sales-history')) {
  if (!source.includes(anchor)) throw new Error("Sales-history smoke insertion anchor missing.");
  source = source.replace(anchor, replacement);
}
if (!source.includes('path: "/admin/sales-history"') || !source.includes('expectedText: "Sold Collectibles"')) {
  throw new Error("Sales-history runtime smoke patch failed.");
}
await writeFile(path, source, "utf8");
console.log("Admin sales-history runtime smoke route added.");
