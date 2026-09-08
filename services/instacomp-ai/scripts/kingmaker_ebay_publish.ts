import { createSupabaseServerClient } from "../../../src/lib/supabase-server";
import { getActiveStoreId } from "../../../src/lib/stores";
import {
  getEbayPublishingReadiness,
  publishEbayInventoryItem,
  type EbayInventoryPublishInput,
} from "../../../src/lib/ebay-inventory-publisher";

type RunnerPayload = {
  mode?: "readiness" | "publish";
  item?: EbayInventoryPublishInput;
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
