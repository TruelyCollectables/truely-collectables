import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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

function projectRef(productionUrl) {
  const match = String(productionUrl || "").match(
    /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i,
  );
  if (!match) throw new Error("Production Supabase URL was not pulled from Vercel.");
  return match[1];
}

async function queryManagement({
  project,
  token,
  query,
  parameters = [],
  readOnly,
  stage,
}) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, parameters, read_only: readOnly }),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Supabase Management ${stage} failed with HTTP ${response.status}: ${text.slice(0, 800)}`,
    );
  }
  return text ? JSON.parse(text) : [];
}

async function main() {
  if (process.env.ALLOW_KINGMAKER_BECKETT_TRANSPORT_PREP !== "YES") {
    throw new Error("ALLOW_KINGMAKER_BECKETT_TRANSPORT_PREP=YES is required.");
  }
  const envPath = process.env.PRODUCTION_ENV_FILE;
  const token = process.env.GH_SUPABASE_ACCESS_TOKEN;
  if (!envPath || !token) {
    throw new Error("PRODUCTION_ENV_FILE and GH_SUPABASE_ACCESS_TOKEN are required.");
  }

  const env = parseEnv(readFileSync(envPath, "utf8"));
  const project = projectRef(env.NEXT_PUBLIC_SUPABASE_URL);
  const transportId = randomBytes(24).toString("hex");
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 4096,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const publicKeySha256 = createHash("sha256").update(publicKey).digest("hex");

  await queryManagement({
    project,
    token,
    readOnly: false,
    stage: "private transport table preparation",
    query: `
      create schema if not exists private;
      revoke all on schema private from public, anon, authenticated;
      create table if not exists private.tcos_kingmaker_beckett_transport_keys (
        transport_id text primary key,
        private_key_pem text not null,
        public_key_sha256 text not null,
        expires_at timestamptz not null,
        consumed_at timestamptz,
        created_at timestamptz not null default now()
      );
      revoke all on private.tcos_kingmaker_beckett_transport_keys
        from public, anon, authenticated;
    `,
  });

  await queryManagement({
    project,
    token,
    readOnly: false,
    stage: "private transport-key persistence",
    parameters: [transportId, privateKey, publicKeySha256, expiresAt.toISOString()],
    query: `
      insert into private.tcos_kingmaker_beckett_transport_keys (
        transport_id,
        private_key_pem,
        public_key_sha256,
        expires_at
      ) values ($1, $2, $3, $4::timestamptz);
    `,
  });

  const verification = await queryManagement({
    project,
    token,
    readOnly: true,
    stage: "private transport-key verification",
    parameters: [transportId, publicKeySha256],
    query: `
      select
        transport_id = $1 as transport_id_match,
        public_key_sha256 = $2 as public_key_match,
        expires_at > now() as unexpired,
        consumed_at is null as unused,
        length(private_key_pem) > 3000 as private_key_present
      from private.tcos_kingmaker_beckett_transport_keys
      where transport_id = $1;
    `,
  });
  const verified = Array.isArray(verification) ? verification[0] : verification;
  for (const field of [
    "transport_id_match",
    "public_key_match",
    "unexpired",
    "unused",
    "private_key_present",
  ]) {
    if (verified?.[field] !== true) {
      throw new Error(`Private transport-key verification failed: ${field}.`);
    }
  }

  const outputDirectory = resolve(
    process.cwd(),
    process.env.OUTPUT_DIR ||
      "evidence/kingmaker-beckett-transport-public-key-20260802-v2",
  );
  mkdirSync(outputDirectory, { recursive: true });
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
    publicKeySha256,
    privateRecord: "private.tcos_kingmaker_beckett_transport_keys",
    privateKeyPersistedOnlyInPrivateDatabase: true,
    publicKeyOnlyInArtifact: true,
    sourceFilesUploaded: false,
  };
  writeFileSync(resolve(outputDirectory, "public-key.pem"), publicKey, {
    mode: 0o644,
  });
  writeFileSync(
    resolve(outputDirectory, "transport.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o644 },
  );

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
        privateKeyPersistedOnlyInPrivateDatabase: true,
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
