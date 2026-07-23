# TCOS Market Intel MCP Connector — Beta One

A remote Model Context Protocol (MCP) server that connects ChatGPT to the TCOS Market Intel deal-sourcing and portfolio workflow.

The connector is deliberately isolated from the production storefront. It can be deployed and tested without changing checkout, eBay sync, offers, inventory, or the public Truely Collectables website.

## What v0.1 does

- Stores and runs saved card searches.
- Searches public web inventory through configured adapters.
- Supports native eBay Browse and X recent-search APIs when tokens are supplied.
- Uses OpenAI web search as an optional public-source discovery and exact-comp refresh adapter.
- Accepts public listing URLs and private-group leads manually shared by the user.
- Normalizes and deduplicates cross-posts using URL, seller, photo hashes, certification number, exact-card identity, location, and price.
- Keeps exact cards separate by year, manufacturer, product, set, subset, card number, parallel, variation, serial tier, autograph/memorabilia status, raw/graded state, grading company, grade, and condition.
- Calculates InstaComp statistics from exact completed sales only.
- Calculates full delivered cost, selling fees, postage, supplies, return reserve, net profit, ROI, and maximum offer.
- Scores Facebook/X seller risk before a cheap price can qualify as a deal.
- Records acquisition lots, receipt status, sales, realized profit, and remaining cost basis.
- Preserves separate acquisition lots for FIFO, LIFO, and future specific-lot accounting.

## Privacy and access boundaries

The connector does **not**:

- store a Facebook password, recovery code, cookie, or browser session;
- bypass private Facebook groups, protected X accounts, login walls, or access controls;
- read private messages or scrape private profiles;
- purchase cards without explicit user approval;
- treat active asking prices as completed sales;
- infer a parallel from glare or use a multi-variation teaser price.

Private-group posts can be processed only when the user manually supplies a link, screenshots, and visible details they are authorized to access. They remain `MANUAL REVIEW REQUIRED` until the important identity, price, shipping, payment, and seller-risk fields are verified.

## MCP tools

### Discovery and intake

- `connector_status`
- `list_saved_searches`
- `upsert_saved_search`
- `run_saved_search`
- `ingest_listing`
- `check_duplicate_listing`
- `compare_two_listings`

### InstaComp and economics

- `instacomp_card`
- `get_comp_history`
- `instacomp_lot`
- `calculate_offer_and_profit`
- `evaluate_seller_risk`
- `classify_deal`

### Portfolio synchronization

- `record_purchase`
- `mark_received`
- `record_sale`
- `get_portfolio_summary`

Write tools are annotated as mutating actions so ChatGPT can request confirmation according to the client/workspace approval policy.

## Public-source adapters

| Adapter | Environment variable | Purpose |
|---|---|---|
| OpenAI public web search | `OPENAI_API_KEY` | Public marketplace, public Facebook/page/group, public X, and exact sold-comp discovery |
| eBay Browse API | `EBAY_BROWSE_ACCESS_TOKEN` | Native live eBay inventory search |
| X recent search API | `X_BEARER_TOKEN` | Native recent public sale-post search |
| Manual URL/screenshot intake | none | Public listings and user-authorized group leads |

Mercari, Whatnot, Sportslots, COMC, MySlabs, Fanatics Collect, CollX, Etsy, and public Facebook pages can be found through the public web-search adapter or ingested manually. When a source hides checkout shipping, selected-variation pricing, or login-restricted details, the result is marked for manual review rather than certified as profitable.

## Local setup

```bash
cd connectors/tcos-market-intel-mcp
cp .env.example .env
npm install
npm test
npm start
```

The server listens on `PORT` (default `8787`).

Health endpoints:

```text
GET /health
GET /privacy
```

The MCP endpoint is:

```text
POST /mcp
Authorization: Bearer <TCOS_CONNECTOR_TOKEN>
```

The server uses stateless Streamable HTTP with JSON responses. Persistent state belongs in Supabase, not in MCP sessions.

## Supabase setup

1. Apply `supabase/001_tcos_market_intel_connector.sql`.
2. Apply `supabase/002_seed_beta_one_ledger.sql` once to load the reconciled Beta One ledger.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on the connector deployment.
4. Never expose the service-role key to the browser or commit it to GitHub.
5. Set `TCOS_REQUIRE_PERSISTENCE=true` after the migration is applied.

The migration enables RLS and creates no anon/authenticated policies. The remote server accesses these tables only with the service-role key and its separate connector bearer token.

## Deployment

The included Dockerfile can run on Render, Railway, Fly.io, Google Cloud Run, Azure Container Apps, or another HTTPS container host.

Example build/run:

```bash
docker build -t tcos-market-intel-mcp .
docker run --rm -p 8787:8787 --env-file .env tcos-market-intel-mcp
```

Production requirements:

- HTTPS endpoint reachable by ChatGPT.
- Strong random `TCOS_CONNECTOR_TOKEN`.
- Supabase service-role key stored server-side.
- OpenAI/eBay/X keys stored as encrypted deployment secrets.
- `TCOS_ALLOWED_ORIGINS` limited to approved ChatGPT origins when applicable.
- Logs must not contain tokens, private messages, passwords, cookies, payment credentials, private addresses, or phone numbers.

## Connecting to ChatGPT

After deployment, add the remote MCP endpoint in ChatGPT developer/app settings:

```text
https://<your-host>/mcp
```

Configure bearer authentication with `TCOS_CONNECTOR_TOKEN`. Keep write-tool approvals enabled during Beta One.

OpenAI supports remote MCP tools through the Responses API and ChatGPT apps; the remote service is a third-party data processor, so its storage, retention, authentication, and privacy controls remain the responsibility of TCOS.

## Beta One rollout

1. Deploy with persistence and only `connector_status`, listing intake, duplicate check, InstaComp, risk, and profit tools enabled in ChatGPT.
2. Seed saved searches for Demidov, WNBA, 1st Bowman prospects, public Facebook, and public X.
3. Run read-only search tests and compare results against manual searches.
4. Validate exact-card identity and selected-variation pricing on at least 100 known listings.
5. Enable purchase/receipt/sale write tools only after duplicate and portfolio reconciliation tests pass.
6. Keep current scheduled reports as a fallback until connector-generated portfolio totals match the reconciled ledger exactly.

## Known v0.1 limitations

- No automatic access to private Facebook groups.
- Public web indexing can miss or delay fast-moving Facebook, X, Mercari, and Whatnot listings.
- Dynamic checkout totals and variation selectors may require manual review.
- Image hashes must be supplied by an intake worker or future image pipeline; the MCP server does not download arbitrary images itself.
- The permanent TCOS historical comp database and full Portfolio Manager UI remain future production features; this connector supplies the tested data and workflow foundation.
