import "server-only";

import { createHash } from "node:crypto";
import { Resend } from "resend";
import { getMarketIntelDealWorkbench } from "./market-intel-deals";
import { getMarketIntelDeliveryConfig } from "./market-intel-delivery";
import { createSupabaseServerClient } from "./supabase-server";

const EMAIL_SCHEMA = "tcos.sharkListRankedEmail.v1";
const LIMITS = { verified: 12, hidden: 12, mislisted: 8 };

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value) {
  return String(value ?? "").trim();
}

function html(value) {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function url(value) {
  try {
    const parsed = new URL(text(value));
    return ["http:", "https:"].includes(parsed.protocol)
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function money(value) {
  const parsed = number(value);
  return parsed === null ? "—" : `$${parsed.toFixed(2)}`;
}

function percent(value) {
  const parsed = number(value);
  if (parsed === null) return "—";
  return `${parsed > 0 ? "+" : ""}${parsed.toFixed(1)}%`;
}

function normalized(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formattedTime(value) {
  const date = new Date(text(value));
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function offerAvailable(options) {
  return list(options).some((option) => normalized(option) === "best offer");
}

function lotSignal(candidate) {
  return /\b(lot|lots|collection|bundle|team set|rookie lot|cards pictured|mixed cards)\b/.test(
    normalized(
      [
        candidate.title,
        candidate.lane,
        candidate.itemType,
        ...list(candidate.queryFamilyIds),
      ].join(" "),
    ),
  );
}

function premiumSignal(candidate) {
  return /\b(silver|prizm|refractor|parallel|color|colour|numbered|serial|ssp|sp|case hit|auto|autograph|signature|patch|relic|memorabilia|young guns|rainbow|holo|ice|wave|shimmer|scope|disco|gold|orange|purple|pink|green|red|blue)\b/.test(
    normalized(
      [
        candidate.title,
        candidate.lane,
        candidate.itemType,
        ...list(candidate.queryFamilyIds),
      ].join(" "),
    ),
  );
}

function reviewScore(candidate) {
  const images = list(candidate.imageUrls).filter(url).length;
  const cost = number(candidate.knownDeliveredCost);
  let score = images >= 2 ? 24 : images === 1 ? 12 : 0;
  if (offerAvailable(candidate.buyingOptions)) score += 10;
  if (lotSignal(candidate)) score += 18;
  if (premiumSignal(candidate)) score += 14;
  if (candidate.manualReviewRequired) score += 10;
  score += Math.min(18, list(candidate.queryFamilyIds).length * 6);
  if (cost !== null && cost <= 10) score += 14;
  else if (cost !== null && cost <= 25) score += 10;
  else if (cost !== null && cost <= 50) score += 6;
  score -= Math.min(12, list(candidate.preliminaryRisks).length * 2);
  return Math.max(0, score);
}

function verifiedSort(left, right) {
  return (
    (number(right.buyScore) || 0) - (number(left.buyScore) || 0) ||
    (number(right.expectedNetProfit) || 0) -
      (number(left.expectedNetProfit) || 0) ||
    (number(right.expectedNetRoiPercent) || 0) -
      (number(left.expectedNetRoiPercent) || 0)
  );
}

function reviewSort(left, right) {
  return (
    right.reviewScore - left.reviewScore ||
    (number(left.knownDeliveredCost) ?? Number.POSITIVE_INFINITY) -
      (number(right.knownDeliveredCost) ?? Number.POSITIVE_INFINITY)
  );
}

function catalyst(row) {
  return (
    text(
      row.catalyst ||
        row.catalystReason ||
        row.trendReason ||
        row.whyHot ||
        row.marketMoverReason,
    ) || null
  );
}

function badge(label, background, color) {
  return `<span style="display:inline-block;margin:0 6px 6px 0;padding:5px 8px;border-radius:999px;background:${background};color:${color};font-size:11px;font-weight:900;text-transform:uppercase;">${html(label)}</span>`;
}

function button(directUrl) {
  return `<a href="${html(directUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-size:14px;font-weight:900;padding:12px 18px;border-radius:8px;">OPEN LISTING</a>`;
}

function image(imageUrl, title) {
  return imageUrl
    ? `<img src="${html(imageUrl)}" alt="${html(title)}" style="display:block;width:140px;max-height:210px;object-fit:contain;border:1px solid #ddd;border-radius:10px;background:#fafafa;margin:0 16px 0 0;">`
    : "";
}

function verifiedCard(deal, rank) {
  const title = text(deal.title || deal.exactIdentity || "Verified opportunity");
  const recommendation = deal.makeOfferAvailable
    ? "BUY AT ASKING · MAKE OFFER AVAILABLE"
    : "BUY AT ASKING";
  return `<section style="border:2px solid #65a30d;border-radius:14px;padding:18px;margin:0 0 18px;background:#fff;"><div style="display:flex;align-items:flex-start;">${image(deal.imageUrl, title)}<div style="flex:1;min-width:0;"><div>${badge(`#${rank} VERIFIED SHARK BITE`, "#d9f99d", "#365314")}${deal.makeOfferAvailable ? badge("MAKE OFFER AVAILABLE", "#cffafe", "#155e75") : badge("NO OFFER CONFIRMED", "#f3f4f6", "#4b5563")}</div><h2 style="font-size:20px;line-height:1.3;margin:6px 0 8px;">${html(title)}</h2>${deal.exactIdentity ? `<p style="font-size:13px;color:#525252;margin:0 0 8px;"><strong>Verified identity:</strong> ${html(deal.exactIdentity)}</p>` : ""}<p style="font-size:13px;color:#525252;margin:0 0 8px;"><strong>Marketplace:</strong> ${html(deal.marketplace || "Unknown")} · <strong>Seller:</strong> ${html(deal.sellerName || "Unknown")} · <strong>Asking:</strong> ${html(money(deal.itemPrice))} · <strong>Shipping:</strong> ${html(money(deal.shipping))}</p>${catalyst(deal) ? `<p style="font-size:13px;background:#fef3c7;border-radius:8px;padding:8px 10px;margin:0 0 10px;"><strong>Why hot:</strong> ${html(catalyst(deal))}</p>` : ""}<p style="font-size:14px;line-height:1.6;margin:0 0 8px;"><strong>Delivered:</strong> ${html(money(deal.deliveredCost))} · <strong>Market:</strong> ${html(money(deal.conservativeResale))} · <strong>Expected net:</strong> ${html(money(deal.expectedNetProfit))} · <strong>ROI:</strong> ${html(percent(deal.expectedNetRoiPercent))}</p><p style="font-size:12px;color:#525252;margin:0 0 12px;">Buy Score ${number(deal.buyScore)?.toFixed(0) || "—"} · Exact sold comps ${number(deal.exactSoldCount)?.toFixed(0) || "0"} · Confidence ${number(deal.compConfidence)?.toFixed(0) || "0"}% · <strong>${html(recommendation)}</strong></p>${button(deal.directUrl)}</div></div></section>`;
}

function reviewCard(candidate, rank, hidden) {
  const title = text(candidate.title || "Manual review listing");
  const label = hidden
    ? "Potental Hidden Gems in Photo"
    : "MISLISTING / LOT LEAD";
  const explanation = hidden
    ? "Target-player lot with usable photos plus lot/premium signals. Inspect the pictures and obtain exact front/back proof before treating it as a deal."
    : "Promising misspelling, incomplete-title, or misinterpreted-listing lead. Identity and economics remain unverified.";
  return `<section style="border:1px solid ${hidden ? "#f59e0b" : "#8b5cf6"};border-radius:14px;padding:18px;margin:0 0 18px;background:#fff;"><div style="display:flex;align-items:flex-start;">${image(candidate.imageUrls[0], title)}<div style="flex:1;min-width:0;"><div>${badge(`#${rank} ${label}`, hidden ? "#fde68a" : "#ddd6fe", hidden ? "#78350f" : "#4c1d95")}${candidate.makeOfferAvailable ? badge("MAKE OFFER AVAILABLE", "#cffafe", "#155e75") : badge("NO OFFER CONFIRMED", "#f3f4f6", "#4b5563")}</div><h2 style="font-size:19px;line-height:1.3;margin:6px 0 8px;">${html(title)}</h2><p style="font-size:13px;color:#525252;margin:0 0 8px;"><strong>Player:</strong> ${html(candidate.watchedPerson || "Tracked player")} · <strong>Marketplace:</strong> ${html(candidate.marketplace || "Unknown")} · <strong>Seller:</strong> ${html(candidate.sellerName || "Unknown")}</p><p style="font-size:13px;color:#525252;margin:0 0 8px;"><strong>Asking:</strong> ${html(money(candidate.itemPrice))} · <strong>Shipping:</strong> ${html(money(candidate.inboundShipping))} · <strong>Known delivered:</strong> ${html(money(candidate.knownDeliveredCost))} · <strong>Review priority:</strong> ${candidate.reviewScore}</p>${catalyst(candidate) ? `<p style="font-size:13px;background:#fef3c7;border-radius:8px;padding:8px 10px;margin:0 0 10px;"><strong>Why hot:</strong> ${html(catalyst(candidate))}</p>` : ""}<p style="font-size:13px;line-height:1.55;color:#404040;margin:0 0 10px;">${html(explanation)}</p><p style="font-size:12px;color:#991b1b;font-weight:800;margin:0 0 12px;">MANUAL REVIEW ONLY — unverified contents receive $0 projected value and are excluded from verified deal totals.</p>${button(candidate.listingUrl)}</div></div></section>`;
}

function heading(eyebrow, title, detail) {
  return `<div style="margin:28px 0 12px;"><div style="font-size:11px;font-weight:900;letter-spacing:.12em;color:#4d7c0f;text-transform:uppercase;">${html(eyebrow)}</div><h2 style="font-size:24px;margin:4px 0;">${html(title)}</h2><p style="font-size:13px;color:#525252;margin:0;">${html(detail)}</p></div>`;
}

function buildEmail(report, verified, hidden, mislisted) {
  const subject = verified.length
    ? `TCOS Shark List — ${verified.length} verified Shark Bite${verified.length === 1 ? "" : "s"}`
    : hidden.length
      ? `TCOS Shark List — ${hidden.length} photo-review lead${hidden.length === 1 ? "" : "s"}`
      : `TCOS Shark List — ${mislisted.length} mislisting lead${mislisted.length === 1 ? "" : "s"}`;
  let rank = 1;
  const cards = [];
  const plain = [
    "TCOS Shark List™ — Ranked Email",
    `Report generated: ${formattedTime(report.generated_at)}`,
    `Verified: ${verified.length} | Potental Hidden Gems in Photo: ${hidden.length} | Mislisting/lot leads: ${mislisted.length}`,
    "",
  ];

  if (verified.length) {
    cards.push(
      heading(
        "Verified economics",
        "VERIFIED SHARK BITES",
        "Exact identity and completed-sale evidence cleared the profit gates. Ranked strongest first.",
      ),
    );
    for (const deal of verified) {
      cards.push(verifiedCard(deal, rank));
      plain.push(
        `${rank}. VERIFIED SHARK BITE — ${text(deal.title || deal.exactIdentity)}`,
        `Delivered ${money(deal.deliveredCost)} | Market ${money(deal.conservativeResale)} | Net ${money(deal.expectedNetProfit)} | ROI ${percent(deal.expectedNetRoiPercent)} | Buy Score ${number(deal.buyScore)?.toFixed(0) || "—"}`,
        deal.makeOfferAvailable
          ? "MAKE OFFER AVAILABLE"
          : "NO OFFER CONFIRMED",
        `OPEN LISTING: ${deal.directUrl}`,
        "",
      );
      rank += 1;
    }
  }

  if (hidden.length) {
    cards.push(
      heading(
        "Manual photo review",
        "Potental Hidden Gems in Photo",
        "Target-player lots and broad listings with usable photos. These are not verified deals yet.",
      ),
    );
    for (const candidate of hidden) {
      cards.push(reviewCard(candidate, rank, true));
      plain.push(
        `${rank}. Potental Hidden Gems in Photo — ${candidate.title}`,
        `Player ${candidate.watchedPerson || "Tracked player"} | Delivered ${money(candidate.knownDeliveredCost)} | Review priority ${candidate.reviewScore}`,
        candidate.makeOfferAvailable
          ? "MAKE OFFER AVAILABLE"
          : "NO OFFER CONFIRMED",
        "MANUAL REVIEW ONLY — no projected value until exact front/back proof.",
        `OPEN LISTING: ${candidate.listingUrl}`,
        "",
      );
      rank += 1;
    }
  }

  if (mislisted.length) {
    cards.push(
      heading(
        "Mislisting attack lane",
        "MISSPELLINGS / MISLISTINGS / MISINTERPRETED LOTS",
        "Promising leads ranked for manual verification. Seller wording is not identity proof.",
      ),
    );
    for (const candidate of mislisted) {
      cards.push(reviewCard(candidate, rank, false));
      plain.push(
        `${rank}. MISLISTING / LOT LEAD — ${candidate.title}`,
        `Player ${candidate.watchedPerson || "Tracked player"} | Delivered ${money(candidate.knownDeliveredCost)} | Review priority ${candidate.reviewScore}`,
        candidate.makeOfferAvailable
          ? "MAKE OFFER AVAILABLE"
          : "NO OFFER CONFIRMED",
        "MANUAL REVIEW ONLY — identity and profit unverified.",
        `OPEN LISTING: ${candidate.listingUrl}`,
        "",
      );
      rank += 1;
    }
  }

  return {
    subject,
    text: plain.join("\n"),
    html: `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#111;"><div style="max-width:820px;margin:0 auto;padding:24px;"><header style="background:#101418;color:#fff;border-radius:16px;padding:24px;"><div style="font-size:12px;font-weight:900;letter-spacing:.13em;color:#bef264;text-transform:uppercase;">TCOS Market Intel™</div><h1 style="font-size:30px;margin:8px 0 6px;">Shark List™</h1><p style="color:#d4d4d4;margin:0;">Ranked best opportunity down · ${html(formattedTime(report.generated_at))}</p><p style="color:#d4d4d4;margin:8px 0 0;">${verified.length} verified · ${hidden.length} photo review · ${mislisted.length} mislisting/lot leads</p></header>${cards.join("")}<footer style="font-size:11px;line-height:1.5;color:#737373;text-align:center;padding:18px 10px;">Private market intelligence for Truely Collectables. No purchase is automatic. Seller wording is untrusted until exact front/back identity proof is complete.</footer></div></body></html>`,
  };
}

function fingerprint(verified, hidden, mislisted) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schema: EMAIL_SCHEMA,
        verified: verified.map((row) => [
          row.listingId,
          row.directUrl,
          number(row.deliveredCost),
          number(row.expectedNetProfit),
          number(row.buyScore),
          row.makeOfferAvailable,
        ]),
        hidden: hidden.map((row) => [
          row.candidateId,
          row.listingUrl,
          number(row.knownDeliveredCost),
          row.reviewScore,
          row.makeOfferAvailable,
        ]),
        mislisted: mislisted.map((row) => [
          row.candidateId,
          row.listingUrl,
          number(row.knownDeliveredCost),
          row.reviewScore,
          row.makeOfferAvailable,
        ]),
      }),
    )
    .digest("hex");
}

async function reportRow(reportId) {
  const supabase = createSupabaseServerClient({ admin: true });
  let query = supabase
    .from("tcos_mi_report_runs")
    .select("*")
    .eq("report_type", "hourly_deals");
  query = reportId
    ? query.eq("id", reportId)
    : query.order("generated_at", { ascending: false }).limit(1);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function liveListings() {
  try {
    const { listings } = await getMarketIntelDealWorkbench();
    return new Map(listings.map((row) => [text(row.id), row]));
  } catch {
    return new Map();
  }
}

function normalizeVerified(row, listingById) {
  const deal = record(row);
  const listing = listingById.get(text(deal.listingId));
  return {
    ...deal,
    directUrl: url(deal.directUrl || listing?.direct_url),
    makeOfferAvailable:
      text(listing?.listing_format).toLowerCase() === "best_offer",
    imageUrl:
      list(listing?.metadata?.image_urls).map(url).find(Boolean) ||
      list(listing?.metadata?.images).map(url).find(Boolean) ||
      null,
  };
}

function normalizeCandidate(row) {
  const candidate = record(row);
  return {
    ...candidate,
    listingUrl: url(candidate.listingUrl),
    imageUrls: list(candidate.imageUrls).map(url).filter(Boolean),
    makeOfferAvailable: offerAvailable(candidate.buyingOptions),
    reviewScore: reviewScore(candidate),
  };
}

export async function sendRankedProfitHunterEmail(options = {}) {
  const report = await reportRow(options.reportId);
  if (!report) {
    return {
      attempted: false,
      delivered: false,
      skipped: true,
      reason: "No Profit Hunter hourly report is available.",
    };
  }

  const data = record(report.report_json);
  const listingById = await liveListings();
  const verified = list(data.actionableDeals)
    .map((row) => normalizeVerified(row, listingById))
    .filter((row) => row.directUrl)
    .sort(verifiedSort)
    .slice(0, LIMITS.verified);
  const candidates = list(data.discoveryCandidates)
    .map(normalizeCandidate)
    .filter((row) => row.listingUrl)
    .sort(reviewSort);
  const hidden = candidates
    .filter(
      (row) =>
        row.imageUrls.length > 0 &&
        lotSignal(row) &&
        (row.manualReviewRequired || premiumSignal(row)),
    )
    .slice(0, LIMITS.hidden);
  const hiddenIds = new Set(hidden.map((row) => row.candidateId));
  const mislisted = candidates
    .filter(
      (row) =>
        !hiddenIds.has(row.candidateId) &&
        (row.manualReviewRequired ||
          list(row.preliminaryRisks).length > 0 ||
          list(row.queryFamilyIds).length > 1),
    )
    .slice(0, LIMITS.mislisted);

  if (!verified.length && !hidden.length && !mislisted.length) {
    return {
      attempted: false,
      delivered: false,
      skipped: true,
      reason: "No ranked Shark List opportunities or manual-review leads were available.",
    };
  }

  const contentFingerprint = fingerprint(verified, hidden, mislisted);
  const metadata = record(report.metadata);
  if (
    !options.force &&
    text(metadata.ranked_shark_email_fingerprint) === contentFingerprint
  ) {
    return {
      attempted: false,
      delivered: false,
      skipped: true,
      reason: "The ranked Shark List email is unchanged from the last delivery.",
      fingerprint: contentFingerprint,
    };
  }

  const config = getMarketIntelDeliveryConfig();
  if (!config.enabled) {
    return {
      attempted: false,
      delivered: false,
      skipped: true,
      reason: "Market Intel email delivery is disabled.",
    };
  }
  if (!config.configured || !config.apiKey || !config.from) {
    return {
      attempted: false,
      delivered: false,
      skipped: true,
      reason: `Market Intel email delivery is not configured. Missing: ${config.missing.join(", ")}.`,
    };
  }

  const email = buildEmail(report, verified, hidden, mislisted);
  const resend = new Resend(config.apiKey);
  const { data: sent, error } = await resend.emails.send({
    from: config.from,
    to: config.recipients,
    subject: email.subject.slice(0, 180),
    text: email.text,
    html: email.html,
  });
  if (error || !sent?.id) {
    return {
      attempted: true,
      delivered: false,
      skipped: false,
      reason: error?.message || "Resend did not return an email ID.",
    };
  }

  const sentAt = new Date().toISOString();
  const supabase = createSupabaseServerClient({ admin: true });
  const { error: updateError } = await supabase
    .from("tcos_mi_report_runs")
    .update({
      delivered_at: sentAt,
      metadata: {
        ...metadata,
        ranked_shark_email_schema: EMAIL_SCHEMA,
        ranked_shark_email_fingerprint: contentFingerprint,
        ranked_shark_email_id: sent.id,
        ranked_shark_email_sent_at: sentAt,
        ranked_shark_email_recipients: config.recipients,
        ranked_shark_email_counts: {
          verified: verified.length,
          potential_hidden_gems: hidden.length,
          mislisting_leads: mislisted.length,
        },
      },
    })
    .eq("id", report.id);

  return {
    attempted: true,
    delivered: true,
    skipped: false,
    emailId: sent.id,
    recipients: config.recipients,
    fingerprint: contentFingerprint,
    counts: {
      verified: verified.length,
      potentialHiddenGems: hidden.length,
      mislistingLeads: mislisted.length,
    },
    warning: updateError
      ? `Email delivered, but report metadata was not updated: ${updateError.message}`
      : null,
  };
}
