import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const EXPECTED_MAIN_SHA = String(process.env.EXPECTED_MAIN_SHA || "").trim();
const SUPABASE_ACCESS_TOKEN = String(
  process.env.GH_SUPABASE_ACCESS_TOKEN || "",
).trim();
const PRODUCTION_ENV_PATH = String(process.env.PRODUCTION_ENV_PATH || "").trim();
const EVIDENCE_DIR = String(
  process.env.EVIDENCE_DIR || "evidence/instacomp-2-hardening",
).trim();

const MIGRATIONS = [
  "20260801143000_instacomp_cache_and_knowledge_hardening.sql",
  "20260801144500_instacomp_future_collision_guard.sql",
  "20260801145000_instacomp_trust_promotion_guard.sql",
  "20260801150000_atomic_public_endpoint_rate_limit.sql",
];

const TRANSIENT_HTTP_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function parseDotEnv(filePath) {
  const parsed = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
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

function safeText(value, limit = 8000) {
  return String(value || "")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(?:service_role|anon)_key\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/(?:token|password|secret)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, limit);
}

function ensureEvidenceDir() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

function writeJson(filename, payload) {
  ensureEvidenceDir();
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, filename),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function stateFromRows(rows, label) {
  const state = Array.isArray(rows) ? rows[0]?.state : null;
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error(`${label} returned no state object.`);
  }
  return state;
}

function assertState(state, key, expected = true) {
  if (state[key] !== expected) {
    throw new Error(
      `Production verification failed for ${key}: expected ${JSON.stringify(
        expected,
      )}, received ${JSON.stringify(state[key])}.`,
    );
  }
}

