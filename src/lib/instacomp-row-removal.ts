export type InstaCompBatchRowRemovalInput = {
  batchDrafting?: boolean;
  draftStatus?: string | null;
  isRemoving?: boolean;
};

export function instaCompBatchRowRemovalBlockedReason({
  batchDrafting = false,
  draftStatus = null,
  isRemoving = false,
}: InstaCompBatchRowRemovalInput) {
  if (isRemoving) {
    return "This InstaComp™ row is already being removed.";
  }

  if (batchDrafting) {
    return "Finish or stop draft creation before removing an InstaComp™ row.";
  }

  if (draftStatus === "drafting") {
    return "This row is creating a draft right now. Remove it after drafting finishes.";
  }

  return null;
}

export function canRemoveInstaCompBatchRow(input: InstaCompBatchRowRemovalInput) {
  return !instaCompBatchRowRemovalBlockedReason(input);
}

export function instaCompBatchRowRemovalLabel({
  operatorMarkedWrong = false,
  status,
  isRemoving = false,
}: {
  operatorMarkedWrong?: boolean;
  status?: string | null;
  isRemoving?: boolean;
}) {
  if (isRemoving) return "Removing...";
  if (operatorMarkedWrong) return "Remove Wrong Row";
  if (status === "scanning") return "End / Remove";
  return "Remove";
}
