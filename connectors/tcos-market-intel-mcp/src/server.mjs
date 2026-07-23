import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { assertProductionConfig, config, persistenceConfigured, publicSearchConfigured } from "./config.mjs";
import {
  calculateDeliveredCost,
  calculateMaximumOffer,
  calculateResaleOutcome,
  classifyDeal,
  compareListingsForDuplicate,
  computeCompStats,
  evaluateSellerRisk,
  identityKey,
  roundMoney,
} from "./logic.mjs";
import { createRepository } from "./repository.mjs";
import { publicSearchService } from "./public-search.mjs";

const repository = createRepository();
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "12mb" }));

const CardIdentitySchema = z
  .object({
    sport: z.string().optional(),
    player: z.string().optional(),
    year: z.union([z.string(), z.number()]).optional(),
    manufacturer: z.string().optional(),
    product: z.string().optional(),
    set: z.string().optional(),
    subset: z.string().optional(),
    cardNumber: z.string().optional(),
    parallel: z.string().optional(),
    variation: z.string().optional(),
    serialTier: z.string().optional(),
    serialNumber: z.string().optional(),
    autograph: z.boolean().optional(),
    memorabilia: z.boolean().optional(),
    rawOrGraded: z.enum(["raw", "graded", "unknown"]).optional(),
    gradingCompany: z.string().optional(),
    grade: z.union([z.string(), z.number()]).optional(),
    certificationNumber: z.string().optional(),
    condition: z.string().optional(),
  })
  .strict();

const ListingSchema = z
  .object({
    id: z.string().uuid().optional(),
    source: z.string().min(1),
    url: z.string().url(),
    discoveredAt: z.string().datetime().optional(),
    sellerName: z.string().optional(),
    sellerAccountUrl: z.string().url().optional(),
    location: z.string().optional(),
    title: z.string().min(1),
    description: z.string().optional(),
    askingPrice: z.number().nonnegative().optional(),
    shipping: z.number().nonnegative().optional(),
    buyerFees: z.number().nonnegative().optional(),
    tax: z.number().nonnegative().optional(),
    quantity: z.number().int().positive().optional(),
    pickupOrShipping: z.string().optional(),
    paymentMethod: z.string().optional(),
    negotiable: z.boolean().optional(),
    imageUrls: z.array(z.string().url()).default([]),
    photoHashes: z.array(z.string()).default([]),
    identity: CardIdentitySchema.default({}),
    certificationNumber: z.string().optional(),
    manualReviewRequired: z.boolean().default(false),
    sellerRisk: z.enum(["low", "medium", "high", "unknown"]).default("unknown"),
    status: z.string().optional(),
    rawPayload: z.record(z.string(), z.unknown()).optional(),
    allowDuplicate: z.boolean().default(false),
  })
  .strict();

const CompSaleSchema = z
  .object({
    source: z.string().min(1),
    soldAt: z.string().datetime(),
    soldPrice: z.number().positive(),
    shipping: z.number().nonnegative().default(0),
    totalPrice: z.number().positive().optional(),
    url: z.string().url(),
    exactMatch: z.boolean().default(true),
    rawOrGraded: z.enum(["raw", "graded", "unknown"]).optional(),
    gradingCompany: z.string().optional(),
    grade: z.union([z.string(), z.number()]).optional(),
    notes: z.string().optional(),
  })
  .strict();

const AcquisitionItemSchema = z
  .object({
    identity: CardIdentitySchema.default({}),
    quantity: z.number().int().positive().default(1),
    allocatedCost: z.number().nonnegative().optional(),
    status: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();

const jsonResult = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  structuredContent: value,
});

const errorResult = (error) => ({
  isError: true,
  content: [
    {
      type: "text",
      text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2),
    },
  ],
});

const guarded = (handler) => async (input) => {
  try {
    return await handler(input);
  } catch (error) {
    console.error(error);
    return errorResult(error);
  }
};

