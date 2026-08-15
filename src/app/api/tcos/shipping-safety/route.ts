import { getLetterTrackShipStationBridgeStatus } from "../../../../lib/lettertrack-shipstation";
import { getShipStationParcelBridgeStatus } from "../../../../lib/shipstation-parcel";
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
  const letterTrackShipStation = getLetterTrackShipStationBridgeStatus();
  const shipStationParcel = getShipStationParcelBridgeStatus();
  const liveAdapterSupported = profiles.some(
    (profile) => profile.livePurchaseSupported,
  );
  const genericLivePostagePossible =
    purchaseMode === "live" && liveShippingEnabled && liveAdapterSupported;
  const letterTrackLivePostagePossible = letterTrackShipStation.ready;
  const parcelLivePostagePossible = shipStationParcel.ready;
  const livePostagePossible =
    genericLivePostagePossible ||
    letterTrackLivePostagePossible ||
    parcelLivePostagePossible;
  const safeForControlledShippingTest =
    purchaseMode === "dry_run" &&
    liveShippingEnabled === false &&
    liveAdapterSupported === false &&
    letterTrackLivePostagePossible === false &&
    parcelLivePostagePossible === false &&
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
      letterTrackShipStation: {
        enabled: letterTrackShipStation.enabled,
        ready: letterTrackShipStation.ready,
        provider: letterTrackShipStation.provider,
        requiresExplicitPurchaseConfirmation:
          letterTrackShipStation.requiresExplicitPurchaseConfirmation,
        letterTrackFinalizeRequired:
          letterTrackShipStation.letterTrackFinalizeRequired,
        apiKeyConfigured: letterTrackShipStation.apiKeyConfigured,
        carrierConfigured: letterTrackShipStation.carrierConfigured,
        warehouseConfigured: letterTrackShipStation.warehouseConfigured,
        shipFromConfigured: letterTrackShipStation.shipFromConfigured,
        serviceCode: letterTrackShipStation.serviceCode,
        packageCode: letterTrackShipStation.packageCode,
      },
      shipStationParcel: {
        enabled: shipStationParcel.enabled,
        ready: shipStationParcel.ready,
        provider: shipStationParcel.provider,
        apiKeyConfigured: shipStationParcel.apiKeyConfigured,
        carrierConfigured: shipStationParcel.carrierConfigured,
        warehouseConfigured: shipStationParcel.warehouseConfigured,
        shipFromConfigured: shipStationParcel.shipFromConfigured,
        groundAdvantageServiceCode:
          shipStationParcel.groundAdvantageServiceCode,
        priorityMailServiceCode: shipStationParcel.priorityMailServiceCode,
        packageCode: shipStationParcel.packageCode,
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
