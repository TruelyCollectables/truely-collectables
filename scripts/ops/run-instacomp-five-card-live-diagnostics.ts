import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { FLAGSHIP_STORE_ID } from "../../src/lib/legal";

type Json = Record<string, any>;

type Item = {
  id: string;
  title: string | null;
  status: string | null;
  metadata: Json | null;
  updated_at: string | null;
};

type ImageRow = {
  inventory_item_id: string;
  image_url: string | null;
  alt_text: string | null;
  sort_order: number | null;
  is_primary: boolean | null;
};

type Expected = {
  source: string;
  player: string;
  year: string;
  manufacturer: string;
  setName: string;
  cardNumber: string;
  parallel: string;
};

const ORIGIN = "https://truelycollectables.com";
const SCAN_URL = `${ORIGIN}/api/instacomp/scan`;
const TEST_EMAIL_PREFIX = "instacomp-proof-";

function rec(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function txt(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function norm(value: unknown) {
  return txt(value)
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function normCard(value: unknown) {
  return norm(value).replace(/\s+/g, "");
}

function normParallel(value: unknown) {
  const clean = norm(value);
  return !clean || clean === "none" || clean === "null" || clean === "base card"
    ? "base"
    : clean;
}

function safeSubset(payload: Json) {
  const ocr = rec(payload.ocrDiagnostics);
  const consensus = rec(payload.consensus);
  return {
    responseKeys: Object.keys(payload).sort(),
    ok: payload.ok === true,
    scanId: txt(payload.scanId) || null,
    ai: rec(payload.ai),
    identityDecision: rec(payload.identityDecision),
    checklistRegistry: rec(payload.checklistRegistry),
    checklistResolution: rec(payload.checklistResolution),
    imageOrientation: rec(payload.imageOrientation),
    review: rec(payload.review),
    consensus: {
      trustedForIdentity: consensus.trustedForIdentity ?? null,
      riskTier: consensus.riskTier ?? null,
      identity: rec(consensus.identity),
      reasons: Array.isArray(consensus.reasons) ? consensus.reasons : [],
      conflicts: Array.isArray(consensus.conflicts) ? consensus.conflicts : [],
      readers: Array.isArray(consensus.readers)
        ? consensus.readers.map((reader: unknown) => {
            const row = rec(reader);
            return {
              provider: txt(row.provider) || null,
              family: txt(row.family) || null,
              status: txt(row.status) || null,
              confidence: row.confidence ?? null,
              identity: rec(row.identity),
              reasons: Array.isArray(row.reasons) ? row.reasons : [],
            };
          })
        : [],
    },
    ocrDiagnostics: {
      primaryAiProvider: ocr.primaryAiProvider ?? null,
      primaryAiFamily: ocr.primaryAiFamily ?? null,
      primaryAiAttempts: Array.isArray(ocr.primaryAiAttempts)
        ? ocr.primaryAiAttempts
        : [],
      checkedImages: ocr.checkedImages ?? null,
      provider: ocr.provider ?? null,
      textExcerpt: txt(ocr.textExcerpt).slice(0, 1600) || null,
      conflicts: Array.isArray(ocr.conflicts) ? ocr.conflicts : [],
      aiCouncil: rec(ocr.aiCouncil),
      imageOrientation: rec(ocr.imageOrientation),
    },
    error: txt(payload.error) || null,
    note: txt(payload.note) || null,
  };
}

function pair(rows: ImageRow[]) {
  const ordered = rows
    .map((row) => ({
      url: txt(row.image_url),
      alt: txt(row.alt_text),
      order: Number(row.sort_order || 0),
      primary: row.is_primary === true,
    }))
    .filter((row) => Boolean(row.url))
    .sort((a, b) => {
      if (a.primary !== b.primary) return a.primary ? -1 : 1;
      return a.order - b.order;
    });
  const front =
    ordered.find((row) => /\bfront\b/i.test(row.alt)) ||
    ordered.find((row) => row.primary) ||
    ordered[0] ||
    null;
  const back =
    ordered.find((row) => /\bback\b/i.test(row.alt) && row.url !== front?.url) ||
    ordered.find((row) => !row.primary && row.url !== front?.url) ||
    ordered.find((row) => row.url !== front?.url) ||
    null;
  return {
    frontUrl: front?.url || "",
    backUrl: back?.url || "",
    ready: Boolean(front?.url && back?.url && front.url !== back.url),
  };
}

const parallelNames = [
  "Choice Fusion Red & Yellow",
  "Neon Green Prizm",
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

function expectedFromMetadata(item: Item): Expected | null {
  const instacomp = rec(rec(item.metadata).instacomp);
  const ai = rec(instacomp.ai);
  const player = txt(ai.player || ai.playerName);
  const year = txt(ai.year);
  const manufacturer = txt(ai.manufacturer || ai.brand);
  const setName = txt(ai.setName || ai.set);
  const cardNumber = txt(ai.cardNumber || ai.card_number);
  const parallel = txt(ai.checklistParallel || ai.parallelName || ai.parallel || "Base");
  if (!player || !year || !manufacturer || !setName || !cardNumber) return null;
  const source =
    instacomp.manualIdentityLocked === true || instacomp.humanVerified === true
      ? "human_verified_metadata"
      : instacomp.identityComplete === true && instacomp.trustedForIdentity === true
        ? "trusted_metadata"
        : "existing_metadata";
  return { source, player, year, manufacturer, setName, cardNumber, parallel };
}

function expectedFromStructuredTitle(item: Item): Expected | null {
  const title = txt(item.title);
  const year = /\b((?:19|20)\d{2})\b/.exec(title)?.[1] || "";
  const manufacturer =
    /\b(Upper Deck|Panini|Topps|Bowman|Leaf|Donruss|Fleer|Score|Onyx|O-Pee-Chee)\b/i.exec(title)?.[1] || "";
  const card = /#\s*([A-Za-z0-9-]+)/.exec(title);
  if (!year || !manufacturer || !card) return null;

  const beforeNumber = title.slice(0, card.index).trim();
  const afterNumber = title.slice(card.index + card[0].length).trim();
  let setName = beforeNumber
    .replace(new RegExp(`^.*?\\b${year}\\b`, "i"), "")
    .replace(new RegExp(`^\\s*${manufacturer}\\s*`, "i"), "")
    .trim();
  const parallel =
    parallelNames.find((name) => title.toLowerCase().includes(name.toLowerCase())) ||
    "Base";

  // This title parser is deliberately limited to the canonical TCOS title order:
  // YEAR MANUFACTURER SET #NUMBER PLAYER PARALLEL.
  const stopWords = [parallel, "RC", "Rookie", "Auto", "Autograph", "Relic", "PSA", "BGS", "SGC"]
    .filter(Boolean)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const player = afterNumber
    .split(new RegExp(`\\s+(?=${stopWords.join("|")}|\\d+\\s*\\/\\s*\\d+)`, "i"))[0]
    ?.trim();
  if (!setName || !player) return null;
  return {
    source: "structured_title",
    player,
    year,
    manufacturer,
    setName,
    cardNumber: card[1],
    parallel,
  };
}

function expected(item: Item) {
  return expectedFromMetadata(item) || expectedFromStructuredTitle(item);
}

function score(item: Item, answer: Expected) {
  const title = txt(item.title);
  let value = 0;
  if (/2025\s+Panini\s+Prizm\s+WNBA/i.test(title)) value += 10000;
  if (/2025\s+Panini\s+Select\s+WNBA/i.test(title)) value += 9000;
  if (answer.source === "human_verified_metadata") value += 3000;
  else if (answer.source === "trusted_metadata") value += 2000;
  else if (answer.source === "existing_metadata") value += 1000;
  if (!/\b(?:PSA|BGS|SGC|CSG|CGC)\b/i.test(title)) value += 400;
  if (!/\b(?:auto|autograph|relic|patch|memorabilia)\b/i.test(title)) value += 300;
  if (normParallel(answer.parallel) === "base") value += 100;
  return value;
}

async function download(url: string, side: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "TCOS-InstaComp-Five-Card-Diagnostics/1.0" },
  });
  if (!response.ok) throw new Error(`${side} image returned HTTP ${response.status}`);
  const type = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  return new File([await response.arrayBuffer()], `${side}.jpg`, { type });
}

async function callScanner(front: File, back: File, accessToken: string) {
  const body = new FormData();
  body.append("frontImage", front, front.name);
  body.append("backImage", back, back.name);
  body.append("aiCouncilTier", "basic");
  const response = await fetch(SCAN_URL, {
    method: "POST",
    body,
    redirect: "error",
    signal: AbortSignal.timeout(295_000),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "TCOS-InstaComp-Five-Card-Diagnostics/1.0",
    },
  });
  const raw = await response.text();
  let payload: Json;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { error: `Non-JSON response: ${raw.slice(0, 500)}` };
  }
  return { status: response.status, ok: response.ok, payload };
}

