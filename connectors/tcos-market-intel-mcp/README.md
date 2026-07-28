# TCOS Market Intel MCP Connector — Profit Hunter Bridge

A remote Model Context Protocol (MCP) server that connects ChatGPT to TCOS Deal Hunter / Profit Hunter, hardened InstaComp exact-market verification, and the private Beta One portfolio workflow.

The connector is isolated from storefront checkout and cannot purchase anything. Its purpose is to discover public listings, send exact front/back images through the production hardened InstaComp scanner, reject uncertain or unprofitable candidates, and preserve verified evidence for Market Intel.

## What v0.2 does

- Stores and runs saved public marketplace searches.
- Supports public web discovery, native eBay Browse, and native public X recent-search when configured.
- Accepts public listing URLs and user-authorized manually shared leads.
- Normalizes and deduplicates cross-posts using URL, seller, photos, certification, exact identity, location, and price.
- Downloads an exact listing’s front and back images through an SSRF-resistant image fetcher.
- Calls the production hardened InstaComp scanner with a dedicated service credential.
- Uses actual image bytes as identity evidence; seller wording remains an untrusted claim.
- Requires pricing-eligible identical completed sales before calculating Profit Hunter resale value.
- Keeps active listings as competition context only.
- Calculates delivered acquisition cost, resale fees, postage, supplies, return reserve, net profit, ROI, opening offer, target offer, and maximum offer.
- Enforces the 20% projected net ROI minimum.
- Returns the current TCOS labels:
  - `TOO GOOD TO BE TRUE`
  - `MUST BUY`
  - `BORDERLINE BUY`
  - `NO FUCKING WAY / OVERPRICED`
  - `SUPPRESSED — NO TRUSTED EXACT SOLD PRICE`
- Scores Facebook/X seller risk before a cheap price can qualify.
- Records acquisition lots, receipt status, sales, realized profit, and remaining basis only through explicit write tools.

## Current search lanes

- Ivan Demidov professional NHL rookie cards, including official RC cards, Young Guns, and legitimate rookie parallels, autographs, and memorabilia.
- Professional WNBA rookie Silver/equivalent or better for Caitlin Clark, Paige Bueckers, Dominique Malonga, Sonia Citron, and Kiki Iriafen.
- Danny Norris seller inventory as an internal WNBA discovery lane.
- Dynamic baseball prospects whose verified true 1st Bowman issue is 2021-present.
- Authenticated and raw signed-prospect baseballs with authentication-adjusted economics.

Ordinary WNBA base, college/NCAA/Bowman University/Draft Picks cards, Rickea Jackson, and non-1st Bowman prospect cards are excluded unless the owner explicitly changes the rules.

## Privacy and access boundaries

The connector does **not**:

- store Facebook passwords, recovery codes, cookies, or browser sessions;
- bypass private groups, protected accounts, login walls, or access controls;
- purchase cards without explicit user approval;
- treat active asking prices as completed sales;
- use teaser prices from unselected variations;
- store a seller JWT or administrator cookie for background scanning;
- expose the InstaComp service credential to the browser.

Private-group posts can be processed only when the user manually supplies information they are authorized to access. They remain review-only until identity, price, shipping, payment, and seller-risk evidence is complete.

## MCP tools

### Discovery and intake

- `connector_status`
- `list_saved_searches`
- `upsert_saved_search`
- `run_saved_search`
- `ingest_listing`
- `check_duplicate_listing`
- `compare_two_listings`

### Hardened InstaComp and economics

- `verify_listing_with_hardened_instacomp` — authoritative Profit Hunter verification path
- `instacomp_card` — legacy/manual exact-sale analysis; not authoritative for automated Profit Hunter buy calls
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

Write tools are mutating actions and must remain subject to client/workspace approval. Listing discovery or a scanner result can never create a purchase.

## Hardened InstaComp bridge

The connector downloads the exact listing’s public front/back images and sends multipart fields to:

```text
POST <INSTACOMP_BASE_URL>/api/instacomp/live-scan
x-tcos-instacomp-service-token: <INSTACOMP_SERVICE_TOKEN>
```

Required production variables:

```text
INSTACOMP_BASE_URL=https://truelycollectables.com
INSTACOMP_SERVICE_TOKEN=<same strong random value configured in Vercel Production>
INSTACOMP_TIMEOUT_MS=240000
TCOS_REQUIRE_INSTACOMP=true
```

