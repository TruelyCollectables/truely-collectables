const pageUrl =
  process.argv[2] ||
  "https://www.pokemon-card.com/card-search/index.php?mode=statuslist&pg=882";

const REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
  "accept-language": "ja,en-US;q=0.8,en;q=0.6",
  "user-agent":
    "TCOS-Checklist-Registry-Verification/1.0 (+https://totallycollectibles.com)",
};

function unique(values: string[]) {
  return [...new Set(values)].sort();
}

function snippets(value: string, needle: RegExp, radius = 240) {
  const rows: string[] = [];
  for (const match of value.matchAll(needle)) {
    const index = match.index || 0;
    rows.push(
      value
        .slice(Math.max(0, index - radius), Math.min(value.length, index + radius))
        .replace(/\s+/g, " ")
        .trim(),
    );
    if (rows.length >= 16) break;
  }
  return unique(rows);
}

function quotedEndpoints(value: string) {
  return unique(
    [...value.matchAll(/["']([^"']*(?:\.php|\.json|\/api\/|ajax)[^"']*)["']/gi)]
      .map((match) => match[1])
      .filter(Boolean),
  );
}

async function fetchText(url: string, accept?: string) {
  const response = await fetch(url, {
    headers: { ...REQUEST_HEADERS, ...(accept ? { accept } : {}) },
    redirect: "follow",
  });
  return { response, text: await response.text() };
}

function summarizeApi(text: string) {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const cardList = Array.isArray(parsed.cardList)
      ? (parsed.cardList as Array<Record<string, unknown>>)
      : [];
    return {
      validJson: true,
      keys: Object.keys(parsed).sort(),
      result: parsed.result ?? null,
      regulation: parsed.regulation ?? null,
      maxPage: parsed.maxPage ?? null,
      thisPage: parsed.thisPage ?? null,
      hitCount: parsed.hitCount ?? null,
      cardListCount: cardList.length,
      firstCards: cardList.slice(0, 3).map((card) => ({
        keys: Object.keys(card).sort(),
        cardID: card.cardID ?? null,
        cardName: card.cardName ?? card.name ?? null,
        cardThumbFile: card.cardThumbFile ?? null,
        cardNumber: card.cardNumber ?? card.number ?? null,
        expansionMark: card.expansionMark ?? null,
      })),
    };
  } catch (error) {
    return {
      validJson: false,
      error: error instanceof Error ? error.message : String(error),
      preview: text.slice(0, 1200).replace(/\s+/g, " "),
    };
  }
}

async function main() {
  const { response, text: html } = await fetchText(pageUrl);
  const scriptSources = unique(
    [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(
      (match) => match[1],
    ),
  );
  const detailLinks = unique(
    [...html.matchAll(/(?:https?:\/\/www\.pokemon-card\.com)?\/card-search\/details\.php\/card\/\d+[^"'\s<]*/gi)].map(
      (match) => match[0],
    ),
  );

  const scripts = [];
  for (const source of scriptSources.filter((value) => value.includes("card-search"))) {
    const scriptUrl = new URL(source, response.url).href;
    const loaded = await fetchText(scriptUrl);
    scripts.push({
      source,
      url: scriptUrl,
      status: loaded.response.status,
      bytes: Buffer.byteLength(loaded.text),
      endpoints: quotedEndpoints(loaded.text),
      snippets: {
        ajax: snippets(loaded.text, /ajax/gi),
        details: snippets(loaded.text, /details\.php/gi),
        indexPhp: snippets(loaded.text, /index\.php/gi),
        resultApi: snippets(loaded.text, /resultAPI\.php/gi),
      },
    });
  }

  const requested = new URL(response.url);
  const apiUrl = new URL("/card-search/resultAPI.php", requested.origin);
  for (const [key, value] of requested.searchParams) {
    apiUrl.searchParams.append(key, value);
  }
  const api = await fetchText(apiUrl.href, "application/json,*/*;q=0.8");

  console.log(
    JSON.stringify(
      {
        requestedUrl: pageUrl,
        finalUrl: response.url,
        status: response.status,
        contentType: response.headers.get("content-type"),
        bytes: Buffer.byteLength(html),
        detailLinkCount: detailLinks.length,
        scriptSources,
        officialProductOptions: [...html.matchAll(/\{\s*name:\s*["']pg["'],\s*value:\s*["']([^"']*)["'],\s*group:\s*["']group-item-name["'],\s*label:\s*["']([^"']*)["']/g)].slice(0, 6).map((match) => ({ value: match[1], label: match[2] })),
        scripts,
        api: {
          url: apiUrl.href,
          status: api.response.status,
          contentType: api.response.headers.get("content-type"),
          bytes: Buffer.byteLength(api.text),
          summary: summarizeApi(api.text),
        },
      },
      null,
      2,
    ),
  );

  if (
    !response.ok ||
    !api.response.ok ||
    scripts.some((entry) => entry.status >= 400)
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