async function main() {
  if (!EXPECTED_MAIN_SHA || !SUPABASE_ACCESS_TOKEN || !PRODUCTION_ENV_PATH) {
    throw new Error("Production hardening runner environment is incomplete.");
  }
  if (!fs.existsSync(PRODUCTION_ENV_PATH)) {
    throw new Error("Pulled Production environment file is missing.");
  }

  ensureEvidenceDir();
  const productionEnv = parseDotEnv(PRODUCTION_ENV_PATH);
  const productionUrl = String(productionEnv.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  if (!/^https:\/\//i.test(productionUrl)) {
    throw new Error("Production NEXT_PUBLIC_SUPABASE_URL was not pulled.");
  }

  const projectRef = new URL(productionUrl).hostname.split(".")[0];
  if (!projectRef) {
    throw new Error("Could not resolve the Production Supabase project reference.");
  }

  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

  async function queryDatabase(query, options = {}) {
    const label = options.label || "Supabase query";
    const readOnly = options.readOnly === true;
    const maximumAttempts = options.maximumAttempts || 6;
    let lastError = null;

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query, parameters: [], read_only: readOnly }),
          signal: AbortSignal.timeout(180_000),
        });
        const body = await response.text();

        if (response.ok) {
          return body ? JSON.parse(body) : [];
        }

        const error = new Error(
          `${label} failed with HTTP ${response.status}: ${safeText(body)}`,
        );
        lastError = error;
        if (!TRANSIENT_HTTP_STATUSES.has(response.status) || attempt === maximumAttempts) {
          throw error;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const transientNetworkFailure =
          lastError.name === "TimeoutError" ||
          /fetch failed|network|timeout|socket|ECONNRESET|ENOTFOUND/i.test(
            lastError.message,
          );
        if (!transientNetworkFailure || attempt === maximumAttempts) {
          throw lastError;
        }
      }

      const delay = Math.min(30_000, 1_500 * 2 ** (attempt - 1));
      console.log(`${label} transient failure; retrying in ${delay}ms (${attempt}/${maximumAttempts}).`);
      await sleep(delay);
    }

    throw lastError || new Error(`${label} failed without an error message.`);
  }

  const beforeRows = await queryDatabase(
    `select json_build_object(
      'savedScans', (select count(*) from public.instacomp_scans),
      'knowledgeEntries', (select count(*) from public.tcos_card_knowledge_entries),
      'knowledgeObservations', (select count(*) from public.tcos_card_knowledge_observations),
      'trustedEntries', (select count(*) from public.tcos_card_knowledge_entries where trust_status = 'tcos_trusted'),
      'reviewEntries', (select count(*) from public.tcos_card_knowledge_entries where trust_status = 'needs_review'),
      'scanCacheRows', (select count(*) from public.instacomp_scan_knowledge_cache)
    ) as state;`,
    { readOnly: true, label: "Read pre-migration state" },
  );
  const before = stateFromRows(beforeRows, "Pre-migration query");

  const appliedMigrations = [];
  for (const migration of MIGRATIONS) {
    const filePath = path.join("supabase", "migrations", migration);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Required migration is missing: ${migration}`);
    }
    const sql = fs.readFileSync(filePath, "utf8").trim();
    if (!sql) throw new Error(`Required migration is empty: ${migration}`);
    if (/\b(?:begin|commit|rollback)\s*;/i.test(sql)) {
      throw new Error(
        `Migration ${migration} unexpectedly contains its own transaction wrapper.`,
      );
    }
    if (/create\s+(?:unique\s+)?index\s+concurrently/i.test(sql)) {
      throw new Error(`Migration ${migration} contains an unsupported concurrent index.`);
    }

    const startedAt = Date.now();
    console.log(`Applying ${migration} atomically.`);
    await queryDatabase(`begin;\n${sql}\ncommit;`, {
      label: `Apply ${migration}`,
      maximumAttempts: 6,
    });
    appliedMigrations.push({
      migration,
      durationMs: Date.now() - startedAt,
      sha256: crypto.createHash("sha256").update(sql).digest("hex"),
    });
  }

  const verificationRows = await queryDatabase(
    `select json_build_object(
      'cacheActorScopeIndex', to_regclass('public.instacomp_scan_cache_actor_scope_idx') is not null,
      'fingerprintV2Column', exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'tcos_card_knowledge_entries'
          and column_name = 'identity_fingerprint_v2'
      ),
      'collisionFlagColumn', exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'tcos_card_knowledge_entries'
          and column_name = 'collision_detected'
      ),
      'collisionAuditTable', to_regclass('public.tcos_card_knowledge_collision_audit') is not null,
      'canonicalVersionsTable', to_regclass('public.tcos_card_knowledge_canonical_versions') is not null,
      'fingerprintTrigger', exists (
        select 1 from pg_trigger
        where tgname = 'tcos_card_knowledge_entries_set_fingerprint_v2'
          and not tgisinternal
      ),
      'futureCollisionTrigger', exists (
        select 1 from pg_trigger
        where tgname = 'tcos_card_knowledge_entries_flag_v2_collision'
          and not tgisinternal
      ),
      'canonicalProtectionTrigger', exists (
        select 1 from pg_trigger
        where tgname = 'tcos_card_knowledge_entries_protect_trusted'
          and not tgisinternal
      ),
      'canonicalPromotionTrigger', exists (
        select 1 from pg_trigger
        where tgname = 'tcos_card_knowledge_observations_promote_canonical'
          and not tgisinternal
      ),
      'canonicalHistoryAppendOnlyTrigger', exists (
        select 1 from pg_trigger
        where tgname = 'tcos_card_knowledge_canonical_versions_append_only'
          and not tgisinternal
      ),
      'operatorThresholdThree', exists (
        select 1
        from pg_proc procedure
        join pg_namespace namespace on namespace.oid = procedure.pronamespace
        where namespace.nspname = 'public'
          and procedure.proname = 'tcos_instacomp_promote_confirmed_observation'
          and position('v_operator_count < 3' in pg_get_functiondef(procedure.oid)) > 0
      ),
      'atomicRateLimitFunction', to_regprocedure(
        'public.tcos_take_public_endpoint_rate_limit(uuid,text,text,text,text,text,jsonb,integer,integer,integer,integer)'
      ) is not null,
      'atomicRateLimitServiceRoleExecute', has_function_privilege(
        'service_role',
        'public.tcos_take_public_endpoint_rate_limit(uuid,text,text,text,text,text,jsonb,integer,integer,integer,integer)',
        'EXECUTE'
      ),
      'atomicRateLimitAnonExecute', has_function_privilege(
        'anon',
        'public.tcos_take_public_endpoint_rate_limit(uuid,text,text,text,text,text,jsonb,integer,integer,integer,integer)',
        'EXECUTE'
      ),
      'atomicRateLimitAuthenticatedExecute', has_function_privilege(
        'authenticated',
        'public.tcos_take_public_endpoint_rate_limit(uuid,text,text,text,text,text,jsonb,integer,integer,integer,integer)',
        'EXECUTE'
      ),
      'privateKnowledgeRegistryPublicGrants', (
        select count(*)
        from information_schema.role_table_grants
        where table_schema = 'public'
          and grantee in ('anon', 'authenticated')
          and (
            table_name like 'tcos_card_knowledge%'
            or table_name = 'instacomp_scan_knowledge_cache'
            or table_name like 'checklist_%'
          )
      ),
      'canonicalHistoryServiceRoleMutationGrants', (
        select count(*)
        from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name = 'tcos_card_knowledge_canonical_versions'
          and grantee = 'service_role'
          and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')
      ),
      'missingFingerprintV2', (
        select count(*)
        from public.tcos_card_knowledge_entries
        where identity_fingerprint_v2 is null
           or identity_fingerprint_v2 not like 'v2|%'
      ),
      'trustedCollisionEntries', (
        select count(*)
        from public.tcos_card_knowledge_entries
        where collision_detected
          and trust_status = 'tcos_trusted'
      ),
      'activeLegacyGlobalCacheRows', (
        select count(*)
        from public.instacomp_scan_knowledge_cache
        where market_expires_at > now()
          and (
            submitted_store_id is null
            or submitted_by_actor_type not in ('admin', 'seller')
            or (
              submitted_by_actor_type = 'seller'
              and submitted_by_account_id is null
            )
          )
      ),
      'unlearnedSavedScans', (
        select count(*)
        from public.instacomp_scans scan
        left join public.tcos_card_knowledge_observations observation
          on observation.observation_key = 'scan:' || scan.id::text
        where observation.id is null
      ),
      'savedScans', (select count(*) from public.instacomp_scans),
      'knowledgeEntries', (select count(*) from public.tcos_card_knowledge_entries),
      'knowledgeObservations', (select count(*) from public.tcos_card_knowledge_observations),
      'trustedEntries', (select count(*) from public.tcos_card_knowledge_entries where trust_status = 'tcos_trusted'),
      'reviewEntries', (select count(*) from public.tcos_card_knowledge_entries where trust_status = 'needs_review'),
      'collisionAuditRows', (select count(*) from public.tcos_card_knowledge_collision_audit),
      'canonicalVersionRows', (select count(*) from public.tcos_card_knowledge_canonical_versions),
      'scanCacheRows', (select count(*) from public.instacomp_scan_knowledge_cache)
    ) as state;`,
    { readOnly: true, label: "Verify Production hardening schema and data" },
  );
  const after = stateFromRows(verificationRows, "Post-migration verification");

  for (const key of [
    "cacheActorScopeIndex",
    "fingerprintV2Column",
    "collisionFlagColumn",
    "collisionAuditTable",
    "canonicalVersionsTable",
    "fingerprintTrigger",
    "futureCollisionTrigger",
    "canonicalProtectionTrigger",
    "canonicalPromotionTrigger",
    "canonicalHistoryAppendOnlyTrigger",
    "operatorThresholdThree",
    "atomicRateLimitFunction",
    "atomicRateLimitServiceRoleExecute",
  ]) {
    assertState(after, key, true);
  }
  for (const key of [
    "atomicRateLimitAnonExecute",
    "atomicRateLimitAuthenticatedExecute",
  ]) {
    assertState(after, key, false);
  }
  for (const key of [
    "privateKnowledgeRegistryPublicGrants",
    "canonicalHistoryServiceRoleMutationGrants",
    "missingFingerprintV2",
    "trustedCollisionEntries",
    "activeLegacyGlobalCacheRows",
    "unlearnedSavedScans",
  ]) {
    if (Number(after[key]) !== 0) {
      throw new Error(`Production verification requires ${key}=0; received ${after[key]}.`);
    }
  }
  for (const key of ["savedScans", "knowledgeEntries", "knowledgeObservations", "scanCacheRows"]) {
    if (Number(after[key]) < Number(before[key])) {
      throw new Error(
        `Production data count decreased for ${key}: ${before[key]} -> ${after[key]}.`,
      );
    }
  }

  const suffix = crypto.randomBytes(8).toString("hex");
  const selfTestSql = `begin;
  do $cert$
  declare
    v_suffix text := '${suffix}';
    v_collision_a uuid;
    v_collision_b uuid;
    v_operator_entry uuid;
    v_catalog_entry uuid;
    v_store uuid;
    v_status text;
    v_revision integer;
    v_player text;
    v_count integer;
    v_receipt jsonb;
    v_ai_collision jsonb := jsonb_build_object(
      'player', 'Certification Collision ${suffix}',
      'year', '2026',
      'brand', 'Panini',
      'setName', 'Certification Set',
      'cardNumber', 'COL-${suffix}',
      'parallel', 'Base',
      'variation', 'Photo A',
      'isAuto', false,
      'isRelic', false,
      'languageCode', 'en'
    );
    v_ai_operator jsonb := jsonb_build_object(
      'player', 'Certification Operator ${suffix}',
      'year', '2026',
      'brand', 'Topps',
      'setName', 'Certification Operator Set',
      'cardNumber', 'OP-${suffix}',
      'parallel', 'Gold',
      'serialNumber', '03/50',
      'isAuto', true,
      'isRelic', false,
      'languageCode', 'en'
    );
    v_ai_catalog jsonb := jsonb_build_object(
      'player', 'Certification Catalog ${suffix}',
      'year', '2026',
      'brand', 'Upper Deck',
      'setName', 'Certification Catalog Set',
      'cardNumber', 'CAT-${suffix}',
      'parallel', 'Silver',
      'variation', 'Photo B',
      'isAuto', false,
      'isRelic', false,
      'languageCode', 'en'
    );
  begin
    insert into public.tcos_card_knowledge_entries(
      identity_fingerprint, title, year, brand, set_name, card_number,
      player, parallel, variation, is_auto, is_relic, ai_result
    ) values (
      'cert-legacy-a-' || v_suffix, 'Collision A', '2026', 'Panini',
      'Certification Set', 'COL-' || v_suffix,
      'Certification Collision ' || v_suffix, 'Base', 'Photo A', false, false,
      v_ai_collision
    ) returning id into v_collision_a;

    insert into public.tcos_card_knowledge_entries(
      identity_fingerprint, title, year, brand, set_name, card_number,
      player, parallel, variation, is_auto, is_relic, ai_result
    ) values (
      'cert-legacy-b-' || v_suffix, 'Collision B', '2026', 'Panini',
      'Certification Set', 'COL-' || v_suffix,
      'Certification Collision ' || v_suffix, 'Base', 'Photo A', false, false,
      v_ai_collision
    ) returning id into v_collision_b;

    select count(*) into v_count
    from public.tcos_card_knowledge_entries
    where id in (v_collision_a, v_collision_b)
      and collision_detected
      and trust_status = 'needs_review';
    if v_count <> 2 then
      raise exception 'Future collision did not fail closed for both rows';
    end if;

    insert into public.tcos_card_knowledge_entries(
      identity_fingerprint, title, year, brand, set_name, card_number,
      player, parallel, serial_number, is_rookie, is_auto, is_relic, ai_result
    ) values (
      'cert-operator-' || v_suffix, 'Operator Candidate', '2026', 'Topps',
      'Certification Operator Set', 'OP-' || v_suffix,
      'Certification Operator ' || v_suffix, 'Gold', '03/50', true, true, false,
      v_ai_operator
    ) returning id into v_operator_entry;

    for v_count in 1..3 loop
      insert into public.tcos_card_knowledge_observations(
        knowledge_entry_id, observation_key, confirmation_status, title,
        ai_result, operator_corrections, result_payload, observed_at
      ) values (
        v_operator_entry,
        'cert-operator-' || v_suffix || '-' || v_count,
        'operator_confirmed',
        'Operator certification ' || v_count,
        v_ai_operator,
        '{}'::jsonb,
        jsonb_build_object('ok', true, 'ai', v_ai_operator),
        now()
      );

      select trust_status, canonical_revision
      into v_status, v_revision
      from public.tcos_card_knowledge_entries
      where id = v_operator_entry;

      if v_count < 3 and (v_status <> 'learning' or v_revision <> 0) then
        raise exception 'Operator trust promoted before three observations';
      end if;
      if v_count = 3 and (v_status <> 'tcos_trusted' or v_revision <> 1) then
        raise exception 'Three operator observations did not promote canonical trust';
      end if;
    end loop;

    insert into public.tcos_card_knowledge_entries(
      identity_fingerprint, title, year, brand, set_name, card_number,
      player, parallel, variation, is_auto, is_relic, ai_result
    ) values (
      'cert-catalog-' || v_suffix, 'Catalog Candidate', '2026', 'Upper Deck',
      'Certification Catalog Set', 'CAT-' || v_suffix,
      'Certification Catalog ' || v_suffix, 'Silver', 'Photo B', false, false,
      v_ai_catalog
    ) returning id into v_catalog_entry;

    insert into public.tcos_card_knowledge_observations(
      knowledge_entry_id, observation_key, confirmation_status, title,
      ai_result, catalog_evidence, result_payload, observed_at
    ) values (
      v_catalog_entry,
      'cert-catalog-' || v_suffix,
      'catalog_confirmed',
      'Catalog certification',
      v_ai_catalog,
      jsonb_build_object('status', 'catalog_confirmed', 'catalogConfirmed', true),
      jsonb_build_object('ok', true, 'ai', v_ai_catalog),
      now()
    );

    select trust_status, canonical_revision, player
    into v_status, v_revision, v_player
    from public.tcos_card_knowledge_entries
    where id = v_catalog_entry;
    if v_status <> 'tcos_trusted' or v_revision <> 1 then
      raise exception 'Catalog confirmation did not promote canonical trust';
    end if;

    perform set_config('tcos.instacomp_canonical_promotion', 'off', true);
    update public.tcos_card_knowledge_entries
    set player = 'Poisoned Scanner Value',
        ai_result = jsonb_build_object('player', 'Poisoned Scanner Value')
    where id = v_catalog_entry;

    select player into v_player
    from public.tcos_card_knowledge_entries
    where id = v_catalog_entry;
    if v_player <> 'Certification Catalog ' || v_suffix then
      raise exception 'Trusted canonical entry was overwritten by scanner data';
    end if;

    begin
      update public.tcos_card_knowledge_canonical_versions
      set canonical_snapshot = '{}'::jsonb
      where knowledge_entry_id = v_catalog_entry;
      raise exception 'Canonical history update unexpectedly succeeded';
    exception
      when others then
        if sqlerrm = 'Canonical history update unexpectedly succeeded'
           or position('append-only' in lower(sqlerrm)) = 0 then
          raise;
        end if;
    end;

    select id into v_store from public.stores order by created_at nulls last limit 1;
    if v_store is null then
      raise exception 'Production store was not found for rate-limit certification';
    end if;

    v_receipt := public.tcos_take_public_endpoint_rate_limit(
      v_store, 'instacomp-cert-' || v_suffix, 'admin:' || v_suffix,
      '203.0.113.200', 'hardening-cert', 'low', '{}'::jsonb,
      86400, 250, 60, 2
    );
    if coalesce((v_receipt->>'allowed')::boolean, false) is not true then
      raise exception 'First atomic rate-limit request was blocked';
    end if;

    v_receipt := public.tcos_take_public_endpoint_rate_limit(
      v_store, 'instacomp-cert-' || v_suffix, 'admin:' || v_suffix,
      '203.0.113.200', 'hardening-cert', 'low', '{}'::jsonb,
      86400, 250, 60, 2
    );
    if coalesce((v_receipt->>'allowed')::boolean, false) is not true then
      raise exception 'Second atomic rate-limit request was blocked';
    end if;

    v_receipt := public.tcos_take_public_endpoint_rate_limit(
      v_store, 'instacomp-cert-' || v_suffix, 'admin:' || v_suffix,
      '203.0.113.200', 'hardening-cert', 'low', '{}'::jsonb,
      86400, 250, 60, 2
    );
    if coalesce((v_receipt->>'allowed')::boolean, true) is not false
       or v_receipt->>'reason' <> 'burst_limit' then
      raise exception 'Atomic burst limit did not block the third request';
    end if;
  end;
  $cert$;
  rollback;`;

  await queryDatabase(selfTestSql, {
    label: "Run rollback-only Production hardening behavior certification",
    maximumAttempts: 3,
  });

  const receipt = {
    schema: "truelycollectables.instacomp2Hardening.productionReceipt.v1",
    sourceSha: EXPECTED_MAIN_SHA,
    projectRef,
    completedAt: new Date().toISOString(),
    appliedMigrations,
    preMigrationState: before,
    postMigrationState: after,
    rollbackOnlyBehaviorCertification: "passed",
    dataPreservation: "passed",
  };
  writeJson("production-receipt.json", receipt);
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "production-receipt.md"),
    [
      "# InstaComp 2.0 Production hardening receipt",
      "",
      `- Source commit: \`${EXPECTED_MAIN_SHA}\``,
      `- Completed: ${receipt.completedAt}`,
      `- Migrations: ${appliedMigrations.length}/${MIGRATIONS.length} applied`,
      `- Saved scans: ${before.savedScans} → ${after.savedScans}`,
      `- Knowledge entries: ${before.knowledgeEntries} → ${after.knowledgeEntries}`,
      `- Knowledge observations: ${before.knowledgeObservations} → ${after.knowledgeObservations}`,
      `- Trusted entries: ${after.trustedEntries}`,
      `- Needs-review entries: ${after.reviewEntries}`,
      `- Collision audit rows: ${after.collisionAuditRows}`,
      `- Canonical version rows: ${after.canonicalVersionRows}`,
      "- Tenant-scoped cache/index contract: PASS",
      "- Future collision fail-closed behavior: PASS",
      "- Three-operator/catalog promotion behavior: PASS",
      "- Trusted canonical overwrite protection: PASS",
      "- Append-only canonical history: PASS",
      "- Atomic daily/burst rate-limit behavior: PASS",
      "- Anonymous/authenticated private-table and rate-limit execution boundary: PASS",
      "- Rollback-only Production behavior certification left no test rows: PASS",
      "",
    ].join("\n"),
  );
  console.log("INSTACOMP_2_PRODUCTION_HARDENING=passed");
  console.log(`INSTACOMP_2_PRODUCTION_SOURCE_SHA=${EXPECTED_MAIN_SHA}`);
  console.log(`INSTACOMP_2_PRODUCTION_MIGRATIONS=${appliedMigrations.length}`);
}

main().catch((error) => {
  const receipt = {
    schema: "truelycollectables.instacomp2Hardening.productionFailure.v1",
    sourceSha: EXPECTED_MAIN_SHA || null,
    failedAt: new Date().toISOString(),
    error: safeText(error instanceof Error ? error.stack || error.message : error),
  };
  writeJson("production-failure.json", receipt);
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "production-failure.md"),
    [
      "# InstaComp 2.0 Production hardening failure",
      "",
      `- Source commit: \`${receipt.sourceSha || "unknown"}\``,
      `- Failed: ${receipt.failedAt}`,
      "",
      "```text",
      receipt.error,
      "```",
      "",
    ].join("\n"),
  );
  console.error(receipt.error);
  process.exitCode = 1;
});
