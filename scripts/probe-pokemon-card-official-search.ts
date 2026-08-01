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

function snippets(value: string, needle: RegExp, radius = 300) {
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

async function fetchText(url: string, accept?: string) {
  const response = await fetch(url, {
    headers: { ...REQUEST_HEADERS, ...(accept ? { accept } : {}) },
    redirect: "follow",
  });
  return { response, text: await response.text() };
}

function parseApi(text: string) {
  return JSON.parse(text) as {
    result: number;
    regulation: string;
    maxPage: number;
    thisPage: number;
    hitCnt?: number;
    cardList: Array<{
      cardID: string;
      cardNameAltText?: string;
      cardNameViewText?: string;
      cardThumbFile?: string;
    }>;
  };
}

async function main() {
  const page = await fetchText(pageUrl);
  const requested = new URL(page.response.url);
  const apiUrl = new URL("/card-search/resultAPI.php", requested.origin);
  for (const [key, value] of requested.searchParams) {
    apiUrl.searchParams.append(key, value);
  }
  const api = await fetchText(apiUrl.href, "application/json,*/*;q=0.8");
  const parsed = parseApi(api.text);
  const firstCard = parsed.cardList[0];
  const detailUrl = firstCard
    ? new URL(
        `/card-search/details.php/card/${firstCard.cardID}/regu/${parsed.regulation}`,
        requested.origin,
      ).href
    : null;
  const detail = detailUrl ? await fetchText(detailUrl) : null;

  console.log(
    JSON.stringify(
      {
        page: {
          status: page.response.status,
          bytes: Buffer.byteLength(page.text),
          productOptionCount: [...page.text.matchAll(/\{\s*name:\s*["']pg["'],\s*value:\s*["']([^"']*)["'],\s*group:\s*["']group-item-name["'],\s*label:\s*["']([^"']*)["']/g)].length,
        },
        api: {
          url: apiUrl.href,
          status: api.response.status,
          result: parsed.result,
          regulation: parsed.regulation,
          hitCnt: parsed.hitCnt ?? null,
          maxPage: parsed.maxPage,
          thisPage: parsed.thisPage,
          cardListCount: parsed.cardList.length,
          firstCard,
        },
        detail: detail
          ? {
              url: detailUrl,
              status: detail.response.status,
              contentType: detail.response.headers.get("content-type"),
              bytes: Buffer.byteLength(detail.text),
              title: detail.text.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || null,
              snippets: {
                cardName: snippets(detail.text, /フシギダネ|cardName|CardName/gi),
                setCode: snippets(detail.text, /SV2a/gi),
                number: snippets(detail.text, /(?:No\.|カード番号|cardNumber|collector|\/165|165\/)/gi),
                image: snippets(detail.text, /043322|card_images/gi),
              },
            }
          : null,
      },
      null,
      2,
    ),
  );

  if (!page.response.ok || !api.response.ok || (detail && !detail.response.ok)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
