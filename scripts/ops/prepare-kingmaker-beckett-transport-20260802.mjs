import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const BUCKET = "tcos-kingmaker-price-guide-sources";
const RECEIPT_SCHEMA = "tcos.kingmaker.beckettTransportPublicKey.v1";

function parseEnv(contents) {
  const parsed = {};
  for (const raw of String(contents || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function objectUrl(baseUrl, objectPath) {
  const encoded = objectPath.split("/").map(encodeURIComponent).join("/");
  return `${String(baseUrl).replace(/\/$/, "")}/storage/v1/object/${BUCKET}/${encoded}`;
}

async function uploadPrivateKey({ baseUrl, serviceKey, objectPath, privateKey }) {
  const response = await fetch(objectUrl(baseUrl, objectPath), {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/x-pem-file",
      "x-upsert": "false",
    },
    body: privateKey,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Private transport-key upload failed with HTTP ${response.status}: ${text.slice(0, 500)}`,
    );
  }
}

async function main() {
  if (process.env.ALLOW_KINGMAKER_BECKETT_TRANSPORT_PREP !== "YES") {
    throw new Error("ALLOW_KINGMAKER_BECKETT_TRANSPORT_PREP=YES is required.");
  }
  const envPath = process.env.PRODUCTION_ENV_FILE;
  if (!envPath) throw new Error("PRODUCTION_ENV_FILE is required.");

  const env = parseEnv(readFileSync(envPath, "utf8"));
  const baseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Production Supabase URL and service-role key are required.");
  }

  const transportId = randomBytes(24).toString("hex");
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 4096,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const privateObjectPath =
    `tcos/kingmaker/beckett/transport/${transportId}/private-key.pem`;

  await uploadPrivateKey({
    baseUrl,
    serviceKey,
    objectPath: privateObjectPath,
    privateKey,
  });

  const outputDirectory = resolve(
    process.cwd(),
    process.env.OUTPUT_DIR ||
      "evidence/kingmaker-beckett-transport-public-key-20260802",
  );
  mkdirSync(outputDirectory, { recursive: true });
  const publicKeyPath = resolve(outputDirectory, "public-key.pem");
  const manifestPath = resolve(outputDirectory, "transport.json");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const manifest = {
    schema: RECEIPT_SCHEMA,
    transportId,
    generatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    expectedMainSha: process.env.EXPECTED_MAIN_SHA || null,
    algorithm: {
      keyWrap: "RSA-OAEP-SHA256",
      payload: "AES-256-GCM",
      rsaBits: 4096,
    },
    publicKeySha256: createHash("sha256").update(publicKey).digest("hex"),
    privateObjectPath,
    privateKeyPersistedOnlyInPrivateStorage: true,
    publicKeyOnlyInArtifact: true,
    sourceFilesUploaded: false,
  };
  writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o644,
  });

  const safetyText = `${publicKey}\n${JSON.stringify(manifest)}`;
  if (/BEGIN PRIVATE KEY|sb_secret_|SUPABASE_SERVICE_ROLE_KEY/i.test(safetyText)) {
    throw new Error("Public transport artifact failed secret scan.");
  }
  console.log(
    JSON.stringify(
      {
        schema: manifest.schema,
        transportId: manifest.transportId,
        expiresAt: manifest.expiresAt,
        publicKeySha256: manifest.publicKeySha256,
        privateKeyPersistedOnlyInPrivateStorage: true,
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
