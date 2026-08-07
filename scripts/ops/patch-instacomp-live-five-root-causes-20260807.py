from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one source block, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")

# 1) Stale exact-image memory must never outrank current Registry truth.
main = Path("services/instacomp-ai/app/main.py")
old = '''    if image_memory:\n        trusted_identity = image_memory.identity\n        registry_result = await checklist_gateway.match(trusted_identity)\n        checklist_result = (\n            registry_result\n            if registry_result.outcome == ChecklistOutcome.EXACT_MATCH\n            else _memory_checklist_result(image_memory)\n        )\n        pricing_allowed = registry_result.outcome == ChecklistOutcome.EXACT_MATCH\n        status = "trusted_memory_match"\n'''
new = '''    memory_registry_result = (\n        await checklist_gateway.match(image_memory.identity)\n        if image_memory\n        else None\n    )\n    memory_registry_verified = bool(\n        memory_registry_result\n        and memory_registry_result.outcome == ChecklistOutcome.EXACT_MATCH\n        and memory_registry_result.identity\n        and memory_registry_result.identity_id\n        and any(\n            receipt.startswith("registry_fingerprint:")\n            for receipt in memory_registry_result.source_receipts\n        )\n    )\n    if image_memory and memory_registry_verified and memory_registry_result:\n        # Memory is only a retrieval hint. Current Registry truth supplies the\n        # canonical identity; rejected/stale memory falls through to fresh vision.\n        trusted_identity = memory_registry_result.identity\n        checklist_result = memory_registry_result\n        pricing_allowed = True\n        status = "trusted_memory_match"\n'''
replace_once(main, old, new, "Registry-revalidated exact-image memory")

old = '''    if (\n        suggestion\n        and suggestion_registry.outcome == ChecklistOutcome.EXACT_MATCH\n'''
new = '''    trusted_text_registry = (\n        await checklist_gateway.match(trusted_text_match.identity)\n        if trusted_text_match\n        else None\n    )\n    trusted_text_registry_verified = bool(\n        trusted_text_registry\n        and trusted_text_registry.outcome == ChecklistOutcome.EXACT_MATCH\n        and trusted_text_registry.identity\n        and trusted_text_registry.identity_id\n        and any(\n            receipt.startswith("registry_fingerprint:")\n            for receipt in trusted_text_registry.source_receipts\n        )\n    )\n\n    if (\n        suggestion\n        and suggestion_registry.outcome == ChecklistOutcome.EXACT_MATCH\n'''
replace_once(main, old, new, "Registry-revalidated text-memory preflight")

old = '''    elif trusted_text_match:\n        trusted_identity = trusted_text_match.identity\n        checklist_result = await checklist_gateway.match(trusted_identity)\n        pricing_allowed = checklist_result.outcome == ChecklistOutcome.EXACT_MATCH\n        status = "trusted_memory_match"\n        match_source = "trusted_text_memory"\n        next_action = (\n            "Known card identified from internal text memory. Continue to verified comps."\n            if pricing_allowed\n            else "Known card identified from internal text memory; Registry verification is required for pricing."\n        )\n'''
new = '''    elif (\n        trusted_text_match\n        and trusted_text_registry_verified\n        and trusted_text_registry\n    ):\n        trusted_identity = trusted_text_registry.identity\n        checklist_result = trusted_text_registry\n        pricing_allowed = True\n        status = "trusted_memory_match"\n        match_source = "trusted_text_memory"\n        next_action = (\n            "Known card memory was revalidated against the current Registry. "\n            "Continue to verified comps."\n        )\n'''
replace_once(main, old, new, "Registry-revalidated text-memory branch")

# 2) Canonical manufacturer must outrank product-line brand in the local bridge.
local_ts = Path("src/lib/instacomp-ai-local.ts")
replace_once(
    local_ts,
    '    brand: text(identity.brand ?? identity.manufacturer),\n',
    '    brand: text(identity.manufacturer ?? identity.brand),\n',
    "manufacturer-first local identity mapping",
)

# 3) Acceptance auth is isolated from the permanent service/Registry credential.
job = Path("src/lib/instacomp-job-server.ts")
old = '''export function isValidInstaCompServiceRequest(\n  request: Request,\n  expectedToken = getInstaCompServiceToken(),\n) {\n  const expected = String(expectedToken || "").trim();\n  const provided = String(\n    request.headers.get("x-tcos-instacomp-service-token") || "",\n  ).trim();\n\n  return Boolean(\n    expected && provided && constantTimeSecretMatch(provided, expected),\n  );\n}\n'''
new = '''export function isValidInstaCompServiceRequest(\n  request: Request,\n  expectedToken = getInstaCompServiceToken(),\n  acceptanceToken = process.env.INSTACOMP_ACCEPTANCE_SERVICE_TOKEN,\n) {\n  const expected = String(expectedToken || "").trim();\n  const acceptance = String(acceptanceToken || "").trim();\n  const provided = String(\n    request.headers.get("x-tcos-instacomp-service-token") || "",\n  ).trim();\n\n  if (!provided) return false;\n  if (expected && constantTimeSecretMatch(provided, expected)) return true;\n\n  // Acceptance is deliberately a separate, short-lived credential so a\n  // Production proof can never rotate or invalidate the Mac Registry token.\n  return Boolean(\n    acceptance.length >= 32 && constantTimeSecretMatch(provided, acceptance),\n  );\n}\n'''
replace_once(job, old, new, "isolated acceptance service credential")

