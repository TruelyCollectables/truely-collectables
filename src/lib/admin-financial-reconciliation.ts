export type FinancialReconciliationDecisionStatus = "resolved" | "ignored";

export const FINANCIAL_RECONCILIATION_NOTE_MIN_LENGTH = 8;

export function cleanFinancialReconciliationNote(value: unknown) {
  const note = String(value || "").trim();
  return note ? note.slice(0, 1000) : null;
}

export function parseFinancialReconciliationDecisionStatus(value: unknown) {
  const status = String(value || "").trim();
  return status === "resolved" || status === "ignored" ? status : null;
}

export function financialReconciliationDecisionRequirements(params: {
  itemId?: unknown;
  status?: unknown;
  resolutionNote?: unknown;
}) {
  const missing: string[] = [];
  const itemId = String(params.itemId || "").trim();
  const status = parseFinancialReconciliationDecisionStatus(params.status);
  const resolutionNote = cleanFinancialReconciliationNote(params.resolutionNote);

  if (!itemId) missing.push("reconciliation item");
  if (!status) missing.push("resolution status");
  if (!resolutionNote) {
    missing.push("audit note");
  } else if (resolutionNote.length < FINANCIAL_RECONCILIATION_NOTE_MIN_LENGTH) {
    missing.push(
      `audit note of at least ${FINANCIAL_RECONCILIATION_NOTE_MIN_LENGTH} characters`,
    );
  }

  return Array.from(new Set(missing));
}

export function financialReconciliationDecisionError(params: {
  itemId?: unknown;
  status?: unknown;
  resolutionNote?: unknown;
}) {
  const missing = financialReconciliationDecisionRequirements(params);

  return missing.length
    ? `Reconciliation decision needs: ${missing.join(", ")}.`
    : null;
}
