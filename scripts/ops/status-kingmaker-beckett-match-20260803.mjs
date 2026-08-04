import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const GUIDE_IDS = [
  "77740b65-9cb8-472e-9a24-738a7052bed4",
  "e61000be-7992-407c-ad1e-06ac8ebe64b2",
  "8dfaa9c4-65c7-4389-b2b2-2d463930c826",
  "c560a8b1-48bf-41cd-924f-9cb9afc4ab06",
  "30dd1dd2-0c1f-4f4e-936b-957f4ce519f2",
];

function parseEnv(contents) {
  const parsed = {};
  for (const raw of String(contents || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    parsed[key] = value;
  }
  return parsed;
}

function projectRef(url) {
  const match = String(url || "").match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i);
  if (!match) throw new Error("Invalid Production Supabase URL.");
  return match[1];
}

async function query(project, token, sql, parameters = []) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query: sql, parameters, read_only: true }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Status query failed (${response.status}): ${text.slice(0, 1000)}`);
  return text ? JSON.parse(text) : [];
}

const envPath = process.env.PRODUCTION_ENV_FILE;
const token = process.env.GH_SUPABASE_ACCESS_TOKEN;
if (!envPath || !token) throw new Error("Protected Production credentials are required.");
const env = parseEnv(readFileSync(envPath, "utf8"));
const project = projectRef(env.NEXT_PUBLIC_SUPABASE_URL);
const rows = await query(
  project,
  token,
  `
    select
      guide.id as guide_id,
      guide.title,
      count(entry.id) as entries,
      count(entry.id) filter (
        where coalesce((entry.metadata ->> 'registry_match_attempted')::boolean, false)
      ) as attempted,
      count(entry.id) filter (
        where coalesce((entry.metadata ->> 'registry_match_attempted')::boolean, false) = false
      ) as unattempted,
      count(entry.id) filter (where entry.identity_match_status = 'exact') as exact,
      count(entry.id) filter (where entry.identity_match_status = 'ambiguous') as ambiguous,
      count(entry.id) filter (where entry.identity_match_status = 'unmatched') as unmatched,
      count(entry.id) filter (where entry.identity_match_status = 'not_applicable') as not_applicable,
      count(entry.id) filter (where entry.validation_status = 'accepted') as accepted,
      count(entry.id) filter (where entry.validation_status = 'review') as review,
      (
        select count(*)
        from public.tcos_kingmaker_price_review_queue queue
        where queue.guide_id = guide.id
          and queue.status in ('open', 'in_review')
      ) as queued_review_items
    from public.tcos_kingmaker_price_guides guide
    left join public.tcos_kingmaker_price_entries entry on entry.guide_id = guide.id
    where guide.id = any($1::uuid[])
    group by guide.id, guide.title
    order by guide.title;
  `,
  [GUIDE_IDS],
);
const normalized = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, /^\d+$/.test(String(value)) ? Number(value) : value])));
const receipt = {
  schema: "tcos.kingmaker.beckettMatchStatus.v1",
  generatedAt: new Date().toISOString(),
  guides: normalized,
  totals: {
    entries: normalized.reduce((sum, row) => sum + row.entries, 0),
    attempted: normalized.reduce((sum, row) => sum + row.attempted, 0),
    unattempted: normalized.reduce((sum, row) => sum + row.unattempted, 0),
    queuedReviewItems: normalized.reduce((sum, row) => sum + row.queued_review_items, 0),
  },
};
const path = resolve(process.env.RECEIPT_PATH || "evidence/kingmaker-beckett-match-status-20260803/status.json");
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
