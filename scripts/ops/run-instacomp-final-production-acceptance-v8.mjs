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
    registryFingerprintSha256: "4366f96b6cf8b136e5ae4da70c35539d56e1793de0a42bcccbf970a892791e59",
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
    registryFingerprintSha256: "112f66efaa6b13de4f33e18f632a5c364c8bd2895b610d157a538748c858ba32",
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
    registryFingerprintSha256: "dd4d9c92ff0cc4b985ef0b3aa29c8bcfb882ffe27021aa8809fde3c97db7a2ad",
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
    registryFingerprintSha256: "66531f084322d986e26c569e12a152bada033904c67b7068c00572c3efaa7d42",
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
    registryFingerprintSha256: "bdbf4845dae6d1da4d783fd23d9c387883769cd68aee3c663b144013bb891028",
    frontSha256: "eb528a8e5de90e0ddb62e92ed3b5a2239819fb1c3fc27000ea1102a5b6f19728",
    backSha256: "28d445c8423a3bc96ca03e6294138a6980fa630825021d31e6acd115a29e329e",
  },
];

const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const normalize = (value) => text(value)
  .normalize("NFKD")
  .replace(/[’']/g, "")
  .replace(/[^a-z0-9]+/gi, " ")
  .trim()
  .toLowerCase();
const normalizeCardNumber = (value) => normalize(value).replace(/\s+/g, "");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function canonicalParallel(value) {
  const normalized = normalize(value);
  if (!normalized || ["base", "base card", "none", "null", "standard", "regular"].includes(normalized)) return "base";
  if (/\b(?:prizms?\s+ice|ice\s+prizm|cracked\s+ice(?:\s+prizm)?|white\s+cracked\s+ice\s+prizm)\b/.test(normalized)) return "prizms ice";
  return normalized;
}

function chooseImagePair(rows) {
  const ordered = rows
    .map((row) => ({
      url: text(row.image_url),
      alt: text(row.alt_text),
      order: Number(row.sort_order || 0),
      primary: row.is_primary === true,
    }))
    .filter((row) => row.url)
    .sort((a, b) => a.primary !== b.primary ? (a.primary ? -1 : 1) : a.order - b.order);
  const front = ordered.find((row) => /\bfront\b/i.test(row.alt)) || ordered.find((row) => row.primary) || ordered[0];
  const back = ordered.find((row) => /\bback\b/i.test(row.alt) && row.url !== front?.url)
    || ordered.find((row) => !row.primary && row.url !== front?.url)
    || ordered.find((row) => row.url !== front?.url);
  if (!front?.url || !back?.url || front.url === back.url) throw new Error("Distinct frozen front/back image pair not found");
  return { frontUrl: front.url, backUrl: back.url };
}

async function downloadImage(url, side) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "TCOS-InstaComp-Final-Acceptance-V8/1.0" },
  });
  if (!response.ok) throw new Error(`${side} image HTTP ${response.status}`);
  const type = (response.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, file: new File([bytes], `${side}.jpg`, { type }) };
}

async function scan(front, back, token) {
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
      "x-tcos-instacomp-service-token": token,
      "User-Agent": "TCOS-InstaComp-Final-Acceptance-V8/1.0",
    },
  });
  const raw = await response.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; }
  catch { payload = { error: `Non-JSON response: ${raw.slice(0, 500)}` }; }
  return { httpOk: response.ok, httpStatus: response.status, payload };
}

function actualFrom(payload) {
  const ai = record(payload.ai);
  const registry = record(payload.checklistRegistry);
  const decision = record(payload.identityDecision);
  let confidence = Number(decision.confidence ?? registry.identityConfidence ?? NaN);
  if (Number.isFinite(confidence) && confidence > 1) confidence /= 100;
  return {
    player: text(ai.player),
    year: text(ai.year),
    manufacturer: text(ai.manufacturer || ai.brand),
    setName: text(ai.setName || ai.set_name),
    cardNumber: text(ai.cardNumber || ai.card_number),
    parallel: text(ai.parallel) || "Base",
    registryIdentityId: text(registry.identityId),
    registryFingerprintSha256: text(registry.fingerprintSha256).toLowerCase(),
    registryStatus: text(registry.status),
    registryMatched: registry.matched === true,
    identityConfirmed: decision.confirmed === true || registry.identityConfirmed === true,
    identityConfidence: Number.isFinite(confidence) ? confidence : null,
  };
}

function diagnostics(payload) {
  const ai = record(payload.ai);
  const registry = record(payload.checklistRegistry);
  const decision = record(payload.identityDecision);
  const consensus = record(payload.consensus);
  const escalation = record(payload.consensusEscalation);
  return {
    error: text(payload.error) || null,
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
    },
    identityDecision: {
      confirmed: decision.confirmed ?? null,
      confidence: decision.confidence ?? null,
      reviewReasons: decision.reviewReasons ?? null,
      explanation: decision.explanation ?? null,
    },
    consensus: {
      trustedForIdentity: consensus.trustedForIdentity ?? null,
      reviewReasons: consensus.reviewReasons ?? null,
      councilReadiness: consensus.councilReadiness ?? null,
      catalogReferee: consensus.catalogReferee ?? null,
      fieldDecisions: consensus.fieldDecisions ?? null,
    },
    consensusEscalation: escalation,
  };
}

