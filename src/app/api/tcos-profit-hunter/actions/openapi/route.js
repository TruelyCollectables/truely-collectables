const serverUrl = "https://truelycollectables.com";

const schema = {
  openapi: "3.1.0",
  info: {
    title: "TCOS Profit Hunter Actions",
    version: "1.0.1",
    description:
      "Private read-and-analysis API for TCOS Deal Hunter / Profit Hunter. It discovers candidates, runs exact front/back InstaComp verification, applies owned-copy exclusions, and calculates fail-closed net ROI. It never purchases items.",
  },
  servers: [{ url: serverUrl }],
  externalDocs: {
    description: "Truely Collectables Privacy Policy",
    url: `${serverUrl}/privacy`,
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/api/tcos-profit-hunter/actions/status": {
      get: {
        operationId: "getProfitHunterStatus",
        summary: "Check Profit Hunter readiness",
        description:
          "Return the locked watch scope and whether discovery and hardened InstaComp are configured. Use this before searches or listing verification.",
        "x-openai-isConsequential": false,
        responses: {
          "200": {
            description: "Profit Hunter readiness and locked scope.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/StatusResponse" },
              },
            },
          },
          "401": { $ref: "#/components/responses/ErrorResponse" },
        },
      },
    },
    "/api/tcos-profit-hunter/actions/search": {
      post: {
        operationId: "searchProfitHunterCandidates",
        summary: "Search for Profit Hunter candidates",
        description:
          "Search public marketplaces using one locked TCOS lane. Returned records are discovery candidates only and must be passed to verifyProfitHunterListing before any buy classification.",
        "x-openai-isConsequential": false,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SearchRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Discovery candidates requiring hardened verification.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SearchResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/ErrorResponse" },
          "401": { $ref: "#/components/responses/ErrorResponse" },
          "500": { $ref: "#/components/responses/ErrorResponse" },
        },
      },
    },
    "/api/tcos-profit-hunter/actions/verify": {
      post: {
        operationId: "verifyProfitHunterListing",
        summary: "Verify and classify one exact listing",
        description:
          "Run one exact physical listing through owned-purchase exclusion, front/back hardened InstaComp identity, exact sold evidence, delivered cost, resale costs, net profit, ROI, and locked TCOS scope rules. Never label a listing actionable without this operation.",
        "x-openai-isConsequential": false,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/VerifyRequest" },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Fail-closed verification result with identity, exact-market evidence, economics, and final TCOS label.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/VerifyResponse" },
              },
            },
          },
          "400": { $ref: "#/components/responses/ErrorResponse" },
          "401": { $ref: "#/components/responses/ErrorResponse" },
          "500": { $ref: "#/components/responses/ErrorResponse" },
        },
      },
    },
  },
  components: {
    schemas: {
      Lane: {
        type: "string",
        enum: [
          "demidov",
          "wnba",
          "danny_norris",
          "baseball_prospect",
          "signed_baseball",
        ],
      },
      ErrorBody: {
        type: "object",
        properties: {
          error: { type: "string" },
          code: { type: "string" },
        },
        required: ["error"],
      },
      StatusResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          service: { type: "string" },
          interface: { type: "string" },
          version: { type: "string" },
          purchaseWritesEnabled: { type: "boolean" },
          scope: {
            type: "object",
            properties: {
              minimumNetRoiPercent: { type: "number" },
              demidov: { type: "object" },
              wnba: { type: "object" },
              baseballProspect: { type: "object" },
              signedBaseball: { type: "object" },
            },
          },
          discovery: {
            type: "object",
            properties: {
              openAiPublicWeb: { type: "boolean" },
              ebayBrowse: { type: "boolean" },
              xRecentSearch: { type: "boolean" },
            },
          },
          hardenedInstaComp: {
            type: "object",
            properties: {
              configured: { type: "boolean" },
              baseUrlConfigured: { type: "boolean" },
              serviceTokenConfigured: { type: "boolean" },
              endpoint: { type: "string" },
            },
          },
        },
        required: [
          "ok",
          "service",
          "interface",
          "version",
          "scope",
          "discovery",
          "hardenedInstaComp",
          "purchaseWritesEnabled",
        ],
      },
      SearchRequest: {
        type: "object",
        properties: {
          lane: { $ref: "#/components/schemas/Lane" },
          player: {
            type: "string",
            description:
              "Optional exact player name. WNBA accepts only Caitlin Clark, Paige Bueckers, Dominique Malonga, Sonia Citron, or Kiki Iriafen.",
          },
          query: {
            type: "string",
            description: "Optional focused public-marketplace search phrase.",
          },
          maxResults: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            default: 20,
          },
        },
        required: ["lane"],
      },
      Candidate: {
        type: "object",
        properties: {
          source: { type: "string" },
          url: { type: "string", format: "uri" },
          sourceItemId: { type: "string" },
          title: { type: "string" },
          sellerName: { type: "string" },
          askingPrice: { type: "number" },
          shipping: { type: "number" },
          buyerFees: { type: "number" },
          tax: { type: "number" },
          imageUrls: {
            type: "array",
            items: { type: "string", format: "uri" },
          },
          purchaseReady: { type: "boolean" },
          requiresHardenedVerification: { type: "boolean" },
          frontBackSelectionRequired: { type: "boolean" },
        },
      },
      SearchResponse: {
        type: "object",
        properties: {
          lane: { $ref: "#/components/schemas/Lane" },
          count: { type: "integer" },
          candidates: {
            type: "array",
            items: { $ref: "#/components/schemas/Candidate" },
          },
          sourceReports: {
            type: "array",
            items: { type: "object" },
          },
          warnings: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["lane", "count", "candidates"],
      },
      Listing: {
        type: "object",
        properties: {
          source: {
            type: "string",
            description: "Marketplace or public source name.",
          },
          url: {
            type: "string",
            format: "uri",
            description: "Exact live listing URL.",
          },
          sourceItemId: { type: "string" },
          title: {
            type: "string",
            description: "Seller listing title, treated only as a claim.",
          },
          sellerName: { type: "string" },
          askingPrice: { type: "number", minimum: 0 },
          shipping: { type: "number", minimum: 0, default: 0 },
          buyerFees: { type: "number", minimum: 0, default: 0 },
          tax: { type: "number", minimum: 0, default: 0 },
          frontImageUrl: {
            type: "string",
            format: "uri",
            description: "Direct HTTPS front-image URL.",
          },
          backImageUrl: {
            type: "string",
            format: "uri",
            description: "Direct HTTPS back-image URL.",
          },
        },
        required: [
          "source",
          "url",
          "title",
          "askingPrice",
          "frontImageUrl",
          "backImageUrl",
        ],
      },
      TrueFirstBowmanEvidence: {
        type: "object",
        description:
          "Required for baseball_prospect verification. Must prove the exact 2021-present true 1st Bowman issue and that no earlier qualifying issue exists.",
        properties: {
          checklistSource: { type: "string" },
          checklistUrl: { type: "string", format: "uri" },
          exactCardNumber: { type: "string" },
          chronologyChecked: { type: "boolean" },
          noEarlierQualifyingIssue: { type: "boolean" },
          notes: { type: "string" },
        },
        required: [
          "checklistSource",
          "checklistUrl",
          "exactCardNumber",
          "chronologyChecked",
          "noEarlierQualifyingIssue",
        ],
      },
      VerifyRequest: {
        type: "object",
        properties: {
          lane: { $ref: "#/components/schemas/Lane" },
          expectedPlayer: { type: "string" },
          listing: { $ref: "#/components/schemas/Listing" },
          trueFirstBowmanEvidence: {
            $ref: "#/components/schemas/TrueFirstBowmanEvidence",
          },
          sellerRisk: {
            type: "string",
            enum: ["low", "medium", "high", "unknown"],
            default: "unknown",
          },
          manualReviewRequired: { type: "boolean", default: false },
          aiCouncilTier: { type: "string", default: "adaptive" },
          operatorSerialNumberOverride: { type: "string" },
          sellingFeeRate: {
            type: "number",
            minimum: 0,
            maximum: 1,
            default: 0.1325,
          },
          orderFee: { type: "number", minimum: 0, default: 0.4 },
          paymentProcessingFees: {
            type: "number",
            minimum: 0,
            default: 0,
          },
          outboundShipping: {
            type: "number",
            minimum: 0,
            default: 0.78,
          },
          supplies: { type: "number", minimum: 0, default: 0.25 },
          gradingAuthentication: {
            type: "number",
            minimum: 0,
            default: 0,
          },
          cleaningPreparation: {
            type: "number",
            minimum: 0,
            default: 0,
          },
          labor: { type: "number", minimum: 0, default: 0 },
          returnReserveRate: {
            type: "number",
            minimum: 0,
            maximum: 1,
            default: 0.02,
          },
        },
        required: ["lane", "listing"],
      },
      Outcome: {
        type: "object",
        properties: {
          label: { type: "string" },
          purchaseReady: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["label", "purchaseReady", "reason"],
      },
      VerifyResponse: {
        type: "object",
        properties: {
          listing: { $ref: "#/components/schemas/Listing" },
          ownedPurchaseExclusion: { type: "object" },
          identity: { type: "object" },
          identityPolicy: { type: "object" },
          exactMarket: { type: "object" },
          acquisition: { type: "object" },
          resale: { type: "object" },
          offer: { type: "object" },
          outcome: { $ref: "#/components/schemas/Outcome" },
          diagnostics: { type: "object" },
        },
        required: ["listing", "outcome"],
      },
    },
    responses: {
      ErrorResponse: {
        description: "Request failed.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorBody" },
          },
        },
      },
    },
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "TCOS private connector token",
      },
    },
  },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return Response.json(schema, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
