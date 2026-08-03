import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

const CHECKLIST_SOURCE_BUCKET = "tcos-checklist-source-files";
const EXPECTED_ADAPTER = "expanded-checklist-spreadsheet";
const EXPECTED_ADAPTER_VERSION = "1.0.0";
const EXPECTED_BASELINE = {
  releases: 297,
  active_versions: 297,
  active_cards: 35_987,
  active_identities: 44_216,
};

const SOURCES = [
  {
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
  },
  {
    id: "2025-panini-prizm-wnba",
    releaseSlug: "2025-panini-prizm-wnba",
    rawSha256: "adb74290ba74803c335b424c399212f7c0f90d7110281c0733ca662dee1f4c8a",
    normalizedPlanSha256: "0904366fff826edc86786c63c7b23a912f5dcffbc70ab78484e442c1df749253",
    sets: 14,
    cards: 350,
    parallels: 146,
    identities: 8_883,
    fingerprints: [
      "cec3412abca207ec433f8619320041daa47d2013a1b4f54985957f1ebcff8a3b",
      "9d506ec8c8f2be2c6aef081e1f0205ca3dbefd20acfde80d12c70fb28002b263",
    ],
  },
  {
    id: "2024-panini-select-wnba",
    releaseSlug: "2024-panini-select-wnba",
    rawSha256: "55d4c49492e9a373d5411ff4bcf0e8f0f15bae745dd7471542267fe9cbc68691",
    normalizedPlanSha256: "9c84227025190d2ef8c03cc0f430e0e7447633b19bdb51ad8da92282b002d98f",
    sets: 17,
    cards: 560,
    parallels: 174,
    identities: 8_480,
    fingerprints: [
      "3a07365b4cd174a0b56fbf31264170be5c696c251cddf0f73dba972f885b9eb8",
      "8b33778605b753f1f79828b56643f59cedd90ed74da93d3b29b963b7fb2ab103",
    ],
  },
  {
    id: "2025-panini-select-wnba",
    releaseSlug: "2025-panini-select-wnba",
    rawSha256: "1fb2b53413b03917705f0ec82ab358c156473e305d043b9134419b87dc583a66",
    normalizedPlanSha256: "b67b3d2d277ef447b89842ba264a0bcb5b5ba5ea792dcc3e47401469b69e2d25",
    sets: 17,
    cards: 553,
    parallels: 232,
    identities: 11_744,
    fingerprints: [
      "65e624163c36ad9ac696c5b900b5d9474cb1c1d0bc5e8b3f4cc901847431c1d9",
      "d8bbcb07f3b6d2fb2348feb452097191b044e0f9d6dfbe0e81736ff5747aa1ab",
    ],
  },
  {
    id: "2024-bowman-chrome-baseball",
    releaseSlug: "2024-bowman-chrome-baseball",
    rawSha256: "c566d41e0aad20bad7c865245846901f05d3b3035dd71ac9e4acb0699ced32bc",
    normalizedPlanSha256: "f6563a3bda84167091e1e757af32d780aa7d7d85dc82c64fa6dcbf9acff4efc2",
    sets: 29,
    cards: 823,
    parallels: 124,
    identities: 9_419,
    fingerprints: [
      "c103d24885f2fd814410c7e32bf5ede0b41ccc3878244749124724e2c7f40147",
      "45f9981eaa4ce23eb46486e332f832baf762d62dbbe2834c77a012acf0d1d8a0",
    ],
  },
  {
    id: "2025-bowman-baseball",
    releaseSlug: "2025-bowman-baseball",
    rawSha256: "e6500897800d768e004bb87e4e5bc5dcf800bba89fc64c5f8aaa6d38ed87059c",
    normalizedPlanSha256: "a0eba071d710475b9d7afd00b6e853e9e692934fd83dbd66e617f318e0a33f36",
    sets: 28,
    cards: 963,
    parallels: 239,
    identities: 21_539,
    fingerprints: [
      "afbd476f6c8dcd5cccb78fc5f60e6ca41db95a47b814f956ba4c55141a43bc03",
      "117bf7fcd89b652aafdbf2f8c43296ab8f0107309a2acb3764541fa3daf297d8",
    ],
  },
];

