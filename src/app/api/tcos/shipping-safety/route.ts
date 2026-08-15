import { getShippingProviderAdapterProfile } from "../../../../lib/shipping-provider-adapter";

export const dynamic = "force-dynamic";

export async function GET() {
  const purchaseMode =
    process.env.TCOS_SHIPPING_PURCHASE_MODE === "live" ? "live" : "dry_run";
  const liveShippingEnabled = process.env.TCOS_LIVE_SHIPPING_ENABLED === "true";
  const methods = [
    "STANDARD_ENVELOPE",
    "GROUND_ADVANTAGE",
    "PRIORITY_MAIL",
  ] as const;
  const profiles = methods.map((method) =>
    getShippingProviderAdapterProfile(method),
  );
  const liveAdapterSupported = profiles.some(
    (profile) => profile.livePurchaseSupported,
  );
  const livePostagePossible =
    purchaseMode === "live" && liveShippingEnabled && liveAdapterSupported;
  const safeForControlledShippingTest =
    purchaseMode === "dry_run" &&
    liveShippingEnabled === false &&
    liveAdapterSupported === false &&
    livePostagePossible === false;

  return Response.json(
    {
      ok: safeForControlledShippingTest,
      scope: "shipping_runtime_safety",
      purchaseMode,
      liveShippingEnabled,
      liveAdapterSupported,
      livePostagePossible,
      standardEnvelope: {
        adapterStatus: profiles[0].adapterStatus,
        livePurchaseSupported: profiles[0].livePurchaseSupported,
        manualPurchaseRequired: profiles[0].manualPurchaseRequired,
      },
      deploymentSha: process.env.TCOS_GIT_COMMIT_SHA || null,
    },
    {
      status: safeForControlledShippingTest ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
        "X-TCOS-Shipping-Safety": safeForControlledShippingTest
          ? "safe"
          : "blocked",
      },
    },
  );
}
