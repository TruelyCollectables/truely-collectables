import { createHash, randomBytes, randomUUID } from "node:crypto";
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

type Truth = {
  position: number;
  inventoryItemId: string;
  player: string;
  year: "2025";
  manufacturer: "Panini";
  product: "2025 Panini Prizm WNBA";
  setName: string;
  cardNumber: string;
  parallel: "Base" | "Prizms Ice";
  registryIdentityId: string;
  frontSha256: string;
  backSha256: string;
};

const ORIGIN = "https://truelycollectables.com";
const SCAN_URL = `${ORIGIN}/api/instacomp/scan`;
const TEST_EMAIL_PREFIX = "instacomp-frozen-five-";

// Frozen from Production image-truth artifact 8994498762 and Registry candidate artifact 8993929571.
// Do not derive these values from inventory title, metadata, or scanner output.
const TRUTH: Truth[] = [
  {
    position: 1,
    inventoryItemId: "ef0e06a3-a6de-4242-8c52-52b420185850",
    player: "Sonia Citron",
    year: "2025",
    manufacturer: "Panini",
    product: "2025 Panini Prizm WNBA",
    setName: "Base",
    cardNumber: "122",
    parallel: "Base",
    registryIdentityId: "2a7d4ddd-e9f7-4ce2-904c-b1a17b33ae4f",
    frontSha256: "eaacec37493b419f1d397df739aedd9df218639ded876c481b2fb28b2b3eb2b1",
    backSha256: "3ecd070456e09342ed83ca88193ed2d029cd8a77ed5b2e2ae1ce443e9866978c",
  },
  {
    position: 2,
    inventoryItemId: "0916fe9d-2837-4d91-add4-73e7216705cd",
    player: "Dominique Malonga",
    year: "2025",
    manufacturer: "Panini",
    product: "2025 Panini Prizm WNBA",
    setName: "Base",
    cardNumber: "116",
    parallel: "Prizms Ice",
    registryIdentityId: "bde0577b-72e8-4e59-8287-89aaf2f9e7e2",
    frontSha256: "d165d8e537a6501711e0b0b789866ac5ab053a3e09216a39108c71c6485fd955",
    backSha256: "e3aba4b0e5f59ec6473f78e1b69bab3d8d377f1ecb72f9b13ac7dbf0d02e56cf",
  },
  {
    position: 3,
    inventoryItemId: "66f9ad9e-43fb-4b2b-b79c-ac99fa082de0",
    player: "Sonia Citron",
    year: "2025",
    manufacturer: "Panini",
    product: "2025 Panini Prizm WNBA",
    setName: "Groovy",
    cardNumber: "13",
    parallel: "Base",
    registryIdentityId: "c58ffc4f-e1c7-4cd9-b6e2-599af5a29044",
    frontSha256: "d168765374b348074c0f194fb15d099eaafe802f543c76bccf8147f391499c02",
    backSha256: "f40ca7f4862e856e47990f4296655306a89f92d2dcd0261b661a07cf82a73e24",
  },
  {
    position: 4,
    inventoryItemId: "f7d73af4-7299-4ed6-b663-39206f2576ee",
    player: "Paige Bueckers",
    year: "2025",
    manufacturer: "Panini",
    product: "2025 Panini Prizm WNBA",
    setName: "Base",
    cardNumber: "5",
    parallel: "Prizms Ice",
    registryIdentityId: "575556fe-fdd4-4083-baee-c5071ed3161f",
    frontSha256: "689101749388e0113da8d8c3270e250e4275dfb043d0c16fce0bd584b0d3bdb2",
    backSha256: "5f44fd564f69868f0cdf48c083e5198f18dc5e1d732b2fe284ca29b407e8de8c",
  },
  {
    position: 5,
    inventoryItemId: "e9335a9d-3cc1-48d3-92db-7be7468714a9",
    player: "Rickea Jackson",
    year: "2025",
    manufacturer: "Panini",
    product: "2025 Panini Prizm WNBA",
    setName: "Base",
    cardNumber: "118",
    parallel: "Base",
    registryIdentityId: "70ad307e-06bb-45c2-90ea-689b6e2f302e",
    frontSha256: "eb528a8e5de90e0ddb62e92ed3b5a2239819fb1c3fc27000ea1102a5b6f19728",
    backSha256: "28d445c8423a3bc96ca03e6294138a6980fa630825021d31e6acd115a29e329e",
  },
];

