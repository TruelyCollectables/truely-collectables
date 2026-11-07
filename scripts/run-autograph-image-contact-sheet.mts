import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { classifyStorefrontItem } from "../src/lib/storefront-taxonomy.ts";

type Row = Record<string, any>;

function parseEnvFile(file: string) {
  const parsed: Record<string, string> = {};
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function titleLines(value: unknown, maxLength = 76) {
  const title = String(value ?? "").replace(/\s+/g, " ").trim();
  const words = title.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > 35 && current) {
      lines.push(current);
      current = word;
      if (lines.length === 2) break;
    } else {
      current = candidate;
    }
  }
  if (current && lines.length < 2) lines.push(current);
  const joined = lines.join(" ");
  if (joined.length < title.length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, Math.max(0, maxLength - joined.length + lines[lines.length - 1].length - 1))}…`;
  }
  return lines.slice(0, 2);
}

async function queryProductionCatalog(params: {
  projectRef: string;
  accessToken: string;
}) {
  const endpoint = `https://api.supabase.com/v1/projects/${params.projectRef}/database/query`;
  const query = `
    select json_build_object(
      'products', coalesce((
        select json_agg(json_build_object(
          'id', p.id,
          'sku', p.sku,
          'title', p.title,
          'description', p.description,
          'price', p.price,
          'quantity', p.quantity,
          'archived_at', p.archived_at,
          'sport', p.sport,
          'ebay_item_id', p.ebay_item_id,
          'image_url', p.image_url
        ) order by p.id)
        from public.products p
      ), '[]'::json),
      'inventory_items', coalesce((
        select json_agg(json_build_object(
          'id', i.id,
          'legacy_product_id', i.legacy_product_id,
          'sku', i.sku,
          'title', i.title,
          'description', i.description,
          'category', i.category,
          'metadata', i.metadata
        ) order by i.id)
        from public.inventory_items i
      ), '[]'::json),
      'inventory_images', coalesce((
        select json_agg(json_build_object(
          'id', x.id,
          'inventory_item_id', x.inventory_item_id,
          'image_url', x.image_url,
          'sort_order', x.sort_order,
          'is_primary', x.is_primary
        ) order by x.inventory_item_id, x.sort_order, x.id)
        from public.inventory_images x
      ), '[]'::json)
    ) as payload;
  `;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, parameters: [], read_only: true }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Supabase autograph image query failed with HTTP ${response.status}: ${body.slice(0, 1000)}`,
    );
  }
  const result = body ? JSON.parse(body) : [];
  const rawPayload = result?.[0]?.payload;
  const payload =
    typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;
  if (!payload) throw new Error("Autograph image query returned no payload");
  return {
    products: payload.products as Row[],
    inventoryItems: payload.inventory_items as Row[],
    inventoryImages: payload.inventory_images as Row[],
  };
}

async function downloadImage(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; TruelyCollectablesTaxonomyAudit/1.0)",
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Image download failed with HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

const envFile = process.env.PRODUCTION_ENV_FILE;
const outputDir = process.env.AUTOGRAPH_SHEET_DIR;
const accessToken = process.env.GH_SUPABASE_ACCESS_TOKEN;
if (!envFile || !outputDir || !accessToken) {
  throw new Error(
    "PRODUCTION_ENV_FILE, AUTOGRAPH_SHEET_DIR, and GH_SUPABASE_ACCESS_TOKEN are required",
  );
}
const env = parseEnvFile(envFile);
const productionUrl = env.NEXT_PUBLIC_SUPABASE_URL;
if (!productionUrl || !/^https:\/\//.test(productionUrl)) {
  throw new Error("Production NEXT_PUBLIC_SUPABASE_URL was not pulled");
}
const projectRef = new URL(productionUrl).hostname.split(".")[0];
const { products, inventoryItems, inventoryImages } =
  await queryProductionCatalog({ projectRef, accessToken });

const inventoryByLegacyId = new Map<number, Row>();
const inventoryBySku = new Map<string, Row>();
for (const item of inventoryItems) {
  const legacyId = Number(item.legacy_product_id);
  if (item.legacy_product_id !== null && Number.isFinite(legacyId)) {
    inventoryByLegacyId.set(legacyId, item);
  }
  const sku = String(item.sku || "").trim();
  if (sku) inventoryBySku.set(sku, item);
}
const imagesByInventoryId = new Map<string, Row[]>();
for (const image of inventoryImages) {
  const key = String(image.inventory_item_id || "");
  if (!key) continue;
  const rows = imagesByInventoryId.get(key) || [];
  rows.push(image);
  imagesByInventoryId.set(key, rows);
}

const candidates: Row[] = [];
for (const product of products) {
  if (
    Number(product.quantity || 0) <= 0 ||
    Number(product.price || 0) <= 0 ||
    product.archived_at
  ) {
    continue;
  }
  const sku = String(product.sku || "").trim();
  const inventory =
    inventoryByLegacyId.get(Number(product.id)) ||
    (sku ? inventoryBySku.get(sku) : undefined);
  const metadata = record(inventory?.metadata);
  const title = String(inventory?.title || product.title || "Untitled");
  const classification = classifyStorefrontItem({
    title,
    description: inventory?.description ?? product.description ?? null,
    rawSport: product.sport,
    primaryCategory: inventory?.category ?? null,
    metadata,
  });
  if (!classification.features.autograph) continue;

  const imageRows = inventory?.id
    ? (imagesByInventoryId.get(String(inventory.id)) || [])
        .slice()
        .sort(
          (left, right) =>
            Number(right.is_primary) - Number(left.is_primary) ||
            Number(left.sort_order || 0) - Number(right.sort_order || 0),
        )
    : [];
  const imageUrl = String(
    imageRows.find((row) => String(row.image_url || "").trim())?.image_url ||
      product.image_url ||
      "",
  ).trim();
  candidates.push({
    id: Number(product.id),
    ebayItemId: product.ebay_item_id ?? null,
    title,
    section: classification.section,
    imageUrl,
  });
}

fs.mkdirSync(outputDir, { recursive: true });
const cellWidth = 400;
const cellHeight = 520;
const imageWidth = 370;
const imageHeight = 410;
const columns = 4;
const rowsPerSheet = 4;
const perSheet = columns * rowsPerSheet;
const sheetWidth = cellWidth * columns;
const sheetHeight = cellHeight * rowsPerSheet;
const manifest: Row[] = [];

for (let sheetIndex = 0; sheetIndex * perSheet < candidates.length; sheetIndex += 1) {
  const page = candidates.slice(sheetIndex * perSheet, (sheetIndex + 1) * perSheet);
  const composites: sharp.OverlayOptions[] = [];

  for (let index = 0; index < page.length; index += 1) {
    const candidate = page[index];
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * cellWidth;
    const top = row * cellHeight;
    let imageBuffer: Buffer;
    let imageError: string | null = null;
    try {
      if (!candidate.imageUrl) throw new Error("No image URL");
      const downloaded = await downloadImage(candidate.imageUrl);
      imageBuffer = await sharp(downloaded)
        .rotate()
        .resize(imageWidth, imageHeight, {
          fit: "contain",
          background: { r: 245, g: 245, b: 245, alpha: 1 },
        })
        .jpeg({ quality: 90 })
        .toBuffer();
    } catch (error) {
      imageError = error instanceof Error ? error.message : String(error);
      imageBuffer = await sharp({
        create: {
          width: imageWidth,
          height: imageHeight,
          channels: 3,
          background: { r: 235, g: 235, b: 235 },
        },
      })
        .composite([
          {
            input: Buffer.from(
              `<svg width="${imageWidth}" height="${imageHeight}"><text x="20" y="200" font-family="sans-serif" font-size="22">IMAGE UNAVAILABLE</text></svg>`,
            ),
          },
        ])
        .jpeg()
        .toBuffer();
    }

    composites.push({ input: imageBuffer, left: left + 15, top: top + 10 });
    const lines = titleLines(candidate.title);
    const label = Buffer.from(
      `<svg width="${cellWidth}" height="100">
        <rect width="100%" height="100%" fill="white"/>
        <text x="12" y="22" font-family="sans-serif" font-size="17" font-weight="700">ID ${escapeXml(candidate.id)} · ${escapeXml(candidate.section)}</text>
        <text x="12" y="48" font-family="sans-serif" font-size="14">${escapeXml(lines[0] || "")}</text>
        <text x="12" y="70" font-family="sans-serif" font-size="14">${escapeXml(lines[1] || "")}</text>
        <text x="12" y="92" font-family="sans-serif" font-size="11" fill="#555">${escapeXml(candidate.ebayItemId || "")}</text>
      </svg>`,
    );
    composites.push({ input: label, left, top: top + 418 });
    manifest.push({
      ...candidate,
      sheet: sheetIndex + 1,
      position: index + 1,
      imageError,
    });
  }

  const output = path.join(
    outputDir,
    `autograph-sheet-${String(sheetIndex + 1).padStart(2, "0")}.jpg`,
  );
  await sharp({
    create: {
      width: sheetWidth,
      height: sheetHeight,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 90 })
    .toFile(output);
}

fs.writeFileSync(
  path.join(outputDir, "autograph-image-manifest.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      candidateCount: candidates.length,
      sheetCount: Math.ceil(candidates.length / perSheet),
      imageFailures: manifest.filter((row) => row.imageError).length,
      candidates: manifest,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      candidateCount: candidates.length,
      sheetCount: Math.ceil(candidates.length / perSheet),
      imageFailures: manifest.filter((row) => row.imageError).length,
      outputDir,
    },
    null,
    2,
  ),
);
