/**
 * REDO cards have an explicitly reviewed Mac-authoritative listing title.
 * Don't display obsolete parser/AI/Registry titles over that saved value.
 * Seller-locked manual titles remain highest priority. Other queues keep
 * the previous Registry/AI precedence. Display changes never confer publishability.
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
    !/^REDO PENDING RESALE\b/i.test(input.rawTitle)
      ? input.rawTitle
      : null;
  return (
    input.manualListingTitle ||
    reviewedRedoTitle ||
    input.registryExactTitle ||
    input.generatedTitle ||
    (input.rawTitle && !input.rawIsGeneric ? input.rawTitle : null) ||
    input.identityReadout ||
    input.identitySummary ||
    input.rawTitle ||
    "Untitled item"
  );
}