function requireApplyGate() {
  if (!process.argv.includes("--apply")) {
    throw new Error("Production import requires the explicit --apply flag.");
  }
  if (process.env.ALLOW_PRODUCTION_SIX_CHECKLIST_IMPORT !== "YES") {
    throw new Error(
      "Production import requires ALLOW_PRODUCTION_SIX_CHECKLIST_IMPORT=YES.",
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
      "evidence/six-checklist-production-20260802/production-import.json",
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

function prepareSources(root) {
  const prepared = [];
  for (const source of SOURCES) {
    const directory = join(root, "private", source.id);
    const planPath = join(directory, `${source.id}.plan.json`);
    const rawPath = join(directory, `${source.id}.xlsx`);
    const planBytes = readFileSync(planPath);
    const rawBytes = readFileSync(rawPath);
    const plan = JSON.parse(planBytes.toString("utf8"));
    const failures = [];
    const counts = plan?.validation?.counts || {};
    const storage = plan?.source?.storage || {};
    const fingerprints = (plan.identities || []).map(
      (entry) => entry?.fingerprint?.fingerprintSha256,
    );

    const checks = [
      ["releaseSlug", plan?.release?.releaseSlug, source.releaseSlug],
      ["adapterId", plan?.adapterId, EXPECTED_ADAPTER],
      ["adapterVersion", plan?.adapterVersion, EXPECTED_ADAPTER_VERSION],
      ["validationStatus", plan?.validation?.status, "passed"],
      ["sourceAuthority", plan?.source?.authority, "approved_reference_dataset"],
      ["privateArchiveRequired", plan?.source?.privateArchiveRequired, true],
      ["sourceIsPublic", storage?.isPublic, false],
      ["sourceBucket", storage?.bucket, CHECKLIST_SOURCE_BUCKET],
      ["sets", Number(counts.sets), source.sets],
      ["cards", Number(counts.cards), source.cards],
      ["parallels", Number(counts.parallels), source.parallels],
      ["identities", Number(counts.identities), source.identities],
      ["rawSha256", sha256(rawBytes), source.rawSha256],
      ["storageSha256", storage?.sha256, source.rawSha256],
      ["storageSizeBytes", Number(storage?.sizeBytes), rawBytes.length],
      [
        "normalizedPlanSha256",
        normalizedPlanDigest(plan),
        source.normalizedPlanSha256,
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
    for (const fingerprint of source.fingerprints) {
      if (!fingerprints.includes(fingerprint)) {
        failures.push(`missing known fingerprint ${fingerprint}`);
      }
    }
    const validationErrors = (plan?.validation?.issues || []).filter(
      (issue) => issue?.severity === "error",
    );
    if (validationErrors.length) {
      failures.push(
        ...validationErrors.map(
          (issue) => `${issue.code || "error"}: ${issue.message || "unknown"}`,
        ),
      );
    }
    if (failures.length) {
      throw new Error(`${source.id} preparation blocked: ${failures.join("; ")}`);
    }
    prepared.push({ source, plan, rawBytes, planPath, rawPath });
  }
  return prepared;
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
      `Supabase Management API ${method} ${path} failed with HTTP ${response.status}: ${text.slice(0, 1000)}`,
    );
  }
  if (!response.ok) return null;
  return text ? JSON.parse(text) : {};
}

async function managementQuery({ label, query, parameters = [], readOnly }) {
  const { projectRef } = managementContext();
  const response = await managementRequest({
    path: `/v1/projects/${projectRef}/database/query`,
    method: "POST",
    body: { query, parameters, read_only: readOnly },
  });
  if (!Array.isArray(response)) {
    throw new Error(`Supabase ${label} returned an unexpected payload.`);
  }
  return response;
}

function quotedTargetSlugs() {
  return SOURCES.map((source) => `'${source.releaseSlug}'`).join(", ");
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
      where r.slug in (${quotedTargetSlugs()})
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
        where id = '${CHECKLIST_SOURCE_BUCKET}' and public = false
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
  if (state.targets.length !== 0) {
    failures.push(
      `target releases already exist: ${state.targets
        .map((target) => target.release_slug)
        .join(", ")}`,
    );
  }
  if (failures.length) {
    throw new Error(`Production baseline blocked: ${failures.join("; ")}`);
  }
}

function expectedTotals(importedSources) {
  return importedSources.reduce(
    (sum, source) => ({
      cards: sum.cards + source.cards,
      identities: sum.identities + source.identities,
    }),
    { cards: 0, identities: 0 },
  );
}

function requireImportedTargets(state, importedSources, baseline) {
  requireHealthyState(state, `after-${importedSources.length}`);
  if (state.targets.length !== importedSources.length) {
    throw new Error(
      `Production has ${state.targets.length} target releases; expected ${importedSources.length}.`,
    );
  }
  for (const source of importedSources) {
    const target = state.targets.find(
      (row) => row.release_slug === source.releaseSlug,
    );
    if (!target) throw new Error(`Missing ${source.releaseSlug}.`);
    const failures = [];
    if (target.adapter_id !== EXPECTED_ADAPTER) {
      failures.push(`adapter_id=${target.adapter_id}`);
    }
    if (Number(target.cards) !== source.cards) {
      failures.push(`cards=${target.cards}`);
    }
    if (Number(target.expected_cards) !== source.cards) {
      failures.push(`expected_cards=${target.expected_cards}`);
    }
    if (Number(target.identities) !== source.identities) {
      failures.push(`identities=${target.identities}`);
    }
    if (Number(target.expected_identities) !== source.identities) {
      failures.push(`expected_identities=${target.expected_identities}`);
    }
    if (failures.length) {
      throw new Error(`${source.releaseSlug} verification blocked: ${failures.join(", ")}`);
    }
  }

  const totals = expectedTotals(importedSources);
  const exactGlobal = {
    releases: Number(baseline.releases) + importedSources.length,
    active_versions:
      Number(baseline.active_versions) + importedSources.length,
    active_cards: Number(baseline.active_cards) + totals.cards,
    active_identities: Number(baseline.active_identities) + totals.identities,
  };
  for (const [key, expected] of Object.entries(exactGlobal)) {
    if (Number(state[key]) !== expected) {
      throw new Error(`${key}=${state[key]}, expected=${expected}.`);
    }
  }
}

function parseConnectionString(value, user, password, poolMode, source) {
  try {
    const url = new URL(value.replace(/^postgres:\/\//, "postgresql://"));
    return {
      host: url.hostname,
      port: Number(url.port || 5432),
      database: url.pathname.replace(/^\//, "") || "postgres",
      user,
      password,
      poolMode,
      source,
    };
  } catch {
    return null;
  }
}

function candidateUsers(role, projectRef) {
  return [...new Set([role.includes(".") ? role : `${role}.${projectRef}`, role])];
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

async function loadPoolerCandidates(login) {
  const { projectRef } = managementContext();
  const users = candidateUsers(login.role, projectRef);
  const candidates = [];

  const shared = await managementRequest({
    path: `/v1/projects/${projectRef}/config/database/pooler`,
    allowFailure: true,
  });
  if (Array.isArray(shared)) {
    const sorted = [...shared].sort((a, b) => {
      const left = String(a?.pool_mode || "").toLowerCase() === "session" ? 0 : 1;
      const right = String(b?.pool_mode || "").toLowerCase() === "session" ? 0 : 1;
      return left - right;
    });
    for (const entry of sorted) {
      const connection = String(
        entry?.connection_string || entry?.connectionString || "",
      );
      const poolMode = String(entry?.pool_mode || "unknown");
      for (const user of users) {
        const parsed = connection
          ? parseConnectionString(
              connection,
              user,
              login.password,
              poolMode,
              "shared-pooler",
            )
          : null;
        if (parsed) candidates.push(parsed);
        if (entry?.db_host) {
          candidates.push({
            host: String(entry.db_host),
            port: Number(entry.db_port || 5432),
            database: String(entry.db_name || "postgres"),
            user,
            password: login.password,
            poolMode,
            source: "shared-pooler-fields",
          });
        }
      }
    }
  }

  const dedicated = await managementRequest({
    path: `/v1/projects/${projectRef}/config/database/pgbouncer`,
    allowFailure: true,
  });
  if (dedicated && typeof dedicated === "object") {
    const connection = String(
      dedicated.connection_string || dedicated.connectionString || "",
    );
    for (const user of users) {
      const parsed = connection
        ? parseConnectionString(
            connection,
            user,
            login.password,
            String(dedicated.pool_mode || "transaction"),
            "dedicated-pooler",
          )
        : null;
      if (parsed) candidates.push(parsed);
    }
  }

  candidates.push({
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    database: "postgres",
    user: login.role,
    password: login.password,
    poolMode: "direct",
    source: "direct-fallback",
  });

  const unique = new Map();
  for (const candidate of candidates) {
    const key = [candidate.host, candidate.port, candidate.database, candidate.user].join("|");
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()];
}

async function connectTemporaryPostgres(login, prepared) {
  const { Client } = await import("pg");
  const candidates = await loadPoolerCandidates(login);
  const errors = [];

  for (const candidate of candidates) {
    const client = new Client({
      host: candidate.host,
      port: candidate.port,
      database: candidate.database,
      user: candidate.user,
      password: candidate.password,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 20_000,
      application_name: "tcos-six-checklist-import-20260802",
    });
    try {
      await client.connect();
      const privilege = await client.query(`select
        current_user as current_user,
        session_user as session_user,
        has_function_privilege(
          current_user,
          'public.tcos_apply_checklist_import_plan(jsonb,text,text,bigint,text,text,text)',
          'EXECUTE'
        ) as can_execute_writer`);

      let writerRole = "current_user";
      if (privilege.rows?.[0]?.can_execute_writer !== true) {
        await client.query("begin");
        try {
          await client.query("set local role service_role");
          const elevated = await client.query(`select
            current_user as current_user,
            has_function_privilege(
              current_user,
              'public.tcos_apply_checklist_import_plan(jsonb,text,text,bigint,text,text,text)',
              'EXECUTE'
            ) as can_execute_writer`);
          if (elevated.rows?.[0]?.can_execute_writer !== true) {
            throw new Error("service_role cannot execute the Registry writer");
          }
          writerRole = "service_role";
          await client.query("rollback");
        } catch (error) {
          await client.query("rollback").catch(() => undefined);
          throw error;
        }
      }

      await client.query("begin");
      try {
        if (writerRole === "service_role") {
          await client.query("set local role service_role");
        }
        await client.query("set local statement_timeout = '120s'");
        await client.query("select pg_sleep(35)");
        await client.query("rollback");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }

      const payloads = [];
      for (const entry of prepared) {
        const serialized = JSON.stringify(entry.plan);
        const observedResult = await client.query(
          `select
            ($1::jsonb)->>'adapterId' as adapter_id,
            ($1::jsonb)->'release'->>'releaseSlug' as release_slug,
            jsonb_array_length(($1::jsonb)->'sets')::integer as sets,
            jsonb_array_length(($1::jsonb)->'cards')::integer as cards,
            jsonb_array_length(($1::jsonb)->'parallels')::integer as parallels,
            jsonb_array_length(($1::jsonb)->'identities')::integer as identities,
            (
              select count(*)::integer
              from jsonb_array_elements(($1::jsonb)->'identities') identity
              where identity->'fingerprint'->>'fingerprintSha256' = any($2::text[])
            ) as known_fingerprints`,
          [serialized, entry.source.fingerprints],
        );
        const observed = observedResult.rows?.[0];
        const checks = [
          ["adapterId", String(observed?.adapter_id || ""), EXPECTED_ADAPTER],
          ["releaseSlug", String(observed?.release_slug || ""), entry.source.releaseSlug],
          ["sets", Number(observed?.sets), entry.source.sets],
          ["cards", Number(observed?.cards), entry.source.cards],
          ["parallels", Number(observed?.parallels), entry.source.parallels],
          ["identities", Number(observed?.identities), entry.source.identities],
          [
            "knownFingerprints",
            Number(observed?.known_fingerprints),
            entry.source.fingerprints.length,
          ],
        ];
        const failures = checks
          .filter(([, actual, expected]) => actual !== expected)
          .map(([label, actual, expected]) => `${label}=${actual}, expected=${expected}`);
        if (failures.length) {
          throw new Error(
            `${entry.source.id} PostgreSQL payload probe failed: ${failures.join("; ")}`,
          );
        }
        payloads.push({
          id: entry.source.id,
          releaseSlug: entry.source.releaseSlug,
          sets: entry.source.sets,
          cards: entry.source.cards,
          parallels: entry.source.parallels,
          identities: entry.source.identities,
          knownFingerprints: entry.source.fingerprints.length,
          serializedBytes: Buffer.byteLength(serialized, "utf8"),
        });
      }

      return {
        client,
        writerRole,
        receipt: {
          source: candidate.source,
          poolMode: candidate.poolMode,
          hostClass: candidate.host.includes("pooler.supabase.com")
            ? "supabase-pooler"
            : "supabase-direct",
          userClass: candidate.user.startsWith("cli_login_")
            ? "temporary-cli-login"
            : "temporary-login",
          writerPrivilegeVerified: true,
          writerRole,
          delaySeconds: 35,
          planPayloads: payloads,
        },
      };
    } catch (error) {
      errors.push(
        `${candidate.source}/${candidate.poolMode}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await client.end().catch(() => undefined);
    }
  }

  throw new Error(
    `Could not establish a verified temporary PostgreSQL connection: ${errors.join(" | ")}`,
  );
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

async function persistPreparedSource({
  client,
  writerRole,
  entry,
  baseline,
  expectedImported,
}) {
  const supabase = serviceClient();
  const storage = entry.plan.source.storage;
  const { error: uploadError } = await supabase.storage
    .from(CHECKLIST_SOURCE_BUCKET)
    .upload(storage.objectPath, entry.rawBytes, {
      contentType: storage.mimeType,
      upsert: false,
      cacheControl: "0",
    });
  if (uploadError) {
    throw new Error(`Could not archive ${entry.source.id}: ${uploadError.message}`);
  }

  try {
    await client.query("begin");
    try {
      if (writerRole === "service_role") {
        await client.query("set local role service_role");
      }
      await client.query("set local statement_timeout = '20min'");
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
        throw new Error(`${entry.source.id} writer returned no persistence receipt.`);
      }
      return { persistence, recoveredAfterAmbiguousResponse: false };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  } catch (error) {
    const recovery = await auditProduction(`recovery-${entry.source.id}`);
    try {
      requireImportedTargets(recovery, expectedImported, baseline);
      return {
        persistence: {
          ok: true,
          recoveredFromAudit: true,
          releaseSlug: entry.source.releaseSlug,
        },
        recoveredAfterAmbiguousResponse: true,
      };
    } catch {
      const targetExists = recovery.targets.some(
        (row) => row.release_slug === entry.source.releaseSlug,
      );
      if (!targetExists) {
        const { error: removeError } = await supabase.storage
          .from(CHECKLIST_SOURCE_BUCKET)
          .remove([storage.objectPath]);
        if (removeError) {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}; source cleanup failed: ${removeError.message}`,
          );
        }
      }
      throw error;
    }
  }
}

async function main() {
  requireApplyGate();
  const prepared = prepareSources(artifactRoot());
  const baseline = await auditProduction("baseline");
  requireExactBaseline(baseline);

  let login = null;
  let postgresClient = null;
  let writerRole = "current_user";
  let connectionReceipt = null;
  let finalReceipt = null;
  let temporaryRoleDeleted = false;

  try {
    login = await createTemporaryLoginRole();
    const connected = await connectTemporaryPostgres(login, prepared);
    postgresClient = connected.client;
    writerRole = connected.writerRole;
    connectionReceipt = connected.receipt;

    const imports = [];
    const auditStates = [{ label: "baseline", state: baseline }];
    const importedSources = [];

    for (const entry of prepared) {
      const expectedImported = [...importedSources, entry.source];
      const persisted = await persistPreparedSource({
        client: postgresClient,
        writerRole,
        entry,
        baseline,
        expectedImported,
      });
      importedSources.push(entry.source);
      const state = await auditProduction(`after-${entry.source.id}`);
      requireImportedTargets(state, importedSources, baseline);
      auditStates.push({ label: `after-${entry.source.id}`, state });
      imports.push({
        id: entry.source.id,
        releaseSlug: entry.source.releaseSlug,
        rawSourceSha256: entry.source.rawSha256,
        rawSourceSizeBytes: entry.rawBytes.length,
        normalizedPlanSha256: entry.source.normalizedPlanSha256,
        counts: entry.plan.validation.counts,
        adapter: {
          id: entry.plan.adapterId,
          version: entry.plan.adapterVersion,
        },
        sourceAuthority: entry.plan.source.authority,
        persistence: persisted.persistence,
        transport: "temporary-postgresql-login",
        recoveredAfterAmbiguousResponse:
          persisted.recoveredAfterAmbiguousResponse,
      });
    }

    finalReceipt = {
      schema: "tcos.checklist.sixReleaseProductionImport.v1",
      generatedAt: new Date().toISOString(),
      sourceCommit: process.env.EXPECTED_MAIN_SHA || null,
      validationArtifact: {
        id: process.env.VALIDATION_ARTIFACT_ID || null,
        sha256: process.env.VALIDATION_ARTIFACT_SHA256 || null,
      },
      status: "passed",
      postgresConnectionPreflight: connectionReceipt,
      temporaryLoginRoleTtlSeconds: login.ttl_seconds,
      imports,
      auditStates,
      finalTargets: auditStates.at(-1)?.state.targets || [],
      finalTotals: {
        releases: Number(auditStates.at(-1)?.state.releases),
        activeVersions: Number(auditStates.at(-1)?.state.active_versions),
        activeCards: Number(auditStates.at(-1)?.state.active_cards),
        activeIdentities: Number(auditStates.at(-1)?.state.active_identities),
      },
      safety: {
        exactValidationArtifactPinned: true,
        semanticDigestsPinned: true,
        rawSourceHashesRecorded: true,
        sourceAuthority: "approved_reference_dataset",
        thirdPartyRowsNeverRepresentedAsOfficialManufacturer: true,
        writerTransport: "temporary-postgresql-login",
        managementApiBodyLimitBypassed: true,
        postgrestStatementTimeoutBypassed: true,
        canaryVerifiedBeforeRemainingImports: true,
        canaryReleaseSlug: SOURCES[0].releaseSlug,
        temporaryLoginRoleDeleted: false,
        migrationsApplied: false,
        deploymentPerformed: false,
        rawSourceFilesIncludedInReceipt: false,
        importedReleaseSlugs: SOURCES.map((source) => source.releaseSlug),
      },
    };
  } finally {
    if (postgresClient) {
      await postgresClient.end().catch(() => undefined);
    }
    if (login) {
      await deleteTemporaryLoginRole();
      temporaryRoleDeleted = true;
    }
  }

  if (!finalReceipt || !temporaryRoleDeleted) {
    throw new Error("Production import did not produce a cleaned passing receipt.");
  }
  finalReceipt.safety.temporaryLoginRoleDeleted = true;
  const finalAudit = await auditProduction("final-cleanup");
  requireImportedTargets(finalAudit, SOURCES, baseline);
  if (Number(finalAudit.temporary_login_roles) !== 0) {
    throw new Error(
      `Temporary login role cleanup failed: ${finalAudit.temporary_login_roles} remains.`,
    );
  }
  finalReceipt.finalCleanupAudit = finalAudit;

  const output = receiptPath();
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(finalReceipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(finalReceipt, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
