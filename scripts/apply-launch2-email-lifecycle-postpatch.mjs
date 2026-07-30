import { readFile, writeFile } from "node:fs/promises";

const shippedPath = "src/app/api/orders/mark-shipped/route.ts";
let shippedSource = await readFile(shippedPath, "utf8");
if (!shippedSource.includes("const notification = customerNotification;")) {
  shippedSource = shippedSource.replace(
    "    return NextResponse.json({\n      success: true,\n      emailSent: customerNotification?.sent === true,\n      emailQueued: Boolean(customerNotification),",
    "    const notification = customerNotification;\n    return NextResponse.json({\n      success: true,\n      emailSent: notification?.sent === true,\n      emailQueued: Boolean(notification),",
  );
}
if (!shippedSource.includes("emailQueued: Boolean(notification)")) {
  throw new Error("Unable to preserve the established shipment notification contract.");
}
await writeFile(shippedPath, shippedSource, "utf8");

const notificationPath = "src/lib/order-notifications.ts";
let notificationSource = await readFile(notificationPath, "utf8");
notificationSource = notificationSource.replace("  let subject = type ===", "  const subject = type ===");
if (!notificationSource.includes("  const subject = type ===")) {
  throw new Error("Unable to apply the notification subject lint contract.");
}
await writeFile(notificationPath, notificationSource, "utf8");

console.log("Shipment compatibility and notification lint contracts applied.");