function rec(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
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
function canonicalParallel(value: unknown) {
  const v = norm(value);
  if (!v || ["base", "base card", "none", "null"].includes(v)) return "base";
  if (/\b(?:prizms?\s+ice|ice\s+prizm|cracked\s+ice(?:\s+prizm)?|white\s+cracked\s+ice\s+prizm)\b/.test(v)) return "prizms ice";
  return v;
}
function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function choosePair(rows: ImageRow[]) {
  const ordered = rows
    .map((row) => ({
      url: txt(row.image_url),
      alt: txt(row.alt_text),
      order: Number(row.sort_order || 0),
      primary: row.is_primary === true,
    }))
    .filter((row) => row.url)
    .sort((a, b) => (a.primary !== b.primary ? (a.primary ? -1 : 1) : a.order - b.order));
  const front = ordered.find((row) => /\bfront\b/i.test(row.alt)) || ordered.find((row) => row.primary) || ordered[0];
  const back = ordered.find((row) => /\bback\b/i.test(row.alt) && row.url !== front?.url)
    || ordered.find((row) => !row.primary && row.url !== front?.url)
    || ordered.find((row) => row.url !== front?.url);
  if (!front?.url || !back?.url || front.url === back.url) throw new Error("Distinct front/back image pair not found");
  return { frontUrl: front.url, backUrl: back.url };
}

async function download(url: string, side: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "TCOS-InstaComp-Frozen-Five-Proof/1.0" },
  });
  if (!response.ok) throw new Error(`${side} image returned HTTP ${response.status}`);
  const type = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, file: new File([bytes], `${side}.jpg`, { type }) };
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
      "User-Agent": "TCOS-InstaComp-Frozen-Five-Proof/1.0",
    },
  });
  const raw = await response.text();
  let payload: Json;
  try { payload = raw ? JSON.parse(raw) : {}; }
  catch { payload = { error: `Non-JSON response: ${raw.slice(0, 500)}` }; }
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
  const stale = listed.data.users.filter((user) => String(user.email || "").toLowerCase().startsWith(TEST_EMAIL_PREFIX));
  for (const user of stale) await deleteTestAccount(admin, user.id);
  return stale.length;
}

