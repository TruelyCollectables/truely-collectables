import type { InstaCompChecklistCandidate } from "./instacomp-checklist-first";

export const INSTACOMP_PARALLEL_PATTERNS = [
  "base",
  "solid_prizm",
  "velocity",
  "cracked_ice",
  "ice",
  "wave",
  "pulsar",
  "mojo",
  "shimmer",
  "disco",
  "scope",
  "laser",
  "sparkle",
  "hyper",
  "no_huddle",
  "fast_break",
  "checkerboard",
  "camo",
  "zebra",
  "tiger",
  "elephant",
  "snakeskin",
  "other",
  "uncertain",
] as const;

export type InstaCompParallelPattern =
  (typeof INSTACOMP_PARALLEL_PATTERNS)[number];

export const INSTACOMP_PARALLEL_COLORS = [
  "black",
  "black_white",
  "blue",
  "bronze",
  "brown",
  "gold",
  "green",
  "orange",
  "pink",
  "purple",
  "red",
  "silver",
  "teal",
  "white",
  "yellow",
] as const;

export type InstaCompParallelColor =
  (typeof INSTACOMP_PARALLEL_COLORS)[number];

export type InstaCompParallelVisualFeatures = {
  dominantColor: InstaCompParallelColor | null;
  pattern: InstaCompParallelPattern;
  serialStampPresent: boolean | null;
  serialStampText: string | null;
  serialRun: number | null;
  autographPresent: boolean | null;
  relicPresent: boolean | null;
  confidence: number;
  evidence: string[];
};

export type InstaCompParallelPatternDecision = {
  status: "resolved" | "ambiguous";
  selectedParallel: string | null;
  selectedIdentityId: string | null;
  confidence: number;
  evidence: string;
  candidateParallels: string[];
  features: InstaCompParallelVisualFeatures;
  matchedIdentityIds: string[];
  rejectionReasons: Record<string, string[]>;
};

type CandidateProfile = {
  candidate: InstaCompChecklistCandidate;
  label: string;
  color: InstaCompParallelColor | null;
  pattern: InstaCompParallelPattern;
  isBase: boolean;
};

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}/]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function boundedConfidence(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
}

function candidateLabel(candidate: InstaCompChecklistCandidate) {
  return String(candidate.parallel || "Base").trim() || "Base";
}

function candidateDescriptor(candidate: InstaCompChecklistCandidate) {
  return normalized(
    [candidate.parallel || "Base", candidate.variation]
      .filter(Boolean)
      .join(" "),
  );
}

function expectedColor(value: string): InstaCompParallelColor | null {
  if (/\bblack\s+(?:and\s+)?white\b/.test(value)) return "black_white";
  for (const color of INSTACOMP_PARALLEL_COLORS) {
    if (color === "black_white") continue;
    if (new RegExp(`\\b${color}\\b`).test(value)) return color;
  }
  return null;
}

function expectedPattern(
  value: string,
  isBase: boolean,
): InstaCompParallelPattern {
  if (isBase) return "base";
  if (/\bcracked\s+ice\b|\bice\s+cracked\b/.test(value)) {
    return "cracked_ice";
  }
  if (/\bvelocity\b/.test(value)) return "velocity";
  if (/\bno\s+huddle\b/.test(value)) return "no_huddle";
  if (/\bfast\s+break\b/.test(value)) return "fast_break";
  if (/\bcheckerboard\b/.test(value)) return "checkerboard";
  if (/\bsnakeskin\b/.test(value)) return "snakeskin";
  if (/\belephant\b/.test(value)) return "elephant";
  if (/\bzebra\b/.test(value)) return "zebra";
  if (/\btiger\b/.test(value)) return "tiger";
  if (/\bpulsar\b/.test(value)) return "pulsar";
  if (/\bmojo\b/.test(value)) return "mojo";
  if (/\bshimmer\b/.test(value)) return "shimmer";
  if (/\bdisco\b|\bcircles?\b/.test(value)) return "disco";
  if (/\bscope\b/.test(value)) return "scope";
  if (/\blaser\b/.test(value)) return "laser";
  if (/\bsparkle\b|\bglitter\b/.test(value)) return "sparkle";
  if (/\bhyper\b/.test(value)) return "hyper";
  if (/\bcamo\b|\bcamouflage\b/.test(value)) return "camo";
  if (/\bwave\b/.test(value)) return "wave";
  if (/\bice\b/.test(value)) return "ice";
  if (/\bprizm\b|\bprism\b|\brefractor\b|\bfoil\b/.test(value)) {
    return "solid_prizm";
  }
  return "other";
}

function profile(candidate: InstaCompChecklistCandidate): CandidateProfile {
  const label = candidateLabel(candidate);
  const descriptor = candidateDescriptor(candidate);
  const isBase =
    normalized(candidate.parallel) === "base" ||
    (!normalized(candidate.parallel) && !normalized(candidate.variation));
  return {
    candidate,
    label,
    color: expectedColor(descriptor),
    pattern: expectedPattern(descriptor, isBase),
    isBase,
  };
}

