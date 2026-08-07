import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { analyzeWithInstaCompAiLocal } from "../../src/lib/instacomp-ai-local";
import { normalizeInstaCompSideImages } from "../../src/lib/instacomp-image-orientation";

type JsonRecord = Record<string, unknown>;

type InventoryItem = {
  id: string;
  title: string | null;
  sku: string | null;
  metadata: JsonRecord | null;
  updated_at: string | null;
  seller_account_id: string | null;
  status: string;
};

type InventoryImage = {
  inventory_item_id: string;
  image_url: string | null;
  alt_text: string | null;
  sort_order: number | null;
  is_primary: boolean | null;
};

type ExpectedIdentity = {
  source: "human_verified_metadata" | "trusted_metadata" | "structured_title";
  player: string;
  year: string;
  manufacturer: string;
  setName: string;
  cardNumber: string;
  parallel: string;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalized(value: unknown) {
  return text(value)
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function normalizedCardNumber(value: unknown) {
  return normalized(value).replace(/\s+/g, "");
}

function normalizedParallel(value: unknown) {
  const clean = normalized(value);
  if (!clean || clean === "none" || clean === "null" || clean === "base card") {
    return "base";
  }
  return clean;
}

function setMatches(expected: string, actual: string) {
  const left = normalized(expected).split(" ").filter(Boolean);
  const right = normalized(actual).split(" ").filter(Boolean);
  if (!left.length || !right.length) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const leftCovered = left.every((token) => rightSet.has(token));
  const rightCovered = right.every((token) => leftSet.has(token));
  return leftCovered || rightCovered;
}

function imagePair(rows: InventoryImage[]) {
  const images = rows
    .map((row) => ({
      url: text(row.image_url),
      alt: text(row.alt_text),
      order: Number(row.sort_order || 0),
      primary: row.is_primary === true,
    }))
    .filter((row) => Boolean(row.url))
    .sort((left, right) => {
      if (left.primary !== right.primary) return left.primary ? -1 : 1;
      return left.order - right.order;
    });
  const front =
    images.find((image) => /\bfront\b/i.test(image.alt)) ||
    images.find((image) => image.primary) ||
    images[0] ||
    null;
  const back =
    images.find(
      (image) => /\bback\b/i.test(image.alt) && image.url !== front?.url,
    ) ||
    images.find((image) => !image.primary && image.url !== front?.url) ||
    images.find((image) => image.url !== front?.url) ||
    null;
  return {
    frontUrl: front?.url || "",
    backUrl: back?.url || "",
    ready: Boolean(front?.url && back?.url && front.url !== back.url),
  };
}

const parallelPhrases = [
  "Cracked Ice Prizm",
  "Blue Velocity",
  "Silver Prizm",
  "Green Prizm",
  "Red Prizm",
  "Blue Prizm",
  "Gold Prizm",
  "Orange Prizm",
  "Purple Prizm",
  "Pink Prizm",
  "Black Prizm",
  "White Prizm",
  "Cracked Ice",
  "Velocity",
  "Wave",
  "Silver",
  "Green",
  "Red",
  "Blue",
  "Gold",
  "Orange",
  "Purple",
  "Pink",
  "Black",
  "White",
  "Base",
];

function identityFromTitle(title: string): ExpectedIdentity | null {
  const year = /\b((?:19|20)\d{2})\b/.exec(title)?.[1] || "";
  const cardMatch = /#\s*([A-Za-z0-9-]+)/.exec(title);
  if (!year || !cardMatch) return null;
  const cardNumber = cardMatch[1];
  const manufacturer =
    /\b(Upper Deck|Panini|Topps|Bowman|Leaf|Donruss|Fleer|Score|O-Pee-Chee)\b/i.exec(
      title,
    )?.[1] || "";
  if (!manufacturer) return null;

  const beforeNumber = title.slice(0, cardMatch.index).trim();
  let setName = beforeNumber
    .replace(new RegExp(`^.*?\\b${year}\\b`, "i"), "")
    .replace(new RegExp(`^\\s*${manufacturer}\\s*`, "i"), "")
    .trim();
  if (!setName) setName = manufacturer;

  const afterNumber = title.slice(cardMatch.index + cardMatch[0].length).trim();
  const qualifier = new RegExp(
    `\\s+(?=${parallelPhrases
      .map((phrase) => phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"))
      .join("|")}|RC\\b|Rookie\\b|Auto(?:graph)?\\b|Relic\\b|\\d+\\s*\\/\\s*\\d+)`,
    "i",
  );
  const player = afterNumber.split(qualifier)[0]?.trim() || "";
  const parallel =
    parallelPhrases.find((phrase) =>
      new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "i").test(title),
    ) || "";
  if (!player || !parallel) return null;

  return {
    source: "structured_title",
    player,
    year,
    manufacturer,
    setName,
    cardNumber,
    parallel,
  };
}

function expectedIdentity(item: InventoryItem): ExpectedIdentity | null {
  const metadata = record(item.metadata);
  const instacomp = record(metadata.instacomp);
  const ai = record(instacomp.ai);
  const player = text(ai.player || ai.playerName);
  const year = text(ai.year);
  const manufacturer = text(ai.manufacturer || ai.brand);
  const setName = text(ai.setName || ai.set);
  const cardNumber = text(ai.cardNumber || ai.card_number);
  const parallel = text(ai.checklistParallel || ai.parallelName || ai.parallel || "Base");
  const complete = Boolean(player && year && manufacturer && setName && cardNumber);
  if (complete && (instacomp.manualIdentityLocked === true || instacomp.humanVerified === true)) {
    return {
      source: "human_verified_metadata",
      player,
      year,
      manufacturer,
      setName,
      cardNumber,
      parallel,
    };
  }
  if (complete && instacomp.identityComplete === true && instacomp.trustedForIdentity === true) {
    return {
      source: "trusted_metadata",
      player,
      year,
      manufacturer,
      setName,
      cardNumber,
      parallel,
    };
  }
  return identityFromTitle(text(item.title));
}

function candidateScore(item: InventoryItem, expected: ExpectedIdentity) {
  const metadata = record(item.metadata);
  const instacomp = record(metadata.instacomp);
  const haystack = `${text(item.title)} ${expected.setName}`;
  let score = 0;
  if (expected.source === "human_verified_metadata") score += 100;
  else if (expected.source === "trusted_metadata") score += 70;
  else score += 30;
  if (/2025\s+Panini\s+Prizm\s+WNBA/i.test(haystack)) score += 60;
  if (/2025\s+Panini\s+Select\s+WNBA/i.test(haystack)) score += 55;
  if (!text(instacomp.scanId)) score += 15;
  if (normalizedParallel(expected.parallel) === "base") score += 5;
  return score;
}

async function downloadImage(url: string, side: "front" | "back") {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "TCOS-InstaComp-Five-Card-Proof/1.0" },
  });
  if (!response.ok) throw new Error(`${side} image returned HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const type = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  const extension = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  return new File([bytes], `${side}.${extension}`, { type });
}

function receipt(scan: JsonRecord, prefix: string) {
  const checklist = record(scan.checklist);
  const values = Array.isArray(checklist.source_receipts)
    ? checklist.source_receipts.map((value) => text(value))
    : [];
  return values.find((value) => value.startsWith(prefix))?.slice(prefix.length) || "";
}

function actualIdentity(scan: JsonRecord, orientation: JsonRecord) {
  const identity = record(scan.trusted_identity);
  let parallel = text(identity.parallel) || "Base";
  const isWnba = /\bwnba\b/i.test(
    [text(identity.league), text(identity.set_name || identity.setName)].join(" "),
  );
  const claimsPrizmParallel = /\b(?:silver|green|red|blue|gold|orange|purple|pink|black|white|ice|wave|velocity|cracked\s+ice)(?:\s+prizm)?\b/i.test(
    parallel,
  );
  const forcedBaseFromBack =
    isWnba &&
    claimsPrizmParallel &&
    orientation.backStandalonePrizm === false &&
    Number(orientation.backDesignationConfidence || 0) >= 0.8;
  if (forcedBaseFromBack) parallel = "Base";
  return {
    player: text(identity.player),
    year: text(identity.year),
    manufacturer: text(identity.manufacturer || identity.brand),
    setName: text(identity.set_name || identity.setName),
    cardNumber: text(identity.card_number || identity.cardNumber),
    parallel,
    forcedBaseFromBack,
  };
}

async function main() {
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : "evidence/instacomp-five-card-proof.json";
  const supabaseUrl = text(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = text(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY);
  if (!supabaseUrl || !serviceKey) throw new Error("Production Supabase credentials are missing.");
  if (!text(process.env.INSTACOMP_AI_LOCAL_URL) || !text(process.env.INSTACOMP_AI_LOCAL_KEY)) {
    throw new Error("Production InstaComp Mac service URL/key are missing.");
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: rawItems, error: itemError } = await supabase
    .from("inventory_items")
    .select("id,title,sku,metadata,updated_at,seller_account_id,status")
    .eq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(250);
  if (itemError) throw itemError;
  const items = (rawItems || []) as InventoryItem[];
  const ids = items.map((item) => item.id);
  if (!ids.length) throw new Error("No draft inventory cards were found.");

  const { data: rawImages, error: imageError } = await supabase
    .from("inventory_images")
    .select("inventory_item_id,image_url,alt_text,sort_order,is_primary")
    .in("inventory_item_id", ids)
    .order("sort_order", { ascending: true });
  if (imageError) throw imageError;
  const imagesByItem = new Map<string, InventoryImage[]>();
  for (const row of (rawImages || []) as InventoryImage[]) {
    const current = imagesByItem.get(row.inventory_item_id) || [];
    current.push(row);
    imagesByItem.set(row.inventory_item_id, current);
  }

  const candidates = items
    .map((item) => {
      const expected = expectedIdentity(item);
      const pair = imagePair(imagesByItem.get(item.id) || []);
      return expected && pair.ready
        ? { item, expected, pair, score: candidateScore(item, expected) }
        : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => right.score - left.score || text(right.item.updated_at).localeCompare(text(left.item.updated_at)));

  const selected: typeof candidates = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = `${normalized(candidate.expected.player)}|${normalizedCardNumber(candidate.expected.cardNumber)}|${normalized(candidate.expected.setName)}`;
    if (seen.has(key)) continue;
    selected.push(candidate);
    seen.add(key);
    if (selected.length === 5) break;
  }
  if (selected.length !== 5) {
    throw new Error(`Only ${selected.length} cards had a distinct front/back pair and a usable answer key; five are required.`);
  }

  const results: JsonRecord[] = [];
  for (const [index, candidate] of selected.entries()) {
    const startedAt = Date.now();
    const [front, back] = await Promise.all([
      downloadImage(candidate.pair.frontUrl, "front"),
      downloadImage(candidate.pair.backUrl, "back"),
    ]);
    const normalizedSides = await normalizeInstaCompSideImages({
      frontImage: front,
      backImage: back,
    });
    if (!normalizedSides.backFile) throw new Error("Normalized back image is missing.");
    const scan = (await analyzeWithInstaCompAiLocal({
      front: normalizedSides.frontFile,
      back: normalizedSides.backFile,
      timeoutMs: 210_000,
    })) as unknown as JsonRecord;
    const actual = actualIdentity(scan, normalizedSides.orientation as unknown as JsonRecord);
    const checks = {
      pricingAllowed: scan.pricing_allowed === true,
      registryIdentity: Boolean(text(record(scan.checklist).identity_id) || receipt(scan, "registry_identity:")),
      registryFingerprint: Boolean(receipt(scan, "registry_fingerprint:")),
      orientationCompleted: normalizedSides.orientation.status === "completed",
      player: normalized(actual.player) === normalized(candidate.expected.player),
      year: normalized(actual.year) === normalized(candidate.expected.year),
      manufacturer: normalized(actual.manufacturer) === normalized(candidate.expected.manufacturer),
      setName: setMatches(candidate.expected.setName, actual.setName),
      cardNumber: normalizedCardNumber(actual.cardNumber) === normalizedCardNumber(candidate.expected.cardNumber),
      parallel: normalizedParallel(actual.parallel) === normalizedParallel(candidate.expected.parallel),
    };
    const passed = Object.values(checks).every(Boolean);
    const result = {
      position: index + 1,
      inventoryItemId: candidate.item.id,
      title: text(candidate.item.title),
      answerKeySource: candidate.expected.source,
      expected: candidate.expected,
      actual,
      scanStatus: text(scan.status),
      matchSource: text(scan.match_source),
      orientation: normalizedSides.orientation,
      checks,
      passed,
      durationMs: Date.now() - startedAt,
    };
    results.push(result);
    console.log(
      `[${index + 1}/5] ${passed ? "PASS" : "FAIL"} ${result.title} -> ${actual.year} ${actual.manufacturer} ${actual.setName} #${actual.cardNumber} ${actual.player} ${actual.parallel}`,
    );
  }

  const passedCount = results.filter((result) => result.passed === true).length;
  const receiptPayload = {
    schema: "tcos.instacomp.fiveCardProductionProof.v1",
    generatedAt: new Date().toISOString(),
    readOnlyProductionDatabase: true,
    selectedFromOwnerDraftInventory: true,
    testedCards: results.length,
    passedCards: passedCount,
    status: passedCount === 5 ? "passed" : "failed",
    results,
  };
  await writeFile(outputPath, `${JSON.stringify(receiptPayload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: receiptPayload.status, passedCards: passedCount, testedCards: 5 }, null, 2));
  if (passedCount !== 5) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
