import assert from "node:assert/strict";

async function main() {
  process.env.GEMINI_API_KEY = "test-gemini";
  process.env.ANTHROPIC_API_KEY = "test-anthropic";
  process.env.XAI_API_KEY = "test-xai";
  delete process.env.PERPLEXITY_API_KEY;

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

  let disagreement = false;
  let xaiContractChecked = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("generativelanguage.googleapis.com")) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      sold: [sharedSold],
                      active: [],
                      notes: "Gemini teacher found exact sold evidence.",
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("api.anthropic.com")) {
      const anthropicSold = disagreement
        ? { ...sharedSold, url: "https://www.ebay.com/itm/999999999999" }
        : sharedSold;
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                sold: [anthropicSold],
                active: [],
                notes: "Claude teacher independently checked the sale.",
              }),
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("api.x.ai")) {
      const requestBody = JSON.parse(String(init?.body || "{}"));
      const webSearch = Array.isArray(requestBody.tools)
        ? requestBody.tools.find((tool: any) => tool?.type === "web_search")
        : null;
      assert.ok(webSearch, "xAI teacher must use web_search");
      assert.deepEqual(webSearch.filters?.allowed_domains, ["ebay.com", "130point.com"]);
      assert.equal(webSearch.allowed_domains, undefined);
      assert.equal(webSearch.enable_image_understanding, true);
      xaiContractChecked = true;

      const xaiSold = disagreement
        ? { ...sharedSold, url: "https://www.ebay.com/itm/888888888888" }
        : sharedSold;
      return new Response(
        JSON.stringify({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    sold: [xaiSold],
                    active: [],
                    notes: "Grok independently checked the sale.",
                  }),
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`Unexpected mocked fetch URL: ${url}`);
  }) as typeof fetch;

  try {
    const { getTeacherExactMarketProviders } = await import(
      "../src/lib/instacomp-teacher-market-provider"
    );

    const ai = {
      player: "Franklin Arias",
      year: "2025",
      brand: "Bowman Chrome",
      setName: "Prospects",
      cardNumber: "BCP-67",
      parallel: null,
      serialNumber: null,
      gradingCompany: null,
      gradeValue: null,
      certificationNumber: null,
      certificationLookupUrl: null,
      gradingEvidence: null,
      team: null,
      sport: "baseball",
      isRookie: false,
      isAuto: false,
      isRelic: false,
      conditionGuess: null,
      confidence: 1,
      notes: null,
    };

    const agreed = await getTeacherExactMarketProviders({
      exactTitle: "2025 Bowman Chrome Prospects Franklin Arias #BCP-67",
      ai,
    });
    assert.deepEqual(agreed.configuredTeachers.sort(), ["anthropic", "gemini", "xai"]);
    assert.equal(agreed.requiredVotes, 2);
    assert.equal(agreed.sold.status, "live");
    assert.equal(agreed.sold.results.length, 1);
    assert.equal(agreed.sold.results[0].source, "teacher_consensus_exact_sold");
    assert.equal(agreed.sold.results[0].sourceCategory, "sold");
    assert.equal(agreed.sold.results[0].price, 30);
    assert.ok(agreed.sold.results[0].flags.includes("eligible to teach InstaComp AI"));
    assert.equal(xaiContractChecked, true);

    disagreement = true;
    const disagreed = await getTeacherExactMarketProviders({
      exactTitle: "2025 Bowman Chrome Prospects Franklin Arias #BCP-67",
      ai,
    });
    assert.equal(disagreed.requiredVotes, 2);
    assert.equal(disagreed.sold.status, "no_matches");
    assert.equal(disagreed.sold.results.length, 0);
    assert.ok(disagreed.discovery.sold.length >= 3);

    console.log("InstaComp outside-teacher market consensus regressions passed.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
