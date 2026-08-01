import fs from "node:fs";
import path from "node:path";

const EXPECTED_MAIN_SHA = String(process.env.EXPECTED_MAIN_SHA || "").trim();
const SUPABASE_ACCESS_TOKEN = String(
  process.env.GH_SUPABASE_ACCESS_TOKEN || "",
).trim();
const PRODUCTION_ENV_PATH = String(process.env.PRODUCTION_ENV_PATH || "").trim();
const EVIDENCE_DIR = String(
  process.env.EVIDENCE_DIR || "evidence/instacomp-learning-registry",
).trim();

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

function safeText(value, limit = 6000) {
  return String(value || "")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .slice(0, limit);
}

function writeJson(filename, payload) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, filename),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
}

async function main() {
  if (!EXPECTED_MAIN_SHA || !SUPABASE_ACCESS_TOKEN || !PRODUCTION_ENV_PATH) {
    throw new Error("Production backfill diagnostic environment is incomplete.");
  }

  const productionEnv = parseDotEnv(PRODUCTION_ENV_PATH);
  const productionUrl = String(productionEnv.NEXT_PUBLIC_SUPABASE_URL || "");
  if (!/^https:\/\//.test(productionUrl)) {
    throw new Error("Production NEXT_PUBLIC_SUPABASE_URL was not pulled.");
  }
  const projectRef = new URL(productionUrl).hostname.split(".")[0];
  if (!projectRef) throw new Error("Could not resolve the Production Supabase project.");

  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  const request = async (query, readOnly) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, parameters: [], read_only: readOnly }),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `Supabase query failed with HTTP ${response.status}: ${safeText(body)}`,
      );
    }
    return body ? JSON.parse(body) : [];
  };

  const counts = await request(
    `select json_build_object(
      'saved_scans', (select count(*) from public.instacomp_scans),
      'knowledge_entries', (select count(*) from public.tcos_card_knowledge_entries),
      'knowledge_observations', (select count(*) from public.tcos_card_knowledge_observations),
      'unlearned_saved_scans', (
        select count(*)
        from public.instacomp_scans scan
        left join public.tcos_card_knowledge_observations observation
          on observation.observation_key = 'scan:' || scan.id::text
        where observation.id is null
      )
    ) as state;`,
    true,
  );

  const samples = await request(
    `select json_build_object(
      'scan_id', scan.id::text,
      'created_at', scan.created_at,
      'image_filename', scan.image_filename,
      'player', scan.player,
      'year', scan.year,
      'brand', scan.brand,
      'set_name', scan.set_name,
      'card_number', scan.card_number,
      'parallel', scan.parallel,
      'confidence', scan.confidence,
      'raw_ai_type', jsonb_typeof(scan.raw_ai_result),
      'raw_comp_type', jsonb_typeof(scan.raw_comp_results),
      'raw_ai_keys', case
        when jsonb_typeof(scan.raw_ai_result) = 'object'
          then (select jsonb_agg(key order by key) from jsonb_object_keys(scan.raw_ai_result) key)
        else null
      end,
      'is_rookie_value', scan.raw_ai_result->'isRookie',
      'is_rookie_type', jsonb_typeof(scan.raw_ai_result->'isRookie'),
      'is_auto_value', scan.raw_ai_result->'isAuto',
      'is_auto_type', jsonb_typeof(scan.raw_ai_result->'isAuto'),
      'is_relic_value', scan.raw_ai_result->'isRelic',
      'is_relic_type', jsonb_typeof(scan.raw_ai_result->'isRelic'),
      'serial_number_value', scan.raw_ai_result->'serialNumber',
      'team_value', scan.raw_ai_result->'team',
      'sport_value', scan.raw_ai_result->'sport',
      'catalog_status', scan.raw_comp_results #>> '{catalogEvidence,status}',
      'catalog_confirmed', scan.raw_comp_results #>> '{catalogEvidence,catalogConfirmed}'
    ) as sample
    from public.instacomp_scans scan
    left join public.tcos_card_knowledge_observations observation
      on observation.observation_key = 'scan:' || scan.id::text
    where observation.id is null
    order by scan.created_at asc
    limit 10;`,
    true,
  );

  const diagnostics = [];
  for (const row of samples || []) {
    const sample = row?.sample || {};
    const scanId = String(sample.scan_id || "");
    const diagnostic = {
      scanId,
      sample,
      replayReturnedEntryId: null,
      observationCountAfterReplay: null,
      error: null,
    };

    if (!/^[0-9a-f-]{36}$/i.test(scanId)) {
      diagnostic.error = "Invalid scan UUID returned by diagnostic query.";
      diagnostics.push(diagnostic);
      continue;
    }

    try {
      const replay = await request(
        `select public.tcos_instacomp_record_scan_knowledge_payload(to_jsonb(scan)) as knowledge_entry_id
         from public.instacomp_scans scan
         where scan.id = '${scanId}'::uuid;`,
        false,
      );
      diagnostic.replayReturnedEntryId =
        replay?.[0]?.knowledge_entry_id || null;
    } catch (error) {
      diagnostic.error = safeText(
        error instanceof Error ? error.message : String(error),
      );
    }

    try {
      const check = await request(
        `select count(*)::integer as observation_count
         from public.tcos_card_knowledge_observations
         where observation_key = 'scan:${scanId}';`,
        true,
      );
      diagnostic.observationCountAfterReplay = Number(
        check?.[0]?.observation_count || 0,
      );
    } catch (error) {
      diagnostic.error = [
        diagnostic.error,
        safeText(error instanceof Error ? error.message : String(error)),
      ]
        .filter(Boolean)
        .join(" | ");
    }

    diagnostics.push(diagnostic);
  }

  const typeSummary = await request(
    `select json_build_object(
      'raw_ai_types', (
        select jsonb_object_agg(value_type, row_count)
        from (
          select coalesce(jsonb_typeof(raw_ai_result), 'sql-null') as value_type,
                 count(*)::integer as row_count
          from public.instacomp_scans
          group by 1
        ) summary
      ),
      'rookie_types', (
        select jsonb_object_agg(value_type, row_count)
        from (
          select coalesce(jsonb_typeof(raw_ai_result->'isRookie'), 'missing') as value_type,
                 count(*)::integer as row_count
          from public.instacomp_scans
          group by 1
        ) summary
      ),
      'auto_types', (
        select jsonb_object_agg(value_type, row_count)
        from (
          select coalesce(jsonb_typeof(raw_ai_result->'isAuto'), 'missing') as value_type,
                 count(*)::integer as row_count
          from public.instacomp_scans
          group by 1
        ) summary
      ),
      'relic_types', (
        select jsonb_object_agg(value_type, row_count)
        from (
          select coalesce(jsonb_typeof(raw_ai_result->'isRelic'), 'missing') as value_type,
                 count(*)::integer as row_count
          from public.instacomp_scans
          group by 1
        ) summary
      )
    ) as summary;`,
    true,
  );

  const receipt = {
    schema: "truelycollectables.instacompLearningBackfillDiagnostic.v1",
    sourceSha: EXPECTED_MAIN_SHA,
    capturedAt: new Date().toISOString(),
    counts: counts?.[0]?.state || null,
    typeSummary: typeSummary?.[0]?.summary || null,
    diagnostics,
  };
  writeJson("backfill-diagnostic.json", receipt);
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "backfill-diagnostic.md"),
    [
      "# InstaComp Production backfill diagnostic",
      "",
      `- Source SHA: \`${EXPECTED_MAIN_SHA}\``,
      `- Saved scans: ${receipt.counts?.saved_scans ?? "unknown"}`,
      `- Existing observations: ${receipt.counts?.knowledge_observations ?? "unknown"}`,
      `- Unlearned saved scans: ${receipt.counts?.unlearned_saved_scans ?? "unknown"}`,
      "",
      "```json",
      JSON.stringify({ typeSummary: receipt.typeSummary, diagnostics }, null, 2),
      "```",
      "",
    ].join("\n"),
  );

  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((error) => {
  const receipt = {
    schema: "truelycollectables.instacompLearningBackfillDiagnostic.v1",
    sourceSha: EXPECTED_MAIN_SHA,
    capturedAt: new Date().toISOString(),
    fatalError: safeText(error instanceof Error ? error.stack || error.message : error),
  };
  writeJson("backfill-diagnostic.json", receipt);
  console.error(receipt.fatalError);
  process.exitCode = 1;
});
