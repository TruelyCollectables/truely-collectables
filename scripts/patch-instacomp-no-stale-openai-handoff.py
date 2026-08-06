from __future__ import annotations

from pathlib import Path


MAIN = Path("services/instacomp-ai/app/main.py")
text = MAIN.read_text()

old = (
    '            next_action = (\n'
    '                "Internal memory did not know this card and the Ollama backup reader was unavailable. "\n'
    '                "The website may use OpenAI only as the emergency teacher."\n'
    '            )\n'
)
new = (
    '            next_action = (\n'
    '                "InstaComp AI could not identify this unknown card because the local Ollama reader "\n'
    '                "was unavailable. No external identity provider was called. Restore the local "\n'
    '                "reader and retry, or send the card to private manual review."\n'
    '            )\n'
)

if old in text:
    text = text.replace(old, new, 1)
elif "No external identity provider was called" not in text:
    raise SystemExit("Expected stale external-reader handoff was not found")

if "The website may use OpenAI only as the emergency teacher" in text:
    raise SystemExit("Stale OpenAI handoff remains after patch")

MAIN.write_text(text)
print("Removed stale Mac-service external-reader handoff")
