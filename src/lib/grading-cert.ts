export type GradingDetectionInput = {
  gradingCompany?: unknown;
  gradeValue?: unknown;
  certificationNumber?: unknown;
  certificationLookupUrl?: unknown;
  evidence?: unknown;
  conditionGuess?: unknown;
  notes?: unknown;
};

export type GradingDetectionResult = {
  gradingCompany: string | null;
  gradeValue: string | null;
  certificationNumber: string | null;
  certificationLookupUrl: string | null;
  evidence: string | null;
};

const GRADING_COMPANIES = [
  {
    canonical: "PSA",
    patterns: [/\bpsa\b/i, /professional\s+sports\s+authenticator/i],
  },
  {
    canonical: "BGS",
    patterns: [/\bbgs\b/i, /\bbeckett\b/i, /\bbvg\b/i, /\bbccg\b/i],
  },
  {
    canonical: "SGC",
    patterns: [/\bsgc\b/i, /sportscard\s+guaranty/i],
  },
  {
    canonical: "CGC",
    patterns: [/\bcgc\b/i, /\bcsg\b/i, /certified\s+guaranty/i],
  },
  {
    canonical: "HGA",
    patterns: [/\bhga\b/i, /hybrid\s+grading/i],
  },
  {
    canonical: "Degree",
    patterns: [/\bdegree\b/i, /degree\s+grading/i],
  },
  {
    canonical: "TAG",
    patterns: [/\btag\b/i, /tag\s+grading/i],
  },
  {
    canonical: "C3",
    patterns: [/\bc3\b/i, /c3\s+grading/i],
  },
  {
    canonical: "Arena Club",
    patterns: [/\barena\s+club\b/i],
  },
];

function cleanNullable(value: unknown, maxLength = 120) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const cleaned = String(value).replace(/\s+/g, " ").trim();

  return cleaned ? cleaned.slice(0, maxLength) : null;
}

export function normalizeGradingCompany(value: unknown) {
  const text = cleanNullable(value, 80);

  if (!text) return null;

  for (const company of GRADING_COMPANIES) {
    if (company.patterns.some((pattern) => pattern.test(text))) {
      return company.canonical;
    }
  }

  return text.length <= 24 ? text : null;
}

export function cleanGradeValue(value: unknown) {
  const text = cleanNullable(value, 40);

  if (!text) return null;

  const authentic = text.match(/\b(authentic|auth)\b/i)?.[1];

  if (authentic) return "Authentic";

  const score =
    text.match(/\b(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5\.5|5|4\.5|4|3\.5|3|2\.5|2|1\.5|1)\b/)?.[1] ||
    text.match(/\b(\d{3,4})\b/)?.[1];

  return score || text;
}

export function cleanCertificationNumber(value: unknown) {
  const text = cleanNullable(value, 80);

  if (!text) return null;

  const cleaned = text
    .replace(/^(cert(?:ification)?|cert\s*#|cert\s*no\.?|serial\s*#|serial\s*no\.?)\s*:?\s*/i, "")
    .replace(/[^a-z0-9-]/gi, "")
    .toUpperCase();

  if (cleaned.length < 5 || cleaned.length > 24) return null;

  return cleaned;
}

export function gradingLookupUrl(
  gradingCompany: string | null | undefined,
  certificationNumber?: string | null
) {
  const company = normalizeGradingCompany(gradingCompany);
  const cert = cleanCertificationNumber(certificationNumber);

  if (company === "PSA") {
    return cert
      ? `https://www.psacard.com/cert/${encodeURIComponent(cert)}/psa`
      : "https://www.psacard.com/cert";
  }

  if (company === "BGS") {
    return "https://www.beckett.com/grading/card-lookup";
  }

  if (company === "SGC") {
    return "https://gosgc.com/cert-code-lookup";
  }

  if (company === "CGC") {
    return "https://www.cgccards.com/certlookup";
  }

  if (company === "Degree") {
    return "https://degreegrading.com/certification-lookup/";
  }

  if (company === "TAG") {
    return "https://taggrading.com/pages/grading";
  }

  return null;
}

function detectCompany(text: string) {
  for (const company of GRADING_COMPANIES) {
    if (company.patterns.some((pattern) => pattern.test(text))) {
      return company.canonical;
    }
  }

  return null;
}

function detectGradeValue(text: string) {
  const gradePatterns = [
    /\b(?:gem\s+mint|mint|nm-mt|near\s+mint|pristine)?\s*(?:grade|graded)?\s*(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5\.5|5|4\.5|4|3\.5|3|2\.5|2|1\.5|1)\b/i,
    /\b(?:psa|bgs|sgc|cgc|csg|degree)\s*(10|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5\.5|5|4\.5|4|3\.5|3|2\.5|2|1\.5|1)\b/i,
    /\btag\s*(\d{3,4})\b/i,
    /\b(authentic)\b/i,
  ];

  for (const pattern of gradePatterns) {
    const match = text.match(pattern);
    if (match?.[1]) return cleanGradeValue(match[1]);
  }

  return null;
}

function detectCertificationNumber(text: string) {
  const certPatterns = [
    /\b(?:cert(?:ification)?|cert\s*#|cert\s*no\.?|certificate|serial\s*#|verification\s*#)\s*[:#]?\s*([a-z]?\d[a-z0-9-]{5,22})\b/i,
    /\b(?:psa|bgs|sgc|cgc|csg|hga|degree|tag)\s+(?:cert(?:ification)?\s*)?(?:#|no\.?)?\s*([a-z]?\d[a-z0-9-]{5,22})\b/i,
  ];

  for (const pattern of certPatterns) {
    const match = text.match(pattern);
    const cert = cleanCertificationNumber(match?.[1]);
    if (cert) return cert;
  }

  return null;
}

export function detectGradingDetails(
  text: string | null | undefined,
  input: GradingDetectionInput = {}
): GradingDetectionResult {
  const combinedText = [
    text,
    cleanNullable(input.conditionGuess, 160),
    cleanNullable(input.notes, 600),
    cleanNullable(input.evidence, 600),
  ]
    .filter(Boolean)
    .join(" ");

  const gradingCompany =
    normalizeGradingCompany(input.gradingCompany) || detectCompany(combinedText);
  const gradeValue =
    cleanGradeValue(input.gradeValue) ||
    (gradingCompany ? detectGradeValue(combinedText) : null);
  const certificationNumber =
    cleanCertificationNumber(input.certificationNumber) ||
    (gradingCompany ? detectCertificationNumber(combinedText) : null);
  const certificationLookupUrl =
    cleanNullable(input.certificationLookupUrl, 300) ||
    gradingLookupUrl(gradingCompany, certificationNumber);
  const evidenceParts = [
    gradingCompany ? `grader ${gradingCompany}` : null,
    gradeValue ? `grade ${gradeValue}` : null,
    certificationNumber ? `cert ${certificationNumber}` : null,
  ].filter(Boolean);

  return {
    gradingCompany,
    gradeValue,
    certificationNumber,
    certificationLookupUrl,
    evidence: evidenceParts.length ? evidenceParts.join("; ") : null,
  };
}

export function gradingSearchPart(input: GradingDetectionInput) {
  const company = normalizeGradingCompany(input.gradingCompany);
  const grade = cleanGradeValue(input.gradeValue);

  return [company, grade].filter(Boolean).join(" ").trim();
}