async function deleteTestAccount(admin: SupabaseClient, accountId: string) {
  const errors: string[] = [];
  const membership = await admin.from("account_store_memberships").delete().eq("account_id", accountId);
  if (membership.error) errors.push(`membership: ${membership.error.message}`);
  const profile = await admin.from("account_profiles").delete().eq("id", accountId);
  if (profile.error) errors.push(`profile: ${profile.error.message}`);
  const auth = await admin.auth.admin.deleteUser(accountId);
  if (auth.error && !/not found/i.test(auth.error.message)) errors.push(`auth: ${auth.error.message}`);
  if (errors.length) throw new Error(errors.join("; "));
}

async function cleanStaleTestAccounts(admin: SupabaseClient) {
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw new Error(`Could not list auth users: ${listed.error.message}`);
  const stale = listed.data.users.filter((user) =>
    String(user.email || "").toLowerCase().startsWith(TEST_EMAIL_PREFIX),
  );
  for (const user of stale) await deleteTestAccount(admin, user.id);
  return stale.length;
}

async function createTestSeller(params: {
  admin: SupabaseClient;
  supabaseUrl: string;
  anonKey: string;
}) {
  const email = `${TEST_EMAIL_PREFIX}${Date.now()}-${randomUUID()}@truelycollectables.com`;
  const password = `${randomBytes(32).toString("base64url")}Aa1!`;
  const created = await params.admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { purpose: "instacomp_five_card_diagnostics" },
  });
  if (created.error || !created.data.user) {
    throw new Error(`Could not create test seller: ${created.error?.message || "no user"}`);
  }
  const accountId = created.data.user.id;

  const updated = await params.admin
    .from("account_profiles")
    .update({ account_status: "active" })
    .eq("id", accountId)
    .select("id")
    .maybeSingle();
  if (updated.error) throw new Error(`Profile activation failed: ${updated.error.message}`);
  if (!updated.data) {
    const inserted = await params.admin
      .from("account_profiles")
      .insert({ id: accountId, account_status: "active" });
    if (inserted.error) throw new Error(`Profile insert failed: ${inserted.error.message}`);
  }

  const membership = await params.admin.from("account_store_memberships").insert({
    account_id: accountId,
    store_id: FLAGSHIP_STORE_ID,
    role: "seller",
    status: "active",
  });
  if (membership.error) throw new Error(`Membership insert failed: ${membership.error.message}`);

  const authClient = createClient(params.supabaseUrl, params.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await authClient.auth.signInWithPassword({ email, password });
  const accessToken = txt(signedIn.data.session?.access_token);
  if (signedIn.error || !accessToken) {
    throw new Error(`Test seller sign-in failed: ${signedIn.error?.message || "no token"}`);
  }
  return { accountId, accessToken };
}

