export const AUTHENTICITY_STATUSES = [
  "not_applicable",
  "verified_cert",
  "seller_pass_guarantee",
  "provenance_only",
  "unverified_as_is",
] as const;

export type AuthenticityStatus = (typeof AUTHENTICITY_STATUSES)[number];

export const AUTOGRAPH_SOURCES = [
  "none",
  "in_person",
  "ttm",
  "fan_club_return",
  "private_signing",
  "inherited",
  "estate",
  "secondhand",
  "other",
] as const;

export type AutographSource = (typeof AUTOGRAPH_SOURCES)[number];

export type AuthenticityProfile = {
  status: AuthenticityStatus;
  autographSource: AutographSource;
  certProvider: string | null;
  certNumber: string | null;
  guaranteedAuthenticators: string[];
  provenanceEvidence: string | null;
  authenticityNotes: string | null;
};

type BadgeTone = "neutral" | "emerald" | "amber" | "sky";

export type AuthenticityBadge = {
  label: string;
  tone: BadgeTone;
};

const DEFAULT_AUTHENTICITY_PROFILE: AuthenticityProfile = {
  status: "not_applicable",
  autographSource: "none",
  certProvider: null,
  certNumber: null,
  guaranteedAuthenticators: [],
  provenanceEvidence: null,
  authenticityNotes: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text.slice(0, maxLength) : null;
}

function cleanStringList(value: unknown, maxItems = 5, maxLength = 80) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return Array.from(
    new Set(
      values
        .map((entry) => cleanText(entry, maxLength))
        .filter((entry): entry is string => Boolean(entry)),
    ),
  ).slice(0, maxItems);
}

export function parseAuthenticityStatus(value: unknown): AuthenticityStatus {
  return AUTHENTICITY_STATUSES.includes(value as AuthenticityStatus)
    ? (value as AuthenticityStatus)
    : DEFAULT_AUTHENTICITY_PROFILE.status;
}

export function parseAutographSource(value: unknown): AutographSource {
  return AUTOGRAPH_SOURCES.includes(value as AutographSource)
    ? (value as AutographSource)
    : DEFAULT_AUTHENTICITY_PROFILE.autographSource;
}

export function sanitizeAuthenticityProfile(value: unknown): AuthenticityProfile {
  const input = isRecord(value) ? value : {};

  return {
    status: parseAuthenticityStatus(input.status),
    autographSource: parseAutographSource(input.autographSource),
    certProvider: cleanText(input.certProvider, 80),
    certNumber: cleanText(input.certNumber, 120),
    guaranteedAuthenticators: cleanStringList(input.guaranteedAuthenticators),
    provenanceEvidence: cleanText(input.provenanceEvidence, 500),
    authenticityNotes: cleanText(input.authenticityNotes, 500),
  };
}

export function validateAuthenticityProfile(profile: AuthenticityProfile) {
  if (profile.status === "verified_cert" && !profile.certProvider) {
    return "Verified certification listings must include the certification provider.";
  }

  if (
    profile.status === "seller_pass_guarantee" &&
    profile.guaranteedAuthenticators.length === 0
  ) {
    return "Seller pass guarantee listings must name at least one authenticator.";
  }

  if (profile.status === "provenance_only" && !profile.provenanceEvidence) {
    return "Provenance-supported listings must describe the supporting evidence.";
  }

  return null;
}

export function extractAuthenticityProfile(metadata: unknown) {
  if (!isRecord(metadata)) {
    return DEFAULT_AUTHENTICITY_PROFILE;
  }

  return sanitizeAuthenticityProfile(metadata.authenticity);
}

export function mergeAuthenticityIntoMetadata(
  metadata: unknown,
  profile: AuthenticityProfile,
): Record<string, unknown> {
  const nextMetadata = isRecord(metadata) ? { ...metadata } : {};
  nextMetadata.authenticity = {
    status: profile.status,
    autographSource: profile.autographSource,
    certProvider: profile.certProvider,
    certNumber: profile.certNumber,
    guaranteedAuthenticators: profile.guaranteedAuthenticators,
    provenanceEvidence: profile.provenanceEvidence,
    authenticityNotes: profile.authenticityNotes,
  };

  return nextMetadata;
}

export function authenticityStatusLabel(status: AuthenticityStatus) {
  if (status === "verified_cert") return "Verified Cert";
  if (status === "seller_pass_guarantee") return "Seller Pass Guarantee";
  if (status === "provenance_only") return "Provenance Evidence Included";
  if (status === "unverified_as_is") return "Unverified Autograph - Sold As-Is";
  return "No Special Authenticity Claim";
}