async function createTestSeller(admin: SupabaseClient, supabaseUrl: string, anonKey: string) {
  const email = `${TEST_EMAIL_PREFIX}${Date.now()}-${randomUUID()}@truelycollectables.com`;
  const password = `${randomBytes(32).toString("base64url")}Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { purpose: "instacomp_frozen_five_production_proof" },
  });
  if (created.error || !created.data.user) throw new Error(`Could not create test seller: ${created.error?.message || "no user"}`);
  const accountId = created.data.user.id;
  const updated = await admin.from("account_profiles").update({ account_status: "active" }).eq("id", accountId).select("id").maybeSingle();
  if (updated.error) throw new Error(`Profile activation failed: ${updated.error.message}`);
  if (!updated.data) {
    const inserted = await admin.from("account_profiles").insert({ id: accountId, account_status: "active" });
    if (inserted.error) throw new Error(`Profile insert failed: ${inserted.error.message}`);
  }
  const membership = await admin.from("account_store_memberships").insert({
    account_id: accountId,
    store_id: FLAGSHIP_STORE_ID,
    role: "seller",
    status: "active",
  });
  if (membership.error) throw new Error(`Membership insert failed: ${membership.error.message}`);
  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await authClient.auth.signInWithPassword({ email, password });
  const accessToken = txt(signedIn.data.session?.access_token);
  if (signedIn.error || !accessToken) throw new Error(`Test seller sign-in failed: ${signedIn.error?.message || "no token"}`);
  return { accountId, accessToken };
}

function actualIdentity(payload: Json) {
  const ai = rec(payload.ai);
  const registry = rec(payload.checklistRegistry);
  const decision = rec(payload.identityDecision);
  return {
    player: txt(ai.player),
    year: txt(ai.year),
    manufacturer: txt(ai.manufacturer || ai.brand),
    setName: txt(ai.setName || ai.set_name),
    cardNumber: txt(ai.cardNumber || ai.card_number),
    parallel: txt(ai.parallel) || "Base",
    registryIdentityId: txt(registry.identityId),
    registryFingerprintSha256: txt(registry.fingerprintSha256),
    registryStatus: txt(registry.status),
    registryMatched: registry.matched === true,
    identityConfirmed: decision.confirmed === true || registry.identityConfirmed === true,
    identityConfidence: decision.confidence ?? registry.identityConfidence ?? null,
  };
}

function safeDiagnostics(payload: Json) {
  const ai = rec(payload.ai);
  const registry = rec(payload.checklistRegistry);
  const decision = rec(payload.identityDecision);
  const ocr = rec(payload.ocrDiagnostics);
  return {
    responseKeys: Object.keys(payload).sort(),
    error: txt(payload.error) || null,
    note: txt(payload.note) || null,
    ai: {
      player: ai.player ?? null,
      year: ai.year ?? null,
      manufacturer: ai.manufacturer ?? ai.brand ?? null,
      setName: ai.setName ?? ai.set_name ?? null,
      cardNumber: ai.cardNumber ?? ai.card_number ?? null,
      parallel: ai.parallel ?? null,
      internalStatus: ai.internalStatus ?? null,
      internalChecklistOutcome: ai.internalChecklistOutcome ?? null,
      internalChecklistReasons: ai.internalChecklistReasons ?? null,
    },
    checklistRegistry: {
      matched: registry.matched ?? null,
      identityId: registry.identityId ?? null,
      fingerprintSha256: registry.fingerprintSha256 ?? null,
      status: registry.status ?? null,
      reasons: registry.reasons ?? null,
      candidateCount: registry.candidateCount ?? null,
      identityConfirmed: registry.identityConfirmed ?? null,
      identityConfidence: registry.identityConfidence ?? null,
      identityThreshold: registry.identityThreshold ?? null,
    },
    identityDecision: {
      confirmed: decision.confirmed ?? null,
      confidence: decision.confidence ?? null,
      threshold: decision.threshold ?? null,
      reviewReasons: decision.reviewReasons ?? null,
      explanation: decision.explanation ?? null,
    },
    ocrDiagnostics: {
      primaryAiProvider: ocr.primaryAiProvider ?? null,
      primaryAiFamily: ocr.primaryAiFamily ?? null,
      textExcerpt: txt(ocr.textExcerpt).slice(0, 1200) || null,
      conflicts: ocr.conflicts ?? null,
    },
  };
}

async function main() {
  const outputArg = process.argv.indexOf("--output");
  const output = outputArg >= 0 ? process.argv[outputArg + 1] : "evidence/instacomp-frozen-five-production-proof/receipt.json";
  await mkdir(dirname(output), { recursive: true });

  const supabaseUrl = txt(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = txt(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const anonKey = txt(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!supabaseUrl || !serviceKey || !anonKey) throw new Error("Production Supabase URL, service-role JWT, and anon key are required");

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const staleAccountsDeleted = await cleanStaleTestAccounts(admin);
  const receipt: Json = {
    schema: "tcos.instacomp.frozenFiveProductionProof.v1",
    generatedAt: new Date().toISOString(),
    productionRoute: SCAN_URL,
    truthSource: {
      imageTruthArtifactId: 8994498762,
      registryCandidateArtifactId: 8993929571,
      answerKeyMode: "fixed_external_truth_not_inventory_title_or_metadata",
    },
    staleAccountsDeleted,
    temporarySeller: { created: false, deleted: false },
    status: "running",
    testedCards: 0,
    passedCards: 0,
    results: [],
  };
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);

  let accountId = "";
  try {
    const seller = await createTestSeller(admin, supabaseUrl, anonKey);
    accountId = seller.accountId;
    receipt.temporarySeller.created = true;

    const ids = TRUTH.map((row) => row.inventoryItemId);
    const [itemsQuery, imagesQuery] = await Promise.all([
      admin.from("inventory_items").select("id,title,status").in("id", ids),
      admin.from("inventory_images").select("inventory_item_id,image_url,alt_text,sort_order,is_primary").in("inventory_item_id", ids).order("sort_order", { ascending: true }),
    ]);
    if (itemsQuery.error) throw new Error(`Inventory query failed: ${itemsQuery.error.message}`);
    if (imagesQuery.error) throw new Error(`Image query failed: ${imagesQuery.error.message}`);
    const items = new Map((itemsQuery.data || []).map((row) => [String(row.id), row]));
    const images = new Map<string, ImageRow[]>();
    for (const row of (imagesQuery.data || []) as ImageRow[]) {
      const bucket = images.get(row.inventory_item_id) || [];
      bucket.push(row);
      images.set(row.inventory_item_id, bucket);
    }

    for (const truth of TRUTH) {
      const item = items.get(truth.inventoryItemId);
      if (!item) throw new Error(`Frozen inventory item disappeared: ${truth.inventoryItemId}`);
      const pair = choosePair(images.get(truth.inventoryItemId) || []);
      const startedAt = Date.now();
      const [front, back] = await Promise.all([download(pair.frontUrl, "front"), download(pair.backUrl, "back")]);
      const frontHash = sha256(front.bytes);
      const backHash = sha256(back.bytes);
      const imageChecks = {
        frontSha256: frontHash === truth.frontSha256,
        backSha256: backHash === truth.backSha256,
      };
      if (!imageChecks.frontSha256 || !imageChecks.backSha256) {
        const result = {
          position: truth.position,
          inventoryItemId: truth.inventoryItemId,
          title: txt(item.title),
          expected: truth,
          imageHashes: { front: frontHash, back: backHash },
          imageChecks,
          passed: false,
          failure: "Frozen Production image bytes changed after truth audit; proof aborted for this card.",
          durationMs: Date.now() - startedAt,
        };
        receipt.results.push(result);
        receipt.testedCards = receipt.results.length;
        await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
        console.log(`[${truth.position}/5] FAIL image-truth hash changed ${truth.inventoryItemId}`);
        continue;
      }

      const response = await callScanner(front.file, back.file, seller.accessToken);
      const actual = actualIdentity(response.payload);
      const checks = {
        exactPhysicalImages: true,
        httpOk: response.ok,
        routeOk: response.payload.ok === true,
        player: norm(actual.player) === norm(truth.player),
        year: norm(actual.year) === norm(truth.year),
        manufacturer: norm(actual.manufacturer) === norm(truth.manufacturer),
        cardNumber: normCard(actual.cardNumber) === normCard(truth.cardNumber),
        parallel: canonicalParallel(actual.parallel) === canonicalParallel(truth.parallel),
        exactRegistryIdentity: actual.registryIdentityId === truth.registryIdentityId,
        registryFingerprintPresent: /^[a-f0-9]{64}$/i.test(actual.registryFingerprintSha256),
        registryMatched: actual.registryMatched,
        identityConfirmed: actual.identityConfirmed,
      };
      const passed = Object.values(checks).every(Boolean);
      const result = {
        position: truth.position,
        inventoryItemId: truth.inventoryItemId,
        title: txt(item.title),
        inventoryStatus: item.status,
        expected: truth,
        actual,
        imageHashes: { front: frontHash, back: backHash },
        checks,
        passed,
        diagnostics: safeDiagnostics(response.payload),
        durationMs: Date.now() - startedAt,
      };
      receipt.results.push(result);
      receipt.testedCards = receipt.results.length;
      receipt.passedCards = receipt.results.filter((row: Json) => row.passed === true).length;
      await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
      console.log(`[${truth.position}/5] ${passed ? "PASS" : "FAIL"} ${truth.player} #${truth.cardNumber} ${truth.setName} ${truth.parallel} | got=${JSON.stringify(actual)}`);
    }

    receipt.status = receipt.testedCards === 5 && receipt.passedCards === 5 ? "passed" : "failed";
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
    temporarySellerDeleted: receipt.temporarySeller.deleted,
  }, null, 2));

  if (receipt.temporarySeller.deleted !== true) process.exitCode = 2;
  else if (receipt.status !== "passed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
