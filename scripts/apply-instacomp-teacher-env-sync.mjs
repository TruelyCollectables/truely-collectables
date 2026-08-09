import fs from "node:fs";

const path = "services/instacomp-ai/scripts/update-live-from-main.sh";
const source = fs.readFileSync(path, "utf8");
const before = `set_vercel_env INSTACOMP_AI_LOCAL_URL "$tunnel_url" production plain
set_vercel_env INSTACOMP_AI_LOCAL_KEY "$local_key" production sensitive
set_vercel_env INSTACOMP_SERVICE_TOKEN "$registry_token" production sensitive
set_vercel_env INSTACOMP_SENTINEL_ARCHIVE_TOKEN "$archive_token" production sensitive
repair_vercel_root_directory`;
const after = `set_vercel_env INSTACOMP_AI_LOCAL_URL "$tunnel_url" production plain
set_vercel_env INSTACOMP_AI_LOCAL_KEY "$local_key" production sensitive
set_vercel_env INSTACOMP_SERVICE_TOKEN "$registry_token" production sensitive
set_vercel_env INSTACOMP_SENTINEL_ARCHIVE_TOKEN "$archive_token" production sensitive

sync_optional_teacher_env() {
  local name="$1"
  local value=""
  value="$(read_env_value "$env_file" "$name")"
  if [[ -z "$value" ]]; then
    return 0
  fi
  set_vercel_env "$name" "$value" production sensitive
  echo "PASS  Synced configured teacher credential $name to Vercel Production."
}

for teacher_env in \\
  GEMINI_API_KEY \\
  GOOGLE_GEMINI_API_KEY \\
  ANTHROPIC_API_KEY \\
  XAI_API_KEY \\
  GROQ_API_KEY \\
  PERPLEXITY_API_KEY \\
  OPENAI_API_KEY
do
  sync_optional_teacher_env "$teacher_env"
done

repair_vercel_root_directory`;
const count = source.split(before).length - 1;
if (count !== 1) {
  throw new Error(`Expected exactly one Vercel credential sync block, found ${count}.`);
}
fs.writeFileSync(path, source.replace(before, after));
console.log("Applied optional teacher credential sync to the fail-closed Mac updater.");
