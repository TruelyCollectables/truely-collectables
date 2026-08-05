export type InstaCompPendingDraftContent = {
  title: string;
  description: string | null;
  condition: string | null;
  quantity: number;
};

type PendingEditAudit = {
  editedAt: string;
  editedBy: string | null;
  titleChanged: boolean;
  descriptionChanged: boolean;
  quantityChanged: boolean;
  previous: InstaCompPendingDraftContent;
  next: InstaCompPendingDraftContent;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanTitle(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDescription(value: unknown) {
  const normalized = String(value ?? "").normalize("NFKC").trim();
  return normalized || null;
}

function cleanCondition(value: unknown) {
  const normalized = cleanTitle(value);
  return normalized || null;
}

function positiveQuantity(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("Pending draft quantity must be a positive integer.");
  }
  return parsed;
}

function contentFrom(value: unknown): InstaCompPendingDraftContent | null {
  const row = recordValue(value);
  const title = cleanTitle(row.title);
  if (!title) return null;
  return {
    title,
    description: cleanDescription(row.description),
    condition: cleanCondition(row.condition),
    quantity: positiveQuantity(row.quantity || 1),
  };
}

function channelContent(content: InstaCompPendingDraftContent) {
  return {
    title: content.title,
    description: content.description || "",
    condition: content.condition || "Ungraded",
    quantity: content.quantity,
  };
}

export function synchronizeInstaCompPendingDraftMetadata(params: {
  metadata: unknown;
  previous: InstaCompPendingDraftContent;
  next: InstaCompPendingDraftContent;
  editedAt: string;
  editedBy?: string | null;
}) {
  const metadata = recordValue(params.metadata);
  const instaComp = recordValue(metadata.instacomp);
  const existingChannelDraft = recordValue(instaComp.channelDraft);
  const existingCanonical = contentFrom(existingChannelDraft.canonical);
  const normalizedNext: InstaCompPendingDraftContent = {
    title: cleanTitle(params.next.title),
    description: cleanDescription(params.next.description),
    condition:
      cleanCondition(params.next.condition) ||
      cleanCondition(existingCanonical?.condition) ||
      cleanCondition(params.previous.condition) ||
      "Ungraded",
    quantity: positiveQuantity(params.next.quantity),
  };
  if (!normalizedNext.title) throw new Error("Title is required.");

  const normalizedPrevious: InstaCompPendingDraftContent = {
    title: cleanTitle(params.previous.title),
    description: cleanDescription(params.previous.description),
    condition:
      cleanCondition(params.previous.condition) ||
      cleanCondition(existingCanonical?.condition),
    quantity: positiveQuantity(params.previous.quantity),
  };
  const audit: PendingEditAudit = {
    editedAt: params.editedAt,
    editedBy: params.editedBy || null,
    titleChanged: normalizedPrevious.title !== normalizedNext.title,
    descriptionChanged:
      normalizedPrevious.description !== normalizedNext.description,
    quantityChanged: normalizedPrevious.quantity !== normalizedNext.quantity,
    previous: normalizedPrevious,
    next: normalizedNext,
  };

  const existingEdits = Array.isArray(metadata.seller_edits)
    ? metadata.seller_edits.slice(-24)
    : [];
  const canonical = channelContent(normalizedNext);
  const nextChannelDraft = Object.keys(existingChannelDraft).length
    ? {
        ...existingChannelDraft,
        canonical,
        website: { ...canonical },
        ebay: { ...canonical },
        contentParity: true,
        sellerReviewRequired: true,
        executableByInstaComp: false,
        sellerEditedAt: params.editedAt,
      }
    : existingChannelDraft;
  const sellerReview = recordValue(metadata.seller_review);

  return {
    ...metadata,
    instacomp: {
      ...instaComp,
      channelDraft: nextChannelDraft,
      sellerEditedDraft: {
        schemaVersion: "tcos.instacomp.seller-edited-draft.v1",
        title: normalizedNext.title,
        description: normalizedNext.description,
        condition: normalizedNext.condition,
        quantity: normalizedNext.quantity,
        editedAt: params.editedAt,
        editedBy: params.editedBy || null,
        websiteEbayParity: true,
      },
    },
    seller_review: {
      ...sellerReview,
      identity_confirmed: false,
      confirmed_at: null,
      confirmed_by: null,
      confirmed_account_id: null,
      reset_at: params.editedAt,
      reset_reason: "seller_draft_edited",
    },
    seller_edits: [...existingEdits, audit],
  };
}
