import {
  getInstaCompCapability,
  type InstaCompCapability,
} from "./instacomp-capabilities";
import type { InstaCompRegistryIdentityReceipt } from "./instacomp-research-contract";

export type KingmakerSellerAction =
  | "create_inventory_draft"
  | "change_listing_price"
  | "publish_listing"
  | "accept_offer"
  | "send_seller_message"
  | "change_order_status"
  | "delete_inventory";

export type KingmakerExecutionAuthorization = {
  action: KingmakerSellerAction;
  sellerAuthenticated: boolean;
  sellerAuthorized: boolean;
  sellerApproved: boolean;
  readinessBlockers: string[];
  registryIdentity: InstaCompRegistryIdentityReceipt | null;
};

export function assertCanonicalRegistryIdentity(
  receipt: InstaCompRegistryIdentityReceipt | null,
): InstaCompRegistryIdentityReceipt {
  if (!receipt?.identityId.trim() || !receipt.fingerprint.trim()) {
    throw new Error("CHECKLIST_IDENTITY_REQUIRED");
  }
  if (!receipt.lockedAt.trim() || !receipt.schemaVersion.trim()) {
    throw new Error("CHECKLIST_RECEIPT_INCOMPLETE");
  }
  return receipt;
}

export function assertInstaCompResearchBoundary(params: {
  capability: InstaCompCapability;
  registryIdentity: InstaCompRegistryIdentityReceipt | null;
}) {
  const definition = getInstaCompCapability(params.capability);
  if (definition.sellerMutationAllowed !== false) {
    throw new Error("INSTACOMP_SELLER_MUTATION_FORBIDDEN");
  }
  if (definition.identityRequired) {
    assertCanonicalRegistryIdentity(params.registryIdentity);
  }
  return definition;
}

export function assertKingmakerExecutionBoundary(
  authorization: KingmakerExecutionAuthorization,
) {
  if (!authorization.sellerAuthenticated) {
    throw new Error("SELLER_AUTHENTICATION_REQUIRED");
  }
  if (!authorization.sellerAuthorized) {
    throw new Error("SELLER_PERMISSION_REQUIRED");
  }
  if (!authorization.sellerApproved) {
    throw new Error("SELLER_APPROVAL_REQUIRED");
  }
  if (authorization.readinessBlockers.length > 0) {
    throw new Error("LISTING_READINESS_BLOCKED");
  }
  if (
    authorization.action === "publish_listing" ||
    authorization.action === "change_listing_price"
  ) {
    assertCanonicalRegistryIdentity(authorization.registryIdentity);
  }
  return authorization;
}
