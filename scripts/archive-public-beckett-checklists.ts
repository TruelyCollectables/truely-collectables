import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const ROOT = resolve(process.cwd(), ".beckett-public-archive");
const ARTICLES = resolve(ROOT, "articles");
const FILES = resolve(ROOT, "files");
const MAX_PAGES = Number(process.env.BECKETT_PUBLIC_MAX_PAGES || 60);
const MAX_ARTICLES = Number(process.env.BECKETT_PUBLIC_MAX_ARTICLES || 5000);
const UA = "Mozilla/5.0 (compatible; TCOS-Public-Beckett-Archiver/1.0)";

function text(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#8211;|&#8212;/g, "-").replace(/&#8217;|&#039;/g, "'").replace(/\s+/g, " ").trim();
}
function slug(v: string) { return v.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 170) || "checklist"; }
async function get(url: string) {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*" }, redirect: "follow", signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r;
}
function articleLinks(html: string) {
  const out = new Set<string>();
  for (const m of html.matchAll(/href=["'](https?:\/\/www\.beckett\.com\/news\/[^"'#?]+)["']/gi)) {
    const u = m[1].replace(/\/$/, "") + "/";
    if (!/\/category\//i.test(u) && !/\/author\//i.test(u) && !/\/tag\//i.test(u)) out.add(u);
  }
  return [...out];
}
function fileLinks(html: string) {
  const out = new Set<string>();
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+\.(?:xlsx?|xlsm|pdf|csv|zip)(?:\?[^\s"'<>]*)?/gi)) out.add(m[0].replace(/&amp;/gi, "&"));
  return [...out];
}
function classify(title: string, body: string) {
  const v = `${title} ${body}`.toLowerCase();
  const manufacturers = ["Topps","Panini","Donruss","Upper Deck","Leaf","Bowman","Fleer","Score","Playoff","Pacific","O-Pee-Chee","Parkhurst","Rittenhouse","Pro Set","Sage","Press Pass","Historic Autographs","Cryptozoic"];
  const sports = ["Baseball","Football","Basketball","Hockey","Soccer","Racing","Wrestling","MMA","Golf","Tennis","Non-Sport","Gaming","Multisport"];
  return { manufacturers: manufacturers.filter(x => v.includes(x.toLowerCase())), sports: sports.filter(x => v.includes(x.toLowerCase().replace("non-sport","non-sport"))) };
}

async function main() {
  mkdirSync(ARTICLES, { recursive: true }); mkdirSync(FILES, { recursive: true });
  const urls = new Set<string>(); const pageFailures: any[] = [];
  for (let page=1; page<=MAX_PAGES && urls.size<MAX_ARTICLES; page++) {
    const url = page===1 ? "https://www.beckett.com/news/category/checklists/" : `https://www.beckett.com/news/category/checklists/page/${page}/`;
    try { const html = await (await get(url)).text(); const found = articleLinks(html); for (const x of found) urls.add(x); console.log(JSON.stringify({page,found:found.length,total:urls.size})); if (page>5 && found.length===0) break; }
    catch (e) { pageFailures.push({url,error:e instanceof Error?e.message:String(e)}); }
  }
  const articles:any[]=[]; const files:any[]=[]; const articleFailures:any[]=[];
  for (const [i,url] of [...urls].slice(0,MAX_ARTICLES).entries()) {
    try {
      const html = await (await get(url)).text(); const title = text(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || url); const body=text(html); const meta=classify(title,body);
      const path=resolve(ARTICLES,`${String(i+1).padStart(5,"0")}-${slug(title)}.txt`); writeFileSync(path,`SOURCE: ${url}\nTITLE: ${title}\nMANUFACTURERS: ${meta.manufacturers.join(", ")}\nSPORTS: ${meta.sports.join(", ")}\n\n${body}\n`);
      const linked=fileLinks(html); articles.push({title,url,textPath:path.replace(process.cwd()+"/",""),textBytes:Buffer.byteLength(body),...meta,fileLinks:linked.length});
      for (const fileUrl of linked) {
        try { const r=await fetch(fileUrl,{headers:{"user-agent":UA},redirect:"follow",signal:AbortSignal.timeout(30000)}); if(!r.ok) throw new Error(`HTTP ${r.status}`); const bytes=Buffer.from(await r.arrayBuffer()); const filename=`${String(files.length+1).padStart(5,"0")}-${slug(title)}-${basename(new URL(fileUrl).pathname)}`; writeFileSync(resolve(FILES,filename),bytes); files.push({title,sourcePage:url,url:fileUrl,filename,sizeBytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")}); }
        catch(e){ files.push({title,sourcePage:url,url:fileUrl,error:e instanceof Error?e.message:String(e)}); }
      }
    } catch(e) { articleFailures.push({url,error:e instanceof Error?e.message:String(e)}); }
  }
  const byManufacturer:Record<string,number>={}; const bySport:Record<string,number>={};
  for(const a of articles){ for(const x of a.manufacturers) byManufacturer[x]=(byManufacturer[x]||0)+1; for(const x of a.sports) bySport[x]=(bySport[x]||0)+1; }
  const manifest={schema:"tcos.beckettPublicArchive.v1",generatedAt:new Date().toISOString(),totals:{archivePagesAttempted:MAX_PAGES,articleUrls:urls.size,articleSnapshots:articles.length,fileCandidates:files.length,downloadedFiles:files.filter(x=>!x.error).length,failedFiles:files.filter(x=>x.error).length,pageFailures:pageFailures.length,articleFailures:articleFailures.length},byManufacturer,bySport,articles,files,pageFailures,articleFailures};
  writeFileSync(resolve(ROOT,"manifest.json"),JSON.stringify(manifest,null,2)+"\n");
  const gaps=`# Beckett coverage gap report\n\n## Public archive captured\n- Public Beckett News checklist articles and their visible checklist text.\n- Public downloadable PDF/XLS/XLSX/CSV/ZIP links referenced by those pages.\n- Public titles, manufacturers, sports, release details, parallels, inserts, autographs, memorabilia and team lists where visible.\n\n## Not captured without separate permission or licensing\n- Login-only Online Price Guide search results and set/card detail pages.\n- Beckett book values, graded values, Market Data Report sales, proprietary IDs and historical pricing.\n- Full paid Vintage OPG catalog (1867-1980) beyond information already published publicly.\n- Bulk exports or API access not explicitly provided by Beckett.\n- Images or editorial content for redistribution beyond internal source snapshots.\n\n## Next acquisition routes\n1. Ask Beckett for database/API/bulk-export licensing.\n2. Purchase only the narrow guide needed to manually evaluate coverage; do not automate extraction unless terms permit it.\n3. Fill checklist gaps from official manufacturer files, public archives, TCDB or other licensed sources.\n`;
  writeFileSync(resolve(ROOT,"GAPS.md"),gaps); console.log(JSON.stringify(manifest.totals)); if(articles.length===0) process.exitCode=1;
}
main().catch(e=>{console.error(e instanceof Error?e.stack||e.message:String(e));process.exitCode=1;});
