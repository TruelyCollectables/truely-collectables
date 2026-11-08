import { getLetterTrackShipStationBridgeStatus } from "./lettertrack-shipstation";
import { getShipStationParcelBridgeStatus } from "./shipstation-parcel";
import { getShippingProviderAdapterProfile } from "./shipping-provider-adapter";

export type ShippingProviderReadinessStatus = "ready" | "warning" | "blocked";

export type ShippingProviderReadinessItem = {
  key: string;
  label: string;
  status: ShippingProviderReadinessStatus;
  detail: string;
  action: string;
  missing: string[];
};

function providerRequired() {
  return process.env.TCOS_SHIPPING_PROVIDERS_REQUIRED === "true";
}

function missingStatus(missing: string[]) {
  if (missing.length === 0) return "ready" as const;

  return providerRequired() ? ("blocked" as const) : ("warning" as const);
}

function shippingPurchaseMode() {
  return process.env.TCOS_SHIPPING_PURCHASE_MODE === "live" ? "live" : "dry_run";
}

export function getShippingProviderReadiness(): ShippingProviderReadinessItem[] {
  const purchaseMode = shippingPurchaseMode();
  const standardEnvelopeProfile =
    getShippingProviderAdapterProfile("STANDARD_ENVELOPE");
  const coverageMissing = standardEnvelopeProfile.missingCoverageCredentialKeys;
  const letterTrackShipStation = getLetterTrackShipStationBridgeStatus();
  const shipStationParcel = getShipStationParcelBridgeStatus();

  return [
    {
      key: "shipping_purchase_mode",
      label: "Shipping Purchase Mode",
      status: purchaseMode === "live" ? "blocked" : "warning",
      detail:
        purchaseMode === "live"
          ? "The generic live shipping purchase mode is enabled, but TCOS has not approved the generic parcel/coverage adapter yet."
          : "TCOS generic shipping remains in dry-run mode. Dedicated ShipStation purchase lanes are separately gated and cannot be enabled by this switch.",
      action:
        purchaseMode === "live"
          ? "Switch TCOS_SHIPPING_PURCHASE_MODE back to dry_run until the generic live provider adapter is approved."
          : "Keep the generic adapter in dry_run. Activate postage only through the dedicated guarded ShipStation bridges after provider setup.",
      missing: purchaseMode === "live" ? ["approved generic live shipping adapter"] : [],
    },
    {
      key: "shipping_adapter_contract",
      label: "Shipping Adapter Contract",
      status: purchaseMode === "live" ? "blocked" : "warning",
      detail:
        purchaseMode === "live"
          ? "TCOS has an auditable generic adapter contract, but generic live provider execution remains intentionally blocked."
          : "TCOS retains the dry-run generic adapter and manual external-purchase fallback while dedicated provider bridges can be approved independently.",
      action:
        "Keep generic live purchase disabled until its quote, buy, void, Coverage, webhook, reconciliation, and audit requirements are approved end-to-end.",
      missing: purchaseMode === "live" ? ["approved generic live adapter implementation"] : [],
    },
    {
      key: "lettertrack_shipstation_bridge",
      label: "LetterTrack / ShipStation Direct Postage",
      status: letterTrackShipStation.ready
        ? "ready"
        : letterTrackShipStation.enabled
          ? "blocked"
          : "warning",
      detail: letterTrackShipStation.ready
        ? "ShipStation direct USPS letter-postage purchase is enabled in TCOS. Each purchase requires explicit operator confirmation; the paid PDF is printed from TCOS and still requires LetterTrack IMb finalization."
        : letterTrackShipStation.enabled
          ? "The direct LetterTrack/ShipStation lane is enabled but missing provider configuration, so TCOS will block every real postage charge."
          : "The direct LetterTrack/ShipStation lane is installed but disabled. No ShipStation letter-postage charge can occur until its dedicated production flag and provider configuration are present.",
      action: letterTrackShipStation.ready
        ? "Use Buy USPS Letter Postage on Standard Envelope orders, print the paid PDF in TCOS, then finalize it in LetterTrack and record the IMb before mailing."
        : `Configure the ShipStation carrier/account and ship-from data, then explicitly enable TCOS_LETTERTRACK_SHIPSTATION_LIVE_ENABLED. Missing: ${
            letterTrackShipStation.missing.join(", ") || "dedicated live enablement"
          }.`,
      missing: letterTrackShipStation.ready
        ? []
        : [
            ...letterTrackShipStation.missing,
            ...(letterTrackShipStation.enabled
              ? []
              : ["TCOS_LETTERTRACK_SHIPSTATION_LIVE_ENABLED"]),
          ],
    },
    {
      key: "shipstation_parcel_bridge",
      label: "ShipStation Ground Advantage / Priority",
      status: shipStationParcel.ready
        ? "ready"
        : shipStationParcel.enabled
          ? "blocked"
          : "warning",
      detail: shipStationParcel.ready
        ? "ShipStation direct USPS Ground Advantage and Priority Mail purchase is enabled. TCOS requires finished package measurements and explicit charge confirmation, then saves USPS tracking and the printable PDF."
        : shipStationParcel.enabled
          ? "The ShipStation parcel lane is enabled but missing provider configuration, so TCOS will block every real parcel-postage charge."
          : "The ShipStation parcel lane is installed but disabled. No Ground Advantage or Priority Mail charge can occur until its dedicated production flag and provider configuration are present.",
      action: shipStationParcel.ready
        ? "Use Buy + Print on Ground Advantage or Priority orders after weighing and measuring the finished package."
        : `Configure the ShipStation carrier/account and ship-from data, then explicitly enable TCOS_SHIPSTATION_PARCEL_LIVE_ENABLED. Missing: ${
            shipStationParcel.missing.join(", ") || "dedicated live enablement"
          }.`,
      missing: shipStationParcel.ready
        ? []
        : [
            ...shipStationParcel.missing,
            ...(shipStationParcel.enabled
              ? []
              : ["TCOS_SHIPSTATION_PARCEL_LIVE_ENABLED"]),
          ],
    },
    {
      key: "standard_envelope_provider",
      label: "Standard Envelope / LetterTrack IMb",
      status: missingStatus(standardEnvelopeProfile.missingCredentialKeys),
      detail:
        standardEnvelopeProfile.missingCredentialKeys.length === 0
          ? `${standardEnvelopeProfile.provider} is configured for TCOS Standard Envelope / IMb evidence handling.`
          : "TCOS can price, audit, and protect Standard Envelope orders, but LetterTrack account/import workflow approval is still required to add the final IMb tracking barcode.",
      action:
        standardEnvelopeProfile.missingCredentialKeys.length === 0
          ? "After paid letter postage is ready, finalize the PDF in LetterTrack and record the assigned IMb back into TCOS."
          : `Set ${standardEnvelopeProfile.missingCredentialKeys.join(", ")} in production secrets.`,
      missing: standardEnvelopeProfile.missingCredentialKeys,
    },
    {
      key: "shipping_coverage_provider",
      label: "Shipping Coverage Provider",
      status: missingStatus(coverageMissing),
      detail:
        coverageMissing.length === 0
          ? `${standardEnvelopeProfile.coverageProvider} is configured for seller shipment coverage purchase.`
          : "TCOS marks every shipment as coverage-required, but cannot purchase external seller protection until the coverage provider account is configured.",
      action:
        coverageMissing.length === 0
          ? "Wire the coverage purchase adapter into label purchase."
          : `Set ${coverageMissing.join(", ")} in production secrets.`,
      missing: coverageMissing,
    },
  ];
}

export function shippingProviderSummary(items = getShippingProviderReadiness()) {
  return {
    ready: items.filter((item) => item.status === "ready").length,
    warning: items.filter((item) => item.status === "warning").length,
    blocked: items.filter((item) => item.status === "blocked").length,
  };
}

export function shippingPurchaseBlockers(params: {
  method: string | null | undefined;
  readiness?: ShippingProviderReadinessItem[];
}) {
  const readiness = params.readiness || getShippingProviderReadiness();
  const method = params.method || "GROUND_ADVANTAGE";
  const neededKeys = new Set<string>(["shipping_coverage_provider"]);

  if (method === "STANDARD_ENVELOPE") {
    neededKeys.add("lettertrack_shipstation_bridge");
    neededKeys.add("standard_envelope_provider");
  } else {
    neededKeys.add("shipstation_parcel_bridge");
  }

  const purchaseMode = readiness.find(
    (item) => item.key === "shipping_purchase_mode",
  );
  if (purchaseMode?.status === "blocked") {
    neededKeys.add("shipping_purchase_mode");
  }

  return readiness.filter(
    (item) => neededKeys.has(item.key) && item.status !== "ready",
  );
}
