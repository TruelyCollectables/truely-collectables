import { readFile, writeFile } from "node:fs/promises";

const smokePath = "scripts/smoke-admin-runtime.mjs";
let smokeSource = await readFile(smokePath, "utf8");
const smokeAnchor = `  {
    path: "/admin/order-notifications",
    auth: true,
    expectedText: "Order Notification Delivery",
  },`;
const smokeReplacement = `${smokeAnchor}
  {
    path: "/admin/sales-history",
    auth: true,
    expectedText: "Sold Collectibles",
  },`;
if (!smokeSource.includes('path: "/admin/sales-history"')) {
  if (!smokeSource.includes(smokeAnchor)) {
    throw new Error("Sales-history smoke insertion anchor missing.");
  }
  smokeSource = smokeSource.replace(smokeAnchor, smokeReplacement);
}
if (
  !smokeSource.includes('path: "/admin/sales-history"') ||
  !smokeSource.includes('expectedText: "Sold Collectibles"')
) {
  throw new Error("Sales-history runtime smoke patch failed.");
}
await writeFile(smokePath, smokeSource, "utf8");

const dashboardPath = "src/app/admin/page.tsx";
let dashboardSource = await readFile(dashboardPath, "utf8");
const dashboardAnchor = `        { href: "/admin/order-notifications", label: "Order Notifications" },`;
const dashboardReplacement = `${dashboardAnchor}
        { href: "/admin/sales-history", label: "Sales History" },`;
if (!dashboardSource.includes('href: "/admin/sales-history"')) {
  if (!dashboardSource.includes(dashboardAnchor)) {
    throw new Error("Sales-history dashboard link insertion anchor missing.");
  }
  dashboardSource = dashboardSource.replace(
    dashboardAnchor,
    dashboardReplacement,
  );
}
if (!dashboardSource.includes('href: "/admin/sales-history"')) {
  throw new Error("Sales-history dashboard link patch failed.");
}
await writeFile(dashboardPath, dashboardSource, "utf8");

console.log("Admin sales-history dashboard link and runtime smoke route added.");
