import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";

const ORIGIN = "https://truelycollectables.com";
const SCAN_URL = `${ORIGIN}/api/instacomp/scan`;

const TRUTH = [
  {
    position: 1,
    inventoryItemId: "ef0e06a3-a6de-4242-8c52-52b420185850",
    player: "Sonia Citron",
    year: "2025",
    manufacturer: "Panini",
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
    setName: "Base",
    cardNumber: "118",
    parallel: "Base",
    registryIdentityId: "70ad307e-06bb-45c2-90ea-689b6e2f302e",
    frontSha256: "eb528a8e5de90e0ddb62e92ed3b5a2239819fb1c3fc27000ea1102a5b6f19728",
    backSha256: "28d445c8423a3bc96ca03e6294138a6980fa630825021d31e6acd115a29e329e",
  },
];

const txt = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const normalize = (value) => txt(value)
  .normalize("NFKD")
  .replace(/[’']/g, "")
  .replace(/[^a-z0-9]+/gi, " ")
  .trim()
  .toLowerCase();
const normalizeCardNumber = (value) => normalize(value).replace(/\s+/g, "");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function canonicalParallel(value) {
  const normalized = normalize(value);
  if (!normalized || ["base", "base card", "none", "null"].includes(normalized)) return "base";
  if (/\b(?:prizms?\s+ice|ice\s+prizm|cracked\s+ice(?:\s+prizm)?|white\s+cracked\s+ice\s+prizm)\b/.test(normalized)) {
    return "prizms ice";
  }
  return normalized;
}

function chooseImagePair(rows) {
  const ordered = rows
    .map((row) => ({
      url: txt(row.image_url),
      alt: txt(row.alt_text),
      order: Number(row.sort_order || 0),
      primary: row.is_primary === true,
    }))
    .filter((row) => row.url)
    .sort((a, b) => a.primary !== b.primary ? (a.primary ? -1 : 1) : a.order - b.order);

  const front = ordered.find((row) => /\bfront\b/i.test(row.alt))
    || ordered.find((row) => row.primary)
    || ordered[0];
  const back = ordered.find((row) => /\bback\b/i.test(row.alt) && row.url !== front?.url)
    || ordered.find((row) => !row.primary && row.url !== front?.url)
    || ordered.find((row) => row.url !== front?.url);

  if (!front?.url || !back?.url || front.url === back.url) {
    throw new Error("Distinct front/back image pair not found");
  }
  return { frontUrl: front.url, backUrl: back.url };
}

async function downloadImage(url, side) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "TCOS-InstaComp-Final-Acceptance/2.0" },
  });
  if (!response.ok) throw new Error(`${side} image HTTP ${response.status}`);
  const type = (response.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, file: new File([bytes], `${side}.jpg`, { type }) };
}

async function callScanner(front, back, serviceToken) {
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
      "x-tcos-instacomp-service-token": serviceToken,
      "User-Agent": "TCOS-InstaComp-Final-Acceptance/2.0",
    },
  });

  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { error: `Non-JSON response: ${raw.slice(0, 500)}` };
  }
  return { ok: response.ok, status: response.status, payload };
}

