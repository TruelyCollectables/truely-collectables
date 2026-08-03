import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const LEARNING_PROVENANCE_MIGRATION =
  "supabase/migrations/20260802224500_instacomp_learning_provenance_receipt.sql";

const REQUIRED_VERIFICATION_FIELDS = [
  "payload_function",
  "observation_function",
  "observation_trigger",
  "cache_trigger",
  "service_role_execute",
  "public_roles_revoked",
  "observation_backfill_safe",
  "cache_backfill_safe",
];

export function parseEnvFileContents(contents) {
  const parsed = {};
  for (const rawLine of String(contents || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
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

export function productionProjectRef(productionUrl) {
  const match = String(productionUrl || "").match(
    /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i,
  );
  if (!match) {
    throw new Error("Production Supabase URL was not pulled from Vercel.");
  }
  return match[1];
}

export function assertLearningProvenanceVerification(row) {
  for (const field of REQUIRED_VERIFICATION_FIELDS) {
    if (row?.[field] !== true) {
      throw new Error(
        `Production learning-provenance verification failed: ${field}.`,
      );
    }
  }
}

export function learningProvenanceVerificationSql() {
  return `
    select
      to_regprocedure(
        'public.tcos_instacomp_payload_exact_identity_trusted(jsonb)'
      ) is not null as payload_function,
      to_regprocedure(
        'public.tcos_instacomp_observation_exact_identity_trusted(text,jsonb)'
      ) is not null as observation_function,
      exists (
        select 1
        from pg_trigger
        where tgrelid = 'public.tcos_card_knowledge_observations'::regclass
          and tgname = 'tcos_instacomp_observation_identity_trust_gate'
          and not tgisinternal
          and tgenabled <> 'D'
      ) as observation_trigger,
      exists (
        select 1
        from pg_trigger
        where tgrelid = 'public.instacomp_scan_knowledge_cache'::regclass
          and tgname = 'tcos_instacomp_cache_identity_trust_gate'
          and not tgisinternal
          and tgenabled <> 'D'
      ) as cache_trigger,
      has_function_privilege(
        'service_role',
        'public.tcos_instacomp_payload_exact_identity_trusted(jsonb)',
        'execute'
      )
        and has_function_privilege(
          'service_role',
          'public.tcos_instacomp_observation_exact_identity_trusted(text,jsonb)',
          'execute'
        ) as service_role_execute,
      not has_function_privilege(
        'anon',
        'public.tcos_instacomp_payload_exact_identity_trusted(jsonb)',
        'execute'
      )
        and not has_function_privilege(
          'authenticated',
          'public.tcos_instacomp_payload_exact_identity_trusted(jsonb)',
          'execute'
        )
        and not has_function_privilege(
          'anon',
          'public.tcos_instacomp_observation_exact_identity_trusted(text,jsonb)',
          'execute'
        )
        and not has_function_privilege(
          'authenticated',
          'public.tcos_instacomp_observation_exact_identity_trusted(text,jsonb)',
          'execute'
        ) as public_roles_revoked,
      not exists (
        select 1
        from public.tcos_card_knowledge_observations observation
        where (
          observation.confirmation_status = 'catalog_confirmed'
          and not public.tcos_instacomp_observation_exact_identity_trusted(
            observation.source_scan_id::text,
            coalesce(observation.result_payload, '{}'::jsonb)
          )
        ) or (
          observation.confirmation_status = 'operator_confirmed'
          and not public.tcos_instacomp_observation_exact_identity_trusted(
            observation.source_scan_id::text,
            coalesce(observation.result_payload, '{}'::jsonb)
          )
          and not public.tcos_instacomp_operator_identity_complete(
            coalesce(observation.operator_corrections, '{}'::jsonb),
            coalesce(observation.ai_result, '{}'::jsonb)
          )
        )
      ) as observation_backfill_safe,
      not exists (
        select 1
        from public.instacomp_scan_knowledge_cache cache
        where (
          cache.confirmation_status = 'catalog_confirmed'
          and not public.tcos_instacomp_payload_exact_identity_trusted(
            coalesce(cache.response_payload, '{}'::jsonb)
          )
        ) or (
          cache.confirmation_status = 'operator_confirmed'
          and not public.tcos_instacomp_payload_exact_identity_trusted(
            coalesce(cache.response_payload, '{}'::jsonb)
          )
          and not public.tcos_instacomp_operator_identity_complete(
            coalesce(cache.response_payload->'operatorCorrections', '{}'::jsonb),
            coalesce(cache.response_payload->'ai', '{}'::jsonb)
          )
        )
      ) as cache_backfill_safe;
  `;
}

async function managementQuery({
  endpoint,
  accessToken,
  query,
  readOnly,
  fetchImpl,
}) {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, parameters: [], read_only: readOnly }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Supabase Management query failed with HTTP ${response.status}: ${body.slice(0, 1200)}`,
    );
  }
  return body;
}

export async function applyAndVerifyLearningProvenance({
  productionEnvContents,
  accessToken,
  migrationSql,
  fetchImpl = fetch,
}) {
  if (!accessToken) {
    throw new Error(
      "SUPABASE_ACCESS_TOKEN is required for a changed migration.",
    );
  }
  const env = parseEnvFileContents(productionEnvContents);
  const projectRef = productionProjectRef(env.NEXT_PUBLIC_SUPABASE_URL);
  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

  await managementQuery({
    endpoint,
    accessToken,
    query: migrationSql,
    readOnly: false,
    fetchImpl,
  });
  const verificationBody = await managementQuery({
    endpoint,
    accessToken,
    query: learningProvenanceVerificationSql(),
    readOnly: true,
    fetchImpl,
  });
  const rows = JSON.parse(verificationBody);
  const row = Array.isArray(rows) ? rows[0] : rows;
  assertLearningProvenanceVerification(row);
  return row;
}

async function runSelfTest() {
  assert.deepEqual(
    parseEnvFileContents(
      "# comment\nNEXT_PUBLIC_SUPABASE_URL='https://abc123.supabase.co'\nVALUE=left=right\n",
    ),
    {
      NEXT_PUBLIC_SUPABASE_URL: "https://abc123.supabase.co",
      VALUE: "left=right",
    },
  );
  assert.equal(productionProjectRef("https://abc123.supabase.co"), "abc123");
  assert.throws(
    () => productionProjectRef("https://abc123.supabase.co.evil.example"),
    /Production Supabase URL/,
  );

  const verified = Object.fromEntries(
    REQUIRED_VERIFICATION_FIELDS.map((field) => [field, true]),
  );
  assert.doesNotThrow(() => assertLearningProvenanceVerification(verified));
  assert.throws(
    () =>
      assertLearningProvenanceVerification({
        ...verified,
        public_roles_revoked: false,
      }),
    /public_roles_revoked/,
  );

  const requests = [];
  const fetchImpl = async (endpoint, init) => {
    requests.push({ endpoint, init });
    return {
      ok: true,
      status: 200,
      text: async () =>
        requests.length === 1 ? "[]" : JSON.stringify([verified]),
    };
  };
  await applyAndVerifyLearningProvenance({
    productionEnvContents:
      "NEXT_PUBLIC_SUPABASE_URL=https://abc123.supabase.co\n",
    accessToken: "test-token",
    migrationSql: "select 1;",
    fetchImpl,
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.headers.Authorization, "Bearer test-token");
  assert.equal(JSON.parse(requests[0].init.body).read_only, false);
  assert.equal(JSON.parse(requests[1].init.body).read_only, true);
  assert.match(
    requests[1].endpoint,
    /^https:\/\/api\.supabase\.com\/v1\/projects\/abc123\//,
  );
  console.log(
    "InstaComp Production learning-provenance migration self-test passed.",
  );
}

async function main() {
  if (process.argv.includes("--self-test")) {
    await runSelfTest();
    return;
  }
  const productionEnvFile = process.env.PRODUCTION_ENV_FILE;
  if (!productionEnvFile) {
    throw new Error("PRODUCTION_ENV_FILE is required.");
  }
  await applyAndVerifyLearningProvenance({
    productionEnvContents: readFileSync(productionEnvFile, "utf8"),
    accessToken: process.env.GH_SUPABASE_ACCESS_TOKEN,
    migrationSql: readFileSync(LEARNING_PROVENANCE_MIGRATION, "utf8"),
  });
  console.log(
    "Production InstaComp learning provenance, triggers, grants, and backfill verified.",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
