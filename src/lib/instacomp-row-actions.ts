export type InstaCompBatchRowAction =
  | "saving_corrections"
  | "refreshing_comps"
  | null;

export function instaCompBatchRowActionLabel({
  action,
  fallback,
}: {
  action: InstaCompBatchRowAction;
  fallback: string;
}) {
  if (action === "saving_corrections") return "Saving Corrections...";
  if (action === "refreshing_comps") return "Refreshing Comps...";
  return fallback;
}
