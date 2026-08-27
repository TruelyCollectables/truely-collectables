# TCOS Market Intel — Tonight Test Runbook

This runbook deploys the feature branch directly for testing. It does not merge PR #70 and does not change TruelyCollectables.com.

## 1. Railway service

Create a Railway project from GitHub repository `TruelyCollectables/truely-collectables`.

Use:

- Branch: `feature/tcos-market-intel-connector-v1`
- Root directory: `connectors/tcos-market-intel-mcp`
- Builder: Dockerfile
- Healthcheck: `/health`

Railway should detect `Dockerfile` and `railway.json` from the selected root directory.

## 2. Minimal safe variables

Set these first:

```env
TCOS_CONNECTOR_TOKEN=<long-random-secret>
TCOS_REQUIRE_PERSISTENCE=false
TCOS_ALLOWED_ORIGINS=https://chatgpt.com,https://chat.openai.com
OPENAI_API_KEY=<server-side OpenAI API key>
TCOS_SEARCH_MODEL=gpt-5
TCOS_SEARCH_MAX_RESULTS=20
```

Leave Supabase, eBay, and X credentials blank for the first deployment. This launches the connector in temporary in-memory mode and tests public web discovery without touching the permanent ledger.

## 3. Generate a public HTTPS domain

In Railway service settings, generate a domain. Verify:

```text
https://<railway-domain>/health
https://<railway-domain>/privacy
```

The health endpoint should return `ok: true`. The privacy endpoint should show that credentials are not stored and private-group bypass is disabled.

## 4. ChatGPT app test

Use ChatGPT on the web. Enable Developer Mode if the account exposes it, then create a custom app with:

```text
https://<railway-domain>/mcp
```

Configure the connector token using the authentication option offered by the ChatGPT app-creation UI. Scan tools and create the app as a draft only.

Start with read-only calls:

- `connector_status`
- `run_saved_search` with `persistResults=false`
- `instacomp_card` with `persistVerifiedSales=false`
- `calculate_offer_and_profit`
- `evaluate_seller_risk`
- `get_portfolio_summary`

Do not test `record_purchase`, `mark_received`, or `record_sale` against permanent data during the first session.

## 5. Persistence test after the server works

Apply the two SQL files in a non-production Supabase project or isolated schema:

1. `supabase/001_tcos_market_intel_connector.sql`
2. `supabase/002_seed_beta_one_ledger.sql`

Then set:

```env
NEXT_PUBLIC_SUPABASE_URL=<project-url>
SUPABASE_SERVICE_ROLE_KEY=<server-only-service-role-key>
TCOS_REQUIRE_PERSISTENCE=true
```

Redeploy and confirm `connector_status` reports persistent Supabase mode. Verify `get_portfolio_summary` returns exactly:

- 15 purchase lots
- 286 units purchased
- 278 awaiting receipt
- 8 in inventory
- $298.67 capital deployed

## 6. Live adapter upgrades

Add later, one at a time:

```env
EBAY_BROWSE_ACCESS_TOKEN=<token>
X_BEARER_TOKEN=<token>
```

Re-run a known saved search after each credential is added. Never add Facebook passwords, browser cookies, session tokens, recovery codes, or private-message credentials.
