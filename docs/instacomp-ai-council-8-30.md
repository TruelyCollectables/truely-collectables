# InstaComp AI Council: 8-30 Evidence Readers

## Purpose

A simple card must not depend on one model getting every visible fact correct. The council runs multiple evidence-only readers before checklist resolution. Readers may extract facts, but they cannot confirm an identity, authorize comps, or teach the learning system by themselves.

The internal checklist registry, visible hard facts, OCR conflicts, and the 95% identity decision remain authoritative.

## Reader counts

- `basic`: 0 backup readers, explicitly disabled.
- `mid`: at least 8 readers.
- `pro`: 12 readers.
- `dealer`: 16 readers.
- `high_end`: 24 readers.
- `courtroom`: 30 readers.
- `adaptive`: 8 readers by default on every scan.

Set `INSTACOMP_AI_COUNCIL_ALWAYS_ON=false` to return adaptive mode to escalation-only behavior. Set `INSTACOMP_AI_COUNCIL_MIN_READERS` from 1 through 30 to change the default minimum. Production should remain at 8 or higher until the real-card benchmark proves a lower count is equally accurate.

## Built-in reader passes

The current OpenAI, Gemini, Groq, and Ollama integrations are reused with different evidence views:

- Full front/back plus detail crops.
- OCR, serial, card-number, and back-label crops.
- Parallel, foil, edge, border, color, and surface crops.
- Clean front/back context without detail crops.

Multiple passes from one vendor improve evidence coverage, but they do not receive multiple votes. The best completed reader from each AI family is the only vote-eligible reader from that family.

## Additional provider/model slots

Fourteen OpenAI-compatible vision slots are available. Built-in passes plus these slots produce a maximum capacity of 30 readers.

For each slot `01` through `14`, configure:

```text
INSTACOMP_AI_COUNCIL_01_BASE_URL=https://provider.example/v1
INSTACOMP_AI_COUNCIL_01_API_KEY=secret
INSTACOMP_AI_COUNCIL_01_MODEL=vision-model-name
INSTACOMP_AI_COUNCIL_01_LABEL=Provider model label
INSTACOMP_AI_COUNCIL_01_FAMILY=provider-family
INSTACOMP_AI_COUNCIL_01_DETAIL_MODE=full
```

Allowed detail modes are `full`, `ocr`, `parallel`, and `context`.

Use the same `FAMILY` value for multiple models from the same vendor. This prevents one vendor from overpowering independent providers. API keys remain server-side and are never included in diagnostics.

## Failure behavior

The council runs configured readers in waves. When a selected reader errors or times out, reserve configured readers are started until the desired completed-reader count is reached or configured capacity is exhausted.

The response reports:

- Desired reader count.
- Available configured reader count.
- Completed reader count.
- Vote-eligible family count.
- Configured AI families.
- Every completed, failed, skipped, or unconfigured attempt.

Insufficient council capacity does not fabricate an identity. Existing checklist, confidence, comp-search, listing, and learning gates remain fail-closed.
