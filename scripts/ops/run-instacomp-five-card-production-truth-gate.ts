import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { FLAGSHIP_STORE_ID } from "../../src/lib/legal";

type Json = Record<string, any>;

type ImageRow = {
  inventory_item_id: string;
  image_url: string | null;
  alt_text: string | null;
  sort_order: number | null;
  is_primary: boolean | null;
};

type TruthCard = {
  inventoryItemId: string;
  player: string;
  year: string;
  manufacturer: string;
  product: string;
  registrySet: string;
  cardNumber: string;
  parallel: string;
  identityId: string;
  requireAiSet?: string;
};

const ORIGIN = "https://truelycollectables.com";
const SCAN_URL = `${ORIGIN}/api/instacomp/scan`;
const TEST_EMAIL_PREFIX = "instacomp-truth-gate-";

const TRUTH: TruthCard[] = [
  {
    inventoryItemId: "ef0e06a3-a6de-4242-8c52-52b420185850",
    player: "Sonia Citron",
    year: "2025",
    manufacturer: "Panini",
    product: "2025 Panini Prizm WNBA",
    registrySet: "Base",
    cardNumber: "122",
    parallel: "Base",
    identityId: "2a7d4ddd-e9f7-4ce2-904c-b1a17b33ae4f",
  },
  {
    inventoryItemId: "0916fe9d-2837-4d91-add4-73e7216705cd",
    player: "Dominique Malonga",
    year: "2025",
    manufacturer: "Panini",
    product: "2025 Panini Prizm WNBA",
    registrySet: "Base",
    cardNumber: "116",
    parallel: "Prizms Ice",
    identityId: "bde0577b-72e8-4e59-8287-89aaf2f9e7e2",
  },
  {
    inventoryItemId: "66f9ad9e-43fb-4b2b-b79c-ac99fa082de0",
    player: "Sonia Citron",
    year: "2025",
    manufacturer: "Panini",
    product: "2025 Panini Prizm WNBA",
    registrySet: "Groovy",
    cardNumber: "13",
    parallel: "Base",
    identityId: "c58ffc4f-e1c7-4cd9-b6e2-599af5a29044",
    requireAiSet: "Groovy",
  },
  {
    inventoryItemId: "f7d73af4-7299-4ed6-b663-39206f2576ee",
    player: "Paige Bueckers",
    year: "2025",
    manufacturer: "Panini",
    product: "2025 Panini Prizm WNBA",
    registrySet: "Base",
    cardNumber: "5",
    parallel: "Prizms Ice",
    identityId: "575556fe-fdd4-4083-baee-c5071ed3161f",
  },
  {
    inventoryItemId: "e9335a9d-3cc1-48d3-92db-7be7468714a9",
    player: "Rickea Jackson",
    year: "2025",
    manufacturer: "Panini",
    product: "2025 Panini Prizm WNBA",
    registrySet: "Base",
    cardNumber: "118",
    parallel: "Base",
    identityId: "70ad307e-06bb-45c2-90ea-689b6e2f302e",
  },
];

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