function serialCompatible(
  candidate: InstaCompChecklistCandidate,
  features: InstaCompParallelVisualFeatures,
  reasons: string[],
) {
  const expectedRun =
    Number.isFinite(Number(candidate.serialRun)) && Number(candidate.serialRun) > 0
      ? Number(candidate.serialRun)
      : null;

  if (features.serialStampPresent === true && features.serialRun == null) {
    reasons.push("serial_stamp_visible_but_denominator_unreadable");
    return false;
  }
  if (features.serialRun != null && expectedRun !== features.serialRun) {
    reasons.push(
      expectedRun == null
        ? "visible_serial_stamp_conflicts_with_unnumbered_candidate"
        : `serial_run_${features.serialRun}_does_not_match_${expectedRun}`,
    );
    return false;
  }
  if (features.serialStampPresent === false && expectedRun != null) {
    reasons.push("numbered_candidate_requires_visible_serial_stamp");
    return false;
  }
  if (features.serialStampPresent === null && expectedRun != null) {
    reasons.push("numbered_candidate_requires_certain_serial_evidence");
    return false;
  }
  return true;
}

function markerCompatible(
  candidate: InstaCompChecklistCandidate,
  features: InstaCompParallelVisualFeatures,
  reasons: string[],
) {
  if (
    features.autographPresent != null &&
    candidate.isAuto !== features.autographPresent
  ) {
    reasons.push("autograph_marker_mismatch");
  }
  if (
    features.relicPresent != null &&
    candidate.isRelic !== features.relicPresent
  ) {
    reasons.push("relic_marker_mismatch");
  }
  return reasons.length === 0;
}

function profileCompatible(
  candidateProfile: CandidateProfile,
  features: InstaCompParallelVisualFeatures,
) {
  const reasons: string[] = [];

  if (features.pattern === "uncertain" || features.pattern === "other") {
    reasons.push("visual_pattern_not_exact");
    return { compatible: false, reasons };
  }

  if (candidateProfile.isBase) {
    if (features.pattern !== "base") {
      reasons.push(`base_conflicts_with_visible_${features.pattern}_pattern`);
    }
    if (features.dominantColor) {
      reasons.push(`base_conflicts_with_visible_${features.dominantColor}_treatment`);
    }
    if (features.serialStampPresent !== false) {
      reasons.push("base_requires_confirmed_absence_of_serial_stamp");
    }
  } else {
    if (candidateProfile.pattern === "other") {
      reasons.push("checklist_parallel_has_no_supported_visual_signature");
    } else if (features.pattern !== candidateProfile.pattern) {
      reasons.push(
        `visible_${features.pattern}_does_not_match_${candidateProfile.pattern}`,
      );
    }

    if (candidateProfile.color) {
      if (features.dominantColor !== candidateProfile.color) {
        reasons.push(
          `visible_${features.dominantColor || "no_color"}_does_not_match_${candidateProfile.color}`,
        );
      }
    } else if (features.dominantColor) {
      reasons.push("visible_color_missing_from_checklist_parallel_name");
    }
  }

  serialCompatible(candidateProfile.candidate, features, reasons);
  markerCompatible(candidateProfile.candidate, features, reasons);
  return { compatible: reasons.length === 0, reasons };
}

function uniqueCandidates(candidates: InstaCompChecklistCandidate[]) {
  const byId = new Map<string, InstaCompChecklistCandidate>();
  for (const candidate of candidates) {
    if (candidate.identityId) byId.set(candidate.identityId, candidate);
  }
  return [...byId.values()];
}

export function resolveChecklistParallelFromVisualFeatures(params: {
  candidates: InstaCompChecklistCandidate[];
  features: InstaCompParallelVisualFeatures;
}): InstaCompParallelPatternDecision {
  const candidates = uniqueCandidates(params.candidates);
  const features: InstaCompParallelVisualFeatures = {
    ...params.features,
    confidence: boundedConfidence(params.features.confidence),
    evidence: Array.isArray(params.features.evidence)
      ? params.features.evidence.map(String).filter(Boolean).slice(0, 20)
      : [],
  };
  const candidateParallels = Array.from(
    new Set(candidates.map(candidateLabel)),
  );
  const matched: CandidateProfile[] = [];
  const rejectionReasons: Record<string, string[]> = {};

  for (const candidate of candidates) {
    const candidateProfile = profile(candidate);
    const result = profileCompatible(candidateProfile, features);
    if (result.compatible) matched.push(candidateProfile);
    else rejectionReasons[candidate.identityId] = result.reasons;
  }

  const selected = matched.length === 1 ? matched[0] : null;
  const requiredConfidence = selected?.isBase ? 0.92 : 0.82;
  const resolved = Boolean(selected && features.confidence >= requiredConfidence);
  const featureSummary = [
    `color=${features.dominantColor || "none"}`,
    `pattern=${features.pattern}`,
    `serial=${features.serialStampText || (features.serialStampPresent === false ? "none" : "uncertain")}`,
    `confidence=${features.confidence.toFixed(2)}`,
  ].join(", ");

  return {
    status: resolved ? "resolved" : "ambiguous",
    selectedParallel: resolved ? selected?.label || null : null,
    selectedIdentityId: resolved
      ? selected?.candidate.identityId || null
      : null,
    confidence: features.confidence,
    evidence: resolved
      ? `Visible feature match resolved ${selected?.label}. ${featureSummary}. ${features.evidence.join(" ")}`.trim()
      : `No single checklist identity passed the strict visible-feature gate. ${featureSummary}. ${features.evidence.join(" ")}`.trim(),
    candidateParallels,
    features,
    matchedIdentityIds: matched.map((entry) => entry.candidate.identityId),
    rejectionReasons,
  };
}
