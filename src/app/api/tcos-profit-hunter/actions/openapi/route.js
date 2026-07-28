const serverUrl = "https://truelycollectables.com";

const laneSchema = {
  type: "string",
  enum: [
    "demidov",
    "wnba",
    "danny_norris",
    "baseball_prospect",
    "signed_baseball",
  ],
};

const nullableString = {
  type: "string",
  nullable: true,
};

const listingSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "source",
    "url",
    "title",
    "askingPrice",
    "frontImageUrl",
    "backImageUrl",
  ],
  properties: {
    source: { type: "string", description: "Marketplace or public source name." },
    url: { type: "string", format: "uri", description: "Exact live listing URL." },
    sourceItemId: nullableString,
    title: { type: "string", description: "Seller listing title, treated only as a claim." },
    sellerName: nullableString,
    askingPrice: { type: "number", minimum: 0 },
    shipping: { type: "number", minimum: 0, default: 0 },
    buyerFees: { type: "number", minimum: 0, default: 0 },
    tax: { type: "number", minimum: 0, default: 0 },
    frontImageUrl: { type: "string", format: "uri", description: "Direct HTTPS front-image URL." },
    backImageUrl: { type: "string", format: "uri", description: "Direct HTTPS back-image URL." },
  },
};

const errorResponse = {
  description: "Request failed.",
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          error: { type: "string" },
          code: { type: "string" },
        },
      },
    },
  },
};

const schema = {
  openapi: "3.0.3",
  info: {
    title: "TCOS Profit Hunter Actions",
    version: "1.0.0",
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
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
          "401": errorResponse,
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
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["lane"],
                properties: {
                  lane: laneSchema,
                  player: {
                    ...nullableString,
                    description:
                      "Optional exact player name. WNBA accepts only Caitlin Clark, Paige Bueckers, Dominique Malonga, Sonia Citron, or Kiki Iriafen.",
                  },
                  query: {
                    ...nullableString,
                    description: "Optional focused public-marketplace search phrase.",
                  },
                  maxResults: {
                    type: "integer",
                    minimum: 1,
                    maximum: 50,
                    default: 20,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Discovery candidates requiring hardened verification.",
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "500": errorResponse,
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
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["lane", "listing"],
                properties: {
                  lane: laneSchema,
                  expectedPlayer: {
                    ...nullableString,
                    description: "Expected exact player name for image-vs-listing verification.",
                  },
                  listing: listingSchema,
                  trueFirstBowmanEvidence: {
                    type: "object",
                    nullable: true,
                    additionalProperties: false,
                    required: [
                      "checklistSource",
                      "checklistUrl",
                      "exactCardNumber",
                      "chronologyChecked",
                      "noEarlierQualifyingIssue",
                    ],
                    properties: {
                      checklistSource: { type: "string" },
                      checklistUrl: { type: "string", format: "uri" },
                      exactCardNumber: { type: "string" },
                      chronologyChecked: { type: "boolean" },
                      noEarlierQualifyingIssue: { type: "boolean" },
                      notes: nullableString,
                    },
                    description:
                      "Required for baseball_prospect verification. Must prove the exact 2021-present true 1st Bowman issue and that no earlier qualifying issue exists.",
                  },
                  sellerRisk: {
                    type: "string",
                    enum: ["low", "medium", "high", "unknown"],
                    default: "unknown",
                  },
                  manualReviewRequired: { type: "boolean", default: false },
                  aiCouncilTier: { type: "string", default: "adaptive" },
                  operatorSerialNumberOverride: nullableString,
                  sellingFeeRate: { type: "number", minimum: 0, maximum: 1, default: 0.1325 },
                  orderFee: { type: "number", minimum: 0, default: 0.4 },
                  paymentProcessingFees: { type: "number", minimum: 0, default: 0 },
                  outboundShipping: { type: "number", minimum: 0, default: 0.78 },
                  supplies: { type: "number", minimum: 0, default: 0.25 },
                  gradingAuthentication: { type: "number", minimum: 0, default: 0 },
                  cleaningPreparation: { type: "number", minimum: 0, default: 0 },
                  labor: { type: "number", minimum: 0, default: 0 },
                  returnReserveRate: { type: "number", minimum: 0, maximum: 1, default: 0.02 },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Fail-closed verification result with identity, exact-market evidence, economics, and final TCOS label.",
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "500": errorResponse,
        },
      },
    },
  },
  components: {
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
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