function parallelCompatible(expected: string, actual: unknown) {
  const wanted = norm(expected);
  const found = norm(actual);
  if (wanted === "base") {
    return !found || found === "base" || found === "base card";
  }
  if (wanted === "prizms ice") {
    if (!/\bice\b/.test(found)) return false;
    // These modifiers identify different canonical Registry parallels and must
    // never be silently collapsed into the unnumbered Prizms Ice printing.
    return !/\b(?:white|red|blue|green|gold|black|purple|orange|pink|silver|choice|mojo|shimmer|wave|hyper|scope|velocity)\b/.test(found);
  }
  return wanted === found;
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

async function download(url: string, side: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "TCOS-InstaComp-Five-Card-Truth-Gate/1.0" },
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
      "User-Agent": "TCOS-InstaComp-Five-Card-Truth-Gate/1.0",
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

function safeSubset(payload: Json) {
  const ocr = rec(payload.ocrDiagnostics);
  const consensus = rec(payload.consensus);
  return {
    ok: payload.ok === true,
    scanId: txt(payload.scanId) || null,
    ai: rec(payload.ai),
    identityDecision: rec(payload.identityDecision),
    checklistRegistry: rec(payload.checklistRegistry),
    checklistResolution: rec(payload.checklistResolution),
    review: rec(payload.review),
    consensus: {
      trustedForIdentity: consensus.trustedForIdentity ?? null,
      riskTier: consensus.riskTier ?? null,
      identity: rec(consensus.identity),
      reasons: Array.isArray(consensus.reasons) ? consensus.reasons : [],
      conflicts: Array.isArray(consensus.conflicts) ? consensus.conflicts : [],
    },
    ocrDiagnostics: {
      primaryAiProvider: ocr.primaryAiProvider ?? null,
      primaryAiFamily: ocr.primaryAiFamily ?? null,
      textExcerpt: txt(ocr.textExcerpt).slice(0, 1600) || null,
      conflicts: Array.isArray(ocr.conflicts) ? ocr.conflicts : [],
      aiCouncil: rec(ocr.aiCouncil),
      imageOrientation: rec(ocr.imageOrientation),
    },
    error: txt(payload.error) || null,
    note: txt(payload.note) || null,
  };
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
    user_metadata: { purpose: "instacomp_five_card_production_truth_gate" },
  });
  if (created.error || !created.data.user) {
    throw new Error(`Could not create test seller: ${created.error?.message || "no user"}`);
  }
  const accountId = created.data.user.id;

  const profile = await params.admin
    .from("account_profiles")
    .upsert({ id: accountId, account_status: "active" }, { onConflict: "id" });
  if (profile.error) throw new Error(`Profile upsert failed: ${profile.error.message}`);

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

