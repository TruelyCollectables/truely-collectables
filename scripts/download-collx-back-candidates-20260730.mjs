import fs from "node:fs/promises";
import path from "node:path";

const bucket = "cdp-batches-prod";
const outputRoot = process.env.OUTPUT_DIR || "collx-back-candidates";
const targets = [
  { productId: 1682, batch: "46404-645610", front: "32476148-front.jpg", title: "2014-15 Flawless Nick Van Exel Momentous Autographed Memorabilia /20" },
  { productId: 1692, batch: "46404-645610", front: "32466275-front.jpg", title: "2017-18 Ultimate Collection Alex Tuch Ultimate Introductions RC Onyx /25" },
  { productId: 1863, batch: "46404-645610", front: "32463002-front.jpg", title: "2017-18 The Cup Alex Tuch RC Exquisite Endorsements Autograph Relics /50" },
  { productId: 1983, batch: "46404-645610", front: "32463004-front.jpg", title: "2019-20 Upper Deck #443 Alex Tuch UD High Gloss #/10" },
  { productId: 1988, batch: "46404-645610", front: "32476146-front.jpg", title: "2018-19 Panini Impeccable #IN-NVE Nick Van Exel Indelible Ink Holo Gold /10" },
  { productId: 2003, batch: "46404-645610", front: "32455992-front.jpg", title: "2013-14 Panini Timeless Treasures #18 Nick Van Exel Treasured Ink /15" },
  { productId: 2019, batch: "46404-645610", front: "32463001-front.jpg", title: "2017-18 Upper Deck Synergy #NN-26 Alex Tuch Noteworthy Newcomers Red /24" },
  { productId: 2210, batch: "46404-645610", front: "32476149-front.jpg", title: "2016-17 Panini Flawless #EX-NVE Nick Van Exel Excellence Signatures Ruby /15" },
  { productId: 2240, batch: "46404-645610", front: "32476145-front.jpg", title: "2019-20 Panini Noir #RN-NVE Nick Van Exel Reigning Nights Signatures /99" },
  { productId: 2291, batch: "46404-645610", front: "32476152-front.jpg", title: "2016-17 Panini Flawless #EX-NVE Nick Van Exel Excellence Signatures Gold /10" },

  { productId: 1709, batch: "46404-650660", front: "32752674-front.jpg", title: "2019-20 Panini National Treasures S-NVE Nick Van Exel Signatures Bronze /25 AUTO" },
  { productId: 1723, batch: "46404-650660", front: "32752675-front.jpg", title: "2015-16 Panini #TC-NVE Nick Van Exel Totally Certified Auto /25" },
  { productId: 1779, batch: "46404-650660", front: "32752666-front.jpg", title: "2020-21 Artifacts Alex Tuch 2010-11 10th Anniversary Retro Auto Facts /49" },
  { productId: 2094, batch: "46404-650660", front: "32752669-front.jpg", title: "2015-16 Panini Gala #S-NVE Nick Van Exel Signatures /40" },
  { productId: 2213, batch: "46404-650660", front: "32752672-front.jpg", title: "2020-21 Donruss #CS-NVE Nick Van Exel Choice Signatures /49" },
  { productId: 2373, batch: "46404-650660", front: "32752670-front.jpg", title: "2015-16 Immaculate Collection #IK-NVA Nick Van Exel Ink Autographs Red /25" },
  { productId: 2411, batch: "46404-650660", front: "32752671-front.jpg", title: "2015-16 Immaculate Collection #IK-NVA Nick Van Exel Ink Autographs Blue /10" },
  { productId: 2448, batch: "46404-650660", front: "32752663-front.jpg", title: "2016-17 Panini Flawless #PI-NVE Nick Van Exel Premium Ink Ruby /15" },

  { productId: 1976, batch: "46404-644015", front: "32371225-front.jpg", title: "2021 Topps Clearly Authentic Gary Sheffield 1986 Autographs Red /50" },
  { productId: 1992, batch: "46404-644015", front: "32371372-front.jpg", title: "1993 Hoops #356 Nick Van Exel Gold 5th Anniversary PSA 10" },
  { productId: 2273, batch: "46404-644015", front: "32371214-front.jpg", title: "2012 Topps Triple Threads #TTUR-13 Giancarlo Stanton Unity Relics Emerald /18" },

  { productId: 2036, batch: "46404-660078", front: "33266884-front.jpg", title: "2024-25 SP Authentic #MP-18 Connor McDavid Maximum Performance Green" },

  { productId: 2052, batch: "46404-613278", front: "29970330-front.jpg", title: "18-19 Contenders Nick Van Exel Legendary Auto /99" },
  { productId: 2117, batch: "46404-613278", front: "29970329-front.jpg", title: "18-19 Spectra Nick Van Exel Making it Rain Auto Neon Pink /25" },
  { productId: 2286, batch: "46404-613278", front: "29970307-front.jpg", title: "21-22 Mosaic Tariq Lamptey Scripts Mosaic Orange Fluorescent /50" },

  { productId: 2103, batch: "46404-628416", front: "31288621-front.jpg", title: "2019-20 Panini Flawless #PI-NVE Nick Van Exel Auto Premium Ink /25" },
  { productId: 2228, batch: "46404-628416", front: "31288607-front.jpg", title: "2012 SP Authentic #20 Paula Creamer Base Limited Auto & Swatch /100" },

  { productId: 2183, batch: "46404-647158", front: "32563351-front.jpg", title: "2016-17 Panini Flawless #EX-NVE Nick Van Exel Excellence Signatures /25" },
  { productId: 2260, batch: "46404-647158", front: "32563346-front.jpg", title: "2014-15 Panini National Treasures #LL-NVE Nick Van Exel Lasting Legacies /35" },
  { productId: 2391, batch: "46404-647158", front: "32563345-front.jpg", title: "2018-19 National Treasures Nick Van Exel Clutch Factor Signatures /99" },

  { productId: 2211, batch: "46404-634566", front: "31678536-front.jpg", title: "2020-21 Upper Deck The Cup #SP-AT Alex Tuch Signature Materials /99" },
  { productId: 2241, batch: "46404-663131", front: "33487479-front.jpg", title: "2012 Topps Triple Threads #TTUR-15 Giancarlo Stanton Unity Relics /36" },
  { productId: 2313, batch: "46404-681168", front: "34428978-front.jpg", title: "2024-25 Upper Deck Allure #115 Lukas Cormier Flying Puck" },
  { productId: 2315, batch: "46404-620850", front: "30594454-front.jpg", title: "2022-23 Upper Deck Ultimate Collection Matty Beniers Ultimate Introductions Auto" },
  { productId: 2336, batch: "46404-654743", front: "32979973-front.jpg", title: "2020 Bowman Jerar Encarnacion Mojo Refractor Blue Auto /150" },

  { productId: 2366, batch: "46404-665885", front: "33605464-front.jpg", title: "2013 Topps Tribute #CC-GS Giancarlo Stanton Commemorative Cuts Relics Gold /15" },
  { productId: 2386, batch: "46404-665885", front: "33605462-front.jpg", title: "2013 Topps Tribute Giancarlo Stanton Famous Four Baggers Relics Orange /25" },
  { productId: 2419, batch: "46404-665885", front: "33605408-front.jpg", title: "2013 Topps Tribute #CC-GS Giancarlo Stanton Commemorative Cuts Relics Blue /50" },
  { productId: 2413, batch: "46404-617125", front: "30301380-front.jpg", title: "2022-23 SPx #64 Nikolaj Ehlers Radiance /100" },
];

