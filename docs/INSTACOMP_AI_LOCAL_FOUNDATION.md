# InstaComp AI™ — Local Foundation

## Purpose

InstaComp AI™ is the private, locally operated card-identification engine for Truely Collectables and TCOS. It begins with controlled machine memory, uses local vision models first, may consult external teacher models when needed, and only promotes verified identities into trusted reusable knowledge.

This foundation intentionally stops immediately before checklist ingestion. The next phase will connect the existing checklist registry to the `ChecklistGateway` contract.

## Core rules

1. A model suggestion is evidence, not truth.
2. No unverified model response may become trusted memory.
3. Every promoted lesson must include a verification source.
4. The system must preserve rejected candidates and corrections.
5. A scan may return `needs_checklist` or `needs_review`; it must never fabricate an exact identity.
6. Pricing and exact-comps searches remain blocked until identity gates pass.

## Runtime layout

```text
Website / Admin Scanner
        |
        v
Existing Next.js InstaComp API
        |
        v
InstaComp AI local service on the Mac mini
        |
        +--> image validation and normalization
        +--> local Ollama vision reader
        +--> private lesson memory
        +--> checklist gateway (next phase)
        +--> teacher review records
```

## Learning states

- `observed`: raw scan and model evidence stored.
- `teacher_suggested`: an external or local teacher proposed an identity.
- `operator_confirmed`: a human supplied or confirmed the exact identity.
- `checklist_confirmed`: the identity matches a trusted checklist row.
- `rejected`: the proposed identity was explicitly rejected.
- `quarantined`: contradictory or incomplete evidence; unusable for automated identity or pricing.

Only `operator_confirmed` and `checklist_confirmed` lessons are searchable as trusted memory.

## API foundation

- `GET /health` — confirms service, model, database, and checklist-adapter state.
- `POST /v1/scans/analyze` — validates front/back images, computes hashes, searches trusted memory, and asks the local vision model for structured evidence.
- `POST /v1/lessons` — records a verified correction or confirmation.
- `GET /v1/lessons/search` — searches trusted memory by identity fields.

## Checklist boundary

The service exposes a `ChecklistGateway` interface with these outcomes:

- `not_configured`
- `input_incomplete`
- `set_absent`
- `set_present_no_exact_match`
- `exact_match`

The temporary implementation returns `not_configured`. Checklist data should not be imported until the schema, source receipts, versioning, and identity normalization rules are approved.

## Local Mac target

Initial target:

- Apple M4 Pro
- 24 GB unified memory
- Ollama running locally
- SQLite for development memory
- Supabase-backed production memory later

Recommended starting model is configurable through `INSTACOMP_AI_OLLAMA_MODEL`. The service does not hard-code a particular model as permanently trusted.

## Definition of done for this phase

- Local service boots on the Mac mini.
- Images are accepted and validated.
- Local model responses are forced into a structured evidence schema.
- Every scan and lesson receives immutable hashes and timestamps.
- Confirmed lessons can be searched.
- Unverified suggestions cannot become trusted memory.
- Checklist integration is represented by a typed adapter and remains unconnected.
