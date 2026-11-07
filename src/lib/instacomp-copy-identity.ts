import type { InstaCompAiResult } from "./instacomp";
import { extractInstaCompSerialNumber } from "./instacomp-serial";

export type InstaCompSerialCopyIdentity = {
  exact: string;
  copyNumber: number;
  printRun: number;
  printRunLabel: string;
};

export type InstaCompInscriptionClassification = {
  ruleId: string | null;
  serial: InstaCompSerialCopyIdentity | null;
  isFutureWatchAuto: boolean;
  inscriptionExpected: boolean;
  inscriptionObserved: boolean;
  inscriptionText: string | null;
  debutDate: string | null;
  status:
    | "not_applicable"
    | "standard_copy"
    | "inscribed_confirmed"
    | "inscribed_expected_needs_read"
    | "inscription_conflict";
  reviewReasons: string[];
};

export type InstaCompListingIdentity = {
  titleSuffix: string;
  descriptionFacts: string[];
  serial: InstaCompSerialCopyIdentity | null;
  inscription: InstaCompInscriptionClassification;
  safeForAutomaticListing: boolean;
};

function clean(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: string | null | undefined) {
  return clean(value).toLowerCase().replace(/[^a-z0-9/]+/g, " ").trim();
}

function parseCopyIdentity(value: string | null | undefined): InstaCompSerialCopyIdentity | null {
  const parsed = extractInstaCompSerialNumber(value);
  if (!parsed) return null;
  return {
    exact: parsed.exact,
    copyNumber: parsed.numerator,
    printRun: parsed.denominator,
    printRunLabel: `/${parsed.denominator}`,
  };
}

function isFutureWatchAuto(ai: Pick<InstaCompAiResult, "brand" | "setName" | "parallel" | "notes" | "isAuto">) {
  if (!ai.isAuto) return false;
  const evidence = compact([ai.brand, ai.setName, ai.parallel, ai.notes].filter(Boolean).join(" "));
  return /\bfuture watch\b/.test(evidence) && /\b(auto|autograph)\b/.test(evidence);
}

function dateCandidate(value: string | null | undefined) {
  const source = clean(value);
  if (!source) return null;
  const numeric = source.match(
    /\b(?:debut(?:ed)?(?:\s+date)?|nhl\s+debut|inscription|inscribed)?\s*[:\-]?\s*((?:0?[1-9]|1[0-2])[\/.\-](?:0?[1-9]|[12]\d|3[01])[\/.\-](?:\d{2}|\d{4}))\b/i,
  );
  if (numeric) return numeric[1];
  const written = source.match(
    /\b(?:debut(?:ed)?(?:\s+date)?|nhl\s+debut|inscription|inscribed)\s*[:\-]?\s*((?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{2,4})\b/i,
  );
  return written?.[1] || null;
}

function explicitInscription(value: string | null | undefined) {
  const source = clean(value);
  if (!source) return null;
  const match = source.match(/\b(?:inscription|inscribed)\s*[:\-]\s*([^;|]+?)(?=$|[;|])/i);
  return match?.[1]?.trim() || null;
}

export function classifyInstaCompInscriptionCopy(
  ai: Pick<
    InstaCompAiResult,
    "brand" | "setName" | "parallel" | "serialNumber" | "notes" | "isAuto"
  >,
): InstaCompInscriptionClassification {
  const serial = parseCopyIdentity(ai.serialNumber);
  const futureWatchAuto = isFutureWatchAuto(ai);
  const debutDate = dateCandidate(ai.notes);
  const inscriptionText = explicitInscription(ai.notes) || debutDate;
  const inscriptionObserved = Boolean(inscriptionText) || /\binscribed|inscription\b/i.test(clean(ai.parallel));
  const inscriptionExpected = Boolean(
    futureWatchAuto &&
      serial &&
      serial.printRun === 999 &&
      serial.copyNumber >= 1 &&
      serial.copyNumber <= 50,
  );
  const standardFutureWatchCopy = Boolean(
    futureWatchAuto && serial && serial.printRun === 999 && serial.copyNumber > 50,
  );
  const reviewReasons: string[] = [];

  if (!futureWatchAuto || !serial || serial.printRun !== 999) {
    return {
      ruleId: null,
      serial,
      isFutureWatchAuto: futureWatchAuto,
      inscriptionExpected: false,
      inscriptionObserved,
      inscriptionText,
      debutDate,
      status: "not_applicable",
      reviewReasons,
    };
  }

  if (inscriptionExpected && !debutDate) {
    reviewReasons.push("expected_debut_date_inscription_not_read");
    return {
      ruleId: "sp-authentic-future-watch-auto-first-50-debut-date",
      serial,
      isFutureWatchAuto: true,
      inscriptionExpected: true,
      inscriptionObserved,
      inscriptionText,
      debutDate,
      status: "inscribed_expected_needs_read",
      reviewReasons,
    };
  }

  if (inscriptionExpected) {
    return {
      ruleId: "sp-authentic-future-watch-auto-first-50-debut-date",
      serial,
      isFutureWatchAuto: true,
      inscriptionExpected: true,
      inscriptionObserved: true,
      inscriptionText: inscriptionText || debutDate,
      debutDate,
      status: "inscribed_confirmed",
      reviewReasons,
    };
  }

  if (standardFutureWatchCopy && inscriptionObserved) {
    reviewReasons.push("future_watch_copy_above_50_claims_inscription");
    return {
      ruleId: "sp-authentic-future-watch-auto-first-50-debut-date",
      serial,
      isFutureWatchAuto: true,
      inscriptionExpected: false,
      inscriptionObserved: true,
      inscriptionText,
      debutDate,
      status: "inscription_conflict",
      reviewReasons,
    };
  }

  return {
    ruleId: "sp-authentic-future-watch-auto-first-50-debut-date",
    serial,
    isFutureWatchAuto: true,
    inscriptionExpected: false,
    inscriptionObserved: false,
    inscriptionText: null,
    debutDate: null,
    status: "standard_copy",
    reviewReasons,
  };
}

export function buildInstaCompListingIdentity(ai: InstaCompAiResult): InstaCompListingIdentity {
  const inscription = classifyInstaCompInscriptionCopy(ai);
  const serial = inscription.serial;
  const titleParts: string[] = [];
  const descriptionFacts: string[] = [];

  if (inscription.isFutureWatchAuto) titleParts.push("Future Watch Auto");
  if (inscription.status === "inscribed_confirmed") titleParts.push("Inscribed");
  if (serial) {
    titleParts.push(serial.exact);
    descriptionFacts.push(`Serial-numbered copy: ${serial.exact}`);
    descriptionFacts.push(`Copy number: ${serial.copyNumber} of ${serial.printRun}`);
  }
  if (inscription.status === "inscribed_confirmed" && inscription.debutDate) {
    descriptionFacts.push(`Hand-inscribed debut date: ${inscription.debutDate}`);
  } else if (inscription.status === "inscribed_expected_needs_read") {
    descriptionFacts.push(
      "This is a first-50 Future Watch Auto copy expected to carry a hand-inscribed debut date; the exact inscription must be confirmed from the card image before listing.",
    );
  }

  return {
    titleSuffix: titleParts.join(" "),
    descriptionFacts,
    serial,
    inscription,
    safeForAutomaticListing: inscription.reviewReasons.length === 0,
  };
}
