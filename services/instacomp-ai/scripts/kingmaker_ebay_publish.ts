import { createSupabaseServerClient } from "../../../src/lib/supabase-server";
import { getActiveStoreId } from "../../../src/lib/stores";
import {
  getEbayPublishingReadiness,
  publishEbayInventoryItem,
  reviseExistingEbayInventoryItem,
  type EbayExistingRevisionInput,
  type EbayInventoryPublishInput,
} from "../../../src/lib/ebay-inventory-publisher";

type RunnerPayload = {
  mode?: "readiness" | "publish" | "revise" | "oauth_exchange";
  item?: EbayInventoryPublishInput;
  revision?: EbayExistingRevisionInput;
  code?: string;
  redirectUri?: string;
};

const HEADQUARTERS_LOCATION = "dd4bd05a-0aee-4342-830e-dd227c1fca28";
const PAYMENT_POLICY = "252035124017";
const NO_RETURNS_POLICY = "252035125017";
const STANDARD_ENVELOPE_POLICY = "256363993017";
const GROUND_ADVANTAGE_POLICY = "256363912017";

function applyVerifiedStoreDefaults(price = 0) {
  process.env.EBAY_MARKETPLACE_ID ||= "EBAY_US";
  process.env.EBAY_MERCHANT_LOCATION_KEY ||= HEADQUARTERS_LOCATION;
  process.env.EBAY_PAYMENT_POLICY_ID ||= PAYMENT_POLICY;
  process.env.EBAY_RETURN_POLICY_ID ||= NO_RETURNS_POLICY;
  process.env.EBAY_FULFILLMENT_POLICY_ID =
    price > 0 && price <= 20 ? STANDARD_ENVELOPE_POLICY : GROUND_ADVANTAGE_POLICY;
}
async function readStdin() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

async function main() {
  const raw = await readStdin();
  const payload = JSON.parse(raw || "{}") as RunnerPayload;
  const mode = payload.mode || "publish";
  const item = payload.item;
  applyVerifiedStoreDefaults(Number(item?.price || 0));

  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();

  if (mode === "readiness") {
    const readiness = await getEbayPublishingReadiness({ supabase, storeId });
    process.stdout.write(JSON.stringify({ ok: true, mode, readiness }));
    return;
  }

  if (mode === "oauth_exchange") {
    const code = String(payload.code || "").trim();
    const redirectUri = String(payload.redirectUri || "").trim();
    const clientId = String(process.env.EBAY_CLIENT_ID || "").trim();
    const clientSecret = String(process.env.EBAY_CLIENT_SECRET || "").trim();
    if (!code || !redirectUri) throw new Error("eBay OAuth code and redirect URI are required.");
    if (!clientId || !clientSecret) throw new Error("Mac-local eBay app credentials are unavailable.");
    const apiRoot = String(process.env.EBAY_ENVIRONMENT || "production").toLowerCase() === "sandbox"
      ? "https://api.sandbox.ebay.com"
      : "https://api.ebay.com";
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetch(`${apiRoot}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.refresh_token) {
      throw new Error(String(data?.error_description || data?.error || "eBay OAuth token exchange failed."));
    }
    process.stdout.write(JSON.stringify({ ok: true, mode, ...data }));
    return;
  }

  if (mode === "revise") {
    if (!payload.revision) throw new Error("KINGMAKER eBay revision payload is missing.");
    const result = await reviseExistingEbayInventoryItem({
      supabase,
      storeId,
      revision: payload.revision,
    });
    process.stdout.write(JSON.stringify({ ok: true, mode, ...result }));
    return;
  }

  if (!item) throw new Error("KINGMAKER eBay publish payload is missing the listing item.");
  const result = await publishEbayInventoryItem({ supabase, storeId, item });
  process.stdout.write(JSON.stringify({ ok: true, mode, ...result }));
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
