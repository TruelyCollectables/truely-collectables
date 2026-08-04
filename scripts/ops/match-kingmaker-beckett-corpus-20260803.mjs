import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const GUIDE_IDS = [
  "77740b65-9cb8-472e-9a24-738a7052bed4",
  "e61000be-7992-407c-ad1e-06ac8ebe64b2",
  "8dfaa9c4-65c7-4389-b2b2-2d463930c826",
  "c560a8b1-48bf-41cd-924f-9cb9afc4ab06",
  "30dd1dd2-0c1f-4f4e-936b-957f4ce519f2",
];
const MATCH_BATCH_SIZE = 100;
const QUEUE_BATCH_SIZE = 250;
const MAX_QUERY_ATTEMPTS = 8;
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

function projectRef(url) {
  const match = String(url || "").match(
    /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i,
  );
  if (!match) throw new Error("Production Supabase URL is invalid.");
  return match[1];
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function retryDelayMilliseconds(status, response) {
  const retryAfter = Number(response.headers.get("retry-after") || 0);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(180, retryAfter) * 1000;
  }
  if (status === 524) return 125_000;
  return 0;
}

async function managementQuery({
  project,
  token,
  query,
  parameters = [],
  readOnly = false,
  stage,
}) {
  let lastFailure = null;
  for (let attempt = 1; attempt <= MAX_QUERY_ATTEMPTS; attempt += 1) {
    let response;
    let text = "";
    try {
      response = await fetch(
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
      text = await response.text();
    } catch (error) {
      lastFailure = `${stage} network failure: ${
        error instanceof Error ? error.message : String(error)
      }`;
      if (attempt === MAX_QUERY_ATTEMPTS) break;
      const delay = Math.min(60_000, 2 ** attempt * 1_000);
      console.warn(`${lastFailure}; retrying in ${Math.round(delay / 1000)}s`);
      await sleep(delay);
      continue;
    }

    if (response.ok) return text ? JSON.parse(text) : [];

    lastFailure = `${stage} failed (${response.status}): ${text.slice(0, 1000)}`;
    const retryable = [408, 425, 429, 500, 502, 503, 504, 524].includes(
      response.status,
    );
    if (!retryable || attempt === MAX_QUERY_ATTEMPTS) break;

    const headerDelay = retryDelayMilliseconds(response.status, response);
    const exponentialDelay = Math.min(60_000, 2 ** attempt * 1_000);
    const delay = Math.max(headerDelay, exponentialDelay);
    console.warn(
      `${stage} received ${response.status}; retry ${attempt}/${MAX_QUERY_ATTEMPTS} in ${Math.round(delay / 1000)}s`,
    );
    await sleep(delay);
  }
  throw new Error(lastFailure || `${stage} failed without a response.`);
}

function firstRow(value) {
  return Array.isArray(value) ? value[0] : value;
}

const prepareSql = `
create or replace function public.tcos_match_kingmaker_price_entries_batch(
  p_guide_id uuid,
  p_limit integer default 100
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
    limit greatest(1, least(p_limit, 500))
    for update skip locked
  ), candidate_rows as (
    select
      entry.id as entry_id,
      array_agg(distinct identity.id order by identity.id)
        filter (where identity.id is not null) as identity_ids,
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
       public.tcos_kingmaker_price_normalize(
         concat_ws(' ', entry.release_year, entry.product)
       )
     )
    left join public.checklist_manufacturers manufacturer
      on manufacturer.id = release.manufacturer_id
     and public.tcos_kingmaker_price_normalize(entry.manufacturer) =
         public.tcos_kingmaker_price_normalize(manufacturer.name)
    left join public.checklist_versions version
      on version.release_id = release.id and version.is_active
    left join public.checklist_sets set_row
      on set_row.release_id = release.id
     and set_row.version_id = version.id
     and (
       public.tcos_kingmaker_price_normalize(entry.set_name) =
         public.tcos_kingmaker_price_normalize(set_row.name)
       or (
         public.tcos_kingmaker_price_normalize(entry.set_name) = 'base'
         and set_row.set_type = 'base'
       )
     )
    left join public.checklist_cards card
      on card.release_id = release.id
     and card.version_id = version.id
     and card.set_id = set_row.id
     and public.tcos_kingmaker_price_normalize(entry.card_number) =
         public.tcos_kingmaker_price_normalize(card.card_number)
    left join public.checklist_card_identities identity
      on identity.release_id = release.id
     and identity.version_id = version.id
     and identity.set_id = set_row.id
     and identity.card_id = card.id
    left join public.checklist_parallels parallel
      on parallel.id = identity.parallel_id
    where entry.entry_kind <> 'card'
       or entry.validation_status = 'rejected'
       or identity.id is null
       or (
         (
           nullif(
             public.tcos_kingmaker_price_normalize(entry.parallel_name),
             ''
           ) is null
           and identity.parallel_id is null
         )
         or public.tcos_kingmaker_price_normalize(entry.parallel_name) =
            public.tcos_kingmaker_price_normalize(parallel.name)
       )
    group by entry.id
  ), updated as (
    update public.tcos_kingmaker_price_entries entry
    set
      checklist_identity_id = case
        when candidates.candidate_count = 1 then candidates.identity_ids[1]
        else null
      end,
      identity_match_status = case
        when entry.entry_kind <> 'card' then 'not_applicable'
        when candidates.candidate_count = 1 then 'exact'
        when candidates.candidate_count > 1 then 'ambiguous'
        else 'unmatched'
      end,
      entity_key = case
        when candidates.candidate_count = 1 then candidates.canonical_key
        else entry.entity_key
      end,
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
        when candidates.candidate_count = 1 then
          coalesce(entry.validation_reasons, '[]'::jsonb) ||
          jsonb_build_array('exact_identity_matched_value_verification_required')
        when candidates.candidate_count > 1 then
          coalesce(entry.validation_reasons, '[]'::jsonb) ||
          jsonb_build_array('multiple_registry_identities_matched')
        else entry.validation_reasons
      end,
      metadata = coalesce(entry.metadata, '{}'::jsonb) ||
        jsonb_build_object(
          'registry_match_attempted', true,
          'registry_match_attempted_at', now()
        )
    from candidate_rows candidates
    where entry.id = candidates.entry_id
    returning entry.identity_match_status
  )
  select
    count(*),
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

create or replace function public.tcos_queue_kingmaker_price_entries_batch(
  p_guide_id uuid,
  p_limit integer default 250
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  queued_count integer := 0;
begin
  with target as (
    select entry.id
    from public.tcos_kingmaker_price_entries entry
    where entry.guide_id = p_guide_id
      and entry.validation_status = 'review'
      and not exists (
        select 1
        from public.tcos_kingmaker_price_review_queue queue
        where queue.entry_id = entry.id
          and queue.status in ('open', 'in_review')
      )
    order by entry.page_number, entry.row_order, entry.id
    limit greatest(1, least(p_limit, 500))
    for update skip locked
  ), inserted as (
    insert into public.tcos_kingmaker_price_review_queue (
      guide_id,
      entry_id,
      page_number,
      issue_type,
      severity,
      reason,
      evidence
    )
    select
      entry.guide_id,
      entry.id,
      entry.page_number,
      case
        when entry.identity_match_status = 'ambiguous' then 'identity_ambiguous'
        when entry.identity_match_status = 'unmatched'
          and entry.entry_kind = 'card' then 'identity_unmatched'
        when entry.identity_match_status = 'exact'
          and entry.validation_status = 'review' then 'value_verification_required'
        when entry.entry_kind <> 'card' then 'aggregate_reference_review'
        else 'parser_review'
      end,
      case
        when entry.identity_match_status in ('ambiguous', 'exact') then 'high'
        else 'medium'
      end,
      case
        when entry.identity_match_status = 'ambiguous' then
          'More than one active Checklist Registry identity matched this Beckett row.'
        when entry.identity_match_status = 'unmatched'
          and entry.entry_kind = 'card' then
          'No exact active Checklist Registry identity matched this Beckett row.'
        when entry.identity_match_status = 'exact'
          and entry.validation_status = 'review' then
          'Identity matched exactly, but the source value requires verification before promotion.'
        when entry.entry_kind <> 'card' then
          'Aggregate, wrapper, set, or multiplier rows require operator review before use.'
        else 'Parser marked this row for review.'
      end,
      jsonb_build_object(
        'source_row_key', entry.source_row_key,
        'validation_reasons', entry.validation_reasons,
        'identity_match_status', entry.identity_match_status,
        'parse_confidence', entry.parse_confidence
      )
    from target
    join public.tcos_kingmaker_price_entries entry on entry.id = target.id
    returning id
  )
  select count(*) into queued_count from inserted;

  return jsonb_build_object('queued', queued_count);
end;
$$;

revoke all on function public.tcos_match_kingmaker_price_entries_batch(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.tcos_queue_kingmaker_price_entries_batch(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.tcos_match_kingmaker_price_entries_batch(uuid, integer)
  to service_role;
grant execute on function public.tcos_queue_kingmaker_price_entries_batch(uuid, integer)
  to service_role;
`;

async function main() {
  if (process.env.ALLOW_KINGMAKER_BECKETT_MATCH !== "YES") {
    throw new Error("ALLOW_KINGMAKER_BECKETT_MATCH=YES is required.");
  }
  const token = process.env.GH_SUPABASE_ACCESS_TOKEN;
  const envPath = process.env.PRODUCTION_ENV_FILE;
  if (!token || !envPath) {
    throw new Error("Protected Production credentials are required.");
  }
  const env = parseEnv(readFileSync(envPath, "utf8"));
  const project = projectRef(env.NEXT_PUBLIC_SUPABASE_URL);

  await managementQuery({
    project,
    token,
    query: prepareSql,
    stage: "bounded matcher preparation",
  });

  const guides = [];
  for (const guideId of GUIDE_IDS) {
    const totals = {
      processedThisRun: 0,
      exactThisRun: 0,
      ambiguousThisRun: 0,
      unmatchedThisRun: 0,
      queuedThisRun: 0,
    };

    for (;;) {
      const result = firstRow(
        await managementQuery({
          project,
          token,
          query:
            "select public.tcos_match_kingmaker_price_entries_batch($1::uuid, $2::integer) as result;",
          parameters: [guideId, MATCH_BATCH_SIZE],
          stage: `match batch ${guideId}`,
        }),
      )?.result || {};
      const processed = Number(result.processed || 0);
      totals.processedThisRun += processed;
      totals.exactThisRun += Number(result.exact || 0);
      totals.ambiguousThisRun += Number(result.ambiguous || 0);
      totals.unmatchedThisRun += Number(result.unmatched || 0);
      if (processed === 0) break;
      if (totals.processedThisRun % 2_500 < MATCH_BATCH_SIZE) {
        console.log(
          `${guideId}: ${totals.processedThisRun} additional rows match-attempted`,
        );
      }
    }

    for (;;) {
      const result = firstRow(
        await managementQuery({
          project,
          token,
          query:
            "select public.tcos_queue_kingmaker_price_entries_batch($1::uuid, $2::integer) as result;",
          parameters: [guideId, QUEUE_BATCH_SIZE],
          stage: `review queue batch ${guideId}`,
        }),
      )?.result || {};
      const queued = Number(result.queued || 0);
      totals.queuedThisRun += queued;
      if (queued === 0) break;
      if (totals.queuedThisRun % 5_000 < QUEUE_BATCH_SIZE) {
        console.log(
          `${guideId}: ${totals.queuedThisRun} additional review items queued`,
        );
      }
    }

    guides.push({ guideId, ...totals });
  }

  const production = firstRow(
    await managementQuery({
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
          count(*) filter (
            where low_observation_id is not null or high_observation_id is not null
          ) as promoted,
          count(*) filter (
            where coalesce(
              (metadata ->> 'registry_match_attempted')::boolean,
              false
            ) = false
          ) as unattempted,
          (
            select count(*)
            from public.tcos_kingmaker_price_review_queue queue
            where queue.guide_id = any($1::uuid[])
              and queue.status in ('open', 'in_review')
          ) as queued_review_items
        from public.tcos_kingmaker_price_entries
        where guide_id = any($1::uuid[]);
      `,
    }),
  );

  if (Number(production.entries) !== 128636) {
    throw new Error(`Expected 128636 entries, found ${production.entries}.`);
  }
  if (Number(production.unattempted) !== 0) {
    throw new Error(`${production.unattempted} rows were not attempted.`);
  }
  if (Number(production.promoted) !== 0) {
    throw new Error("Beckett observations were promoted unexpectedly.");
  }
  if (Number(production.queued_review_items) < Number(production.review)) {
    throw new Error(
      `Review queue is incomplete: ${production.queued_review_items}/${production.review}.`,
    );
  }

  const receipt = {
    schema: RECEIPT_SCHEMA,
    status: "passed",
    generatedAt: new Date().toISOString(),
    resumedFromCheckpoint: true,
    matchBatchSize: MATCH_BATCH_SIZE,
    queueBatchSize: QUEUE_BATCH_SIZE,
    guides,
    production: Object.fromEntries(
      Object.entries(production).map(([key, value]) => [key, Number(value)]),
    ),
    promotedAutomatically: false,
    secretsPersisted: false,
  };
  const receiptPath = resolve(
    process.env.RECEIPT_PATH ||
      "evidence/kingmaker-beckett-production-match-20260803/receipt.json",
  );
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
