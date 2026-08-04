import type { InstaCompAiResult } from "./instacomp";
import {
  buildInstaCompListingIdentity,
  type InstaCompListingIdentity,
} from "./instacomp-copy-identity";
import {
  inscriptionDescriptionFact,
  inscriptionTitleToken,
  normalizeInstaCompInscriptionEvidence,
  type InstaCompUniversalInscriptionEvidence,
} from "./instacomp-inscription-evidence";

export type InstaCompAiInscriptionFields = {
  isInscribed?: boolean | null;
  inscriptionText?: string | null;
  inscriptionConfidence?: number | null;
};

export type InstaCompListingOutput = InstaCompListingIdentity & {
  universalInscription: InstaCompUniversalInscriptionEvidence;
  titleTokens: string[];
  sellerDescriptionFacts: string[];
  publicationStatus: "ready" | "review_required";
  publicationReviewReasons: string[];
};

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export function buildInstaCompListingOutput(params: {
  ai: InstaCompAiResult & InstaCompAiInscriptionFields;
  externalOcrText?: string | null;
  manualInscriptionText?: string | null;
}): InstaCompListingOutput {
  const base = buildInstaCompListingIdentity(params.ai);
  const universalInscription = normalizeInstaCompInscriptionEvidence({
    isAuto: params.ai.isAuto,
    parallel: params.ai.parallel,
    notes: params.ai.notes,
    externalOcrText: params.externalOcrText,
    aiIsInscribed: params.ai.isInscribed,
    aiInscriptionText: params.ai.inscriptionText,
    aiInscriptionConfidence: params.ai.inscriptionConfidence,
    manualInscriptionText: params.manualInscriptionText,
  });

  const titleTokens = unique([
    base.titleSuffix || null,
    inscriptionTitleToken(universalInscription),
  ]);
  const sellerDescriptionFacts = unique([
    ...base.descriptionFacts,
    inscriptionDescriptionFact(universalInscription),
  ]);
  const publicationReviewReasons = unique([
    ...base.inscription.reviewReasons,
    ...universalInscription.reviewReasons,
  ]);
  const publicationStatus =
    base.safeForAutomaticListing && publicationReviewReasons.length === 0
      ? "ready"
      : "review_required";

  return {
    ...base,
    titleSuffix: titleTokens.join(" "),
    descriptionFacts: sellerDescriptionFacts,
    universalInscription,
    titleTokens,
    sellerDescriptionFacts,
    publicationStatus,
    publicationReviewReasons,
    safeForAutomaticListing: publicationStatus === "ready",
  };
}

export function applyInstaCompListingOutput(params: {
  baseTitle: string;
  baseDescription?: string | null;
  output: InstaCompListingOutput;
}) {
  const title = [params.baseTitle.trim(), ...params.output.titleTokens]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const facts = params.output.sellerDescriptionFacts.map((fact) => `- ${fact}`);
  const description = [params.baseDescription?.trim(), facts.join("\n")]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return {
    title,
    description,
    publicationStatus: params.output.publicationStatus,
    reviewReasons: params.output.publicationReviewReasons,
  };
}
