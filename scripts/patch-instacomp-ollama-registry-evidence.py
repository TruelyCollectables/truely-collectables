#!/usr/bin/env python3
from pathlib import Path

path = Path("services/instacomp-ai/app/main.py")
source = path.read_text()

replacements = [
    (
        '''async def health() -> HealthResponse:\n    database_ready = store.ready()\n    checklist_ready = await checklist_gateway.health()\n    return HealthResponse(\n        ok=database_ready and checklist_ready,\n        app=settings.app_name,\n        codename=settings.codename,\n        version=settings.version,\n        database="ready" if database_ready else "error",\n        ollama="unchecked",\n        ollama_model="disabled_for_identity_scans",\n        checklist="ready" if checklist_ready else "not_configured",\n    )\n''',
        '''async def health() -> HealthResponse:\n    database_ready = store.ready()\n    checklist_ready = await checklist_gateway.health()\n    ollama_ready = await reader.health()\n    return HealthResponse(\n        ok=database_ready and checklist_ready and ollama_ready,\n        app=settings.app_name,\n        codename=settings.codename,\n        version=settings.version,\n        database="ready" if database_ready else "error",\n        ollama="ready" if ollama_ready else "unavailable",\n        ollama_model=settings.ollama_model,\n        checklist="ready" if checklist_ready else "not_configured",\n    )\n''',
    ),
    (
        '''    # CHECKLIST-ONLY REVIEW PATH: unresolved cards are preserved as complete\n    # scan receipts. No Ollama or external identity reader is called here.\n    suggestion = None\n    proposed_identity = printed_identity\n''',
        '''    # LOCAL EVIDENCE FALLBACK: trusted memory and bounded printed evidence run\n    # first. When they cannot identify a new card, Ollama reads the actual front/back\n    # images and supplies evidence only. The central Registry remains the sole identity\n    # authority, and pricing stays blocked without its identity ID and fingerprint.\n    suggestion = None\n    model_error = None\n    suggestion_registry = printed_registry\n    try:\n        suggestion = await reader.analyze(\n            front_image.content,\n            back_image.content if back_image else None,\n        )\n        suggestion_text = "\\n".join(\n            dict.fromkeys(\n                [\n                    *suggestion.evidence.visible_text,\n                    *suggestion.evidence.front_visible_text,\n                    *suggestion.evidence.back_visible_text,\n                    *suggestion.evidence.logos,\n                    *suggestion.evidence.front_notes,\n                    *suggestion.evidence.back_notes,\n                ]\n            )\n        )\n        suggestion_registry = await checklist_gateway.match(\n            suggestion.identity,\n            suggestion_text,\n        )\n    except (httpx.HTTPError, ValueError) as exc:\n        model_error = str(exc)\n\n    proposed_identity = suggestion.identity if suggestion else printed_identity\n''',
    ),
    (
        '''    if trusted_text_match:\n        trusted_identity = trusted_text_match.identity\n''',
        '''    if (\n        suggestion\n        and suggestion_registry.outcome == ChecklistOutcome.EXACT_MATCH\n        and suggestion_registry.identity\n        and suggestion_registry.identity_id\n        and any(\n            receipt.startswith("registry_fingerprint:")\n            for receipt in suggestion_registry.source_receipts\n        )\n    ):\n        trusted_identity = suggestion_registry.identity\n        checklist_result = suggestion_registry\n        pricing_allowed = True\n        status = "trusted_memory_match"\n        match_source = "ollama_backup"\n        next_action = (\n            "Local front/back evidence was locked to one exact Registry identity. "\n            "Continue to verified comps."\n        )\n    elif trusted_text_match:\n        trusted_identity = trusted_text_match.identity\n''',
    ),
    (
        '''    else:\n        checklist_result = printed_registry\n        trusted_identity = None\n        pricing_allowed = False\n        match_source = "none"\n        if checklist_result.outcome == ChecklistOutcome.NOT_CONFIGURED:\n''',
        '''    else:\n        checklist_result = suggestion_registry\n        trusted_identity = None\n        pricing_allowed = False\n        match_source = "none"\n        if model_error:\n            status = "model_unavailable"\n            next_action = (\n                "The local Ollama evidence reader was unavailable. Keep identity and "\n                "pricing blocked, repair the local model, and retry."\n            )\n        elif checklist_result.outcome == ChecklistOutcome.NOT_CONFIGURED:\n''',
    ),
    (
        '''            next_action = (\n                "InstaComp preserved the front/back scan and checklist receipt, but one exact identity was not proven. No external identity provider was called. Review or correct the card privately."\n            )\n''',
        '''            next_action = (\n                "InstaComp preserved the front/back evidence and Registry receipt, but "\n                "one exact identity was not proven. Review or correct the card privately."\n            )\n''',
    ),
]

for old, new in replacements:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match, found {count}: {old[:120]!r}")
    source = source.replace(old, new, 1)

path.write_text(source)
print(f"patched {path}")
