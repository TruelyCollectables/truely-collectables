/**
 * REDO cards and verified inventory have an explicitly reviewed Mac-authoritative listing title.
 * The stored clean title takes precedence over obsolete parser/AI/Registry checklist titles.
 * Seller-locked manual titles remain highest priority. Display changes never confer publishability.
 */
export function kingmakerPendingDisplayTitle(input: {
  queue: string;
  rawTitle: string | null;
  rawIsGeneric: boolean;
  manualListingTitle: string | null;
  registryExactTitle: string | null;
  generatedTitle: string | null;
  identityReadout: string | null;
  identitySummary: string | null;
}): string {
  const reviewedRedoTitle =
    input.queue === "redo_pending_resale" &&
    input.rawTitle &&
    !input.rawIsGeneric &&
    !/^REDO PENDING RESALE/i.test(input.rawTitle)
      ? input.rawTitle
      : null;

  const validRawTitle =
    input.rawTitle && !input.rawIsGeneric
      ? input.rawTitle
      : null;

  return (
    input.manualListingTitle ||
    reviewedRedoTitle ||
    validRawTitle ||
    input.registryExactTitle ||
    input.generatedTitle ||
    input.identityReadout ||
    input.identitySummary ||
    input.rawTitle ||
    "Untitled item"
  );
}
