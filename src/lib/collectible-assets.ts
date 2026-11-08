export type CollectibleGraderVerificationStatus =
  | "not_applicable"
  | "pending"
  | "verified"
  | "manual_verified"
  | "conflict"
  | "not_supported"
  | "failed";

export type GraderVerificationResult = {
  provider: string | null;
  certNumber: string | null;
  status: CollectibleGraderVerificationStatus;
  verificationUrl: string | null;
  checkedAt: string | null;
  expectedIdentity: Record<string, unknown>;
  observedIdentity: Record<string, unknown>;
  mismatchReasons: string[];
  providerScanUrls: string[];
  rawEvidence: Record<string, unknown>;
};

export type MarketSnapshotForTiming = {
  checked_at?: string | null;
  checkedAt?: string | null;
  market_value?: number | string | null;
  marketValue?: number | string | null;
  trusted_for_pricing?: boolean | null;
  trustedForPricing?: boolean | null;
};

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalized(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&amp;/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlText(html: string) {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function captured(text: string, expression: RegExp) {
  return cleanText(text.match(expression)?.[1]);
}

function exactCardNumber(value: unknown) {
  return normalized(value).replace(/^no /, "").replace(/^number /, "");
}

function gradeValue(value: unknown) {
  return normalized(value).replace(/^(psa|bgs|beckett|sgc|cgc|hga|tag) /, "");
}

function comparableContains(left: unknown, right: unknown) {
  const a = normalized(left);
  const b = normalized(right);
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

function certImageUrls(html: string) {
  const urls = new Set<string>();
  for (const match of html.matchAll(
    /<img\b[^>]*(?:alt=["'][^"']*cert image[^"']*["'][^>]*src=["']([^"']+)["']|src=["']([^"']+)["'][^>]*alt=["'][^"']*cert image[^"']*["'])[^>]*>/gi,
  )) {
    const url = decodeHtml(match[1] || match[2] || "");
    if (url.startsWith("http://") || url.startsWith("https://")) urls.add(url);
  }
  return Array.from(urls).slice(0, 4);
}

export function parsePhysicalSerial(value: unknown) {
  const text = cleanText(value);
  if (!text || /not serial|unnumbered|n\/a|none/i.test(text)) {
    return {
      exactSerialNumber: null,
      serialCopyNumber: null,
      serialPrintRun: null,
    };
  }

  const match = text.match(/\b0*(\d{1,9})\s*(?:\/|of)\s*0*(\d{1,9})\b/i);
  if (!match) {
    return {
      exactSerialNumber: text.slice(0, 80),
      serialCopyNumber: null,
      serialPrintRun: null,
    };
  }

  return {
    exactSerialNumber: `${Number(match[1])}/${Number(match[2])}`,
    serialCopyNumber: Number(match[1]),
    serialPrintRun: Number(match[2]),
  };
}

export function officialGraderVerificationUrl(
  provider: unknown,
  certNumber: unknown,
) {
  const company = normalized(provider);
  const cert = String(certNumber ?? "").replace(/[^a-z0-9]/gi, "");
  if (!cert) return null;
  if (company === "psa") return `https://www.psacard.com/cert/${cert}/psa`;
  return null;
}

export async function verifyGraderCertification(params: {
  provider: unknown;
  certNumber: unknown;
  expected: {
    year?: unknown;
    manufacturer?: unknown;
    player?: unknown;
    cardNumber?: unknown;
    grade?: unknown;
  };
}): Promise<GraderVerificationResult> {
  const provider = cleanText(params.provider);
  const certNumber = String(params.certNumber ?? "").replace(/[^a-z0-9]/gi, "");
  const verificationUrl = officialGraderVerificationUrl(provider, certNumber);
  const expectedIdentity = {
    year: cleanText(params.expected.year),
    manufacturer: cleanText(params.expected.manufacturer),
    player: cleanText(params.expected.player),
    cardNumber: cleanText(params.expected.cardNumber),
    grade: cleanText(params.expected.grade),
  };

  if (!provider || !certNumber) {
    return {
      provider,
      certNumber: certNumber || null,
      status: "not_applicable",
      verificationUrl,
      checkedAt: null,
      expectedIdentity,
      observedIdentity: {},
      mismatchReasons: [],
      providerScanUrls: [],
      rawEvidence: {},
    };
  }

  if (normalized(provider) !== "psa" || !verificationUrl) {
    return {
      provider,
      certNumber,
      status: "not_supported",
      verificationUrl,
      checkedAt: new Date().toISOString(),
      expectedIdentity,
      observedIdentity: {},
      mismatchReasons: [`Automatic ${provider} certification lookup is not connected yet.`],
      providerScanUrls: [],
      rawEvidence: {},
    };
  }

  const checkedAt = new Date().toISOString();

  try {
    const response = await fetch(verificationUrl, {
      cache: "no-store",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "TruelyCollectables-CertVerification/1.0",
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      return {
        provider,
        certNumber,
        status: "failed",
        verificationUrl,
        checkedAt,
        expectedIdentity,
        observedIdentity: {},
        mismatchReasons: [`PSA returned HTTP ${response.status}.`],
        providerScanUrls: [],
        rawEvidence: { responseStatus: response.status },
      };
    }

    const html = await response.text();
    const text = htmlText(html);
    const observedIdentity = {
      certNumber:
        captured(text, /Cert Number\s+([A-Z0-9-]+)/i) ||
        captured(text, /According to the PSA database[\s\S]*?#\s*([0-9]+)/i),
      grade: captured(
        text,
        /Item Grade\s+(.+?)\s+(?:Label Type|Reverse Cert\/Barcode|Year)/i,
      ),
      year: captured(text, /\bYear\s+(\d{4})\b/i),
      manufacturer: captured(text, /Brand\/Title\s+(.+?)\s+Subject\b/i),
      player: captured(text, /\bSubject\s+(.+?)\s+Card Number\b/i),
      cardNumber: captured(text, /Card Number\s+(.+?)\s+Category\b/i),
      category: captured(
        text,
        /\bCategory\s+(.+?)\s+(?:PSA Estimate|PSA Population|Set Registry|Sales)/i,
      ),
    };

    const mismatchReasons: string[] = [];
    if (String(observedIdentity.certNumber || "").replace(/\D/g, "") !== certNumber.replace(/\D/g, "")) {
      mismatchReasons.push("Certification number did not match PSA's returned record.");
    }
    if (
      expectedIdentity.year &&
      normalized(observedIdentity.year) !== normalized(expectedIdentity.year)
    ) {
      mismatchReasons.push("Year did not match the verified card record.");
    }
    if (
      expectedIdentity.player &&
      !comparableContains(observedIdentity.player, expectedIdentity.player)
    ) {
      mismatchReasons.push("Player/subject did not match the verified card record.");
    }
    if (
      expectedIdentity.cardNumber &&
      exactCardNumber(observedIdentity.cardNumber) !==
        exactCardNumber(expectedIdentity.cardNumber)
    ) {
      mismatchReasons.push("Card number did not match the verified card record.");
    }
    if (
      expectedIdentity.grade &&
      gradeValue(observedIdentity.grade) !== gradeValue(expectedIdentity.grade)
    ) {
      mismatchReasons.push("Grade did not match the verified card record.");
    }
    if (
      expectedIdentity.manufacturer &&
      observedIdentity.manufacturer &&
      !comparableContains(
        observedIdentity.manufacturer,
        expectedIdentity.manufacturer,
      )
    ) {
      mismatchReasons.push("Manufacturer/brand did not match the verified card record.");
    }

    const requiredObserved = [
      observedIdentity.certNumber,
      observedIdentity.grade,
      observedIdentity.year,
      observedIdentity.player,
      observedIdentity.cardNumber,
    ];
    const complete = requiredObserved.every(Boolean);

    return {
      provider,
      certNumber,
      status: complete && mismatchReasons.length === 0 ? "verified" : "conflict",
      verificationUrl,
      checkedAt,
      expectedIdentity,
      observedIdentity,
      mismatchReasons: complete
        ? mismatchReasons
        : [...mismatchReasons, "PSA's page did not expose every required identity field."],
      providerScanUrls: certImageUrls(html),
      rawEvidence: {
        responseStatus: response.status,
        finalUrl: response.url,
        pageHasCertVerificationText: /According to the PSA database/i.test(text),
      },
    };
  } catch (error: any) {
    return {
      provider,
      certNumber,
      status: "failed",
      verificationUrl,
      checkedAt,
      expectedIdentity,
      observedIdentity: {},
      mismatchReasons: [error?.message || "PSA certification lookup failed."],
      providerScanUrls: [],
      rawEvidence: {},
    };
  }
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function classifySaleTiming(params: {
  soldPrice: unknown;
  soldAt: unknown;
  snapshots: MarketSnapshotForTiming[];
}) {
  const soldPrice = money(params.soldPrice);
  const soldAt = Date.parse(String(params.soldAt || ""));
  const trusted = params.snapshots
    .map((snapshot) => ({
      checkedAt: Date.parse(String(snapshot.checked_at || snapshot.checkedAt || "")),
      marketValue: money(snapshot.market_value ?? snapshot.marketValue),
      trusted:
        snapshot.trusted_for_pricing === true ||
        snapshot.trustedForPricing === true,
    }))
    .filter(
      (snapshot) =>
        snapshot.trusted &&
        snapshot.marketValue &&
        Number.isFinite(snapshot.checkedAt),
    )
    .sort((left, right) => left.checkedAt - right.checkedAt);

  if (!soldPrice || !Number.isFinite(soldAt) || trusted.length === 0) {
    return {
      code: "needs_more_data",
      label: "Needs more market data",
      differencePercent: null,
      currentMarketValue: trusted.at(-1)?.marketValue || null,
      preSalePeak: null,
    };
  }

  const currentMarketValue = trusted.at(-1)!.marketValue!;
  const preSaleValues = trusted
    .filter((snapshot) => snapshot.checkedAt <= soldAt)
    .map((snapshot) => snapshot.marketValue!);
  const preSalePeak = preSaleValues.length ? Math.max(...preSaleValues) : null;
  const differencePercent =
    Math.round(((currentMarketValue - soldPrice) / soldPrice) * 10_000) / 100;

  if (currentMarketValue >= soldPrice * 1.15) {
    return {
      code: "sold_early",
      label: "Sold too early",
      differencePercent,
      currentMarketValue,
      preSalePeak,
    };
  }

  if (preSalePeak && preSalePeak >= soldPrice * 1.2 && soldPrice < preSalePeak * 0.85) {
    return {
      code: "sold_late",
      label: "Sold too late",
      differencePercent,
      currentMarketValue,
      preSalePeak,
    };
  }

  if (currentMarketValue <= soldPrice * 0.9) {
    return {
      code: "sold_ahead_of_decline",
      label: "Sold before the decline",
      differencePercent,
      currentMarketValue,
      preSalePeak,
    };
  }

  return {
    code: "right_on_time",
    label: "Sold at the right time",
    differencePercent,
    currentMarketValue,
    preSalePeak,
  };
}
