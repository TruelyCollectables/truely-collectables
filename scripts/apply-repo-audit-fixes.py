import json
from pathlib import Path

# FBI/CIA admin-control audit: every admin fetch must survive a non-JSON response
# and surface the failure inline instead of throwing during response parsing.
sentinel_path = Path("src/app/admin/instacomp/checklist-sentinel/page.tsx")
sentinel = sentinel_path.read_text()
sentinel = sentinel.replace(
    """        statusResponse.json(),
        downloadsResponse.json(),
        findingsResponse.json(),
""",
    """        statusResponse.json().catch(() => ({})),
        downloadsResponse.json().catch(() => ({})),
        findingsResponse.json().catch(() => ({})),
""",
    1,
)
sentinel = sentinel.replace(
    "const payload = (await response.json()) as ProxyPayload;",
    "const payload = (await response.json().catch(() => ({}))) as ProxyPayload;",
    1,
)
if "statusResponse.json().catch(() => ({}))" not in sentinel:
    raise SystemExit("Sentinel load JSON safety patch did not apply")
if "response.json().catch(() => ({}))" not in sentinel:
    raise SystemExit("Sentinel action JSON safety patch did not apply")
sentinel_path.write_text(sentinel)

# FBI/CIA dependency audit: GHSA-5p4m-2wfm-xmqj affects js-yaml 4.3.0 and is
# patched in 4.3.1. Pin the transitive 4.x dependency to the patched release.
package_path = Path("package.json")
package = json.loads(package_path.read_text())
overrides = package.get("overrides")
if not isinstance(overrides, dict):
    overrides = {}
overrides["js-yaml"] = "4.3.1"
package["overrides"] = overrides
package_path.write_text(json.dumps(package, indent=2) + "\n")
