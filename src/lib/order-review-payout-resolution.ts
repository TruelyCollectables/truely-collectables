const noteRequiredPayoutResolutionActions = new Set([
  "release_to_seller",
  "reverse_for_buyer",
  "cancel_no_payout",
]);

export function cleanOrderReviewPayoutResolutionNote(value: unknown) {
  const text = String(value || "").trim();
  return text.length > 0 ? text.slice(0, 1000) : null;
}

export function orderReviewPayoutResolutionRequirements(params: {
  action: string | null | undefined;
  adminNote: unknown;
}) {
  const missing: string[] = [];
  const action = String(params.action || "").trim();
  const adminNote = cleanOrderReviewPayoutResolutionNote(params.adminNote);

  if (
    noteRequiredPayoutResolutionActions.has(action) &&
    (!adminNote || adminNote.length < 8)
  ) {
    missing.push("audit note");
  }

  return missing;
}
