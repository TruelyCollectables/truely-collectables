from pathlib import Path

main_path = Path("services/instacomp-ai/app/main.py")
main = main_path.read_text()
old_handoff = (
    '            next_action = (\n'
    '                "Internal memory did not know this card and the Ollama backup reader was unavailable. "\n'
    '                "The website may use OpenAI only as the emergency teacher."\n'
    '            )\n'
)
new_handoff = (
    '            next_action = (\n'
    '                "InstaComp AI could not identify this unknown card because the local Ollama reader "\n'
    '                "was unavailable. No external identity provider was called. Restore the local "\n'
    '                "reader and retry, or send the card to private manual review."\n'
    '            )\n'
)
if old_handoff not in main:
    raise SystemExit("Expected stale OpenAI handoff was not found")
main = main.replace(old_handoff, new_handoff, 1)
main_path.write_text(main)

ollama_path = Path("services/instacomp-ai/app/ollama.py")
ollama = ollama_path.read_text()
anchor = (
    '- A colored Prizm name such as Green Prizm, Silver Prizm, Blue Prizm, or Red Prizm requires visible color/finish evidence plus PRIZM in back_visible_text.\n'
)
velocity_rule = (
    '- For 2025 Panini Prizm WNBA, never confuse Blue Velocity Prizm with Blue Cracked Ice Prizm. '
    'Blue Velocity has a repeated directional/chevron or streaked velocity pattern; Blue Cracked Ice has irregular shattered polygon or ice-fragment facets. '
    'Use the exact named parallel only when that specific pattern is visibly supported. If the pattern is unclear, return Blue Prizm or null rather than guessing Cracked Ice.\n'
)
if anchor not in ollama:
    raise SystemExit("Expected Prizm prompt anchor was not found")
if velocity_rule not in ollama:
    ollama = ollama.replace(anchor, anchor + velocity_rule, 1)
ollama_path.write_text(ollama)

print("Applied Blue Velocity and no-OpenAI handoff repair")
