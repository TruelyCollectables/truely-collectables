import http from "node:http";

const PORT = Number(process.env.WNBA_CARD_PROXY_PORT || 4317);
const UPSTREAM = process.env.WNBA_REGISTRY_UPSTREAM_URL ||
  "https://truelycollectables.com/api/internal/checklist-registry/wnba-import";
const MAX_REQUEST_BYTES = 96 * 1024 * 1024;

function clean(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function comparable(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function union(left, right) {
  return [...new Set([...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]
    .map(clean)
    .filter(Boolean))];
}

function canonicalCardKey(card) {
  return [
    clean(card.setSourceKey),
    comparable(card.cardNumber),
    comparable(card.variation),
  ].join(":");
}

function coalescePlan(payload) {
  if (!payload || payload.operation !== "import_required_wnba_checklist" || !payload.plan) {
    return { payload, before: null, after: null };
  }

  const plan = payload.plan;
  if (!Array.isArray(plan.cards) || !Array.isArray(plan.identities)) {
    throw new Error("WNBA import plan is missing cards or identities.");
  }

  const before = plan.cards.length;
  const merged = new Map();
  const sourceKeyRemap = new Map();

  for (const rawCard of plan.cards) {
    const card = { ...rawCard };
    const canonicalKey = canonicalCardKey(card);
    if (!canonicalKey || canonicalKey.startsWith(":")) {
      throw new Error(`Could not canonicalize WNBA card source key ${clean(card.sourceKey)}.`);
    }
    sourceKeyRemap.set(clean(card.sourceKey), canonicalKey);

    const existing = merged.get(canonicalKey);
    if (!existing) {
      merged.set(canonicalKey, {
        ...card,
        sourceKey: canonicalKey,
        players: union([], card.players),
        teams: union([], card.teams),
      });
      continue;
    }

    existing.players = union(existing.players, card.players);
    existing.teams = union(existing.teams, card.teams);
    existing.rookieDesignation = existing.rookieDesignation === true || card.rookieDesignation === true
      ? true
      : existing.rookieDesignation ?? card.rookieDesignation ?? null;
    existing.firstBowmanDesignation = existing.firstBowmanDesignation === true || card.firstBowmanDesignation === true
      ? true
      : existing.firstBowmanDesignation ?? card.firstBowmanDesignation ?? null;
    if (!existing.sourceNotes && card.sourceNotes) existing.sourceNotes = card.sourceNotes;
  }

  plan.cards = [...merged.values()];
  for (const identity of plan.identities) {
    const remapped = sourceKeyRemap.get(clean(identity.cardSourceKey));
    if (!remapped) {
      throw new Error(`Identity references unmapped WNBA card source key ${clean(identity.cardSourceKey)}.`);
    }
    identity.cardSourceKey = remapped;
  }

  if (!plan.validation || !plan.validation.counts) {
    throw new Error("WNBA import plan is missing validation counts.");
  }
  plan.validation.counts.cards = plan.cards.length;

  return { payload, before, after: plan.cards.length };
}

async function readRequest(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) throw new Error("WNBA proxy request exceeded the size limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method !== "POST" || request.url !== "/") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false, message: "Not found." }));
    return;
  }

  try {
    const authorization = request.headers.authorization;
    if (!authorization) throw new Error("OIDC authorization header is missing.");
    const raw = await readRequest(request);
    const incoming = JSON.parse(raw);
    const { payload, before, after } = coalescePlan(incoming);
    const release = clean(payload?.plan?.release?.releaseSlug) || "unknown-release";
    console.log(
      `[wnba-card-coalescer] ${release}: ${before ?? "?"} source cards -> ${after ?? "?"} Registry cards; ${payload?.plan?.identities?.length ?? "?"} identities preserved`,
    );

    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    const text = await upstream.text();
    response.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json",
    });
    response.end(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[wnba-card-coalescer] ${message}`);
    response.writeHead(502, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false, message }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[wnba-card-coalescer] listening on 127.0.0.1:${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
