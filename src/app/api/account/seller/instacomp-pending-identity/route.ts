import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function textValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function booleanValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "yes", "1", "auto", "autograph", "relic", "memorabilia"].includes(normalized)) return true;
      if (["false", "no", "0", "none", "base"].includes(normalized)) return false;
    }
  }
  return null;
}

function positiveInteger(...values: unknown[]) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function textList(value: unknown, limit = 50) {
  return Array.isArray(value)
    ? value
        .map((entry) => textValue(entry))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, limit)
    : [];
}

function buildIdentitySummary(fields: Record<string, unknown>) {
  const year = textValue(fields.year);
  const manufacturer = textValue(fields.manufacturer) || textValue(fields.brand);
  const setName = textValue(fields.setName) || textValue(fields.product);
  const cardNumber = textValue(fields.cardNumber) || textValue(fields.card_number);
  const player = textValue(fields.player) || textValue(fields.playerName);
  const team = textValue(fields.team);
  const variation =
    textValue(fields.variation) ||
    textValue(fields.parallel) ||
    textValue(fields.checklistParallel) ||
    textValue(fields.parallelName);
  const pieces = [
    year,
    manufacturer,
    setName,
    cardNumber ? `#${cardNumber}` : null,
    player,
    team ? `(${team})` : null,
  ].filter(Boolean);
  const summary = pieces.join(" ").replace(/\s+/g, " ").trim();
  return summary
    ? [
        `Card read: ${summary}.`,
        variation ? `Surface variation: ${variation}.` : null,
      ]
        .filter(Boolean)
        .join(" ")
    : null;
}

