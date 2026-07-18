import type { InventoryStatus } from "../modules/inventory";

export const ADMIN_INVENTORY_STATUSES: InventoryStatus[] = [
  "draft",
  "active",
  "reserved",
  "sold",
  "archived",
];

export function parseAdminProductId(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function parseAdminInventoryStatus(value: unknown) {
  const status = String(value || "").trim() as InventoryStatus;
  return ADMIN_INVENTORY_STATUSES.includes(status) ? status : null;
}

export function adminProductStatusRequiresStock(status: InventoryStatus) {
  return status === "active" || status === "reserved";
}

export function adminProductStatusZeroesQuantity(status: InventoryStatus) {
  return status === "sold" || status === "archived";
}

export function adminProductStatusNormalizedQuantity(params: {
  quantity: unknown;
  status: InventoryStatus;
}) {
  if (adminProductStatusZeroesQuantity(params.status)) {
    return 0;
  }

  const parsed = Number(params.quantity || 0);

  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function adminProductStatusPendingLabel(status: InventoryStatus) {
  if (status === "active") return "Setting active...";
  if (status === "reserved") return "Reserving...";
  if (status === "sold") return "Marking sold out...";
  if (status === "archived") return "Ending item...";
  return "Updating status...";
}

export function adminProductStatusSuccessMessage(status: InventoryStatus) {
  if (status === "active") {
    return "Product is active and available anywhere inventory status + quantity allow it.";
  }

  if (status === "reserved") {
    return "Product is reserved and removed from normal buyer availability.";
  }

  if (status === "sold") {
    return "Product is marked sold and quantity was set to 0.";
  }

  if (status === "archived") {
    return "Product was ended/archived, removed from active inventory, and quantity was set to 0.";
  }

  return "Product status updated.";
}

export function adminProductStatusChangeError(params: {
  productId: unknown;
  status: unknown;
  quantity?: unknown;
}) {
  const status = parseAdminInventoryStatus(params.status);

  if (!parseAdminProductId(params.productId)) {
    return "Invalid product ID.";
  }

  if (!status) {
    return "Unsupported inventory status.";
  }

  if (
    params.quantity !== undefined &&
    adminProductStatusRequiresStock(status) &&
    Number(params.quantity || 0) <= 0
  ) {
    return "Set quantity to at least 1 before marking this product active or reserved.";
  }

  return null;
}
