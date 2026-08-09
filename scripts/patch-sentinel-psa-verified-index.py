#!/usr/bin/env python3
from pathlib import Path

# Workflow-trigger touch: 2026-08-09 verified PSA index hotfix.
ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "services/instacomp-ai/app/sentinel_sources.py"
text = PATH.read_text("utf-8")

import_anchor = "import httpx\n"
import_line = "from .psa_verified_sets import verified_psa_set_for_target\n"
if import_line not in text:
    if import_anchor not in text:
        raise SystemExit("sentinel_sources.py import anchor not found")
    text = text.replace(import_anchor, import_anchor + "\n" + import_line, 1)

anchor = '''        if kind == "psa_first_party":\n            direct_url = source["search_url_template"].format(query=quote_plus(query))\n'''
replacement = '''        if kind == "psa_first_party":\n            verified = verified_psa_set_for_target(target.get("target_key"))\n            if verified is not None:\n                verified_url = _canonical_psa_apr_url(verified.url)\n                if not _is_psa_exact_release_url(verified_url, target):\n                    raise ValueError(\n                        "Verified PSA set index entry failed exact-release validation."\n                    )\n                trust, policy = candidate_trust(verified_url)\n                exact, identity_reason = exact_target_match(\n                    target, verified.title, verified_url\n                )\n                if not exact:\n                    raise ValueError(\n                        "Verified PSA set index entry failed target identity validation: "\n                        + identity_reason\n                    )\n                return [\n                    Candidate(\n                        url=verified_url,\n                        title=verified.title,\n                        source_id=source["source_id"],\n                        domain=(urlparse(verified_url).hostname or "").lower(),\n                        trust_score=trust,\n                        import_policy=policy,\n                        exact_match=True,\n                        reason=(\n                            "Exact whole-release match from verified PSA whole-release "\n                            f"index ({verified.verified_on}); {identity_reason}"\n                        ),\n                    )\n                ]\n\n            direct_url = source["search_url_template"].format(query=quote_plus(query))\n'''
if "verified_psa_set_for_target(target.get(\"target_key\"))" not in text:
    if anchor not in text:
        raise SystemExit("PSA first-party search anchor not found")
    text = text.replace(anchor, replacement, 1)

PATH.write_text(text, "utf-8")
print("patched", PATH)