# 4) Extend executable auth regression.
auth_test = Path("scripts/run-instacomp-service-auth-simulations.ts")
text = auth_test.read_text(encoding="utf-8")
marker = 'const acceptance = "a".repeat(64);'
if marker not in text:
    insert = '''\nconst acceptance = "a".repeat(64);\nconst acceptanceRequest = new Request("https://example.test/api/instacomp/scan", {\n  headers: { "x-tcos-instacomp-service-token": acceptance },\n});\nassert.equal(\n  isValidInstaCompServiceRequest(acceptanceRequest, expected, acceptance),\n  true,\n);\nassert.equal(\n  isValidInstaCompServiceRequest(valid, expected, acceptance),\n  true,\n);\nconst weakAcceptance = new Request("https://example.test/api/instacomp/scan", {\n  headers: { "x-tcos-instacomp-service-token": "short" },\n});\nassert.equal(\n  isValidInstaCompServiceRequest(weakAcceptance, expected, "short"),\n  false,\n);\n'''
    text = text.replace('\nconsole.log(\n', insert + '\nconsole.log(\n', 1)
    auth_test.write_text(text, encoding="utf-8")

# 5) The updater preserves/resyncs the Mac Registry token and proves it after deploy.
updater = Path("services/instacomp-ai/scripts/update-live-from-main.sh")
old = '''local_key="$(read_env_value "$env_file" INSTACOMP_AI_API_KEY)"\narchive_token="$(read_env_value "$env_file" INSTACOMP_AI_SENTINEL_ARCHIVE_TOKEN)"\nif [[ ! "$local_key" =~ ^[0-9a-fA-F]{64}$ ]]; then\n'''
new = '''local_key="$(read_env_value "$env_file" INSTACOMP_AI_API_KEY)"\nregistry_token="$(read_env_value "$env_file" INSTACOMP_AI_REGISTRY_TOKEN)"\narchive_token="$(read_env_value "$env_file" INSTACOMP_AI_SENTINEL_ARCHIVE_TOKEN)"\nif [[ ! "$local_key" =~ ^[0-9a-fA-F]{64}$ ]]; then\n'''
replace_once(updater, old, new, "read permanent Registry token")

old = '''if [[ ! "$archive_token" =~ ^[0-9a-fA-F]{64}$ ]]; then\n  echo "Refusing key repair: INSTACOMP_AI_SENTINEL_ARCHIVE_TOKEN is missing or invalid. Run install-sentinel-control.sh once to create it safely." >&2\n  exit 2\nfi\n'''
new = '''if [[ ! "$registry_token" =~ ^[0-9a-fA-F]{64}$ ]]; then\n  echo "Refusing Registry auth repair: INSTACOMP_AI_REGISTRY_TOKEN is missing or is not a 256-bit hex key." >&2\n  exit 2\nfi\nif [[ ! "$archive_token" =~ ^[0-9a-fA-F]{64}$ ]]; then\n  echo "Refusing key repair: INSTACOMP_AI_SENTINEL_ARCHIVE_TOKEN is missing or invalid. Run install-sentinel-control.sh once to create it safely." >&2\n  exit 2\nfi\n'''
replace_once(updater, old, new, "validate permanent Registry token")

old = '''set_vercel_env INSTACOMP_AI_LOCAL_URL "$tunnel_url" production plain\nset_vercel_env INSTACOMP_AI_LOCAL_KEY "$local_key" production sensitive\nset_vercel_env INSTACOMP_SENTINEL_ARCHIVE_TOKEN "$archive_token" production sensitive\nrepair_vercel_root_directory\nnpx vercel --prod --yes --cwd "$repo_root"\n\nproxy_status_file='''
new = '''set_vercel_env INSTACOMP_AI_LOCAL_URL "$tunnel_url" production plain\nset_vercel_env INSTACOMP_AI_LOCAL_KEY "$local_key" production sensitive\nset_vercel_env INSTACOMP_SERVICE_TOKEN "$registry_token" production sensitive\nset_vercel_env INSTACOMP_SENTINEL_ARCHIVE_TOKEN "$archive_token" production sensitive\nrepair_vercel_root_directory\nnpx vercel --prod --yes --cwd "$repo_root"\n\nregistry_probe_file="$service_root/data/runtime-updates/$timestamp-production-registry.json"\nregistry_probe_url="${site_url}/api/instacomp/checklist-lookup"\nfor ((attempt=1; attempt<=30; attempt++)); do\n  if curl --fail --silent --show-error --max-time 30 \\\n    -H "content-type: application/json" \\\n    -H "x-tcos-instacomp-service-token: $registry_token" \\\n    --data '{"cardNumber":"__INSTACOMP_AUTH_PROBE__"}' \\\n    "$registry_probe_url" > "$registry_probe_file" 2>/dev/null && \\\n    REGISTRY_PROBE_FILE="$registry_probe_file" "$python_bin" - <<'PY'\nimport json\nimport os\nfrom pathlib import Path\n\npayload = json.loads(Path(os.environ["REGISTRY_PROBE_FILE"]).read_text("utf-8"))\nif payload.get("ok") is not True:\n    raise SystemExit(1)\nPY\n  then\n    break\n  fi\n  [[ "$attempt" -lt 30 ]] || {\n    echo "Production Registry rejected the preserved Mac Registry credential." >&2\n    exit 2\n  }\n  sleep 3\ndone\necho "PASS  Permanent Mac Registry credential accepted through Production."\n\nproxy_status_file='''
replace_once(updater, old, new, "sync and prove permanent Registry token")

print("InstaComp live-five proven root causes patched: PASS")