function buildMcpServer() {
  const server = new McpServer({ name: "tcos-market-intel", version: "0.1.0" });
  const register = (name, title, description, inputSchema, annotations, handler) =>
    server.registerTool(name, { title, description, inputSchema, annotations }, guarded(handler));

  register(
    "connector_status",
    "TCOS Connector Status",
    "Check connector health, persistence, public-search adapters, and privacy boundaries.",
    z.object({}),
    { readOnlyHint: true, openWorldHint: false },
    async () => {
      let persistence;
      try {
        persistence = await repository.status();
      } catch (error) {
        persistence = {
          mode: persistenceConfigured ? "supabase_error" : "memory",
          persistent: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      return jsonResult({
        service: "TCOS Market Intel Connector",
        version: "0.1.0",
        persistence,
        publicSearch: publicSearchService.status(),
        privacy: {
          publicOrAuthorizedContentOnly: true,
          privateFacebookGroupAutomation: false,
          passwordCookieOrSessionStorage: false,
          purchaseWithoutApproval: false,
        },
      });
    },
  );

  register(
    "list_saved_searches",
    "List Saved Searches",
    "List TCOS saved searches and source/filter configuration.",
    z.object({ enabledOnly: z.boolean().default(false) }),
    { readOnlyHint: true, openWorldHint: false },
    async ({ enabledOnly }) => jsonResult(await repository.listSavedSearches({ enabledOnly })),
  );

  register(
    "upsert_saved_search",
    "Create or Update Saved Search",
    "Persist a TCOS saved search without purchasing anything.",
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().min(1),
      query: z.string().min(1),
      sources: z.array(z.string()).default([]),
      filters: z.record(z.string(), z.unknown()).default({}),
      enabled: z.boolean().default(true),
      cadence: z.string().optional(),
    }),
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (input) => jsonResult(await repository.upsertSavedSearch(input)),
  );

  register(
    "run_saved_search",
    "Run Saved Search",
    "Run a search against configured public adapters. Private and login-restricted content is never bypassed.",
    z.object({
      savedSearchId: z.string().uuid().optional(),
      query: z.string().min(1).optional(),
      sources: z.array(z.string()).default([]),
      filters: z.record(z.string(), z.unknown()).default({}),
      maxResults: z.number().int().min(1).max(50).default(20),
      exactIdentityOnly: z.boolean().default(false),
      persistResults: z.boolean().default(false),
    }),
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async (input) => {
      let savedSearch = null;
      if (input.savedSearchId) {
        const searches = await repository.listSavedSearches();
        savedSearch = searches.find((entry) => entry.id === input.savedSearchId);
        if (!savedSearch) throw new Error(`Saved search ${input.savedSearchId} was not found`);
      }
      const request = {
        query: input.query || savedSearch?.query,
        sources: input.sources.length ? input.sources : savedSearch?.sources || [],
        filters: Object.keys(input.filters).length ? input.filters : savedSearch?.filters || {},
        maxResults: input.maxResults,
        exactIdentityOnly: input.exactIdentityOnly,
      };
      if (!request.query) throw new Error("A query or savedSearchId is required");
      const discovery = await publicSearchService.search(request);
      const persisted = [];
      if (input.persistResults) {
        for (const listing of discovery.results) persisted.push(await repository.ingestListing(listing));
      }
      if (savedSearch) await repository.markSavedSearchRun(savedSearch.id);
      return jsonResult({ request, ...discovery, persisted });
    },
  );

  register(
    "ingest_listing",
    "Ingest Public or Manually Shared Listing",
    "Normalize and save a public listing or a private-group lead manually supplied by the user, after duplicate checks.",
    ListingSchema,
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (input) => jsonResult(await repository.ingestListing(input)),
  );

  register(
    "check_duplicate_listing",
    "Check Listing Duplicate",
    "Compare a candidate against stored listings using URL, seller, photos, certification, exact identity, and price.",
    ListingSchema.omit({ allowDuplicate: true }),
    { readOnlyHint: true, openWorldHint: false },
    async (input) => jsonResult({ identityKey: identityKey(input.identity), matches: await repository.findDuplicates(input) }),
  );

  register(
    "compare_two_listings",
    "Compare Two Listings",
    "Score whether two listings are one cross-posted opportunity.",
    z.object({ first: ListingSchema.omit({ allowDuplicate: true }), second: ListingSchema.omit({ allowDuplicate: true }) }),
    { readOnlyHint: true, openWorldHint: false },
    async ({ first, second }) => jsonResult(compareListingsForDuplicate(first, second)),
  );

  register(
    "instacomp_card",
    "InstaComp Exact Card",
    "Calculate exact-card comp statistics from verified completed sales and optionally refresh public comps.",
    z.object({
      identity: CardIdentitySchema,
      sales: z.array(CompSaleSchema).default([]),
      refreshFromPublicWeb: z.boolean().default(false),
      persistVerifiedSales: z.boolean().default(false),
      maxResults: z.number().int().min(1).max(50).default(20),
    }),
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async ({ identity, sales, refreshFromPublicWeb, persistVerifiedSales, maxResults }) => {
      const stored = await repository.getCompHistory(identity, { limit: 200 });
      let refreshed = [];
      let warnings = [];
      if (refreshFromPublicWeb) {
        const result = await publicSearchService.searchComps({ identity, maxResults });
        refreshed = result.sales;
        warnings = result.warnings || [];
      }
      const unique = new Map();
      for (const sale of [...stored, ...sales, ...refreshed]) {
        const total = roundMoney(sale.totalPrice ?? sale.soldPrice + (sale.shipping || 0));
        unique.set(`${sale.source}|${sale.soldAt}|${total}|${sale.url}`, sale);
      }
      const exactSales = [...unique.values()].filter((sale) => sale.exactMatch !== false);
      if (persistVerifiedSales && (sales.length || refreshed.length)) {
        await repository.addCompSales(identity, [...sales, ...refreshed].filter((sale) => sale.exactMatch !== false));
      }
      return jsonResult({ identity, identityKey: identityKey(identity), stats: computeCompStats(exactSales), warnings });
    },
  );

  register(
    "get_comp_history",
    "Get Exact Comp History",
    "Read stored exact completed-sale records for one precise card identity.",
    z.object({ identity: CardIdentitySchema, limit: z.number().int().min(1).max(500).default(100) }),
    { readOnlyHint: true, openWorldHint: false },
    async ({ identity, limit }) => {
      const sales = await repository.getCompHistory(identity, { limit });
      return jsonResult({ identity, stats: computeCompStats(sales), sales });
    },
  );

  register(
    "instacomp_lot",
    "InstaComp Lot",
    "Calculate conservative, expected, and optimistic lot economics without valuing unidentified filler at full retail.",
    z.object({
      deliveredCost: z.number().nonnegative(),
      components: z.array(
        z.object({
          identity: CardIdentitySchema.default({}),
          quantity: z.number().int().positive().default(1),
          confidence: z.enum(["high", "medium", "low", "unverified"]).default("low"),
          conservativeValueEach: z.number().nonnegative().default(0),
          expectedValueEach: z.number().nonnegative().default(0),
          optimisticValueEach: z.number().nonnegative().default(0),
          sellIndividually: z.boolean().default(false),
        }),
      ),
      unidentifiedCardCount: z.number().int().nonnegative().default(0),
      conservativeBulkValueEach: z.number().nonnegative().default(0),
      expectedBulkValueEach: z.number().nonnegative().default(0),
      sellingFeeRate: z.number().min(0).max(1).default(config.defaults.sellingFeeRate),
      orderFee: z.number().nonnegative().default(config.defaults.orderFee),
      outboundShipping: z.number().nonnegative().default(0),
      supplies: z.number().nonnegative().default(0),
      labor: z.number().nonnegative().default(0),
      returnReserveRate: z.number().min(0).max(1).default(config.defaults.returnReserveRate),
    }),
    { readOnlyHint: true, openWorldHint: false },
    async (input) => {
      const values = input.components.reduce(
        (acc, component) => {
          acc.conservative += component.quantity * component.conservativeValueEach;
          acc.expected += component.quantity * component.expectedValueEach;
          acc.optimistic += component.quantity * component.optimisticValueEach;
          return acc;
        },
        { conservative: 0, expected: 0, optimistic: 0 },
      );
      values.conservative += input.unidentifiedCardCount * input.conservativeBulkValueEach;
      values.expected += input.unidentifiedCardCount * input.expectedBulkValueEach;
      values.optimistic += input.unidentifiedCardCount * input.expectedBulkValueEach;
      const scenarios = Object.fromEntries(
        Object.entries(values).map(([name, resalePrice]) => [
          name,
          calculateResaleOutcome({
            deliveredCost: input.deliveredCost,
            resalePrice,
            sellingFeeRate: input.sellingFeeRate,
            orderFee: input.orderFee,
            outboundShipping: input.outboundShipping,
            supplies: input.supplies,
            labor: input.labor,
            returnReserveRate: input.returnReserveRate,
          }),
        ]),
      );
      return jsonResult({
        breakupValue: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, roundMoney(value)])),
        scenarios,
      });
    },
  );

  register(
    "calculate_offer_and_profit",
    "Calculate Profit and Maximum Offer",
    "Calculate delivered cost, resale profit, ROI, opening offer, target price, and maximum purchase price.",
    z.object({
      askingPrice: z.number().nonnegative(),
      shipping: z.number().nonnegative().default(0),
      tax: z.number().nonnegative().default(0),
      paymentFees: z.number().nonnegative().default(0),
      travelCost: z.number().nonnegative().default(0),
      otherAcquisitionCosts: z.number().nonnegative().default(0),
      acquisitionTaxRate: z.number().min(0).max(1).default(0),
      resalePrice: z.number().nonnegative(),
      buyerShipping: z.number().nonnegative().default(0),
      buyerSalesTax: z.number().nonnegative().default(0),
      sellingFeeRate: z.number().min(0).max(1).default(config.defaults.sellingFeeRate),
      orderFee: z.number().nonnegative().default(config.defaults.orderFee),
      paymentProcessingFees: z.number().nonnegative().default(0),
      outboundShipping: z.number().nonnegative().default(config.defaults.outboundPostage),
      supplies: z.number().nonnegative().default(config.defaults.supplies),
      gradingAuthentication: z.number().nonnegative().default(0),
      cleaningPreparation: z.number().nonnegative().default(0),
      labor: z.number().nonnegative().default(0),
      returnReserveRate: z.number().min(0).max(1).default(config.defaults.returnReserveRate),
      targetRoi: z.number().min(0).max(10).default(config.defaults.targetRoi),
    }),
    { readOnlyHint: true, openWorldHint: false },
    async (input) => {
      const acquisition = calculateDeliveredCost(input);
      return jsonResult({
        acquisition,
        resale: calculateResaleOutcome({ ...input, deliveredCost: acquisition.deliveredCost }),
        offer: calculateMaximumOffer(input),
      });
    },
  );

  register(
    "evaluate_seller_risk",
    "Evaluate Facebook/X Seller Risk",
    "Score seller-risk signals and flag possible scams before a low price can qualify.",
    z.object({
      accountAgeDays: z.number().nonnegative().optional(),
      hobbyHistory: z.boolean().optional(),
      referencesAvailable: z.boolean().optional(),
      timestampedPhotoRefused: z.boolean().default(false),
      copiedPhotosSuspected: z.boolean().default(false),
      certificationMismatch: z.boolean().default(false),
      inconsistentPhotos: z.boolean().default(false),
      paymentNameMismatch: z.boolean().default(false),
      pressureToPay: z.boolean().default(false),
      locationChanged: z.boolean().default(false),
      trackingRefused: z.boolean().default(false),
      paymentMethod: z.string().optional(),
      priceDiscountPercent: z.number().optional(),
    }),
    { readOnlyHint: true, openWorldHint: false },
    async (input) => jsonResult(evaluateSellerRisk(input)),
  );

  register(
    "classify_deal",
    "Classify Deal",
    "Classify a deal as Strong Buy, Buy If Negotiated, Speculative, Manual Review, Pass, or High Risk.",
    z.object({
      identityConfirmed: z.boolean().default(true),
      manualReviewRequired: z.boolean().default(false),
      sellerRisk: z.enum(["low", "medium", "high"]).default("low"),
      netProfit: z.number(),
      roiPercent: z.number(),
      minimumNetProfit: z.number().optional(),
      minimumRoiPercent: z.number().default(10),
      isLot: z.boolean().default(false),
      profitAtMaximumOffer: z.number().optional(),
      roiAtMaximumOffer: z.number().optional(),
      futurePerformanceDependent: z.boolean().default(false),
      gradingUpsideDependent: z.boolean().default(false),
    }),
    { readOnlyHint: true, openWorldHint: false },
    async (input) => jsonResult({ status: classifyDeal(input) }),
  );

  register(
    "record_purchase",
    "Record Purchase Lot",
    "Create one acquisition lot after the user confirms a purchase. Separate genuine transactions stay separate.",
    z.object({
      id: z.string().uuid().optional(),
      portfolioId: z.string().optional(),
      source: z.string().min(1),
      sourceUrl: z.string().url().optional(),
      sourceItemId: z.string().optional(),
      orderNumber: z.string().optional(),
      purchasedAt: z.string().datetime().optional(),
      sellerName: z.string().optional(),
      quantity: z.number().int().positive(),
      deliveredCost: z.number().nonnegative(),
      status: z.enum(["awaiting_receipt", "in_inventory", "returned", "canceled"]).default("awaiting_receipt"),
      items: z.array(AcquisitionItemSchema).default([]),
      notes: z.string().optional(),
    }),
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async (input) => jsonResult(await repository.recordPurchase(input)),
  );

  register(
    "mark_received",
    "Mark Purchase Received",
    "Mark a confirmed lot in inventory and replace provisional identities with receipt inspection details.",
    z.object({
      lotId: z.string().uuid(),
      receivedAt: z.string().datetime().optional(),
      receiptNotes: z.string().optional(),
      verifiedItems: z.array(AcquisitionItemSchema).default([]),
    }),
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (input) => jsonResult(await repository.markReceived(input)),
  );

  register(
    "record_sale",
    "Record Sale",
    "Record a user-confirmed sale against a specific acquisition lot and calculate realized profit.",
    z.object({
      id: z.string().uuid().optional(),
      lotId: z.string().uuid(),
      quantitySold: z.number().int().positive(),
      soldAt: z.string().datetime().optional(),
      marketplace: z.string().min(1),
      grossSale: z.number().nonnegative(),
      buyerShipping: z.number().nonnegative().default(0),
      marketplaceFees: z.number().nonnegative().default(0),
      paymentFees: z.number().nonnegative().default(0),
      actualPostage: z.number().nonnegative().default(0),
      supplies: z.number().nonnegative().default(0),
      refunds: z.number().nonnegative().default(0),
      netProceeds: z.number(),
    }),
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async (input) => jsonResult(await repository.recordSale(input)),
  );

  register(
    "get_portfolio_summary",
    "Get Portfolio Summary",
    "Get purchase lots, receipt status, remaining cost basis, sales, and realized totals.",
    z.object({}),
    { readOnlyHint: true, openWorldHint: false },
    async () => jsonResult(await repository.getPortfolioSummary()),
  );

  return server;
}