export function autographSourceLabel(source: AutographSource) {
  if (source === "ttm") return "Through The Mail (TTM)";
  if (source === "fan_club_return") return "Fan Club Return";
  if (source === "private_signing") return "Private Signing";
  if (source === "in_person") return "In Person";
  if (source === "secondhand") return "Acquired Secondhand";
  if (source === "none") return "No Autograph Source Recorded";
  return source.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function hasAuthenticityDetails(profile: AuthenticityProfile) {
  return (
    profile.status !== "not_applicable" ||
    profile.autographSource !== "none" ||
    Boolean(profile.certProvider) ||
    Boolean(profile.certNumber) ||
    profile.guaranteedAuthenticators.length > 0 ||
    Boolean(profile.provenanceEvidence) ||
    Boolean(profile.authenticityNotes)
  );
}

export function buildAuthenticityBadges(
  profile: AuthenticityProfile,
): AuthenticityBadge[] {
  const badges: AuthenticityBadge[] = [];

  if (profile.status === "verified_cert") {
    badges.push({ label: "Verified Cert", tone: "emerald" });
  }

  if (profile.status === "seller_pass_guarantee") {
    badges.push({ label: "Seller Pass Guarantee", tone: "sky" });
  }

  if (profile.status === "provenance_only") {
    badges.push({ label: "Provenance Evidence Included", tone: "sky" });
  }

  if (profile.status === "unverified_as_is") {
    badges.push({ label: "Unverified Autograph - Sold As-Is", tone: "amber" });
  }

  if (profile.autographSource !== "none") {
    badges.push({
      label: autographSourceLabel(profile.autographSource),
      tone: "neutral",
    });
  }

  return badges;
}

export function getAuthenticityCallout(profile: AuthenticityProfile): {
  title: string;
  detail: string;
  tone: BadgeTone;
} {
  if (profile.status === "verified_cert") {
    return {
      title: "Certified Listing",
      detail: profile.certProvider
        ? `This listing is disclosed as certified through ${profile.certProvider}. Review the certificate details and photos before purchase.`
        : "This listing is disclosed as certified. Review the certificate details and photos before purchase.",
      tone: "emerald",
    };
  }

  if (profile.status === "seller_pass_guarantee") {
    return {
      title: "Seller Pass Guarantee",
      detail:
        "The seller states this item should pass the named authenticator review. That guarantee becomes part of the transaction record.",
      tone: "sky",
    };
  }

  if (profile.status === "provenance_only") {
    return {
      title: "Provenance-Supported Listing",
      detail:
        "This listing includes provenance evidence, but provenance is not the same as third-party certification unless the listing says so clearly.",
      tone: "sky",
    };
  }

  if (profile.status === "unverified_as_is") {
    return {
      title: "Unverified Autograph Risk",
      detail:
        "This item is disclosed as unverified and sold as-is. Buyers accept the listed authentication risk unless the seller made a false claim.",
      tone: "amber",
    };
  }

  return {
    title: "No Special Authenticity Claim",
    detail:
      "No certification, seller pass guarantee, or provenance-only claim has been added to this listing.",
    tone: "neutral",
  };
}

function textValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    return value.map(textValue).filter(Boolean).join(", ") || null;
  }

  return cleanText(value, 200);
}

function aspectValue(aspects: Record<string, unknown>, name: string) {
  return textValue(aspects[name]);
}

function affirmative(value: string | null) {
  return ["1", "true", "yes", "y", "autographed", "signed"].includes(
    String(value || "").trim().toLowerCase(),
  );
}

export function inferAuthenticityProfileFromEbayListing(params: {
  title: string;
  category?: string | null;
  aspects?: Record<string, unknown> | null;
}) {
  const title = params.title.toLowerCase();
  const category = String(params.category || "").toLowerCase();
  const aspects = isRecord(params.aspects) ? params.aspects : {};
  const authProvider = cleanText(
    aspectValue(aspects, "Autograph Authentication"),
    80,
  );
  const authNumber = cleanText(
    aspectValue(aspects, "Autograph Authentication Number"),
    120,
  );
  const autographed = affirmative(aspectValue(aspects, "Autographed"));
  const signedBy = cleanText(aspectValue(aspects, "Signed By"), 120);
  const hasAutographTitleSignal =
    title.includes("autograph") ||
    title.includes("autographed") ||
    title.includes(" signed ") ||
    title.startsWith("signed ") ||
    title.includes(" psa dna") ||
    title.includes(" jsa") ||
    title.includes(" beckett");
  const autographSensitive =
    category === "autographs" ||
    autographed ||
    Boolean(authProvider) ||
    Boolean(authNumber) ||
    Boolean(signedBy) ||
    hasAutographTitleSignal;

  let autographSource: AutographSource = "none";

  if (title.includes("ttm")) autographSource = "ttm";
  else if (title.includes("fan club")) autographSource = "fan_club_return";
  else if (title.includes("in person")) autographSource = "in_person";
  else if (title.includes("private signing")) autographSource = "private_signing";

  if (!autographSensitive) {
    return DEFAULT_AUTHENTICITY_PROFILE;
  }

  return sanitizeAuthenticityProfile({
    status: authProvider || authNumber ? "verified_cert" : "unverified_as_is",
    autographSource,
    certProvider: authProvider,
    certNumber: authNumber,
    authenticityNotes:
      authProvider || authNumber
        ? null
        : "Imported from an existing marketplace listing without third-party certification details. Review and update this disclosure before activation if needed.",
  });
}
