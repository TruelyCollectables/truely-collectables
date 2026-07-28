import { createHmac } from "node:crypto";

const root = String(process.env.ADMIN_SESSION_SECRET || "").trim();
const explicit = String(process.env.TCOS_CONNECTOR_TOKEN || "").trim();
const token = explicit || (root
  ? createHmac("sha256", root)
      .update("TCOS Profit Hunter connector bearer v1", "utf8")
      .digest("base64url")
  : "");
if (!token) throw new Error("Production connector token could not be derived.");

const endpoint = new URL(
  "/api/tcos-profit-hunter/mcp",
  String(process.env.PRODUCTION_URL || "https://truelycollectables.com"),
);
let sessionId = null;

function parseResponse(contentType, text) {
  if (!text.trim()) return [];
  if (contentType.includes("application/json")) {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : [value];
  }
  if (contentType.includes("text/event-stream")) {
    return text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  throw new Error(
    `Unexpected MCP content type: ${contentType || "NONE"}; body=${text.slice(0, 800)}`,
  );
}

async function post(message, label) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
    redirect: "error",
  });
  const text = await response.text();
  const contentType = String(response.headers.get("content-type") || "");
  const returnedSession = response.headers.get("mcp-session-id");
  if (returnedSession) sessionId = returnedSession;
  console.log(
    `${label}: HTTP=${response.status} type=${contentType.split(";")[0]} session=${Boolean(sessionId)}`,
  );
  if (!response.ok) {
    throw new Error(
      `${label} failed: HTTP ${response.status}; body=${text.slice(0, 1200)}`,
    );
  }
  return parseResponse(contentType, text);
}

try {
  const initialized = await post(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "tcos-production-verifier", version: "1.0.0" },
      },
    },
    "initialize",
  );
  const initResult = initialized.find((message) => message.id === 1);
  if (!initResult?.result) {
    throw new Error(
      `Initialize returned no result: ${JSON.stringify(initialized).slice(0, 1200)}`,
    );
  }

  await post(
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    },
    "initialized-notification",
  );

  const toolMessages = await post(
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    "tools-list",
  );
  const toolResult = toolMessages.find((message) => message.id === 2)?.result;
  const names = (toolResult?.tools || []).map((tool) => tool.name).sort();
  for (const name of [
    "profit_hunter_status",
    "search_profit_hunter_candidates",
    "verify_profit_hunter_listing",
  ]) {
    if (!names.includes(name)) {
      throw new Error(`Missing MCP tool: ${name}; found=${names.join(",")}`);
    }
  }

  const statusMessages = await post(
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "profit_hunter_status", arguments: {} },
    },
    "profit-hunter-status",
  );
  const statusResult = statusMessages.find((message) => message.id === 3)?.result;
  const textPayload = statusResult?.content?.find(
    (entry) => entry.type === "text",
  )?.text;
  if (!textPayload) {
    throw new Error(
      `Status tool returned no text: ${JSON.stringify(statusResult).slice(0, 1200)}`,
    );
  }
  const payload = JSON.parse(textPayload);
  if (payload?.hardenedInstaComp?.configured !== true) {
    throw new Error(
      `Hardened InstaComp is not configured: ${JSON.stringify(payload?.hardenedInstaComp)}`,
    );
  }
  if (payload?.purchaseWritesEnabled !== false) {
    throw new Error("Profit Hunter unexpectedly exposes purchase writes.");
  }
  if (
    !payload?.discovery?.openAiPublicWeb &&
    !payload?.discovery?.ebayBrowse &&
    !payload?.discovery?.xRecentSearch
  ) {
    throw new Error(
      `No automatic discovery provider is configured: ${JSON.stringify(payload?.discovery)}`,
    );
  }

  console.log(
    JSON.stringify({
      connected: true,
      tools: names,
      hardenedInstaCompConfigured: true,
      automaticDiscoveryConfigured: true,
      purchaseWritesEnabled: false,
    }),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`PROFIT_HUNTER_PRODUCTION_VERIFY_FAILED: ${message}`);
  process.exit(1);
}