The service token is separate from the connector bearer token. Vercel and the connector runtime must contain the same secret value. The scanner continues to fail closed when Supabase job storage, identity evidence, exact sold providers, or delivered-price support is missing.

## Public-source adapters

| Adapter | Environment variable | Purpose |
|---|---|---|
| OpenAI public web search | `OPENAI_API_KEY` | Public marketplace and public social discovery |
| eBay Browse API | `EBAY_BROWSE_ACCESS_TOKEN` | Native live eBay inventory search |
| X recent search API | `X_BEARER_TOKEN` | Native recent public sale-post search |
| Hardened InstaComp | `INSTACOMP_BASE_URL`, `INSTACOMP_SERVICE_TOKEN` | Exact image identity and sold-backed pricing |
| Manual URL/screenshot intake | none | Public listings and authorized private-group leads |

Mercari, Whatnot, Sportslots, COMC, MySlabs, Fanatics Collect, CollX, Etsy, and public Facebook pages may be discovered through public indexing or manually ingested. Missing checkout, variation, image, or shipping evidence blocks a buy call.

## Local setup

```bash
cd connectors/tcos-market-intel-mcp
cp .env.example .env
npm install
npm run check
npm start
```

The server listens on `PORT` (default `8787`).

Health endpoints:

```text
GET /health
GET /privacy
```

MCP endpoint:

```text
POST /mcp
Authorization: Bearer <TCOS_CONNECTOR_TOKEN>
```

The server uses stateless Streamable HTTP. Persistent state belongs in Supabase, not MCP sessions.

## Supabase setup

1. Apply `supabase/001_tcos_market_intel_connector.sql` in a controlled environment.
2. Do **not** use `supabase/002_seed_beta_one_ledger.sql` as portfolio data; that obsolete 2026-07-23 snapshot is intentionally retired and inert.
3. Import current purchases only from the authoritative TCOS Purchase Ledger through an evidence-backed reconciliation process.
4. Set `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` server-side.
5. Set `TCOS_REQUIRE_PERSISTENCE=true` after the schema is confirmed.

The schema enables RLS and creates no anon/authenticated policies. The connector uses the service-role key and its separate connector bearer token.

## Deployment

The Dockerfile can run on Railway, Render, Fly.io, Cloud Run, Azure Container Apps, or another HTTPS container host.

```bash
docker build -t tcos-market-intel-mcp .
docker run --rm -p 8787:8787 --env-file .env tcos-market-intel-mcp
```

Production requirements:

- HTTPS endpoint reachable by ChatGPT.
- Strong random `TCOS_CONNECTOR_TOKEN`.
- Same strong random `INSTACOMP_SERVICE_TOKEN` in Vercel and connector runtime.
- Supabase service-role key stored server-side.
- Public-search keys stored as encrypted deployment secrets.
- `TCOS_ALLOWED_ORIGINS` restricted to approved clients when applicable.
- Logs must never contain tokens, passwords, cookies, payment credentials, private addresses, or phone numbers.

## Connecting to ChatGPT

After deployment, add the remote MCP endpoint:

```text
https://<connector-host>/mcp
```

Configure bearer authentication with `TCOS_CONNECTOR_TOKEN`. Keep write-tool approvals enabled during Beta One.

## Release sequence

1. Merge and deploy the production InstaComp service-auth change.
2. Configure the same `INSTACOMP_SERVICE_TOKEN` in Vercel and the connector host.
3. Deploy the connector over HTTPS with persistence and hardened InstaComp required.
4. Confirm `/health` shows `hardenedInstaComp.configured: true`.
5. Process a known correct card and the permanent negative fixtures:
   - Franklin Arias BDC-13 rejected as not a true 1st Bowman.
   - WNBA Base mislabeled as Silver rejected.
   - True Silver accepted.
   - Demidov Glitter Bomb mislabeled as Black Rainbow identified from the back.
   - Active-only market returns no trusted price.
6. Connect the remote MCP endpoint to ChatGPT.
7. Resume automated buy recommendations only after one end-to-end listing returns exact identity, exact sold evidence, delivered cost, and a correct Profit Hunter classification.

## Known limitations

- Public indexing can miss fast-moving or login-limited listings.
- Selected-variation and dynamic checkout totals may still require manual review.
- The 25-card live benchmark completed 26 cards with strong identity accuracy, but returned no pricing-eligible exact sold evidence during that sample. The connector therefore suppresses those cards rather than inventing values.
- The permanent TCOS historical comp database and full Portfolio Manager UI remain future production features.