async function cleanupTestSeller(params: {
  admin: SupabaseClient;
  accountId: string;
  supabaseUrl: string;
  managementToken: string;
}) {
  const projectRef = new URL(params.supabaseUrl).hostname.split(".")[0];
  const safeId = params.accountId.replace(/[^0-9a-f-]/gi, "");
  if (safeId !== params.accountId) throw new Error("Unsafe temporary account id");

  const sql = [
    `delete from public.account_store_memberships where account_id = '${safeId}'::uuid;`,
    `delete from public.account_profiles where id = '${safeId}'::uuid;`,
  ].join("\n");
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.managementToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql, read_only: false }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Temporary seller SQL cleanup failed: HTTP ${response.status} ${await response.text()}`);
  }
  const auth = await params.admin.auth.admin.deleteUser(params.accountId);
  if (auth.error && !/not found/i.test(auth.error.message)) {
    throw new Error(`Temporary auth cleanup failed: ${auth.error.message}`);
  }
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

async function main() {
  const outputArg = process.argv.indexOf("--output");
  const output = outputArg >= 0
    ? process.argv[outputArg + 1]
    : "evidence/instacomp-five-card-production-truth-gate/receipt.json";
  await mkdir(dirname(output), { recursive: true });

  const supabaseUrl = txt(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = txt(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const anonKey = txt(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const managementToken = txt(process.env.GH_SUPABASE_ACCESS_TOKEN);
  if (!supabaseUrl || !serviceKey || !anonKey || !managementToken) {
    throw new Error("Production Supabase URL, service-role JWT, anon key, and management token are required.");
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const receipt: Json = {
    schema: "tcos.instacomp.fiveCardProductionTruthGate.v1",
    generatedAt: new Date().toISOString(),
    productionRoute: SCAN_URL,
    truthSource: "captured_physical_images_plus_production_checklist_registry",
    gateRequired: "5/5",
    temporarySeller: { created: false, deleted: false },
    status: "running",
    testedCards: 0,
    passedCards: 0,
    results: [],
  };
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);

  const ids = TRUTH.map((card) => card.inventoryItemId);
  const [itemsResult, imagesResult] = await Promise.all([
    admin.from("inventory_items").select("id,title,status").in("id", ids),
    admin
      .from("inventory_images")
      .select("inventory_item_id,image_url,alt_text,sort_order,is_primary")
      .in("inventory_item_id", ids)
      .order("sort_order", { ascending: true }),
  ]);
  if (itemsResult.error) throw new Error(`Inventory query failed: ${itemsResult.error.message}`);
  if (imagesResult.error) throw new Error(`Image query failed: ${imagesResult.error.message}`);
  const items = new Map((itemsResult.data || []).map((row) => [String(row.id), row]));
  const imagesByItem = new Map<string, ImageRow[]>();
  for (const row of (imagesResult.data || []) as ImageRow[]) {
    const current = imagesByItem.get(row.inventory_item_id) || [];
    current.push(row);
    imagesByItem.set(row.inventory_item_id, current);
  }

  for (const truth of TRUTH) {
    if (!items.has(truth.inventoryItemId)) throw new Error(`Missing truth inventory item ${truth.inventoryItemId}`);
    const images = pair(imagesByItem.get(truth.inventoryItemId) || []);
    if (!images.ready) throw new Error(`Missing distinct front/back images for ${truth.inventoryItemId}`);
  }

  let accountId = "";
  try {
    const seller = await createTestSeller({ admin, supabaseUrl, anonKey });
    accountId = seller.accountId;
    receipt.temporarySeller.created = true;
    await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);

    for (const [index, truth] of TRUTH.entries()) {
      const item = items.get(truth.inventoryItemId)!;
      const images = pair(imagesByItem.get(truth.inventoryItemId) || []);
      const startedAt = Date.now();
      const [front, back] = await Promise.all([
        download(images.frontUrl, "front"),
        download(images.backUrl, "back"),
      ]);
      const response = await callScanner(front, back, seller.accessToken);
      const found = actual(response.payload);
      const registry = rec(response.payload.checklistRegistry);
      const decision = rec(response.payload.identityDecision);
      const registryIdentityId = txt(registry.identityId);
      const checks = {
        httpOk: response.ok,
        routeOk: response.payload.ok === true,
        player: norm(found.player) === norm(truth.player),
        year: norm(found.year) === norm(truth.year),
        manufacturer: norm(found.manufacturer) === norm(truth.manufacturer),
        cardNumber: normCard(found.cardNumber) === normCard(truth.cardNumber),
        parallelTextCompatible: parallelCompatible(truth.parallel, found.parallel),
        requiredInsertSet: truth.requireAiSet ? norm(found.setName).includes(norm(truth.requireAiSet)) : true,
        registryMatched: registry.matched === true,
        registryIdentityExact: registryIdentityId === truth.identityId,
        identityConfirmed: decision.confirmed === true || registry.identityConfirmed === true,
      };
      const passed = Object.values(checks).every(Boolean);
      const result = {
        position: index + 1,
        inventoryItemId: truth.inventoryItemId,
        title: txt(item.title),
        inventoryStatus: item.status,
        expected: truth,
        actual: found,
        registryIdentityId: registryIdentityId || null,
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
      console.log(`[${index + 1}/5] ${passed ? "PASS" : "FAIL"} ${result.title} expected=${truth.identityId} actual=${registryIdentityId || "none"}`);
    }

    receipt.status = receipt.passedCards === 5 ? "passed" : "failed";
  } finally {
    if (accountId) {
      try {
        await cleanupTestSeller({ admin, accountId, supabaseUrl, managementToken });
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
    temporarySellerDeleted: receipt.temporarySeller.deleted,
  }, null, 2));

  if (receipt.temporarySeller.deleted !== true) process.exitCode = 2;
  else if (receipt.status !== "passed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
