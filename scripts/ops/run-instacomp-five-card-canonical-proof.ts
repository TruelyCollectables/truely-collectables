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

type ProofCard = {
  inventoryItemId: string;
  player: string;
  year: string;
  manufacturer: string;
  cardNumber: string;
  checklistSet: string;
  parallel: string;
  registryIdentityId: string;
};

const ORIGIN = "https://truelycollectables.com";
const SCAN_URL = `${ORIGIN}/api/instacomp/scan`;
const TEST_EMAIL_PREFIX = "instacomp-canonical-proof-";

const CARDS: ProofCard[] = [
  {
    inventoryItemId: "ef0e06a3-a6de-4242-8c52-52b420185850",
    player: "Sonia Citron",
    year: "2025",
    manufacturer: "Panini",
    cardNumber: "122",
    checklistSet: "Base",
    parallel: "Base",
    registryIdentityId: "2a7d4ddd-e9f7-4ce2-904c-b1a17b33ae4f",
  },
  {
    inventoryItemId: "bbf7f682-4ead-447d-b692-b84f68df2a0e",
    player: "Dominique Malonga",
    year: "2025",
    manufacturer: "Panini",
    cardNumber: "116",
    checklistSet: "Base",
    parallel: "Prizms Ice",
    registryIdentityId: "bde0577b-72e8-4e59-8287-89aaf2f9e7e2",
  },
  {
    inventoryItemId: "6434de96-8b41-4f1b-9b25-0b4f30b6b882",
    player: "Sonia Citron",
    year: "2025",
    manufacturer: "Panini",
    cardNumber: "13",
    checklistSet: "Groovy",
    parallel: "Base",
    registryIdentityId: "c58ffc4f-e1c7-4cd9-b6e2-599af5a29044",
  },
  {
    inventoryItemId: "10b150ae-169d-4489-95b4-e289f497e28d",
    player: "Paige Bueckers",
    year: "2025",
    manufacturer: "Panini",
    cardNumber: "5",
    checklistSet: "Base",
    parallel: "Prizms Ice",
    registryIdentityId: "575556fe-fdd4-4083-baee-c5071ed3161f",
  },
  {
    inventoryItemId: "f66c97d0-a1ad-483c-b177-f49d386069d2",
    player: "Rickea Jackson",
    year: "2025",
    manufacturer: "Panini",
    cardNumber: "118",
    checklistSet: "Base",
    parallel: "Base",
    registryIdentityId: "70ad307e-06bb-45c2-90ea-689b6e2f302e",
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
    headers: { "User-Agent": "TCOS-InstaComp-Canonical-Proof/1.0" },
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
      "User-Agent": "TCOS-InstaComp-Canonical-Proof/1.0",
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
    user_metadata: { purpose: "instacomp_canonical_five_card_proof" },
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
  return { accountId, accessToken, email };
}

async function cleanupTestSeller(admin: SupabaseClient, accountId: string) {
  const cleanup: Json = { authDeleted: false, membershipDeleted: false, profileDeleted: false, errors: [] };
  const membership = await admin.from("account_store_memberships").delete().eq("account_id", accountId);
  if (membership.error) cleanup.errors.push(`membership:${membership.error.message}`);
  else cleanup.membershipDeleted = true;
  const profile = await admin.from("account_profiles").delete().eq("id", accountId);
  if (profile.error) cleanup.errors.push(`profile:${profile.error.message}`);
  else cleanup.profileDeleted = true;
  const auth = await admin.auth.admin.deleteUser(accountId);
  if (auth.error && !/not found/i.test(auth.error.message)) cleanup.errors.push(`auth:${auth.error.message}`);
  else cleanup.authDeleted = true;
  return cleanup;
}

function diagnosticSubset(payload: Json) {
  const ai = rec(payload.ai);
  const registry = rec(payload.checklistRegistry);
  const decision = rec(payload.identityDecision);
  const resolution = rec(payload.checklistResolution);
  return {
    ok: payload.ok === true,
    ai: {
      player: ai.player ?? null,
      year: ai.year ?? null,
      brand: ai.brand ?? ai.manufacturer ?? null,
      setName: ai.setName ?? ai.set_name ?? null,
      cardNumber: ai.cardNumber ?? ai.card_number ?? null,
      parallel: ai.parallel ?? null,
      serialNumber: ai.serialNumber ?? null,
      internalStatus: ai.internalStatus ?? null,
      internalChecklistOutcome: ai.internalChecklistOutcome ?? null,
      internalChecklistReasons: ai.internalChecklistReasons ?? [],
    },
    checklistRegistry: {
      matched: registry.matched ?? null,
      identityId: registry.identityId ?? null,
      fingerprintSha256: registry.fingerprintSha256 ?? null,
      status: registry.status ?? null,
      reasons: registry.reasons ?? [],
      candidateCount: registry.candidateCount ?? null,
      identityConfirmed: registry.identityConfirmed ?? null,
    },
    identityDecision: {
      confirmed: decision.confirmed ?? null,
      confidence: decision.confidence ?? null,
      threshold: decision.threshold ?? null,
      reviewReasons: decision.reviewReasons ?? [],
    },
    checklistResolution: {
      status: resolution.status ?? null,
      reasons: resolution.reasons ?? [],
    },
    error: payload.error ?? null,
  };
}

async function main() {
  const outputArg = process.argv.indexOf("--output");
  const output = outputArg >= 0
    ? process.argv[outputArg + 1]
    : "evidence/instacomp-five-card-canonical-proof/receipt.json";
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

  const ids = CARDS.map((card) => card.inventoryItemId);
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
  const itemById = new Map((itemsResult.data || []).map((item: any) => [String(item.id), item]));
  const imagesById = new Map<string, ImageRow[]>();
  for (const row of (imagesResult.data || []) as ImageRow[]) {
    const bucket = imagesById.get(row.inventory_item_id) || [];
    bucket.push(row);
    imagesById.set(row.inventory_item_id, bucket);
  }

  for (const expected of CARDS) {
    if (!itemById.has(expected.inventoryItemId)) {
      throw new Error(`Acceptance inventory item missing: ${expected.inventoryItemId}`);
    }
    if (!pair(imagesById.get(expected.inventoryItemId) || []).ready) {
      throw new Error(`Acceptance card lacks a front/back image pair: ${expected.inventoryItemId}`);
    }
  }

  const receipt: Json = {
    schema: "tcos.instacomp.fiveCardCanonicalProductionProof.v1",
    generatedAt: new Date().toISOString(),
    productionRoute: SCAN_URL,
    acceptanceContract: {
      exactInventoryIds: ids,
      registryAuthorityRequired: true,
      exactRegistryIdentityRequired: true,
      registryFingerprintRequired: true,
      identityDecisionConfirmedRequired: true,
      expectedCards: CARDS,
    },
    status: "running",
    testedCards: 0,
    passedCards: 0,
    results: [],
    cleanup: null,
  };
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);

  let accountId = "";
  try {
    const seller = await createTestSeller({ admin, supabaseUrl, anonKey });
    accountId = seller.accountId;

    for (const [index, expected] of CARDS.entries()) {
      const item: any = itemById.get(expected.inventoryItemId);
      const images = pair(imagesById.get(expected.inventoryItemId) || []);
      const startedAt = Date.now();
      const [front, back] = await Promise.all([
        download(images.frontUrl, "front"),
        download(images.backUrl, "back"),
      ]);
      const response = await callScanner(front, back, seller.accessToken);
      const payload = response.payload;
      const ai = rec(payload.ai);
      const registry = rec(payload.checklistRegistry);
      const decision = rec(payload.identityDecision);

      const actualIdentityId = txt(registry.identityId);
      const checks = {
        httpOk: response.ok,
        routeOk: payload.ok === true,
        player: norm(ai.player) === norm(expected.player),
        year: norm(ai.year) === norm(expected.year),
        manufacturer: norm(ai.brand || ai.manufacturer) === norm(expected.manufacturer),
        cardNumber: normCard(ai.cardNumber || ai.card_number) === normCard(expected.cardNumber),
        registryMatched: registry.matched === true,
        exactRegistryIdentity: actualIdentityId === expected.registryIdentityId,
        registryFingerprint: Boolean(txt(registry.fingerprintSha256)),
        identityConfirmed:
          decision.confirmed === true || registry.identityConfirmed === true,
      };
      const passed = Object.values(checks).every(Boolean);
      const result = {
        position: index + 1,
        inventoryItemId: expected.inventoryItemId,
        title: txt(item.title),
        expected,
        httpStatus: response.status,
        checks,
        passed,
        diagnostics: diagnosticSubset(payload),
        durationMs: Date.now() - startedAt,
      };
      receipt.results.push(result);
      receipt.testedCards = receipt.results.length;
      receipt.passedCards = receipt.results.filter((row: Json) => row.passed).length;
      await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
      console.log(
        `[${index + 1}/5] ${passed ? "PASS" : "FAIL"} ${result.title} | expectedIdentity=${expected.registryIdentityId} actualIdentity=${actualIdentityId || "none"} registryStatus=${txt(registry.status) || "none"} internal=${txt(ai.internalStatus) || "none"}`,
      );
    }
    receipt.status = receipt.passedCards === 5 ? "passed" : "failed";
  } finally {
    if (accountId) receipt.cleanup = await cleanupTestSeller(admin, accountId);
    receipt.finishedAt = new Date().toISOString();
    await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
  }

  console.log(JSON.stringify({
    status: receipt.status,
    testedCards: receipt.testedCards,
    passedCards: receipt.passedCards,
    cleanup: receipt.cleanup,
  }, null, 2));

  if (receipt.status !== "passed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