const outputPath = process.argv[2];
const passLabel = process.argv[3] || "unspecified";
const token = text(process.env.INSTACOMP_ACCEPTANCE_SERVICE_TOKEN);
const supabaseUrl = text(process.env.NEXT_PUBLIC_SUPABASE_URL);
const serverKey = text(process.env.SUPABASE_SERVICE_ROLE_KEY);
if (!outputPath || !token || !supabaseUrl || !serverKey) throw new Error("Output path, isolated acceptance token, Supabase URL, and server key are required");

await mkdir(dirname(outputPath), { recursive: true });
const db = createClient(supabaseUrl, serverKey, { auth: { persistSession: false, autoRefreshToken: false } });
const ids = TRUTH.map((row) => row.inventoryItemId);
const [itemsResult, imagesResult] = await Promise.all([
  db.from("inventory_items").select("id").in("id", ids),
  db.from("inventory_images")
    .select("inventory_item_id,image_url,alt_text,sort_order,is_primary")
    .in("inventory_item_id", ids)
    .order("sort_order", { ascending: true }),
]);
if (itemsResult.error) throw new Error(`Inventory query failed: ${itemsResult.error.message}`);
if (imagesResult.error) throw new Error(`Image query failed: ${imagesResult.error.message}`);
const inventoryIds = new Set((itemsResult.data || []).map((row) => String(row.id)));
const images = new Map();
for (const row of imagesResult.data || []) {
  const bucket = images.get(row.inventory_item_id) || [];
  bucket.push(row);
  images.set(row.inventory_item_id, bucket);
}

const receipt = {
  schema: "tcos.instacomp.finalProductionAcceptance.v8",
  generatedAt: new Date().toISOString(),
  passLabel,
  productionRoute: SCAN_URL,
  truthSource: {
    imageTruthArtifactId: 8994498762,
    registryCandidateArtifactId: 8993929571,
    answerKeyMode: "fixed_external_truth_not_inventory_title_or_metadata",
  },
  requiredGate: "5/5 exact physical images + exact identity + exact Registry UUID/fingerprint + >=95% confirmed identity",
  testedCards: 0,
  passedCards: 0,
  status: "running",
  results: [],
};
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);

for (const truth of TRUTH) {
  const startedAt = Date.now();
  if (!inventoryIds.has(truth.inventoryItemId)) throw new Error(`Frozen inventory item disappeared: ${truth.inventoryItemId}`);
  const pair = chooseImagePair(images.get(truth.inventoryItemId) || []);
  const [front, back] = await Promise.all([
    downloadImage(pair.frontUrl, "front"),
    downloadImage(pair.backUrl, "back"),
  ]);
  const frontHash = sha256(front.bytes);
  const backHash = sha256(back.bytes);
  const imageChecks = {
    frontSha256: frontHash === truth.frontSha256,
    backSha256: backHash === truth.backSha256,
  };

  let scanResult = { httpOk: false, httpStatus: 0, payload: {} };
  let actual = actualFrom({});
  if (imageChecks.frontSha256 && imageChecks.backSha256) {
    scanResult = await scan(front.file, back.file, token);
    actual = actualFrom(scanResult.payload);
  }

  const checks = {
    exactPhysicalImages: imageChecks.frontSha256 && imageChecks.backSha256,
    httpOk: scanResult.httpOk,
    routeOk: scanResult.payload?.ok === true,
    player: normalize(actual.player) === normalize(truth.player),
    year: normalize(actual.year) === normalize(truth.year),
    manufacturer: normalize(actual.manufacturer) === normalize(truth.manufacturer),
    setName: normalize(actual.setName) === normalize(truth.setName),
    cardNumber: normalizeCardNumber(actual.cardNumber) === normalizeCardNumber(truth.cardNumber),
    parallel: canonicalParallel(actual.parallel) === canonicalParallel(truth.parallel),
    exactRegistryIdentity: actual.registryIdentityId === truth.registryIdentityId,
    exactRegistryFingerprint: actual.registryFingerprintSha256 === truth.registryFingerprintSha256,
    registryMatched: actual.registryMatched,
    identityConfirmed: actual.identityConfirmed,
    identityConfidenceGte95: actual.identityConfidence !== null && actual.identityConfidence >= 0.95,
  };
  const passed = Object.values(checks).every(Boolean);
  receipt.results.push({
    position: truth.position,
    inventoryItemId: truth.inventoryItemId,
    expected: truth,
    actual,
    imageHashes: { front: frontHash, back: backHash },
    checks,
    passed,
    httpStatus: scanResult.httpStatus,
    diagnostics: diagnostics(scanResult.payload),
    durationMs: Date.now() - startedAt,
  });
  receipt.testedCards = receipt.results.length;
  receipt.passedCards = receipt.results.filter((row) => row.passed === true).length;
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`[${truth.position}/5] ${passed ? "PASS" : "FAIL"} ${truth.player} #${truth.cardNumber} ${truth.setName}/${truth.parallel} | actual=${JSON.stringify(actual)}`);
}

receipt.status = receipt.testedCards === 5 && receipt.passedCards === 5 ? "passed" : "failed";
receipt.finishedAt = new Date().toISOString();
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ passLabel, status: receipt.status, testedCards: receipt.testedCards, passedCards: receipt.passedCards }, null, 2));
if (receipt.status !== "passed") process.exit(1);
