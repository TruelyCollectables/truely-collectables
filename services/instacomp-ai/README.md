# InstaComp AI™

**Codename:** InstaComp AI 1.0 Beta  
**Build:** `1.0.0-beta.prechecklist`

This service is the private local vision and verified-learning engine for InstaComp. It runs on the Mac mini, uses Ollama for local image reading, stores immutable image hashes and scan receipts, and promotes only verified identities into trusted memory.

The service is intentionally complete only through the checklist boundary. It will return `needs_checklist` until an approved checklist registry is connected.

## What is already implemented

- Safe JPEG, PNG, and WebP intake
- EXIF rotation normalization
- Front/back image hashing and content-addressed storage
- Local Ollama vision analysis
- Strict structured identity and visual-evidence output
- SQLite scan receipts and lesson memory
- Trusted/untrusted learning states
- Operator correction recording
- Trusted-memory search
- Pricing lock until exact checklist confirmation
- Typed checklist gateway ready for the importer
- Health endpoint
- Optional private API key

## Mac mini installation

From the repository root:

```bash
cd services/instacomp-ai
cp .env.example .env
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Install Ollama, then pull the configured vision model:

```bash
ollama pull qwen2.5vl:7b
```

Start the service:

```bash
./scripts/run-local.sh
```

Check it:

```bash
curl http://127.0.0.1:8787/health
```

## Analyze a card

```bash
curl -X POST http://127.0.0.1:8787/v1/scans/analyze \
  -H "X-InstaComp-AI-Key: YOUR_KEY_IF_CONFIGURED" \
  -F "front=@/path/to/front.jpg" \
  -F "back=@/path/to/back.jpg"
```

A successful pre-checklist scan will normally return:

```json
{
  "status": "needs_checklist",
  "pricing_allowed": false,
  "learning_allowed": false,
  "next_action": "Wire and import the approved checklist registry."
}
```

That is expected and is a safety feature, not a failure.

## Record an owner-confirmed lesson

Only use this after personally verifying the exact card identity:

```bash
curl -X POST http://127.0.0.1:8787/v1/lessons \
  -H "Content-Type: application/json" \
  -H "X-InstaComp-AI-Key: YOUR_KEY_IF_CONFIGURED" \
  -d '{
    "scan_id": "SCAN_UUID",
    "state": "operator_confirmed",
    "operator_id": "owner",
    "verification_source": "front/back review",
    "identity": {
      "sport": "hockey",
      "year": "2024-25",
      "brand": "Upper Deck",
      "set_name": "Series 1",
      "player": "Example Player",
      "card_number": "201",
      "parallel": "Base"
    }
  }'
```

External model suggestions may be stored as `teacher_suggested`, but they are never trusted or used as permanent truth by themselves.

## Run tests

```bash
source .venv/bin/activate
pytest -q
```

## Checklist connection point

Implement a real `ChecklistGateway` in `app/checklist.py` and replace `UnconfiguredChecklistGateway`. The importer must preserve source, source URL or file receipt, release/version identifiers, row hashes, ingestion timestamps, and supersession history. Exact matching must require normalized identity agreement and must never silently choose between conflicting checklist rows.

## Network safety

Keep the service bound to `127.0.0.1` until a private tunnel or authenticated reverse proxy is deliberately configured. Do not expose Ollama directly to the public internet.
