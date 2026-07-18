export function adminBulkDescriptionBlockedReason({
  description,
  productCount,
  selectedCount,
}: {
  description: string;
  productCount: number;
  selectedCount: number;
}) {
  if (productCount <= 0) {
    return "No products are loaded for bulk description updates.";
  }

  if (selectedCount <= 0) {
    return "Select at least one product before applying a bulk description.";
  }

  if (!description.trim()) {
    return "Paste description text before applying it to selected products.";
  }

  return null;
}

export function adminBulkDescriptionSubmitLabel({
  pending,
  selectedCount,
}: {
  pending: boolean;
  selectedCount: number;
}) {
  if (pending) {
    return `Saving descriptions for ${selectedCount} selected product${
      selectedCount === 1 ? "" : "s"
    }...`;
  }

  return `Apply To Selected (${selectedCount})`;
}

export function adminBulkDescriptionSelectionSummary({
  filteredCount,
  productCount,
  selectedCount,
}: {
  filteredCount: number;
  productCount: number;
  selectedCount: number;
}) {
  return `${selectedCount} selected · showing ${filteredCount}/${productCount}`;
}
