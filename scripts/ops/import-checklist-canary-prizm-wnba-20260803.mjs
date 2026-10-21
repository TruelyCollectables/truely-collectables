import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

const SOURCE_BUCKET = "tcos-checklist-source-files";
const EXPECTED_ADAPTER = "expanded-checklist-spreadsheet";
const EXPECTED_ADAPTER_VERSION = "1.0.0";
const SOURCE = {
  id: "2024-panini-prizm-wnba",
  releaseSlug: "2024-panini-prizm-wnba",
  rawSha256: "7caae8b8591a5aa4c9127789e47a3c56fc8d3a1c164efb13081e259fb40e859c",
  normalizedPlanSha256: "e3d529384fc3778732f1f4fc6897079154506cb167b39f14d02bd60bd2b28159",
  sets: 12,
  cards: 337,
  parallels: 121,
  identities: 6_702,
  fingerprints: [
    "5953e2b69f9358ab313832b2ba6125d8affd9d188deb24f22626046f92eec074",
    "276eece3df1bf713b7ac22756cbe47e911b5c9cdfaea08c67b3fc2bc880a2291",
  ],
};
const EXPECTED_BASELINE = {
  releases: 297,
  active_versions: 297,
  active_cards: 35_987,
  active_identities: 44_216,
};
const EXPECTED_AFTER = {
  releases: 298,
  active_versions: 298,
  active_cards: 36_324,
  active_identities: 50_918,
};

function requireApplyGate() {
  if (!process.argv.includes("--apply")) {
    throw new Error("Production canary import requires the explicit --apply flag.");
  }
  if (process.env.ALLOW_PRODUCTION_CHECKLIST_CANARY_IMPORT !== "YES") {
    throw new Error(
      "Production canary import requires ALLOW_PRODUCTION_CHECKLIST_CANARY_IMPORT=YES.",
    );
  }
}

function argumentValue(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1]
    ? process.argv[index + 1]
    : fallback;
}

function artifactRoot() {
  const value = argumentValue("--artifact-root", process.env.ARTIFACT_ROOT);
  if (!value) throw new Error("Missing --artifact-root.");
  return resolve(process.cwd(), value);
}

function receiptPath() {
  return resolve(
    process.cwd(),
    argumentValue(
      "--receipt",
      "evidence/checklist-canary-prizm-wnba-20260803/production-import.json",
    ),
  );
}

