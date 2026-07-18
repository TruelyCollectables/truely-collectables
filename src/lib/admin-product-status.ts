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

export function adminProductStatusChangeError(params: {
  productId: unknown;
  status: unknown;
}) {
  if (!parseAdminProductId(params.productId)) {
    return "Invalid product ID.";
  }

  if (!parseAdminInventoryStatus(params.status)) {
    return "Unsupported inventory status.";
  }

  return null;
}
