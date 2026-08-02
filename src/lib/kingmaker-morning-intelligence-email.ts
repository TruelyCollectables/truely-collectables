import type { KingmakerMorningIntelligencePayload } from "./kingmaker-morning-intelligence";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `$${value.toFixed(2)}`;
}

function percent(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function safeHref(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function itemCard(
  title: string,
  detail: string,
  href: string | null | undefined,
  metrics: string[],
) {
  const link = safeHref(href);
  return `<article style="margin:0 0 14px;padding:16px;border:1px solid #27313b;border-radius:14px;background:#0d1218"><h3 style="margin:0 0 7px;color:#f8fafc;font-size:17px;line-height:1.35">${escapeHtml(title)}</h3><p style="margin:0;color:#a7b0ba;font-size:13px;line-height:1.55">${escapeHtml(detail)}</p>${metrics.length ? `<p style="margin:9px 0 0;color:#fbbf24;font-size:12px;font-weight:800">${metrics.map(escapeHtml).join(" · ")}</p>` : ""}${link ? `<a href="${escapeHtml(link)}" style="display:inline-block;margin-top:12px;padding:9px 13px;border-radius:999px;background:#34d399;color:#042f2e;text-decoration:none;font-size:12px;font-weight:900">OPEN INTELLIGENCE ↗</a>` : ""}</article>`;
}

function section(title: string, count: number, cards: string[]) {
  if (!cards.length) return "";
  return `<section style="margin-top:24px"><p style="margin:0;color:#34d399;font-size:10px;font-weight:900;letter-spacing:.18em;text-transform:uppercase">${escapeHtml(title)}</p><h2 style="margin:5px 0 12px;color:#f8fafc;font-size:23px">${count} ${escapeHtml(title.toLowerCase())}</h2>${cards.join("")}</section>`;
}

export function renderKingmakerMorningIntelligenceEmail(
  payload: KingmakerMorningIntelligencePayload,
) {
  const actionableCards = payload.actionableDeals.map((item) =>
    itemCard(item.title, item.detail, item.href, [
      `Expected profit ${money(item.expectedProfit)}`,
      `ROI ${percent(item.roiPercent)}`,
      item.confidence === null || item.confidence === undefined
        ? "Confidence —"
        : `Confidence ${(item.confidence * 100).toFixed(0)}%`,
    ]),
  );
  const changeCards = payload.meaningfulChanges.map((item) =>
    itemCard(item.title, item.detail, item.href, [item.severity.toUpperCase()]),
  );
  const portfolioCards = payload.portfolioMovements.map((item) =>
    itemCard(item.title, item.detail, item.href, [
      item.movementType.replaceAll("_", " ").toUpperCase(),
      item.amount === null || item.amount === undefined
        ? ""
        : `Amount ${money(item.amount)}`,
    ].filter(Boolean)),
  );
  const warningCards = payload.warnings.map((warning) =>
    itemCard("Truth / system warning", warning, null, ["OWNER REVIEW REQUIRED"]),
  );

  const textLines = [
    "PROJECT KINGMAKER BETA 1.0",
    payload.subject,
    payload.headline,
    `Generated: ${payload.generatedAt}`,
    "",
  ];
  for (const [label, items] of [
    ["ACTIONABLE DEALS", payload.actionableDeals],
    ["MEANINGFUL CHANGES", payload.meaningfulChanges],
  ] as const) {
    if (!items.length) continue;
    textLines.push(label);
    items.forEach((item, index) => {
      textLines.push(`${index + 1}. ${item.title}`, item.detail, item.href || "", "");
    });
  }
  if (payload.portfolioMovements.length) {
    textLines.push("PORTFOLIO MOVEMENT");
    payload.portfolioMovements.forEach((item, index) => {
      textLines.push(`${index + 1}. ${item.title}`, item.detail, item.href || "", "");
    });
  }
  if (payload.warnings.length) {
    textLines.push("WARNINGS", ...payload.warnings.map((warning) => `- ${warning}`), "");
  }
  textLines.push("Searches discover. KINGMAKER decides. Purchase Ledger owns. Outcomes teach.");

  const html = `<!doctype html><html><body style="margin:0;background:#05070a;font-family:Arial,Helvetica,sans-serif;color:#f8fafc"><div style="max-width:820px;margin:0 auto;padding:24px"><header style="padding:24px;border:1px solid #27313b;border-radius:18px;background:linear-gradient(135deg,#0a0f14,#111820)"><p style="margin:0;color:#fbbf24;font-size:10px;font-weight:900;letter-spacing:.2em;text-transform:uppercase">Project KINGMAKER Beta 1.0</p><h1 style="margin:8px 0 6px;font-size:30px;line-height:1.15">${escapeHtml(payload.subject)}</h1><p style="margin:0;color:#a7b0ba;font-size:15px;line-height:1.55">${escapeHtml(payload.headline)}</p><p style="margin:12px 0 0;color:#64748b;font-size:11px">${escapeHtml(payload.generatedAt)} · ${escapeHtml(payload.mode.toUpperCase())}</p></header>${section("Actionable Deals", actionableCards.length, actionableCards)}${section("Meaningful Changes", changeCards.length, changeCards)}${section("Portfolio Movement", portfolioCards.length, portfolioCards)}${section("Warnings", warningCards.length, warningCards)}<footer style="margin-top:24px;padding:18px;border-top:1px solid #27313b;color:#64748b;font-size:11px;line-height:1.55;text-align:center">Searches discover. KINGMAKER decides. Purchase Ledger owns. Outcomes teach.<br>No purchase is automatic. Unverified evidence remains research-only.</footer></div></body></html>`;

  return {
    subject: payload.subject.slice(0, 180),
    text: textLines.filter(Boolean).join("\n"),
    html,
  };
}
