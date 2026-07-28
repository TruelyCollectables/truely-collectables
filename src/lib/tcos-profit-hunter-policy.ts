import { timingSafeEqual } from "node:crypto";

export const TCOS_WNBA_ROOKIE_PLAYERS = [
  "Caitlin Clark",
  "Paige Bueckers",
  "Dominique Malonga",
  "Sonia Citron",
  "Kiki Iriafen",
] as const;

export type ProfitHunterLane =
  | "demidov"
  | "wnba"
  | "danny_norris"
  | "baseball_prospect"
  | "signed_baseball";

export type TrueFirstBowmanEvidence = {
  checklistSource: string;
  checklistUrl: string;
  exactCardNumber: string;
  chronologyChecked: boolean;
  noEarlierQualifyingIssue: boolean;
  notes?: string | null;
};

type InstaCompIdentity = {
  player?: string | null;
  year?: string | null;
  brand?: string | null;
  setName?: string | null;
  cardNumber?: string | null;
  parallel?: string | null;
  sport?: string | null;
  isRookie?: boolean | null;
  isAuto?: boolean | null;
  isRelic?: boolean | null;
  notes?: string | null;
};

function normalize(value: unknown) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sameText(left: unknown, right: unknown) {
  return Boolean(normalize(left) && normalize(left) === normalize(right));
}

function extractedStartYear(value: unknown) {
  const match = String(value || "").match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function collegeProduct(identity: InstaCompIdentity) {
  const text = normalize(
    [identity.brand, identity.setName, identity.notes].filter(Boolean).join(" "),
  );
  return /(college|collegiate|ncaa|bowman university|draft picks|university)/.test(
    text,
  );
}

function ordinaryBase(identity: InstaCompIdentity) {
  const parallel = normalize(identity.parallel);
  return !parallel || parallel === "base" || parallel === "base card";
}

function recognizedCaseHitOrSsp(identity: InstaCompIdentity) {
  const text = normalize(
    [identity.parallel, identity.setName, identity.notes].filter(Boolean).join(" "),
  );
  return /(ssp|super short print|case hit|downtown|kaboom|color blast|colour blast|gold vinyl|black finite)/.test(
    text,
  );
}

export function validateProfitHunterServiceBearer(
  authorizationHeader: string | null,
  expectedToken = process.env.TCOS_CONNECTOR_TOKEN,
) {
  const expected = String(expectedToken || "").trim();
  const authorization = String(authorizationHeader || "").trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const provided = String(match?.[1] || "").trim();
  if (!expected || !provided) return false;

  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

export function validateProfitHunterIdentity(params: {
  lane: ProfitHunterLane;
  expectedPlayer?: string | null;
  identity: InstaCompIdentity;
  trueFirstBowmanEvidence?: TrueFirstBowmanEvidence | null;
}) {
  const reasons: string[] = [];
  const player = String(params.identity.player || "").trim();

  if (!player) reasons.push("InstaComp did not return a player identity.");
  if (params.expectedPlayer && !sameText(player, params.expectedPlayer)) {
    reasons.push(
      `Verified player ${player || "UNKNOWN"} does not match expected player ${params.expectedPlayer}.`,
    );
  }

  if (params.lane === "demidov") {
    if (!sameText(player, "Ivan Demidov")) {
      reasons.push("Demidov lane requires Ivan Demidov.");
    }
    if (params.identity.isRookie !== true) {
      reasons.push("Demidov lane requires a verified professional rookie card.");
    }
  }

  if (params.lane === "wnba" || params.lane === "danny_norris") {
    const allowed = TCOS_WNBA_ROOKIE_PLAYERS.some((name) => sameText(name, player));
    if (!allowed) reasons.push("Player is outside the locked five-player WNBA watchlist.");
    if (params.identity.isRookie !== true) {
      reasons.push("WNBA lane requires a verified professional rookie card.");
    }
    if (collegeProduct(params.identity)) {
      reasons.push("College, NCAA, Bowman University, and Draft Picks cards are excluded.");
    }
    if (
      ordinaryBase(params.identity) &&
      params.identity.isAuto !== true &&
      params.identity.isRelic !== true &&
      !recognizedCaseHitOrSsp(params.identity)
    ) {
      reasons.push(
        "Ordinary WNBA base is excluded; the minimum eligible tier is Silver/equivalent or better.",
      );
    }
  }

  if (params.lane === "baseball_prospect") {
    const startYear = extractedStartYear(params.identity.year);
    if (startYear === null || startYear < 2021) {
      reasons.push("Baseball prospect cards must have a verified issue year of 2021 or later.");
    }
    const identityText = normalize(
      [params.identity.brand, params.identity.setName].filter(Boolean).join(" "),
    );
    if (!identityText.includes("bowman")) {
      reasons.push("Baseball prospect lane requires a verified Bowman issue.");
    }

    const evidence = params.trueFirstBowmanEvidence;
    if (!evidence) {
      reasons.push("Authoritative true 1st Bowman chronology evidence is required.");
    } else {
      if (!evidence.checklistSource.trim() || !evidence.checklistUrl.trim()) {
        reasons.push("Checklist source and URL are required for true 1st Bowman proof.");
      }
      if (!evidence.chronologyChecked) {
        reasons.push("Complete player Bowman chronology has not been confirmed.");
      }
      if (!evidence.noEarlierQualifyingIssue) {
        reasons.push("An earlier qualifying Bowman issue has not been ruled out.");
      }
      if (!sameText(params.identity.cardNumber, evidence.exactCardNumber)) {
        reasons.push(
          "InstaComp card number does not match the authoritative true 1st Bowman evidence.",
        );
      }
    }
  }

  if (params.lane === "signed_baseball") {
    reasons.push(
      "Signed baseballs require the separate memorabilia/authentication workflow and cannot be certified by the card scanner.",
    );
  }

  return {
    accepted: reasons.length === 0,
    reasons,
    normalizedPlayer: normalize(player),
  };
}

export function profitHunterLockedScope() {
  return {
    demidov: {
      player: "Ivan Demidov",
      professionalNhlRookieOnly: true,
    },
    wnba: {
      players: [...TCOS_WNBA_ROOKIE_PLAYERS],
      professionalWnbaRookieOnly: true,
      ordinaryBaseExcluded: true,
      minimumTier: "Silver Prizm or equivalent",
      collegeProductsExcluded: true,
    },
    baseballProspect: {
      trueFirstBowmanOnly: true,
      issueYearMinimum: 2021,
      completeChronologyRequired: true,
      noEarlierQualifyingIssueRequired: true,
      permanentFailureExample:
        "Franklin Arias 2025 Bowman Draft Chrome BDC-13 is not a 1st Bowman",
    },
    signedBaseball: {
      discoveryEnabled: true,
      cardScannerCertification: false,
    },
    minimumNetRoiPercent: 20,
  };
}
