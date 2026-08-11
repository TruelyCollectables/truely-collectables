import assert from "node:assert/strict";

async function main() {
  process.env.GROQ_API_KEY = "test-groq";
  process.env.VERCEL_OIDC_TOKEN = "test-oidc";
  process.env.GEMINI_API_KEY = "invalid-but-present";
  process.env.INSTACOMP_TEACHER_GEMINI_DISABLED = "true";
  delete process.env.INSTACOMP_GATEWAY_GEMINI_DISABLED;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.XAI_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_AUTH_TOKEN;
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.INSTACOMP_AI_LOCAL_URL;
  delete process.env.INSTACOMP_AI_LOCAL_KEY;

  const sharedSold = {
    title: "2025 Bowman Chrome Prospects Franklin Arias #BCP-67",
    itemPrice: 25,
    shippingPrice: 5,
    url: "https://www.ebay.com/itm/123456789012",
    imageUrl: "https://i.ebayimg.com/images/g/test/s-l1600.jpg",
    soldAt: "2026-07-31",
    listedAt: null,
    identityEvidence: "Exact year, product, set, player and card number matched.",
  };
  let splitVote = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("api.groq.com")) {
      const body = JSON.parse(String(init?.body || "{}"));
      assert.ok(body.model === "groq/compound-mini" || body.model === "openai/gpt-oss-20b");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sold: [sharedSold], active: [], notes: "Groq exact sale." }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("ai-gateway.vercel.sh/v1/responses")) {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Authorization"), "Bearer test-oidc");
      const body = JSON.parse(String(init?.body || "{}"));
      assert.equal(body.model, "google/gemini-2.5-flash-lite");
      assert.deepEqual(body.tools, [{ type: "google_search" }]);
      assert.equal(body.tool_choice, "required");
      assert.deepEqual(body.providerOptions?.gateway?.only, ["vertex"]);
      const sold = splitVote ? { ...sharedSold, url: "https://www.ebay.com/itm/888888888888" } : sharedSold;
      return new Response(JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ sold: [sold], active: [], notes: "Gemini grounded exact sale." }) }] }],
        provider_metadata: { vertex: { groundingMetadata: { webSearchQueries: ["exact eBay sold query"], searchEntryPoint: { renderedContent: "grounded" } } } },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("ai-gateway.vercel.sh/v1/chat/completions")) {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Authorization"), "Bearer test-oidc");
      const body = JSON.parse(String(init?.body || "{}"));
      assert.equal(body.model, "perplexity/sonar");
      const sold = splitVote ? { ...sharedSold, url: "https://www.ebay.com/itm/999999999999" } : sharedSold;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sold: [sold], active: [], notes: "Sonar exact sale." }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected mocked fetch URL: ${url}`);
  }) as typeof fetch;

  try {
    const { getTeacherExactMarketProviders } = await import("../src/lib/instacomp-teacher-market-provider");
    const ai = {
      player: "Franklin Arias", year: "2025", brand: "Bowman Chrome", setName: "Prospects",
      cardNumber: "BCP-67", parallel: null, serialNumber: null, gradingCompany: null,
      gradeValue: null, certificationNumber: null, certificationLookupUrl: null,
      gradingEvidence: null, team: null, sport: "baseball", isRookie: false,
      isAuto: false, isRelic: false, conditionGuess: null, confidence: 1, notes: null,
    };
    const exactTitle = "2025 Bowman Chrome Prospects Franklin Arias #BCP-67";
    const agreed = await getTeacherExactMarketProviders({ exactTitle, ai });
    assert.deepEqual(agreed.configuredTeachers.sort(), ["gateway_gemini", "gateway_perplexity", "groq", "groq_browser"]);
    assert.equal(agreed.requiredVotes, 2);
    assert.equal(agreed.sold.status, "live");
    assert.equal(agreed.sold.results.length, 1);
    assert.ok(agreed.sold.results[0].flags.includes("teacher:gateway_gemini"));
    assert.ok(agreed.sold.results[0].flags.includes("teacher:groq"));
    assert.ok(agreed.sold.results[0].flags.includes("eligible to teach InstaComp AI"));

    splitVote = true;
    const disagreed = await getTeacherExactMarketProviders({ exactTitle, ai });
    assert.equal(disagreed.requiredVotes, 2);
    assert.equal(disagreed.sold.status, "no_matches");
    assert.equal(disagreed.sold.results.length, 0);
    console.log("InstaComp Gemini + Groq + Gateway Perplexity teacher consensus regressions passed.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
