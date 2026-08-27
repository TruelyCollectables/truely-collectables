# Upper Deck Checklist Registry importer v1

This slice adds validation-first support for official Upper Deck checklist HTML pages.

## Proof releases

- 2024-25 Upper Deck Series 1 Hockey
- 2025-26 Allure Hockey

## Preserved facts

- Official set label and card number
- Player/subject and team
- Rookie, autograph, memorabilia, and technology evidence
- Serial-numbered print run
- SP designation
- Stated odds and product configurations
- Point value
- Source URL, retrieval time, SHA-256, parser version, and private archive path

## Exact identity behavior

The importer keeps base, subset, insert, parallel, serial tier, autograph, memorabilia, variation, and configuration evidence separate in deterministic physical-printing fingerprints. Duplicate identities, conflicting card-number subjects, unparseable serial runs, malformed rows, and claimed official files from the wrong domain fail closed into validation.

## Safety

- HTML source pages remain private.
- No price fields are imported.
- Validation is available without Supabase credentials.
- Production persistence still requires the existing explicit non-validation import path.
- This feature branch performs no Production migration, database write, deployment, or source bulk download.
