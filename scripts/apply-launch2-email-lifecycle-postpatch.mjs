import { readFile, writeFile } from "node:fs/promises";

const path = "src/app/api/orders/mark-shipped/route.ts";
let source = await readFile(path, "utf8");
if (!source.includes("const notification = customerNotification;")) {
  source = source.replace(
    "    return NextResponse.json({\n      success: true,\n      emailSent: customerNotification?.sent === true,\n      emailQueued: Boolean(customerNotification),",
    "    const notification = customerNotification;\n    return NextResponse.json({\n      success: true,\n      emailSent: notification?.sent === true,\n      emailQueued: Boolean(notification),",
  );
}
if (!source.includes("emailQueued: Boolean(notification)")) {
  throw new Error("Unable to preserve the established shipment notification contract.");
}
await writeFile(path, source, "utf8");
console.log("Shipment notification compatibility contract applied.");
