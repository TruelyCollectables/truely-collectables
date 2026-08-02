import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cronRoute = readFileSync(
  "src/app/api/cron/kingmaker/morning-intelligence/route.ts",
  "utf8",
);
const adminRoute = readFileSync(
  "src/app/api/admin/market-intel/kingmaker/morning-intelligence/test/route.ts",
  "utf8",
);
const adminPage = readFileSync(
  "src/app/admin/market-intel/kingmaker/morning-intelligence/page.tsx",
  "utf8",
);
const delivery = readFileSync(
  "src/lib/kingmaker-morning-intelligence-delivery.ts",
  "utf8",
);
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

for (const fragment of [
  'TIME_ZONE = "America/Denver"',
  "DELIVERY_HOUR = 7",
  "isAuthorizedMarketIntelIngest",
  'const statusOnly = url.searchParams.get("statusOnly") === "1"',
  'force = url.searchParams.get("force") === "1"',
  'sendEmail = url.searchParams.get("sendEmail") !== "0"',
  "outside_mountain_delivery_hour",
  "deliverKingmakerMorningIntelligence",
  "Cache-Control",
  "no-store",
]) {
  assert.ok(cronRoute.includes(fragment), `Cron route is missing ${fragment}.`);
}

for (const fragment of [
  'mode === "send"',
  "forceFull: true",
  "sendEmail",
  "adminRedirectUrl",
  "dryRun=1",
  "sent=1",
  "skipped=1",
]) {
  assert.ok(adminRoute.includes(fragment), `Admin controlled route is missing ${fragment}.`);
}

for (const fragment of [
  "Controlled Delivery Console",
  "Run Controlled Dry Test",
  "Send Forced Verification Email",
  'name="mode" value="dry-run"',
  'name="mode" value="send"',
  "buildLiveKingmakerMorningIntelligence",
  "Fingerprint:",
  "7:00 AM America/Denver",
]) {
  assert.ok(adminPage.includes(fragment), `Admin console is missing ${fragment}.`);
}

for (const fragment of [
  "previousFingerprint",
  "kingmaker_morning_fingerprint",
  "renderKingmakerMorningIntelligenceEmail",
  "resend.emails.send",
  "persistDeliveryState",
  'reason: "dry_run"',
]) {
  assert.ok(delivery.includes(fragment), `Delivery service is missing ${fragment}.`);
}

const scheduled = vercel.crons.find(
  (entry) => entry.path === "/api/cron/kingmaker/morning-intelligence",
);
assert.ok(scheduled, "Vercel cron must include KINGMAKER morning intelligence.");
assert.equal(
  scheduled.schedule,
  "12 * * * *",
  "Hourly UTC invocation must remain guarded to 7 AM America/Denver in the route.",
);

console.log("KINGMAKER morning intelligence route contracts passed.");
