#!/usr/bin/env bash
set -euo pipefail

: "${VERCEL_SCOPE:=truelycollectables-projects}"
test -n "${VERCEL_TOKEN:-}"
test -n "${GH_SUPABASE_ACCESS_TOKEN:-}"

work_dir="$RUNNER_TEMP/mainstream-checklist-ingestion"
mkdir -p .vercel "$work_dir"

if [[ -n "${VERCEL_ORG_ID:-}" && -n "${VERCEL_PROJECT_ID:-}" ]]; then
  printf '{"orgId":"%s","projectId":"%s"}\n' \
    "$VERCEL_ORG_ID" "$VERCEL_PROJECT_ID" > .vercel/project.json
else
  for attempt in 1 2 3; do
    if npx vercel@56.2.0 link --yes --project truely-collectables \
      --scope "$VERCEL_SCOPE" --token "$VERCEL_TOKEN" >/dev/null; then
      break
    fi
    if [[ "$attempt" == 3 ]]; then
      echo "Vercel project link failed after ${attempt} attempts." >&2
      exit 1
    fi
    sleep $((attempt * 3))
  done
fi

production_env="$work_dir/production.env"
for attempt in 1 2 3; do
  if npx vercel@56.2.0 env pull "$production_env" \
    --yes --environment production --scope "$VERCEL_SCOPE" \
    --token "$VERCEL_TOKEN" >/dev/null; then
    break
  fi
  if [[ "$attempt" == 3 ]]; then
    echo "Vercel Production environment pull failed after ${attempt} attempts." >&2
    exit 1
  fi
  sleep $((attempt * 3))
done
chmod 600 "$production_env"

set -a
source "$production_env"
set +a

test -n "${NEXT_PUBLIC_SUPABASE_URL:-}"
project_ref="$(node -e '
  const url = new URL(process.argv[1]);
  const ref = url.hostname.split(".")[0];
  if (!/^[a-z0-9]{16,40}$/.test(ref)) {
    throw new Error("Invalid Supabase project reference");
  }
  process.stdout.write(ref);
' "$NEXT_PUBLIC_SUPABASE_URL")"

keys_file="$work_dir/api-keys.json"
curl --silent --show-error --fail \
  --retry 5 --retry-delay 2 --retry-all-errors \
  --header "Authorization: Bearer $GH_SUPABASE_ACCESS_TOKEN" \
  --output "$keys_file" \
  "https://api.supabase.com/v1/projects/$project_ref/api-keys?reveal=true"

service_key="$(jq -r '
  map(select(
    (((.name // "") | ascii_downcase | gsub("[^a-z0-9]+"; "_")) == "service_role") or
    (((.id // "") | ascii_downcase | gsub("[^a-z0-9]+"; "_")) == "service_role")
  )) | .[0].api_key // empty
' "$keys_file")"
test -n "$service_key"

echo "::add-mask::$service_key"
echo "PRODUCTION_ENV_PATH=$production_env" >> "$GITHUB_ENV"
echo "RESOLVED_SUPABASE_PROJECT_REF=$project_ref" >> "$GITHUB_ENV"
echo "RESOLVED_SUPABASE_SERVICE_ROLE_KEY=$service_key" >> "$GITHUB_ENV"
