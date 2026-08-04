# InstaComp AI™ Checklist Handoff

The pre-checklist foundation is complete when this document is reached. The next build step requires actual checklist data.

## Accepted delivery format

Preferred: UTF-8 CSV using `services/instacomp-ai/checklists/checklist-template.csv`.

One row represents one exact card configuration. Base, parallel, variation, autograph, memorabilia, and serial-run differences must be separate rows.

## Required fields

- source_name
- source_release_id
- source_version
- source_receipt
- sport
- year
- brand
- set_name
- player
- card_number
- parallel

All columns in the template must remain present even when optional values are blank.

## Source receipt rule

Every row must identify where its checklist came from. `source_receipt` may be an official URL, an original filename plus checksum, or another durable source reference. Data with no source receipt will not be promoted into the trusted registry.

## Validation command

```bash
cd services/instacomp-ai
source .venv/bin/activate
python scripts/validate_checklist.py checklists/YOUR-FILE.csv \
  --report reports/YOUR-FILE.audit.json
```

The file is ready only when `ready_to_import` is `true`.

## Blocking conditions

- Missing required columns
- Invalid booleans or serial runs
- Exact identities with contradictory row receipts or metadata
- Autograph claims with no supporting label or notes
- Multiple rows that normalize to the same identity but disagree in content
- Unknown source or version

## What happens next

After validated checklist files are supplied, the next phase will:

1. Create the versioned registry tables.
2. Import releases and rows with immutable hashes.
3. Replace the unconfigured gateway with real exact matching.
4. Connect checklist confirmation to trusted lesson promotion.
5. Run scan regressions against known cards.
6. Enable exact-comp searching only after identity confirmation.

Until then, InstaComp AI™ correctly returns `needs_checklist` and keeps pricing disabled.
