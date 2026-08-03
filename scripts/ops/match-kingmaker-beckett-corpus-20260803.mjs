import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const GUIDE_IDS = [
  "77740b65-9cb8-472e-9a24-738a7052bed4",
  "e61000be-7992-407c-ad1e-06ac8ebe64b2",
  "8dfaa9c4-65c7-4389-b2b2-2d463930c826",
  "c560a8b1-48bf-41cd-924f-9cb9afc4ab06",
  "30dd1dd2-0c1f-4f4e-936b-957f4ce519f2",
];
const BATCH_SIZE = 250;
const RECEIPT_SCHEMA = "tcos.kingmaker.beckettProductionMatchReceipt.v1";

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
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function projectRef(url) {
  const match = String(url || "").match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i);
  if (!match) throw new Error("Production Supabase URL is invalid.");
  return match[1];
}

async function managementQuery({ project, token, query, parameters = [], readOnly = false, stage }) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, parameters, read_only: readOnly }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${stage} failed (${response.status}): ${text.slice(0, 1000)}`);
  return text ? JSON.parse(text) : [];
}

function firstRow(value) {
  return Array.isArray(value) ? value[0] : value;
}

const prepareSql = `
create or replace function public.tcos_match_kingmaker_price_entries_batch(
  p_guide_id uuid,
  p_limit integer default 250
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  processed_count integer := 0;
  exact_count integer := 0;
  ambiguous_count integer := 0;
  unmatched_count integer := 0;
begin
  with target as (
    select entry.id
    from public.tcos_kingmaker_price_entries entry
    where entry.guide_id = p_guide_id
      and coalesce((entry.metadata ->> 'registry_match_attempted')::boolean, false) = false
    order by entry.page_number, entry.row_order, entry.id
    limit greatest(1, least(p_limit, 1000))
    for update skip locked
  ), candidate_rows as (
    select
      entry.id as entry_id,
      array_agg(distinct identity.id order by identity.id) filter (where identity.id is not null) as identity_ids,
      min(identity.canonical_key) as canonical_key,
      count(distinct identity.id) as candidate_count
    from target
    join public.tcos_kingmaker_price_entries entry on entry.id = target.id
    left join public.checklist_releases release
      on entry.entry_kind = 'card'
     and public.tcos_kingmaker_price_normalize(entry.release_year) in (
       public.tcos_kingmaker_price_normalize(release.release_year),
       public.tcos_kingmaker_price_normalize(release.season)
     )
     and public.tcos_kingmaker_price_normalize(release.product_name) in (
       public.tcos_kingmaker_price_normalize(entry.product),
       public.tcos_kingmaker_price_normalize(concat_ws(' ', entry.release_year, entry.product))
     )
    left join public.checklist_manufacturers manufacturer
      on manufacturer.id = release.manufacturer_id
     and public.tcos_kingmaker_price_normalize(entry.manufacturer) = public.tcos_kingmaker_price_normalize(manufacturer.name)
    left join public.checklist_versions version
      on version.release_id = release.id and version.is_active
    left join public.checklist_sets set_row
      on set_row.release_id = release.id
     and set_row.version_id = version.id
     and (
       public.tcos_kingmaker_price_normalize(entry.set_name) = public.tcos_kingmaker_price_normalize(set_row.name)
       or (public.tcos_kingmaker_price_normalize(entry.set_name) = 'base' and set_row.set_type = 'base')
     )
    left join public.checklist_cards card
      on card.release_id = release.id
     and card.version_id = version.id
     and card.set_id = set_row.id
     and public.tcos_kingmaker_price_normalize(entry.card_number) = public.tcos_kingmaker_price_normalize(card.card_number)
    left join public.checklist_card_identities identity
      on identity.release_id = release.id
     and identity.version_id = version.id
     and identity.set_id = set_row.id
     and identity.card_id = card.id
    left join public.checklist_parallels parallel on parallel.id = identity.parallel_id
    where entry.entry_kind <> 'card'
       or entry.validation_status = 'rejected'
       or identity.id is null
       or (
         (nullif(public.tcos_kingmaker_price_normalize(entry.parallel_name), '') is null and identity.parallel_id is null)
         or public.tcos_kingmaker_price_normalize(entry.parallel_name) = public.tcos_kingmaker_price_normalize(parallel.name)
       )
    group by entry.id
  ), updated as (
    update public.tcos_kingmaker_price_entries entry
    set
      checklist_identity_id = case when candidates.candidate_count = 1 then candidates.identity_ids[1] else null end,
      identity_match_status = case
        when entry.entry_kind <> 'card' then 'not_applicable'
        when candidates.candidate_count = 1 then 'exact'
        when candidates.candidate_count > 1 then 'ambiguous'
        else 'unmatched'
      end,
      entity_key = case when candidates.candidate_count = 1 then candidates.canonical_key else entry.entity_key end,
      validation_status = case
        when candidates.candidate_count = 1
         and coalesce(entry.metadata ->> 'sourceEngine', '') = 'text'
         and entry.parse_confidence >= 0.98 then 'accepted'
        when entry.validation_status = 'rejected' then 'rejected'
        else 'review'
      end,
      validation_reasons = case
        when candidates.candidate_count = 1
         and coalesce(entry.metadata ->> 'sourceEngine', '') = 'text'
         and entry.parse_confidence >= 0.98 then '[]'::jsonb
        when candidates.candidate_count = 1 then coalesce(entry.validation_reasons, '[]'::jsonb) || jsonb_build_array('exact_identity_matched_value_verification_required')
        when candidates.candidate_count > 1 then coalesce(entry.validation_reasons, '[]'::jsonb) || jsonb_build_array('multiple_registry_identities_matched')
        else entry.validation_reasons
      end,
      metadata = coalesce(entry.metadata, '{}'::jsonb) || jsonb_build_object('registry_match_attempted', true, 'registry_match_attempted_at', now())
    from candidate_rows candidates
    where entry.id = candidates.entry_id
    returning entry.identity_match_status
  )
  select count(*),
         count(*) filter (where identity_match_status = 'exact'),
         count(*) filter (where identity_match_status = 'ambiguous'),
         count(*) filter (where identity_match_status = 'unmatched')
  into processed_count, exact_count, ambiguous_count, unmatched_count
  from updated;

  return jsonb_build_object(
    'processed', processed_count,
    'exact', exact_count,
    'ambiguous', ambiguous_count,
    'unmatched', unmatched_count
  );
end;
$$;
revoke all on function public.tcos_match_kingmaker_price_entries_batch(uuid, integer) from public, anon, authenticated;
grant execute on function public.tcos_match_kingmaker_price_entries_batch(uuid, integer) to service_role;
`;

async function main() {
  if (process.env.ALLOW_KINGMAKER_BECKETT_MATCH !== "YES") throw new Error("ALLOW_KINGMAKER_BECKETT_MATCH=YES is required.");
  const token = process.env.GH_SUPABASE_ACCESS_TOKEN;
  const envPath = process.env.PRODUCTION_ENV_FILE;
  if (!token || !envPath) throw new Error("Protected Production credentials are required.");
  const env = parseEnv(readFileSync(envPath, "utf8"));
  const project = projectRef(env.NEXT_PUBLIC_SUPABASE_URL);

  await managementQuery({ project, token, query: prepareSql, stage: "bounded matcher preparation" });

  const guides = [];
  for (const guideId of GUIDE_IDS) {
    const totals = { processed: 0, exact: 0, ambiguous: 0, unmatched: 0 };
    for (;;) {
      const result = firstRow(await managementQuery({
        project,
        token,
        query: "select public.tcos_match_kingmaker_price_entries_batch($1::uuid, $2::integer) as result;",
        parameters: [guideId, BATCH_SIZE],
        stage: `match batch ${guideId}`,
      }))?.result || {};
      const processed = Number(result.processed || 0);
      for (const key of Object.keys(totals)) totals[key] += Number(result[key] || 0);
      if (processed === 0) break;
      if (totals.processed % 5000 < BATCH_SIZE) console.log(`${guideId}: ${totals.processed} matched-attempted`);
    }
    guides.push({ guideId, ...totals });
  }

  await managementQuery({
    project,
    token,
    stage: "review queue generation",
    query: `
      insert into public.tcos_kingmaker_price_review_queue (
        guide_id, entry_id, page_number, issue_type, severity, reason, evidence
      )
      select entry.guide_id, entry.id, entry.page_number,
        case
          when entry.identity_match_status = 'ambiguous' then 'identity_ambiguous'
          when entry.identity_match_status = 'unmatched' and entry.entry_kind = 'card' then 'identity_unmatched'
          when entry.identity_match_status = 'exact' and entry.validation_status = 'review' then 'value_verification_required'
          when entry.entry_kind <> 'card' then 'aggregate_reference_review'
          else 'parser_review'
        end,
        case when entry.identity_match_status in ('ambiguous','exact') then 'high' else 'medium' end,
        case
          when entry.identity_match_status = 'ambiguous' then 'More than one active Checklist Registry identity matched this Beckett row.'
          when entry.identity_match_status = 'unmatched' and entry.entry_kind = 'card' then 'No exact active Checklist Registry identity matched this Beckett row.'
          when entry.identity_match_status = 'exact' and entry.validation_status = 'review' then 'Identity matched exactly, but OCR-derived values require visual verification before promotion.'
          when entry.entry_kind <> 'card' then 'Aggregate, wrapper, set, or multiplier rows require operator review before use.'
          else 'Parser marked this row for review.'
        end,
        jsonb_build_object('source_row_key', entry.source_row_key, 'raw_text', entry.raw_text, 'validation_reasons', entry.validation_reasons, 'identity_match_status', entry.identity_match_status, 'parse_confidence', entry.parse_confidence)
      from public.tcos_kingmaker_price_entries entry
      where entry.guide_id = any($1::uuid[])
        and entry.validation_status = 'review'
        and not exists (
          select 1 from public.tcos_kingmaker_price_review_queue queue
          where queue.entry_id = entry.id and queue.status in ('open','in_review')
        );
    `,
    parameters: [GUIDE_IDS],
  });

  const production = firstRow(await managementQuery({
    project,
    token,
    readOnly: true,
    stage: "final matching verification",
    parameters: [GUIDE_IDS],
    query: `
      select
        count(*) as entries,
        count(*) filter (where identity_match_status = 'exact') as exact,
        count(*) filter (where identity_match_status = 'ambiguous') as ambiguous,
        count(*) filter (where identity_match_status = 'unmatched') as unmatched,
        count(*) filter (where identity_match_status = 'not_applicable') as not_applicable,
        count(*) filter (where validation_status = 'accepted') as accepted,
        count(*) filter (where validation_status = 'review') as review,
        count(*) filter (where low_observation_id is not null or high_observation_id is not null) as promoted,
        count(*) filter (where coalesce((metadata ->> 'registry_match_attempted')::boolean, false) = false) as unattempted
      from public.tcos_kingmaker_price_entries
      where guide_id = any($1::uuid[]);
    `,
  }));

  if (Number(production.entries) !== 128636) throw new Error(`Expected 128636 entries, found ${production.entries}.`);
  if (Number(production.unattempted) !== 0) throw new Error(`${production.unattempted} rows were not attempted.`);
  if (Number(production.promoted) !== 0) throw new Error("Beckett observations were promoted unexpectedly.");

  const receipt = {
    schema: RECEIPT_SCHEMA,
    status: "passed",
    generatedAt: new Date().toISOString(),
    guides,
    production: Object.fromEntries(Object.entries(production).map(([key, value]) => [key, Number(value)])),
    promotedAutomatically: false,
    secretsPersisted: false,
  };
  const receiptPath = resolve(process.env.RECEIPT_PATH || "evidence/kingmaker-beckett-production-match-20260803/receipt.json");
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
