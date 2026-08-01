import {
  POKEMON_TCG_DATA_ADAPTER_ID,
  POKEMON_TCG_DATA_BUNDLE_SCHEMA,
  pokemonTcgDataSetBundleAdapter,
} from "./pokemon-tcg-data";
import type {
  ChecklistImportPlan,
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { buildChecklistSourceStorageReceipt } from "./storage";

export const POKEMON_TCG_DATA_SOURCE_ID_ADAPTER_VERSION = "1.0.1" as const;

type MutableCard = {
  id?: unknown;
  [key: string]: unknown;
};

type MutableBundle = {
  schema?: unknown;
  cards?: MutableCard[];
  data?: MutableCard[];
  [key: string]: unknown;
};

function artifactText(content: string | Uint8Array) {
  return typeof content === "string"
    ? content
    : Buffer.from(content).toString("utf8");
}

function safeSurrogate(index: number, sourceId: string) {
  return `tcos-source-${index}-${Buffer.from(sourceId, "utf8").toString("hex")}`;
}

function sourceKey(sourceId: string) {
  return `pokemon-card:${encodeURIComponent(sourceId)}`;
}

function makeSourceIdsSafe(artifact: ChecklistSourceArtifact) {
  const parsed = JSON.parse(artifactText(artifact.content)) as MutableBundle;
  const cards =
    parsed.schema === POKEMON_TCG_DATA_BUNDLE_SCHEMA && Array.isArray(parsed.cards)
      ? parsed.cards
      : Array.isArray(parsed.data)
        ? parsed.data
        : null;

  if (!cards) {
    return {
      artifact,
      originalBySurrogate: new Map<string, string>(),
    };
  }

  const originalBySurrogate = new Map<string, string>();
  const transformedCards = cards.map((card, index) => {
    const originalId = String(card?.id || "").trim();
    if (!originalId) return card;
    const surrogate = safeSurrogate(index, originalId);
    originalBySurrogate.set(surrogate, originalId);
    return { ...card, id: surrogate };
  });

  const transformed =
    parsed.schema === POKEMON_TCG_DATA_BUNDLE_SCHEMA
      ? { ...parsed, cards: transformedCards }
      : { ...parsed, data: transformedCards };

  return {
    artifact: {
      ...artifact,
      content: JSON.stringify(transformed),
    },
    originalBySurrogate,
  };
}

function restoreSourceIds(
  plan: ChecklistImportPlan,
  artifact: ChecklistSourceArtifact,
  originalBySurrogate: Map<string, string>,
) {
  const sourceKeyReplacements = new Map<string, string>();
  const seenSourceKeys = new Set<string>();

  for (const card of plan.cards) {
    let notes: Record<string, unknown> = {};
    try {
      notes = JSON.parse(card.sourceNotes || "{}") as Record<string, unknown>;
    } catch {
      notes = {};
    }

    const surrogate = String(notes.sourceCardId || "");
    const originalId = originalBySurrogate.get(surrogate);
    if (!originalId) continue;

    const previousSourceKey = card.sourceKey;
    const restoredSourceKey = sourceKey(originalId);
    if (seenSourceKeys.has(restoredSourceKey)) {
      throw new Error(`Duplicate Pokémon source ID after restoration: ${originalId}`);
    }
    seenSourceKeys.add(restoredSourceKey);
    sourceKeyReplacements.set(previousSourceKey, restoredSourceKey);

    card.sourceKey = restoredSourceKey;
    notes.sourceCardId = originalId;
    card.sourceNotes = JSON.stringify(notes);
  }

  for (const identity of plan.identities) {
    identity.cardSourceKey =
      sourceKeyReplacements.get(identity.cardSourceKey) || identity.cardSourceKey;
  }

  plan.adapterVersion = POKEMON_TCG_DATA_SOURCE_ID_ADAPTER_VERSION;
  plan.source.storage = buildChecklistSourceStorageReceipt({
    manufacturerSlug: "pokemon",
    releaseSlug: plan.release.releaseSlug,
    originalFilename: artifact.originalFilename,
    mimeType: artifact.mimeType,
    content: artifact.content,
  });

  return plan;
}

export const pokemonTcgDataSourceIdSafeAdapter: ChecklistSourceAdapter = {
  id: POKEMON_TCG_DATA_ADAPTER_ID,
  version: POKEMON_TCG_DATA_SOURCE_ID_ADAPTER_VERSION,
  supports(artifact) {
    return pokemonTcgDataSetBundleAdapter.supports(artifact);
  },
  parse(artifact) {
    const safe = makeSourceIdsSafe(artifact);
    const plan = pokemonTcgDataSetBundleAdapter.parse(safe.artifact);
    return restoreSourceIds(plan, artifact, safe.originalBySurrogate);
  },
};
