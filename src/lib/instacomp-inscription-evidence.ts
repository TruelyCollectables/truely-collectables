export type InstaCompInscriptionSource =
  | "ai_scan"
  | "ocr"
  | "checklist_rule"
  | "manual"
  | "none";

export type InstaCompUniversalInscriptionEvidence = {
  isInscribed: boolean;
  inscriptionText: string | null;
  confidence: number | null;
  source: InstaCompInscriptionSource;
  status: "confirmed" | "suspected_unreadable" | "not_observed";
  reviewReasons: string[];
};

export type InstaCompInscriptionEvidenceInput = {
  isAuto?: boolean | null;
  parallel?: string | null;
  notes?: string | null;
  externalOcrText?: string | null;
  aiIsInscribed?: boolean | null;
  aiInscriptionText?: string | null;
  aiInscriptionConfidence?: number | null;
  manualInscriptionText?: string | null;
};

function clean(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function safeConfidence(value: number | null | undefined) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, Number(value)));
}

function inscriptionFromLabeledText(value: string | null | undefined) {
  const source = clean(value);
  if (!source) return null;

  const patterns = [
    /\b(?:hand[- ]?inscribed|inscription|inscribed|inscription text|signed with)\s*[:\-]\s*["']?([^;|\n]+?)["']?(?=$|[;|])/i,
    /\b(?:nickname|message)\s+inscription\s*[:\-]\s*["']?([^;|\n]+?)["']?(?=$|[;|])/i,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    const candidate = clean(match?.[1]);
    if (candidate) return candidate;
  }
  return null;
}

function inscriptionSignal(value: string | null | undefined) {
  return /\b(inscribed|inscription|hand[- ]?written message|signed with inscription)\b/i.test(
    clean(value),
  );
}

function plausibleInscription(value: string | null | undefined) {
  const candidate = clean(value);
  if (!candidate || candidate.length > 120) return null;
  if (/^(?:unknown|unreadable|illegible|unclear|n\/a|none)$/i.test(candidate)) {
    return null;
  }
  return candidate;
}

export function normalizeInstaCompInscriptionEvidence(
  input: InstaCompInscriptionEvidenceInput,
): InstaCompUniversalInscriptionEvidence {
  const manual = plausibleInscription(input.manualInscriptionText);
  if (manual) {
    return {
      isInscribed: true,
      inscriptionText: manual,
      confidence: 1,
      source: "manual",
      status: "confirmed",
      reviewReasons: [],
    };
  }

  const aiText = plausibleInscription(input.aiInscriptionText);
  const aiConfidence = safeConfidence(input.aiInscriptionConfidence);
  if (aiText && (input.aiIsInscribed !== false)) {
    const confirmed = (aiConfidence ?? 0.9) >= 0.82;
    return {
      isInscribed: true,
      inscriptionText: aiText,
      confidence: aiConfidence ?? 0.9,
      source: "ai_scan",
      status: confirmed ? "confirmed" : "suspected_unreadable",
      reviewReasons: confirmed ? [] : ["inscription_text_low_confidence"],
    };
  }

  const notesText = inscriptionFromLabeledText(input.notes);
  if (notesText) {
    return {
      isInscribed: true,
      inscriptionText: notesText,
      confidence: aiConfidence ?? 0.9,
      source: "ai_scan",
      status: "confirmed",
      reviewReasons: [],
    };
  }

  const ocrText = inscriptionFromLabeledText(input.externalOcrText);
  if (ocrText) {
    return {
      isInscribed: true,
      inscriptionText: ocrText,
      confidence: aiConfidence ?? 0.85,
      source: "ocr",
      status: "confirmed",
      reviewReasons: [],
    };
  }

  const observedSignal = Boolean(
    input.aiIsInscribed ||
      inscriptionSignal(input.notes) ||
      inscriptionSignal(input.parallel) ||
      inscriptionSignal(input.externalOcrText),
  );
  if (observedSignal) {
    return {
      isInscribed: true,
      inscriptionText: null,
      confidence: aiConfidence,
      source: input.aiIsInscribed ? "ai_scan" : "ocr",
      status: "suspected_unreadable",
      reviewReasons: ["inscription_observed_but_text_unreadable"],
    };
  }

  return {
    isInscribed: false,
    inscriptionText: null,
    confidence: null,
    source: "none",
    status: "not_observed",
    reviewReasons: [],
  };
}

export function inscriptionTitleToken(
  evidence: InstaCompUniversalInscriptionEvidence,
) {
  return evidence.status === "confirmed" ? "Inscribed" : null;
}

export function inscriptionDescriptionFact(
  evidence: InstaCompUniversalInscriptionEvidence,
) {
  if (evidence.status !== "confirmed" || !evidence.inscriptionText) return null;
  return `Hand inscription: ${evidence.inscriptionText}`;
}
