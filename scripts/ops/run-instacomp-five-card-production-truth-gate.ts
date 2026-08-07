import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
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

function safeUuid(value: string, label: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Unsafe ${label} UUID`);
  }
  return value;
}

function parallelCompatible(expected: string, actual: unknown) {
  const wanted = norm(expected);
  const found = norm(actual);
  if (wanted === "base") {
    return !found || found === "base" || found === "base card";
  }
  if (wanted === "prizms ice") {
    if (!/\bice\b/.test(found)) return false;
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function jsonRequestWithRetry(params: {
  label: string;
  url: string;
  init: RequestInit;
  attempts?: number;
}) {
  const attempts = params.attempts ?? 3;
  let last = "unknown error";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(params.url, {
        ...params.init,
        signal: AbortSignal.timeout(30_000),
      });
      const raw = await response.text();
      let body: Json = {};
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = { raw: raw.slice(0, 500) };
        }
      }
      if (response.ok) return body;
      last = `HTTP ${response.status}: ${txt(body.msg || body.message || body.error || body.raw || raw).slice(0, 500) || "empty body"}`;
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable) break;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) await sleep(1500 * attempt);
  }
  throw new Error(`${params.label} failed after ${attempts} attempt(s): ${last}`);
}

async function managementQuery(params: {
  supabaseUrl: string;
  managementToken: string;
  label: string;
  query: string;
  attempts?: number;
}) {
  const projectRef = new URL(params.supabaseUrl).hostname.split(".")[0];
  const attempts = params.attempts ?? 3;
  let last = "unknown error";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.managementToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: params.query, read_only: false }),
        signal: AbortSignal.timeout(45_000),
      });
      const raw = await response.text();
      if (response.ok) {
        if (!raw) return [];
        try { return JSON.parse(raw); } catch { return raw; }
      }
      last = `HTTP ${response.status}: ${raw.slice(0, 500) || "empty body"}`;
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable) break;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) await sleep(1500 * attempt);
  }
  throw new Error(`${params.label} failed after ${attempts} attempt(s): ${last}`);
}

async function createAuthUser(params: {
  supabaseUrl: string;
  serviceKey: string;
}) {
  const email = `${TEST_EMAIL_PREFIX}${Date.now()}-${randomUUID()}@truelycollectables.com`;
  const password = `${randomBytes(32).toString("base64url")}Aa1!`;
  const body = await jsonRequestWithRetry({
    label: "temporary auth user creation",
    url: `${params.supabaseUrl}/auth/v1/admin/users`,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.serviceKey}`,
        apikey: params.serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { purpose: "instacomp_five_card_production_truth_gate" },
      }),
    },
  });
  const accountId = txt(body.id || rec(body.user).id);
  safeUuid(accountId, "temporary account");
  return { accountId, email, password };
}

async function setupTemporarySeller(params: {
  accountId: string;
  supabaseUrl: string;
  managementToken: string;
}) {
  const accountId = safeUuid(params.accountId, "temporary account");
  const storeId = safeUuid(String(FLAGSHIP_STORE_ID), "flagship store");
  await managementQuery({
    supabaseUrl: params.supabaseUrl,
    managementToken: params.managementToken,
    label: "temporary seller SQL setup",
    query: `
      set statement_timeout = '30s';
      set lock_timeout = '5s';
      insert into public.account_profiles (id, account_status)
      values ('${accountId}'::uuid, 'active')
      on conflict (id) do update set account_status = excluded.account_status;
      delete from public.account_store_memberships
      where account_id = '${accountId}'::uuid and store_id = '${storeId}'::uuid;
      insert into public.account_store_memberships (account_id, store_id, role, status)
      values ('${accountId}'::uuid, '${storeId}'::uuid, 'seller', 'active');
    `,
  });
}

async function signInTestSeller(params: {
  supabaseUrl: string;
  anonKey: string;
  email: string;
  password: string;
}) {
  const body = await jsonRequestWithRetry({
    label: "temporary seller sign-in",
    url: `${params.supabaseUrl}/auth/v1/token?grant_type=password`,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.anonKey}`,
        apikey: params.anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: params.email, password: params.password }),
    },
  });
  const accessToken = txt(body.access_token);
  if (!accessToken) throw new Error("Temporary seller sign-in returned no access token");
  return accessToken;
}

async function cleanupStaleTruthGateUsers(params: {
  supabaseUrl: string;
  managementToken: string;
}) {
  await managementQuery({
    supabaseUrl: params.supabaseUrl,
    managementToken: params.managementToken,
    label: "stale temporary seller cleanup",
    query: `
      set statement_timeout = '30s';
      set lock_timeout = '5s';
      delete from public.account_store_memberships
      where account_id in (select id from auth.users where email like '${TEST_EMAIL_PREFIX}%');
      delete from public.account_profiles
      where id in (select id from auth.users where email like '${TEST_EMAIL_PREFIX}%');
      delete from auth.users where email like '${TEST_EMAIL_PREFIX}%';
    `,
  });
}

async function cleanupTestSeller(params: {
  accountId: string;
  supabaseUrl: string;
  managementToken: string;
}) {
  const accountId = safeUuid(params.accountId, "temporary account");
  await managementQuery({
    supabaseUrl: params.supabaseUrl,
    managementToken: params.managementToken,
    label: "temporary seller cleanup",
    query: `
      set statement_timeout = '30s';
      set lock_timeout = '5s';
      delete from public.account_store_memberships where account_id = '${accountId}'::uuid;
      delete from public.account_profiles where id = '${accountId}'::uuid;
      delete from auth.users where id = '${accountId}'::uuid;
    `,
  });
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

  await cleanupStaleTruthGateUsers({ supabaseUrl, managementToken });
  receipt.staleTemporarySellerCleanup = "complete";
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
    const authUser = await createAuthUser({ supabaseUrl, serviceKey });
    accountId = authUser.accountId;
    receipt.temporarySeller.created = true;
    receipt.temporarySeller.accountId = accountId;
    await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);

    await setupTemporarySeller({ accountId, supabaseUrl, managementToken });

    const accessToken = await signInTestSeller({
      supabaseUrl,
      anonKey,
      email: authUser.email,
      password: authUser.password,
    });

    for (const [index, truth] of TRUTH.entries()) {
      const item = items.get(truth.inventoryItemId)!;
      const images = pair(imagesByItem.get(truth.inventoryItemId) || []);
      const startedAt = Date.now();
      const [front, back] = await Promise.all([
        download(images.frontUrl, "front"),
        download(images.backUrl, "back"),
      ]);
      const response = await callScanner(front, back, accessToken);
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
        await cleanupTestSeller({ accountId, supabaseUrl, managementToken });
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