function failurePath() {
  return resolve(
    process.cwd(),
    argumentValue(
      "--failure-receipt",
      "evidence/checklist-canary-prizm-wnba-20260803/failure.json",
    ),
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedPlanDigest(plan) {
  return sha256(
    JSON.stringify({
      schema: "tcos.checklist.normalizedDigest.v1",
      adapterId: plan.adapterId,
      adapterVersion: plan.adapterVersion,
      release: plan.release,
      sets: plan.sets,
      cards: plan.cards,
      parallels: plan.parallels,
      identities: plan.identities,
    }),
  );
}

function prepareSource(root) {
  const directory = join(root, "private", SOURCE.id);
  const planPath = join(directory, `${SOURCE.id}.plan.json`);
  const rawPath = join(directory, `${SOURCE.id}.xlsx`);
  const planBytes = readFileSync(planPath);
  const rawBytes = readFileSync(rawPath);
  const plan = JSON.parse(planBytes.toString("utf8"));
  const counts = plan?.validation?.counts || {};
  const storage = plan?.source?.storage || {};
  const fingerprints = (plan.identities || []).map(
    (entry) => entry?.fingerprint?.fingerprintSha256,
  );
  const failures = [];
  const checks = [
    ["releaseSlug", plan?.release?.releaseSlug, SOURCE.releaseSlug],
    ["adapterId", plan?.adapterId, EXPECTED_ADAPTER],
    ["adapterVersion", plan?.adapterVersion, EXPECTED_ADAPTER_VERSION],
    ["validationStatus", plan?.validation?.status, "passed"],
    ["sourceAuthority", plan?.source?.authority, "approved_reference_dataset"],
    ["privateArchiveRequired", plan?.source?.privateArchiveRequired, true],
    ["sourceIsPublic", storage?.isPublic, false],
    ["sourceBucket", storage?.bucket, SOURCE_BUCKET],
    ["sets", Number(counts.sets), SOURCE.sets],
    ["cards", Number(counts.cards), SOURCE.cards],
    ["parallels", Number(counts.parallels), SOURCE.parallels],
    ["identities", Number(counts.identities), SOURCE.identities],
    ["rawSha256", sha256(rawBytes), SOURCE.rawSha256],
    ["storageSha256", storage?.sha256, SOURCE.rawSha256],
    ["storageSizeBytes", Number(storage?.sizeBytes), rawBytes.length],
    [
      "normalizedPlanSha256",
      normalizedPlanDigest(plan),
      SOURCE.normalizedPlanSha256,
    ],
  ];
  for (const [label, actual, expected] of checks) {
    if (actual !== expected) {
      failures.push(`${label}=${String(actual)}, expected=${String(expected)}`);
    }
  }
  if (!storage?.objectPath || !storage?.originalFilename || !storage?.mimeType) {
    failures.push("source storage receipt is incomplete");
  }
  if (new Set(fingerprints).size !== fingerprints.length) {
    failures.push("duplicate physical-printing fingerprints");
  }
  for (const fingerprint of SOURCE.fingerprints) {
    if (!fingerprints.includes(fingerprint)) {
      failures.push(`missing known fingerprint ${fingerprint}`);
    }
  }
  const validationErrors = (plan?.validation?.issues || []).filter(
    (issue) => issue?.severity === "error",
  );
  failures.push(
    ...validationErrors.map(
      (issue) => `${issue.code || "error"}: ${issue.message || "unknown"}`,
    ),
  );
  if (failures.length) {
    throw new Error(`Canary preparation blocked: ${failures.join("; ")}`);
  }
  return { plan, rawBytes, planPath, rawPath };
}

function managementContext() {
  const accessToken = String(process.env.GH_SUPABASE_ACCESS_TOKEN || "");
  const productionUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  if (!accessToken || !productionUrl) {
    throw new Error("Production Management API credentials are incomplete.");
  }
  const projectRef = new URL(productionUrl).hostname.split(".")[0];
  if (!projectRef) throw new Error("Could not resolve Production project ref.");
  return { accessToken, productionUrl, projectRef };
}

async function managementRequest({
  path,
  method = "GET",
  body,
  allowFailure = false,
}) {
  const { accessToken } = managementContext();
  const response = await fetch(`https://api.supabase.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok && !allowFailure) {
    throw new Error(
      `Supabase Management API ${method} ${path} failed with HTTP ${response.status}: ${text.slice(0, 800)}`,
    );
  }
  if (!response.ok) return null;
  return text ? JSON.parse(text) : {};
}

async function managementQuery({ label, query, readOnly }) {
  const { projectRef } = managementContext();
  const response = await managementRequest({
    path: `/v1/projects/${projectRef}/database/query`,
    method: "POST",
    body: { query, parameters: [], read_only: readOnly },
  });
  if (!Array.isArray(response)) {
    throw new Error(`Supabase ${label} returned an unexpected payload.`);
  }
  return response;
}

async function auditProduction(label) {
  const query = `with active_versions as (
      select * from public.checklist_versions where is_active
    ), identity_counts as (
      select v.id, v.normalized_identity_count as expected_identities,
        count(i.id)::bigint as actual_identities
      from active_versions v
      left join public.checklist_card_identities i on i.version_id = v.id
      group by v.id, v.normalized_identity_count
    ), target_rows as (
      select r.slug as release_slug,
        r.id as release_id,
        v.id as active_version_id,
        r.metadata->>'latestAdapterId' as adapter_id,
        v.normalized_card_count as expected_cards,
        v.normalized_identity_count as expected_identities,
        (select count(*) from public.checklist_cards c where c.version_id = v.id) as cards,
        (select count(*) from public.checklist_card_identities i where i.version_id = v.id) as identities
      from public.checklist_releases r
      join active_versions v on v.release_id = r.id
      where r.slug = '${SOURCE.releaseSlug}'
    )
    select json_build_object(
      'releases', (select count(*) from public.checklist_releases),
      'active_versions', (select count(*) from active_versions),
      'active_cards', (
        select count(*) from public.checklist_cards c
        join active_versions v on v.id = c.version_id
      ),
      'active_identities', (
        select count(*) from public.checklist_card_identities i
        join active_versions v on v.id = i.version_id
      ),
      'identity_deficit_versions', (
        select count(*) from identity_counts
        where actual_identities <> expected_identities
      ),
      'failed_import_runs', (
        select count(*) from public.checklist_import_runs where status = 'failed'
      ),
      'registry_public_grants', (
        select count(*) from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name like 'checklist\\_%' escape '\\'
          and grantee in ('anon', 'authenticated')
      ),
      'writer_rpc', to_regprocedure(
        'public.tcos_apply_checklist_import_plan(jsonb,text,text,bigint,text,text,text)'
      ) is not null,
      'private_source_bucket', exists (
        select 1 from storage.buckets
        where id = '${SOURCE_BUCKET}' and public = false
      ),
      'temporary_login_roles', (
        select count(*) from pg_roles where rolname like 'cli_login_%'
      ),
      'targets', coalesce((
        select jsonb_agg(to_jsonb(target_rows) order by release_slug)
        from target_rows
      ), '[]'::jsonb)
    ) as state;`;
  const rows = await managementQuery({
    label: `${label} audit`,
    query,
    readOnly: true,
  });
  const state = rows?.[0]?.state;
  if (!state) throw new Error(`Supabase ${label} audit returned no state.`);
  state.targets = Array.isArray(state.targets) ? state.targets : [];
  return state;
}

function requireHealthyState(state, label) {
  const failures = [];
  if (Number(state.identity_deficit_versions) !== 0) {
    failures.push(`identity_deficit_versions=${state.identity_deficit_versions}`);
  }
  if (Number(state.failed_import_runs) !== 0) {
    failures.push(`failed_import_runs=${state.failed_import_runs}`);
  }
  if (Number(state.registry_public_grants) !== 0) {
    failures.push(`registry_public_grants=${state.registry_public_grants}`);
  }
  if (state.writer_rpc !== true) failures.push("writer_rpc=false");
  if (state.private_source_bucket !== true) failures.push("private_source_bucket=false");
  if (failures.length) {
    throw new Error(`Production ${label} health blocked: ${failures.join(", ")}`);
  }
}

function requireExactBaseline(state) {
  requireHealthyState(state, "baseline");
  const failures = [];
  for (const [key, expected] of Object.entries(EXPECTED_BASELINE)) {
    if (Number(state[key]) !== expected) {
      failures.push(`${key}=${state[key]}, expected=${expected}`);
    }
  }
  if (Number(state.temporary_login_roles) !== 0) {
    failures.push(`temporary_login_roles=${state.temporary_login_roles}, expected=0`);
  }
  if (state.targets.length !== 0) {
    failures.push(`target ${SOURCE.releaseSlug} already exists`);
  }
  if (failures.length) {
    throw new Error(`Production baseline blocked: ${failures.join("; ")}`);
  }
}

function requireExactImportedState(state, label, expectedTemporaryRoles) {
  requireHealthyState(state, label);
  const failures = [];
  for (const [key, expected] of Object.entries(EXPECTED_AFTER)) {
    if (Number(state[key]) !== expected) {
      failures.push(`${key}=${state[key]}, expected=${expected}`);
    }
  }
  if (Number(state.temporary_login_roles) !== expectedTemporaryRoles) {
    failures.push(
      `temporary_login_roles=${state.temporary_login_roles}, expected=${expectedTemporaryRoles}`,
    );
  }
  if (state.targets.length !== 1) {
    failures.push(`targets=${state.targets.length}, expected=1`);
  } else {
    const target = state.targets[0];
    const checks = [
      ["release_slug", target.release_slug, SOURCE.releaseSlug],
      ["adapter_id", target.adapter_id, EXPECTED_ADAPTER],
      ["cards", Number(target.cards), SOURCE.cards],
      ["expected_cards", Number(target.expected_cards), SOURCE.cards],
      ["identities", Number(target.identities), SOURCE.identities],
      [
        "expected_identities",
        Number(target.expected_identities),
        SOURCE.identities,
      ],
    ];
    for (const [name, actual, expected] of checks) {
      if (actual !== expected) {
        failures.push(`${name}=${String(actual)}, expected=${String(expected)}`);
      }
    }
  }
  if (failures.length) {
    throw new Error(`Production ${label} verification blocked: ${failures.join("; ")}`);
  }
}

async function createTemporaryLoginRole() {
  const { projectRef } = managementContext();
  const payload = await managementRequest({
    path: `/v1/projects/${projectRef}/cli/login-role`,
    method: "POST",
    body: { read_only: false },
  });
  if (!payload?.role || !payload?.password || !payload?.ttl_seconds) {
    throw new Error("Supabase temporary login role response was incomplete.");
  }
  console.log(`::add-mask::${payload.password}`);
  return payload;
}

async function deleteTemporaryLoginRole() {
  const { projectRef } = managementContext();
  await managementRequest({
    path: `/v1/projects/${projectRef}/cli/login-role`,
    method: "DELETE",
  });
}

function parseConnectionString(value, user, password, poolMode) {
  const url = new URL(String(value).replace(/^postgres:\/\//, "postgresql://"));
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.replace(/^\//, "") || "postgres",
    user,
    password,
    poolMode,
  };
}

async function loadExactVerifiedPooler(login) {
  const { projectRef } = managementContext();
  const shared = await managementRequest({
    path: `/v1/projects/${projectRef}/config/database/pooler`,
  });
  if (!Array.isArray(shared)) {
    throw new Error("Shared Supabase pooler configuration was unavailable.");
  }
  const entry = shared.find(
    (candidate) =>
      String(candidate?.pool_mode || "").toLowerCase() === "transaction" &&
      String(candidate?.connection_string || candidate?.connectionString || ""),
  );
  if (!entry) {
    throw new Error("Verified shared transaction pooler was unavailable.");
  }
  const user = login.role.includes(".")
    ? login.role
    : `${login.role}.${projectRef}`;
  return parseConnectionString(
    entry.connection_string || entry.connectionString,
    user,
    login.password,
    "transaction",
  );
}

async function connectExactVerifiedPooler(login) {
  const { Client } = await import("pg");
  const candidate = await loadExactVerifiedPooler(login);
  const client = new Client({
    host: candidate.host,
    port: candidate.port,
    database: candidate.database,
    user: candidate.user,
    password: candidate.password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
    query_timeout: 1_500_000,
    statement_timeout: 1_500_000,
    application_name: "tcos-checklist-canary-prizm-wnba-20260803",
  });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    const privilege = await client.query(`select
      current_user as current_user,
      has_function_privilege(
        current_user,
        'public.tcos_apply_checklist_import_plan(jsonb,text,text,bigint,text,text,text)',
        'EXECUTE'
      ) as can_execute_writer`);
    if (privilege.rows?.[0]?.can_execute_writer !== true) {
      throw new Error("service_role cannot execute the Registry writer");
    }
    await client.query("rollback");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    await client.end().catch(() => undefined);
    throw error;
  }
  return {
    client,
    receipt: {
      source: "shared-pooler",
      poolMode: "transaction",
      hostClass: "supabase-pooler",
      userClass: "project-qualified-temporary-login",
      writerRole: "service_role",
      writerPrivilegeVerified: true,
    },
  };
}

function serviceClient() {
  const { productionUrl } = managementContext();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!serviceKey) {
    throw new Error("Production Supabase service-role key is missing.");
  }
  return createClient(productionUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function ensureSourceArchived(entry) {
  const supabase = serviceClient();
  const storage = entry.plan.source.storage;
  const { error: uploadError } = await supabase.storage
    .from(SOURCE_BUCKET)
    .upload(storage.objectPath, entry.rawBytes, {
      contentType: storage.mimeType,
      upsert: false,
      cacheControl: "0",
    });
  if (!uploadError) {
    return { newlyUploaded: true, reusedExactExistingObject: false };
  }

  const { data, error: downloadError } = await supabase.storage
    .from(SOURCE_BUCKET)
    .download(storage.objectPath);
  if (downloadError || !data) {
    throw new Error(`Could not archive canary source: ${uploadError.message}`);
  }
  const existing = Buffer.from(await data.arrayBuffer());
  if (
    existing.length !== entry.rawBytes.length ||
    sha256(existing) !== SOURCE.rawSha256
  ) {
    throw new Error(
      `Existing private source object does not match the pinned canary source: ${uploadError.message}`,
    );
  }
  return { newlyUploaded: false, reusedExactExistingObject: true };
}

async function removeSourceObject(entry) {
  const supabase = serviceClient();
  const storage = entry.plan.source.storage;
  const { error } = await supabase.storage
    .from(SOURCE_BUCKET)
    .remove([storage.objectPath]);
  if (error) {
    throw new Error(`Canary source cleanup failed: ${error.message}`);
  }
}

async function persistCanary(client, entry) {
  const storage = entry.plan.source.storage;
  await client.query("begin");
  try {
    await client.query("set local role service_role");
    await client.query("set local statement_timeout = '25min'");
    await client.query("set local idle_in_transaction_session_timeout = '30min'");
    const result = await client.query(
      `select public.tcos_apply_checklist_import_plan(
        $1::jsonb,
        $2::text,
        $3::text,
        $4::bigint,
        $5::text,
        $6::text,
        $7::text
      ) as persistence`,
      [
        JSON.stringify(entry.plan),
        storage.originalFilename,
        storage.mimeType,
        storage.sizeBytes,
        storage.sha256,
        storage.bucket,
        storage.objectPath,
      ],
    );
    await client.query("commit");
    const persistence = result.rows?.[0]?.persistence;
    if (!persistence || typeof persistence !== "object") {
      throw new Error("Canary writer returned no persistence receipt.");
    }
    return persistence;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function closeClient(client) {
  if (!client) return;
  await Promise.race([
    client.end().catch(() => undefined),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 7_000)),
  ]);
}

function sanitizeError(error, secrets) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets.filter(Boolean)) {
    message = message.split(secret).join("[masked]");
  }
  return message.slice(0, 2_000);
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  requireApplyGate();
  const entry = prepareSource(artifactRoot());
  console.log("[canary] pinned plan and source validated");

  const baseline = await auditProduction("baseline");
  requireExactBaseline(baseline);
  console.log("[canary] exact 297-release Production baseline passed");

  let login = null;
  let client = null;
  let connectionReceipt = null;
  let storageReceipt = null;
  let persistence = null;
  let recoveredAfterAmbiguousResponse = false;
  let afterWrite = null;
  let operationError = null;
  let cleanupError = null;

  try {
    login = await createTemporaryLoginRole();
    console.log("[canary] temporary login role created");

    const connected = await connectExactVerifiedPooler(login);
    client = connected.client;
    connectionReceipt = connected.receipt;
    console.log("[canary] verified shared transaction pooler connected");

    storageReceipt = await ensureSourceArchived(entry);
    console.log(
      storageReceipt.newlyUploaded
        ? "[canary] pinned source archived privately"
        : "[canary] exact existing private source archive reused",
    );

    try {
      console.log("[canary] Registry writer started");
      persistence = await persistCanary(client, entry);
      console.log("[canary] Registry writer committed");
    } catch (error) {
      const recovery = await auditProduction("writer-recovery");
      try {
        requireExactImportedState(recovery, "writer-recovery", 1);
        persistence = {
          ok: true,
          recoveredFromAudit: true,
          releaseSlug: SOURCE.releaseSlug,
        };
        recoveredAfterAmbiguousResponse = true;
        console.log("[canary] writer response recovered through exact Production audit");
      } catch {
        if (storageReceipt?.newlyUploaded && recovery.targets.length === 0) {
          await removeSourceObject(entry);
          console.log("[canary] uncommitted private source archive removed");
        }
        throw error;
      }
    }

    afterWrite = await auditProduction("after-write");
    requireExactImportedState(afterWrite, "after-write", 1);
    console.log("[canary] exact post-write audit passed");
  } catch (error) {
    operationError = error;
  } finally {
    await closeClient(client);
    if (login) {
      try {
        await deleteTemporaryLoginRole();
        console.log("[canary] temporary login role deleted");
      } catch (error) {
        cleanupError = error;
      }
    }
  }

  let finalAudit = null;
  try {
    finalAudit = await auditProduction("final-cleanup");
  } catch (error) {
    cleanupError ||= error;
  }

  if (operationError || cleanupError) {
    const secrets = [
      process.env.GH_SUPABASE_ACCESS_TOKEN,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      login?.password,
    ];
    writeJson(failurePath(), {
      schema: "tcos.checklist.canaryFailure.v1",
      generatedAt: new Date().toISOString(),
      status: "failed",
      releaseSlug: SOURCE.releaseSlug,
      operationError: operationError
        ? sanitizeError(operationError, secrets)
        : null,
      cleanupError: cleanupError ? sanitizeError(cleanupError, secrets) : null,
      baseline,
      afterWrite,
      finalAudit,
      storageReceipt,
      safety: {
        exactValidatedArtifactRequired: true,
        temporaryLoginCleanupAttempted: login !== null,
        migrationsApplied: false,
        deploymentPerformed: false,
      },
    });
    throw operationError || cleanupError;
  }

  requireExactImportedState(finalAudit, "final-cleanup", 0);
  console.log("[canary] final cleanup audit passed");

  const receipt = {
    schema: "tcos.checklist.prizmWnbaCanaryProductionImport.v1",
    generatedAt: new Date().toISOString(),
    sourceCommit: process.env.EXPECTED_MAIN_SHA || null,
    status: "passed",
    validationArtifact: {
      id: process.env.VALIDATION_ARTIFACT_ID || null,
      sha256: process.env.VALIDATION_ARTIFACT_SHA256 || null,
    },
    releaseSlug: SOURCE.releaseSlug,
    counts: {
      sets: SOURCE.sets,
      cards: SOURCE.cards,
      parallels: SOURCE.parallels,
      identities: SOURCE.identities,
    },
    rawSourceSha256: SOURCE.rawSha256,
    normalizedPlanSha256: SOURCE.normalizedPlanSha256,
    postgresConnection: connectionReceipt,
    storage: storageReceipt,
    persistence,
    recoveredAfterAmbiguousResponse,
    baseline,
    afterWrite,
    finalAudit,
    safety: {
      exactValidationArtifactPinned: true,
      semanticDigestPinned: true,
      rawSourceHashRecorded: true,
      sourceAuthority: "approved_reference_dataset",
      thirdPartyRowsNeverRepresentedAsOfficialManufacturer: true,
      exactVerifiedTransportOnly: true,
      noCandidateLoop: true,
      noSleepPreflight: true,
      canaryAuditedBeforeAnyFurtherRelease: true,
      temporaryLoginRoleDeleted: true,
      migrationsApplied: false,
      deploymentPerformed: false,
      rawSourceFileIncludedInReceipt: false,
    },
  };
  writeJson(receiptPath(), receipt);
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