const originAllowed = (origin) => !origin || config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Mcp-Session-Id, Last-Event-ID");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(originAllowed(origin) ? 204 : 403);
  if (origin && !originAllowed(origin)) return res.status(403).json({ error: "Origin is not allowed" });
  next();
});

const authorize = (req, res, next) => {
  if (!config.connectorToken) return res.status(503).json({ error: "Connector authentication is not configured" });
  if ((req.headers.authorization || "") !== `Bearer ${config.connectorToken}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

app.get("/health", async (_req, res) => {
  let persistence;
  try {
    persistence = await repository.status();
  } catch (error) {
    persistence = { persistent: false, error: error instanceof Error ? error.message : String(error) };
  }
  res.json({
    ok: true,
    name: "tcos-market-intel",
    version: "0.1.0",
    persistence,
    publicSearchConfigured,
    publicSearch: publicSearchService.status(),
  });
});

app.get("/privacy", (_req, res) => {
  res.json({
    publicOrAuthorizedContentOnly: true,
    privateGroupBypass: false,
    credentialsStored: false,
    purchasesWithoutUserApproval: false,
    description:
      "The connector searches public sources and accepts leads the user manually shares. It does not store Facebook passwords, cookies, recovery codes, or session data.",
  });
});

app.post("/mcp", authorize, async (req, res) => {
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    transport.close().catch(() => undefined);
    server.close().catch(() => undefined);
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", authorize, (_req, res) => {
  res.status(405).json({ error: "This connector uses stateless Streamable HTTP; send MCP messages with POST" });
});

app.delete("/mcp", authorize, (_req, res) => {
  res.status(405).json({ error: "Stateless connector sessions do not require deletion" });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error instanceof Error ? error.message : "Internal server error" });
});

assertProductionConfig();
app.listen(config.port, "0.0.0.0", () => {
  console.log(`TCOS Market Intel MCP listening on port ${config.port}`);
});