function actual(payload: Json) {
  const ai = rec(payload.ai);
  return {
    player: txt(ai.player),
    year: txt(ai.year),
    manufacturer: txt(ai.manufacturer || ai.brand),
    setName: txt(ai.setName || ai.set_name),
    cardNumber: txt(ai.cardNumber || ai.card_number),
    parallel: txt(ai.parallel) || "Base",
  };
}

function setMatches(left: string, right: string) {
  const a = new Set(norm(left).split(" ").filter(Boolean));
  const b = new Set(norm(right).split(" ").filter(Boolean));
  return [...a].every((token) => b.has(token)) || [...b].every((token) => a.has(token));
}

async function main() {
  const outputArg = process.argv.indexOf("--output");
  const output = outputArg >= 0
    ? process.argv[outputArg + 1]
    : "evidence/instacomp-five-card-live-diagnostics/receipt.json";
  await mkdir(dirname(output), { recursive: true });

  const supabaseUrl = txt(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = txt(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const anonKey = txt(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!supabaseUrl || !serviceKey || !anonKey) {
    throw new Error("Supabase URL, exact service-role JWT, and anon key are required.");
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const preflight = await admin.from("account_profiles").select("id").limit(1);
  if (preflight.error) throw new Error(`Service-role table preflight failed: ${preflight.error.message}`);

  const staleAccountsDeleted = await cleanStaleTestAccounts(admin);
  const receipt: Json = {
    schema: "tcos.instacomp.fiveCardLiveDiagnostics.v1",
    generatedAt: new Date().toISOString(),
    productionRoute: SCAN_URL,
    staleAccountsDeleted,
    candidateSummary: {},
    temporarySeller: { created: false, deleted: false },
    status: "running",
    testedCards: 0,
    passedCards: 0,
    results: [],
  };
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);

  let accountId = "";
  try {
    const seller = await createTestSeller({ admin, supabaseUrl, anonKey });
    accountId = seller.accountId;
    receipt.temporarySeller.created = true;
    await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);

    const itemsQuery = await admin
      .from("inventory_items")
      .select("id,title,status,metadata,updated_at")
      .order("updated_at", { ascending: false })
      .limit(1000);
    if (itemsQuery.error) throw new Error(`Inventory query failed: ${itemsQuery.error.message}`);
    const items = (itemsQuery.data || []) as Item[];
    const imagesByItem = new Map<string, ImageRow[]>();
    for (let offset = 0; offset < items.length; offset += 150) {
      const ids = items.slice(offset, offset + 150).map((item) => item.id);
      const imageQuery = await admin
        .from("inventory_images")
        .select("inventory_item_id,image_url,alt_text,sort_order,is_primary")
        .in("inventory_item_id", ids)
        .order("sort_order", { ascending: true });
      if (imageQuery.error) throw new Error(`Image query failed: ${imageQuery.error.message}`);
      for (const row of (imageQuery.data || []) as ImageRow[]) {
        const current = imagesByItem.get(row.inventory_item_id) || [];
        current.push(row);
        imagesByItem.set(row.inventory_item_id, current);
      }
    }

    const candidates = items
      .map((item) => {
        const answer = expected(item);
        const images = pair(imagesByItem.get(item.id) || []);
        return answer && images.ready
          ? { item, answer, images, score: score(item, answer) }
          : null;
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => b.score - a.score);

    receipt.candidateSummary = {
      inventoryItemsRead: items.length,
      usableCandidates: candidates.length,
      prizmWnbaCandidates: candidates.filter((row) => /2025\s+Panini\s+Prizm\s+WNBA/i.test(txt(row.item.title))).length,
      selectWnbaCandidates: candidates.filter((row) => /2025\s+Panini\s+Select\s+WNBA/i.test(txt(row.item.title))).length,
    };

    const selected: typeof candidates = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const key = `${norm(candidate.answer.player)}|${normCard(candidate.answer.cardNumber)}|${norm(candidate.answer.setName)}`;
      if (seen.has(key)) continue;
      selected.push(candidate);
      seen.add(key);
      if (selected.length === 5) break;
    }
    if (selected.length !== 5) throw new Error(`Only ${selected.length} usable cards were available.`);

    for (const [index, candidate] of selected.entries()) {
      const startedAt = Date.now();
      const [front, back] = await Promise.all([
        download(candidate.images.frontUrl, "front"),
        download(candidate.images.backUrl, "back"),
      ]);
      const response = await callScanner(front, back, seller.accessToken);
      const found = actual(response.payload);
      const checks = {
        httpOk: response.ok,
        routeOk: response.payload.ok === true,
        player: norm(found.player) === norm(candidate.answer.player),
        year: norm(found.year) === norm(candidate.answer.year),
        manufacturer: norm(found.manufacturer) === norm(candidate.answer.manufacturer),
        setName: setMatches(candidate.answer.setName, found.setName),
        cardNumber: normCard(found.cardNumber) === normCard(candidate.answer.cardNumber),
        parallel: normParallel(found.parallel) === normParallel(candidate.answer.parallel),
        registryIdentity: Boolean(txt(rec(response.payload.checklistRegistry).identityId)),
        identityConfirmed:
          rec(response.payload.identityDecision).confirmed === true ||
          rec(response.payload.checklistRegistry).identityConfirmed === true,
      };
      const passed = Object.values(checks).every(Boolean);
      const result = {
        position: index + 1,
        inventoryItemId: candidate.item.id,
        title: txt(candidate.item.title),
        inventoryStatus: candidate.item.status,
        expected: candidate.answer,
        actual: found,
        httpStatus: response.status,
        checks,
        passed,
        diagnostics: safeSubset(response.payload),
        durationMs: Date.now() - startedAt,
      };
      receipt.results.push(result);
      receipt.testedCards = receipt.results.length;
      receipt.passedCards = receipt.results.filter((row: Json) => row.passed).length;
      await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
      console.log(
        `[${index + 1}/5] ${passed ? "PASS" : "FAIL"} ${result.title} | internal=${txt(result.diagnostics.ai.internalStatus) || "none"} checklist=${txt(result.diagnostics.ai.internalChecklistOutcome) || txt(result.diagnostics.checklistResolution.status) || "none"} reasons=${JSON.stringify(result.diagnostics.ai.internalChecklistReasons || result.diagnostics.checklistResolution.reasons || [])}`,
      );
    }

    receipt.status = receipt.passedCards === 5 ? "passed" : "failed";
  } finally {
    if (accountId) {
      try {
        await deleteTestAccount(admin, accountId);
        receipt.temporarySeller.deleted = true;
      } catch (error) {
        receipt.temporarySeller.cleanupError = error instanceof Error ? error.message : String(error);
      }
    }
    receipt.finishedAt = new Date().toISOString();
    await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
  }

  console.log(JSON.stringify({
    status: receipt.status,
    testedCards: receipt.testedCards,
    passedCards: receipt.passedCards,
    candidateSummary: receipt.candidateSummary,
    temporarySellerDeleted: receipt.temporarySeller.deleted,
  }, null, 2));

  if (receipt.temporarySeller.deleted !== true) process.exitCode = 2;
  else if (receipt.status !== "passed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
