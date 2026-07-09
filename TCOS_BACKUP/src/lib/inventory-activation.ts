import {
  extractAuthenticityProfile,
  type AuthenticityProfile,
} from "./authenticity";

export type InventoryActivationBlocker =
  | "missing_sku"
  | "missing_price"
  | "missing_quantity"
  | "missing_image"
  | "missing_authenticity_disclosure"
  | "missing_cert_provider"
  | "missing_pass_guarantee_authenticator"
  | "missing_provenance_evidence";

function cleanText(value: string | null | undefined) {
  return value?.trim() || null;
}

function isAutographSensitive(params: {
  title: string | null;
  category: string | null;
  authenticity: AuthenticityProfile;
}) {
  const title = cleanText(params.title)?.toLowerCase() || "";
  const category = cleanText(params.category)?.toLowerCase() || "";
  const authenticity = params.authenticity;

  return (
    category === "autographs" ||
    title.includes("autograph") ||
    title.includes("autographed") ||
    title.includes("signed") ||
    title.includes("psa dna") ||
    title.includes("jsa") ||
    title.includes("beckett authenticated") ||
    title.includes(" coa") ||
    title.startsWith("coa ") ||
    authenticity.autographSource !== "none" ||
    Boolean(authenticity.certProvider) ||
    Boolean(authenticity.certNumber) ||
    Boolean(authenticity.provenanceEvidence) ||
    authenticity.guaranteedAuthenticators.length > 0
  );
}

export function getInventoryActivationBlockers(params: {
  sku: string | null;
  price: number;
  quantity: number;
  imageUrl: string | null;
  title: string | null;
  category: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const blockers: InventoryActivationBlocker[] = [];
  const authenticity = extractAuthenticityProfile(params.metadata);

  if (!params.sku) blockers.push("missing_sku");
  if (params.price <= 0) blockers.push("missing_price");
  if (params.quantity <= 0) blockers.push("missing_quantity");
  if (!params.imageUrl) blockers.push("missing_image");

  if (isAutographSensitive({
    title: params.title,
    category: params.category,
    authenticity,
  })) {
    if (authenticity.status === "not_applicable") {
      blockers.push("missing_authenticity_disclosure");
    }

    if (
      authenticity.status === "verified_cert" &&
      !cleanText(authenticity.certProvider)
    ) {
      blockers.push("missing_cert_provider");
    }

    if (
      authenticity.status === "seller_pass_guarantee" &&
      authenticity.guaranteedAuthenticators.length === 0
    ) {
      blockers.push("missing_pass_guarantee_authenticator");
    }

    if (
      authenticity.status === "provenance_only" &&
      !cleanText(authenticity.provenanceEvidence)
    ) {
      blockers.push("missing_provenance_evidence");
    }
  }

  return blockers;
}
