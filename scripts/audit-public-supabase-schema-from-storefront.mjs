import fs from "node:fs";

const siteOrigin = "https://truelycollectables.com";
const envFile = process.env.LAUNCH_ENV_FILE || ".env.storefront.production";
const outputFile = process.env.PUBLIC_SCHEMA_AUDIT_OUTPUT || "public-supabase-schema-audit.json";

function parseDotEnv(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim().replace(/^export\s+/, "");
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

function usable(value) {
  const text = String(value || "").trim();
  return Boolean(text && !/sensitive|encrypted|unavailable|placeholder|redacted/i.test(text) && !text.startsWith("__"));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function candidatesFromText(text) {
  const candidates = new Set();
  for (const match of text.matchAll(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g)) candidates.add(match[0]);
  for (const match of text.matchAll(/\bsb_publishable_[A-Za-z0-9._-]{20,}\b/g)) candidates.add(match[0]);
  return [...candidates];
}

function chooseAnonKey(candidates, projectRef) {
  for (const token of candidates) {
    if (token.startsWith("sb_publishable_")) return token;
    const payload = decodeJwtPayload(token);
    if (!payload) continue;
    const role = String(payload.role || "").toLowerCase();
    const ref = String(payload.ref || "").toLowerCase();
    const iss = String(payload.iss || "").toLowerCase();
    if (role === "anon" && (!projectRef || ref === projectRef || iss.includes(projectRef))) return token;
  }
  return null;
}

async function discoverPublicAnonKey(projectRef) {
  const root = await fetchWithTimeout(siteOrigin);
  const html = await root.text();
  const assetUrls = new Set();
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+\.js(?:\?[^"']*)?)["']/g)) {
    try {
      assetUrls.add(new URL(match[1], siteOrigin).toString());
    } catch {}
  }
  const candidates = candidatesFromText(html);
  const urls = [...assetUrls].slice(0, 120);
  for (let index = 0; index < urls.length; index += 8) {
    const batch = urls.slice(index, index + 8);
    const texts = await Promise.all(batch.map(async (url) => {
      try {
        const response = await fetchWithTimeout(url);
        return response.ok ? await response.text() : "";
      } catch {
        return "";
      }
    }));
    for (const text of texts) for (const candidate of candidatesFromText(text)) candidates.push(candidate);
    const selected = chooseAnonKey(candidates, projectRef);
    if (selected) return { key: selected, assetCount: urls.length, scannedCount: Math.min(index + 8, urls.length) };
  }
  return { key: chooseAnonKey(candidates, projectRef), assetCount: urls.length, scannedCount: urls.length };
}

async function auditTable({ baseUrl, anonKey, table, select = "id" }) {
  try {
    const response = await fetchWithTimeout(`${baseUrl.replace(/\/$/, "")}/rest/v1/${encodeURIComponent(table)}?select=${encodeURIComponent(select)}&limit=1`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, Accept: "application/json" },
    });
    let code = null;
    try {
      const payload = await response.clone().json();
      code = typeof payload?.code === "string" ? payload.code : null;
    } catch {}
    const missing = response.status === 404 || code === "PGRST205" || code === "42P01";
    const invalidKey = response.status === 401 && ["PGRST301", "invalid_token"].includes(code || "");
    return {
      table,
      status: missing ? "missing" : invalidKey ? "unknown" : response.ok || response.status === 401 || response.status === 403 ? "present" : "unknown",
      httpStatus: response.status,
      diagnosticCode: code,
    };
  } catch (error) {
    return { table, status: "unknown", httpStatus: null, diagnosticCode: error instanceof Error && error.name === "AbortError" ? "timeout" : "request_failed" };
  }
}

const env = parseDotEnv(fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "");
const supabaseUrl = usable(env.NEXT_PUBLIC_SUPABASE_URL) ? env.NEXT_PUBLIC_SUPABASE_URL : null;
let projectRef = null;
try {
  projectRef = supabaseUrl ? new URL(supabaseUrl).hostname.split(".")[0].toLowerCase() : null;
} catch {}

const discovery = supabaseUrl ? await discoverPublicAnonKey(projectRef) : { key: null, assetCount: 0, scannedCount: 0 };
const tables = [
  ["stores", "id"], ["store_settings", "store_id"], ["products", "id"], ["orders", "id"], ["offers", "id"],
  ["stripe_webhook_events", "id"], ["checkout_attempts", "id"], ["stripe_post_payment_objects", "id"],
  ["financial_adjustment_ledger_entries", "id"], ["stripe_reconciliation_runs", "id"], ["stripe_reconciliation_items", "id"],
  ["payment_simulation_runs", "id"], ["payment_simulation_scenarios", "id"], ["live_payment_launch_gates", "store_id"],
  ["live_payment_launch_events", "id"], ["order_shipping_labels", "id"], ["order_shipping_tracking_events", "id"],
  ["order_shipping_coverage_claims", "id"], ["public_endpoint_rate_limit_events", "id"], ["admin_login_attempts", "id"],
  ["tos_acceptance_events", "id"], ["transaction_evidence_reports", "id"],
];
const results = supabaseUrl && discovery.key
  ? await Promise.all(tables.map(([table, select]) => auditTable({ baseUrl: supabaseUrl, anonKey: discovery.key, table, select })))
  : tables.map(([table]) => ({ table, status: "unknown", httpStatus: null, diagnosticCode: discovery.key ? "supabase_url_unavailable" : "public_anon_key_not_found" }));

const payload = {
  schema: "truelyCollectables.publicSupabaseSchemaAudit.v1",
  generatedAt: new Date().toISOString(),
  projectUrlAvailable: Boolean(supabaseUrl),
  publicAnonKeyDiscovered: Boolean(discovery.key),
  scannedJavascriptAssets: discovery.scannedCount,
  availableJavascriptAssets: discovery.assetCount,
  criticalTableCount: results.length,
  presentCount: results.filter((item) => item.status === "present").length,
  missingCount: results.filter((item) => item.status === "missing").length,
  unknownCount: results.filter((item) => item.status === "unknown").length,
  missingTables: results.filter((item) => item.status === "missing").map((item) => item.table),
  unknownTables: results.filter((item) => item.status === "unknown").map((item) => item.table),
  tables: results,
  secretValuesIncluded: false,
  readOnlyGuarantee: "The public Supabase browser credential was discovered from already-public storefront assets and used only for read-only REST table-existence checks. No credential value is logged or stored in this evidence. No database write, migration, deployment, payment, approval, or runtime-switch action occurred.",
};

fs.writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
console.log(`Public Supabase schema audit completed: ${payload.presentCount} present, ${payload.missingCount} missing, ${payload.unknownCount} unknown.`);