function scannerActual(payload) {
  const ai = record(payload.ai);
  const registry = record(payload.checklistRegistry);
  const decision = record(payload.identityDecision);
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

function diagnostics(payload) {
  const ai = record(payload.ai);
  const registry = record(payload.checklistRegistry);
  const decision = record(payload.identityDecision);
  const ocr = record(payload.ocrDiagnostics);
  return {
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
    },
    identityDecision: {
      confirmed: decision.confirmed ?? null,
      confidence: decision.confidence ?? null,
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

const output = process.argv[2];
const passLabel = process.argv[3] || "unspecified";
const serviceToken = txt(process.env.INSTACOMP_ACCEPTANCE_SERVICE_TOKEN);
const supabaseUrl = txt(process.env.NEXT_PUBLIC_SUPABASE_URL);
const serverKey = txt(process.env.SUPABASE_SERVICE_ROLE_KEY);
if (!output || !serviceToken || !supabaseUrl || !serverKey) {
  throw new Error("Acceptance output, service token, Supabase URL, and server key are required");
}

await mkdir(dirname(output), { recursive: true });
const db = createClient(supabaseUrl, serverKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const ids = TRUTH.map((item) => item.inventoryItemId);
const [inventoryQuery, imagesQuery] = await Promise.all([
  db.from("inventory_items").select("id,title,status").in("id", ids),
  db.from("inventory_images")
    .select("inventory_item_id,image_url,alt_text,sort_order,is_primary")
    .in("inventory_item_id", ids)
    .order("sort_order", { ascending: true }),
]);
if (inventoryQuery.error) throw new Error(`Inventory query failed: ${inventoryQuery.error.message}`);
if (imagesQuery.error) throw new Error(`Image query failed: ${imagesQuery.error.message}`);

const inventory = new Map((inventoryQuery.data || []).map((row) => [String(row.id), row]));
const images = new Map();
for (const row of imagesQuery.data || []) {
  const bucket = images.get(row.inventory_item_id) || [];
  bucket.push(row);
  images.set(row.inventory_item_id, bucket);
}

const receipt = {
  schema: "tcos.instacomp.finalProductionAcceptance.v2",
  generatedAt: new Date().toISOString(),
  passLabel,
  productionRoute: SCAN_URL,
  truthSource: {
    imageTruthArtifactId: 8994498762,
    registryCandidateArtifactId: 8993929571,
    answerKeyMode: "fixed_external_truth_not_inventory_title_or_metadata",
  },
  authentication: { mode: "temporary_instacomp_service_token" },
  testedCards: 0,
  passedCards: 0,
  status: "running",
  results: [],
};
await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);

for (const truth of TRUTH) {
  const item = inventory.get(truth.inventoryItemId);
  if (!item) throw new Error(`Frozen inventory item disappeared: ${truth.inventoryItemId}`);

  const pair = chooseImagePair(images.get(truth.inventoryItemId) || []);
  const started = Date.now();
  const [front, back] = await Promise.all([
    downloadImage(pair.frontUrl, "front"),
    downloadImage(pair.backUrl, "back"),
  ]);

  const frontHash = hash(front.bytes);
  const backHash = hash(back.bytes);
  const imageChecks = {
    frontSha256: frontHash === truth.frontSha256,
    backSha256: backHash === truth.backSha256,
  };

  if (!imageChecks.frontSha256 || !imageChecks.backSha256) {
    receipt.results.push({
      position: truth.position,
      inventoryItemId: truth.inventoryItemId,
      expected: truth,
      imageHashes: { front: frontHash, back: backHash },
      imageChecks,
      passed: false,
      failure: "Frozen Production image bytes changed",
      durationMs: Date.now() - started,
    });
    receipt.testedCards = receipt.results.length;
    await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
    continue;
  }

  const response = await callScanner(front.file, back.file, serviceToken);
  const actual = scannerActual(response.payload);
  const checks = {
    exactPhysicalImages: true,
    httpOk: response.ok,
    routeOk: response.payload.ok === true,
    player: normalize(actual.player) === normalize(truth.player),
    year: normalize(actual.year) === normalize(truth.year),
    manufacturer: normalize(actual.manufacturer) === normalize(truth.manufacturer),
    cardNumber: normalizeCardNumber(actual.cardNumber) === normalizeCardNumber(truth.cardNumber),
    parallel: canonicalParallel(actual.parallel) === canonicalParallel(truth.parallel),
    exactRegistryIdentity: actual.registryIdentityId === truth.registryIdentityId,
    registryFingerprintPresent: /^[a-f0-9]{64}$/i.test(actual.registryFingerprintSha256),
    registryMatched: actual.registryMatched,
    identityConfirmed: actual.identityConfirmed,
  };
  const passed = Object.values(checks).every(Boolean);

  receipt.results.push({
    position: truth.position,
    inventoryItemId: truth.inventoryItemId,
    title: txt(item.title),
    inventoryStatus: item.status,
    expected: truth,
    actual,
    imageHashes: { front: frontHash, back: backHash },
    checks,
    passed,
    diagnostics: diagnostics(response.payload),
    durationMs: Date.now() - started,
  });
  receipt.testedCards = receipt.results.length;
  receipt.passedCards = receipt.results.filter((result) => result.passed === true).length;
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`[${truth.position}/5] ${passed ? "PASS" : "FAIL"} ${truth.player} #${truth.cardNumber} ${truth.parallel} | got=${JSON.stringify(actual)}`);
}

receipt.status = receipt.testedCards === 5 && receipt.passedCards === 5 ? "passed" : "failed";
receipt.finishedAt = new Date().toISOString();
await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ passLabel, status: receipt.status, testedCards: receipt.testedCards, passedCards: receipt.passedCards }, null, 2));
if (receipt.status !== "passed") process.exit(1);