async function listBatch(batch) {
  const items = [];
  let pageToken = "";
  do {
    const url = new URL(`https://storage.googleapis.com/storage/v1/b/${bucket}/o`);
    url.searchParams.set("prefix", `${batch}/`);
    url.searchParams.set("maxResults", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`GCS list ${batch} failed with ${response.status}`);
    const payload = await response.json();
    items.push(...(Array.isArray(payload.items) ? payload.items : []));
    pageToken = String(payload.nextPageToken || "");
  } while (pageToken);
  return items;
}

async function downloadObject(name, destination) {
  const url = `https://storage.googleapis.com/${bucket}/${name
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Download ${name} failed with ${response.status}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
  return { url, bytes: Number(response.headers.get("content-length") || 0) };
}

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(outputRoot, { recursive: true });

const batches = Array.from(new Set(targets.map((target) => target.batch))).sort();
const manifest = { bucket, generatedAt: new Date().toISOString(), targets, batches: [] };
for (const batch of batches) {
  const items = await listBatch(batch);
  const batchTargets = targets.filter((target) => target.batch === batch);
  const targetNames = new Set(batchTargets.map((target) => `${batch}/${target.front}`));
  const backs = items.filter((item) => /-back\.jpg$/i.test(String(item.name || "")));
  const selected = items.filter(
    (item) => targetNames.has(String(item.name || "")) || backs.includes(item),
  );
  const downloads = [];
  for (const item of selected) {
    const name = String(item.name || "");
    if (!name) continue;
    const destination = path.join(outputRoot, "images", name);
    try {
      const downloaded = await downloadObject(name, destination);
      downloads.push({ name, destination, ...downloaded, ok: true });
    } catch (error) {
      downloads.push({ name, destination, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  manifest.batches.push({
    batch,
    objectCount: items.length,
    targetFronts: batchTargets,
    backObjects: backs.map((item) => ({
      name: item.name,
      id: item.id,
      generation: item.generation,
      size: item.size,
      md5Hash: item.md5Hash,
      crc32c: item.crc32c,
      timeCreated: item.timeCreated,
      updated: item.updated,
      metadata: item.metadata || null,
    })),
    targetFrontObjects: items
      .filter((item) => targetNames.has(String(item.name || "")))
      .map((item) => ({
        name: item.name,
        id: item.id,
        generation: item.generation,
        size: item.size,
        md5Hash: item.md5Hash,
        crc32c: item.crc32c,
        timeCreated: item.timeCreated,
        updated: item.updated,
        metadata: item.metadata || null,
      })),
    downloads,
  });
  console.log(JSON.stringify({
    batch,
    objectCount: items.length,
    targetFrontCount: batchTargets.length,
    backCount: backs.length,
    downloaded: downloads.filter((entry) => entry.ok).length,
  }));
}

await fs.writeFile(
  path.join(outputRoot, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(`Wrote ${path.join(outputRoot, "manifest.json")}`);