function collectEvidenceTexts(metadata: JsonRecord) {
  const instaComp = recordValue(metadata.instacomp);
  const ai = recordValue(instaComp.ai);
  const macReceipt = recordValue(instaComp.macReceipt);
  const imageOrientation = recordValue(instaComp.imageOrientation);
  const coreVisualEvidence = recordValue(instaComp.coreVisualEvidence);

  const texts = [
    textValue(instaComp.identitySummary),
    textValue(coreVisualEvidence.identitySummary),
    textValue(coreVisualEvidence.reason),
    textValue(imageOrientation.reason),
    textValue(macReceipt.reason),
    ...textList(ai.frontVisibleText),
    ...textList(ai.backVisibleText),
    ...textList(coreVisualEvidence.frontVisibleText),
    ...textList(coreVisualEvidence.backVisibleText),
    ...textList(imageOrientation.frontEvidenceText),
    ...textList(imageOrientation.backEvidenceText),
    ...textList(recordValue(macReceipt.imageOrientation).front_evidence),
    ...textList(recordValue(macReceipt.imageOrientation).back_evidence),
    ...textList(recordValue(macReceipt.imageOrientation).frontEvidenceText),
    ...textList(recordValue(macReceipt.imageOrientation).backEvidenceText),
    ...textList(instaComp.exactMarketQueries),
    ...textList(Object.values(recordValue(instaComp.sourceLinks))),
    textValue(metadata.title),
    textValue(metadata.description),
    textValue(instaComp.exactStoredTitleQuery),
    textValue(instaComp.fallbackIdentityQuery),
    textValue(recordValue(metadata.collectible_asset).title),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(new Set(texts));
}

function inferManufacturer(texts: string[]) {
  const combined = texts.join(" ").toLowerCase();
  for (const [needle, canonical] of Object.entries({
    panini: "Panini",
    topps: "Topps",
    bowman: "Bowman",
    "upper deck": "Upper Deck",
    leaf: "Leaf",
    donruss: "Donruss",
    fleer: "Fleer",
    score: "Score",
    "o-pee-chee": "O-Pee-Chee",
    "o pee chee": "O-Pee-Chee",
  })) {
    if (combined.includes(needle)) return canonical;
  }
  return null;
}

function inferYear(texts: string[]) {
  const scores = new Map<number, number>();
  for (const rawText of texts) {
    const text = rawText.toLowerCase();
    const hasManufacturer = ["panini", "topps", "bowman", "upper deck", "leaf", "donruss", "fleer", "score"].some((needle) =>
      text.includes(needle),
    );
    const hasProduct = ["prizm", "select", "optic", "mosaic", "chrome", "basketball", "baseball", "football", "hockey", "wnba", "nba"].some((needle) =>
      text.includes(needle),
    );
    for (const match of rawText.matchAll(/\b((?:19|20)\d{2})\b/g)) {
      const year = Number(match[1]);
      if (year < 1900 || year > 2035) continue;
      let score = 1;
      if (hasManufacturer) score += 4;
      if (hasProduct) score += 2;
      if (text.includes("copyright") || text.includes("licensed product") || text.includes("official")) score += 1;
      scores.set(year, (scores.get(year) || 0) + score);
    }
  }
  if (!scores.size) return null;
  return String([...scores.entries()].sort((left, right) => right[1] - left[1] || right[0] - left[0])[0][0]);
}

function inferCardNumber(texts: string[]) {
  const combined = texts.join(" | ");
  const labeledPatterns = [
    /\b(?:card\s*(?:no\.?|number)|card\s*#)\s*([A-Z0-9][A-Z0-9-]{0,8})\b/i,
    /\b(?:no\.?|#)\s*([A-Z0-9][A-Z0-9-]{0,8})\b/i,
  ];
  for (const pattern of labeledPatterns) {
    const match = combined.match(pattern)?.[1];
    if (!match) continue;
    const normalized = match.trim().toUpperCase();
    if (/^\d{4}$/.test(normalized) && Number(normalized) >= 1900 && Number(normalized) <= 2035) continue;
    return normalized;
  }
  return null;
}

function inferPlayer(texts: string[]) {
  const banned = new Set([
    "panini",
    "prizm",
    "prism",
    "select",
    "wnba",
    "nba",
    "rookie",
    "card",
    "cards",
    "basketball",
    "official",
    "trading",
    "copyright",
    "concourse",
    "premier",
    "courtside",
    "silver",
    "green",
    "blue",
    "red",
    "gold",
    "velocity",
    "cracked",
    "ice",
  ]);

  const candidates: Array<{ score: number; value: string }> = [];
  for (const rawText of texts) {
    const cleaned = rawText.replace(/[^A-Za-z .'-]+/g, " ").replace(/\s+/g, " ").trim();
    const words = cleaned.split(" ").filter(Boolean);
    if (words.length < 2 || words.length > 5) continue;
    if (words.some((word) => word.length < 2)) continue;
    const lowered = words.map((word) => word.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, ""));
    if (lowered.some((word) => banned.has(word))) continue;
    if (lowered.every((word) => word.length <= 3)) continue;
    let score = 1;
    if (words.length >= 2 && words.length <= 4) score += 1;
    if (cleaned === cleaned.toUpperCase()) score += 0.3;
    if (/[A-Z][a-z]/.test(cleaned)) score += 0.5;
    candidates.push({ score, value: cleaned });
  }
  candidates.sort((left, right) => right.score - left.score || right.value.length - left.value.length);
  return candidates[0]?.score >= 1.5 ? candidates[0].value : null;
}

function inferParallel(texts: string[]) {
  const combined = texts.join(" ").toLowerCase();
  if (combined.includes("silver flash prizm")) return "Silver Flash Prizm";
  if (combined.includes("silver prizm")) return "Silver Prizm";
  if (combined.includes("cracked ice")) return "Cracked Ice Prizm";
  if (combined.includes("holo")) return "Holo";
  if (combined.includes("wave")) return "Wave";
  if (combined.includes("concourse")) return "Concourse";
  if (combined.includes("premier level")) return "Premier Level";
  if (combined.includes("courtside")) return "Courtside";
  if (combined.includes("prizm")) return "Prizm";
  return "Base";
}

function visualIdentity(metadata: JsonRecord) {
  const instaComp = recordValue(metadata.instacomp);
  const ai = recordValue(instaComp.ai);
  const collectible = recordValue(metadata.collectible_asset);
  const card = recordValue(metadata.card);
  const verified = recordValue(metadata.verified_reference);
  const identityComplete = instaComp.identityComplete === true;

  const year = textValue(ai.year, ai.season, card.year, card.season, verified.year);
  const manufacturer = textValue(
    ai.manufacturer,
    ai.manufacturerName,
    card.manufacturer,
    verified.manufacturer,
  );
  const brand = textValue(ai.brand, card.brand, verified.brand);
  const product = textValue(ai.product, ai.productName, card.product, verified.product);
  const setName = textValue(
    ai.setName,
    ai.set_name,
    ai.set,
    card.setName,
    card.set_name,
    verified.setName,
  );
  const cardNumber = textValue(
    ai.cardNumber,
    ai.card_number,
    card.cardNumber,
    card.card_number,
    verified.cardNumber,
    verified.card_number,
  );
  const player = textValue(
    ai.player,
    ai.playerName,
    ai.subject,
    card.player,
    verified.player,
  );
  const team = textValue(ai.team, ai.teamName, card.team, verified.team);
  const sport = textValue(ai.sport, card.sport, verified.sport);
  const league = textValue(ai.league, card.league, verified.league);
  const parallel =
    textValue(ai.checklistParallel, ai.parallelName, ai.parallel, card.parallel, verified.parallel) ||
    "Base";
  const variation = textValue(ai.variation, card.variation, verified.variation);
  const serialRun = positiveInteger(
    ai.serialRun,
    ai.printRun,
    collectible.serial_run,
    collectible.title_print_run,
    verified.serialRun,
  );
  const isAuto = booleanValue(
    ai.isAuto,
    ai.autograph,
    ai.autographStatus,
    card.isAuto,
    verified.isAuto,
  );
  const isRelic = booleanValue(
    ai.isRelic,
    ai.memorabilia,
    ai.memorabiliaStatus,
    card.isRelic,
    verified.isRelic,
  );
  const registryIdentityId = textValue(ai.checklistIdentityId, instaComp.cardUuid);
  const registryFingerprintSha256 = textValue(
    ai.checklistFingerprintSha256,
    ai.registryFingerprintSha256,
  );
  const evidenceTexts = collectEvidenceTexts(metadata);
  const visualYear = year || inferYear(evidenceTexts);
  const visualManufacturer = manufacturer || inferManufacturer(evidenceTexts);
  const visualCardNumber = cardNumber || inferCardNumber(evidenceTexts);
  const visualPlayer = player || inferPlayer(evidenceTexts);
  const visualProduct =
    product ||
    (evidenceTexts.some((text) => /silver flash prizm/i.test(text))
      ? 'Silver Flash Prizm'
      : evidenceTexts.some((text) => /silver prizm/i.test(text))
        ? 'Silver Prizm'
        : evidenceTexts.some((text) => /cracked ice/i.test(text))
          ? 'Cracked Ice Prizm'
          : evidenceTexts.some((text) => /\bconcourse\b/i.test(text))
            ? 'Concourse'
            : evidenceTexts.some((text) => /\bpremier level\b/i.test(text))
              ? 'Premier Level'
              : evidenceTexts.some((text) => /\bcourtside\b/i.test(text))
                ? 'Courtside'
                : evidenceTexts.some((text) => /\bprizm\b/i.test(text))
                  ? 'Prizm'
                  : null);
  const visualSetName = setName || visualProduct;
  const visualParallel = parallel || inferParallel(evidenceTexts);
  const summary =
    textValue(ai.notes) ||
    textValue(instaComp.identitySummary) ||
    buildIdentitySummary({
      year: visualYear,
      manufacturer: visualManufacturer,
      brand,
      product: visualProduct,
      setName: visualSetName,
      cardNumber: visualCardNumber,
      player: visualPlayer,
      team,
      variation,
      parallel: visualParallel,
    });
  const hasEnoughIdentity = Boolean(
    visualYear && visualManufacturer && visualCardNumber && visualPlayer,
  );

  return {
    status:
      identityComplete && hasEnoughIdentity
        ? ('identified' as const)
        : ('review_required' as const),
    source: 'visual_ai' as const,
    aiIdentificationRequired: !(identityComplete && hasEnoughIdentity),
    registryIdentityId: registryIdentityId || null,
    registryFingerprintSha256: registryFingerprintSha256 || null,
    lockedFields: {
      year: visualYear || null,
      manufacturer: visualManufacturer || null,
      brand,
      product: visualProduct,
      setName: visualSetName,
      cardNumber: visualCardNumber || null,
      player: visualPlayer || null,
      team,
      sport,
      league,
      parallel: visualParallel,
      variation: variation || null,
      serialRun: serialRun ?? null,
      isAuto,
      isRelic,
    },
    reasons:
      identityComplete && hasEnoughIdentity
        ? ['pending_listing_identity_locked_to_visual_ai_read']
        : ['visual_ai_identity_missing_required_fields'],
    notes: summary,
  };
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ error: "Unauthorized" }, { status: 401 });

    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const body = (await request.json().catch(() => null)) as
      | { inventoryItemId?: unknown }
      | null;
    const inventoryItemId = textValue(body?.inventoryItemId);
    if (!inventoryItemId) {
      return Response.json({ error: "inventoryItemId is required." }, { status: 400 });
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const { data: row, error } = await supabase
      .from("inventory_items")
      .select("id,seller_account_id,metadata")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .maybeSingle();

    if (error) throw error;
    if (!row) return Response.json({ error: "Pending listing not found." }, { status: 404 });

    const isStoreOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    if (!isStoreOwner && row.seller_account_id !== account.id) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const metadata = recordValue(row.metadata);
    const instaComp = recordValue(metadata.instacomp);
    const identity = visualIdentity(metadata);
    const currentAi = recordValue(instaComp.ai);
    const nextAi = {
      ...currentAi,
      year: identity.lockedFields.year,
      manufacturer: identity.lockedFields.manufacturer,
      brand: identity.lockedFields.brand,
      product: identity.lockedFields.product,
      setName: identity.lockedFields.setName,
      cardNumber: identity.lockedFields.cardNumber,
      player: identity.lockedFields.player,
      team: identity.lockedFields.team,
      sport: identity.lockedFields.sport,
      league: identity.lockedFields.league,
      parallel: identity.lockedFields.parallel,
      variation: identity.lockedFields.variation,
      serialRun: identity.lockedFields.serialRun,
      isAuto: identity.lockedFields.isAuto,
      isRelic: identity.lockedFields.isRelic,
      notes: identity.notes || currentAi.notes || null,
      checklistParallel: identity.lockedFields.parallel,
    };

    const nextMetadata = {
      ...metadata,
      instacomp: {
        ...instaComp,
        ai: nextAi,
        identityComplete: identity.status === 'identified',
        lastStatus:
          identity.status === 'identified' ? 'identity_complete' : 'review_required',
        lastStage: identity.status === 'identified' ? 'complete' : 'core_identity',
        checklistIdentity: {
          status: identity.status,
          source: identity.source,
          aiIdentificationRequired: identity.aiIdentificationRequired,
          registryIdentityId: identity.registryIdentityId,
          registryFingerprintSha256: identity.registryFingerprintSha256,
          lockedFields: identity.lockedFields,
          reasons: identity.reasons,
          checkedAt: new Date().toISOString(),
        },
      },
    };

    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ metadata: nextMetadata })
      .eq("id", inventoryItemId)
      .eq("store_id", storeId);
    if (updateError) throw updateError;

    return Response.json({ success: true, identity, identityComplete: identity.status === 'identified' });
  } catch (error: unknown) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not verify the pending-listing Registry identity.",
      },
      { status: 500 },
    );
  }
}
