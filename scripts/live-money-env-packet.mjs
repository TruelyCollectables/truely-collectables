const mode = process.argv.includes("--bootstrap-template")
  ? "bootstrap-template"
  : process.argv.includes("--env-template")
    ? "env-template"
    : "checklist";
const jsonOutput = process.argv.includes("--json");

const entries = [
  ["NEXT_PUBLIC_SUPABASE_URL", "https://<project-ref>.supabase.co", "Public Supabase project URL."],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "<supabase-anon-key>", "Browser-safe Supabase anon key."],
  ["SUPABASE_SERVICE_ROLE_KEY", "<server-only-service-role-key>", "Server-only Supabase credential."],
  ["STRIPE_LIVE_SECRET_KEY", "sk_live_<redacted>", "Server-only Stripe live key."],
  ["NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY", "pk_live_<redacted>", "Stripe publishable key."],
  ["STRIPE_LIVE_WEBHOOK_SECRET", "whsec_<redacted>", "Stripe webhook signing secret."],
  ["NEXT_PUBLIC_SITE_URL", "https://truelycollectables.com", "Canonical production origin."],
  ["STRIPE_LIVE_FINANCIAL_EVENTS_VERIFIED", "false", "Enable only after live financial webhook proof."],
  ["TCOS_LIVE_PAYMENTS_ENABLED", "false", "Final live-payment runtime switch."],
].map(([key, placeholder, note]) => ({ key, placeholder, note }));

if (jsonOutput) {
  console.log(JSON.stringify({
    schema: "tcos.liveMoneyEnvironmentPacket.v3",
    runtime: "cloudflare-workers",
    containsSecretValues: false,
    entries,
  }, null, 2));
} else if (mode === "bootstrap-template") {
  console.log("# Cloudflare production bootstrap template (no secret values)");
  for (const entry of entries.slice(0, 3)) console.log(`${entry.key}=${entry.placeholder}`);
} else if (mode === "env-template") {
  console.log("# Cloudflare production environment template (no secret values)");
  for (const entry of entries) console.log(`${entry.key}=${entry.placeholder}`);
} else {
  console.log("Truely Collectables Cloudflare live-money environment checklist");
  for (const entry of entries) {
    console.log(`- ${entry.key}: ${entry.note}`);
  }
  console.log("No secret values are included. Runtime values belong in Cloudflare Worker secrets.");
}
