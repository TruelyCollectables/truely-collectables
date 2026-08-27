import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Seed = { title: string; sport: string; year: string; sourcePage?: string; url: string };
type Brand = { name: string; seedPath: string; hosts: string[]; queries: string[]; floor?: Seed[] };

const NOW = new Date().getUTCFullYear();
const FILE_RE = /\.(pdf|xlsx?|xlsm|csv)(?:$|[?#])/i;
const LIMIT_MS = 28 * 60_000;
const started = Date.now();

const paniniFloor: Seed[] = [
  { title:"2011 Timeless Treasures Football",sport:"Football",year:"2011",sourcePage:"https://blog.paniniamerica.net/panini-unwrapped-2011-timeless-treasures-football-including-checklist-reveal/",url:"https://blog.paniniamerica.net/wp-content/uploads/2011/09/2011-timeless-treasures-fb-checklist.xlsx" },
  { title:"2013-14 Titanium Hockey",sport:"Hockey",year:"2013-14",sourcePage:"https://blog.paniniamerica.net/the-panini-america-quality-control-gallery-2013-14-titanium-hockey-with-checklist/",url:"https://blog.paniniamerica.net/wp-content/uploads/2014/01/2013-14-titanium-checklist-final.xls" },
  { title:"2013 Boxing Day",sport:"Multi-Sport",year:"2013",sourcePage:"https://blog.paniniamerica.net/panini-america-publishes-2013-boxing-day-checklist-contest-winners-announced/",url:"https://blog.paniniamerica.net/wp-content/uploads/2014/01/media-checklist-2013-boxing-day.xlsx" },
  { title:"2020 Obsidian Football",sport:"Football",year:"2020",sourcePage:"https://blog.paniniamerica.net/the-panini-america-quality-control-gallery-checklist-2020-obsidian-football-50-sweet-pics/",url:"https://blog.paniniamerica.net/wp-content/uploads/2020/12/2020-Obsidian-FB-Checklist.xlsx" },
  { title:"2021 Elements Football",sport:"Football",year:"2021",sourcePage:"https://blog.paniniamerica.net/the-panini-america-quality-control-gallery-checklist-2021-elements-football/",url:"https://blog.paniniamerica.net/wp-content/uploads/2021/08/2021-Elements-FB-Checklist.xlsx" },
  { title:"2025 Ohio State Media Checklist",sport:"Football",year:"2025",sourcePage:"https://blog.paniniamerica.net/buckeye-fever-2024-25-panini-the-ohio-state-university-nil/",url:"https://blog.paniniamerica.net/wp-content/uploads/2025/09/2025-Ohio-State-Media-Checklist.pdf" },
  { title:"2025 National Silver Packs",sport:"Multi-Sport",year:"2025",url:"https://blog.paniniamerica.net/wp-content/uploads/2025/07/National-checklist.pdf" },
  { title:"2025 UConn Collegiate Basketball",sport:"Basketball",year:"2025",url:"https://blog.paniniamerica.net/wp-content/uploads/2025/03/UConn-checklist1-1.pdf" },
  { title:"2026 Direct Application",sport:"Miscellaneous",year:"2026",sourcePage:"https://www.paniniamerica.net/checklist.html",url:"https://assets.paniniamerica.net/checklist/2026+Direct+Application.pdf" }
];

const sports = ["baseball","football","basketball","hockey","soccer","racing","ufc","wwe","golf","entertainment","national","black friday","boxing day"];
const brands: Brand[] = [
  {
    name:"Topps", seedPath:"data/topps-checklist-seeds.json",
    hosts:["topps.com","www.topps.com","cdn.shopify.com"],
    queries:[
      ...Array.from({length: NOW-1999},(_,i)=>2000+i).flatMap(y=>[
        `site:cdn.shopify.com/s/files Topps ${y} checklist pdf`,
        `site:topps.com ${y} checklist pdf`,
        `site:topps.com ${y} checklist xls OR xlsx`
      ]),
      ...sports.map(s=>`site:cdn.shopify.com/s/files Topps ${s} checklist pdf`),
      "site:cdn.shopify.com/s/files/1/0662/9749/5709/files checklist",
      "site:cdn.shopify.com/s/files/1/0739/2015/1805/files checklist"
    ]
  },
  {
    name:"Panini", seedPath:"data/panini-checklist-seeds.json",
    hosts:["paniniamerica.net","www.paniniamerica.net","blog.paniniamerica.net","assets.paniniamerica.net"],
    floor:paniniFloor,
    queries:[
      ...Array.from({length: NOW-2008},(_,i)=>2009+i).flatMap(y=>[
        `site:blog.paniniamerica.net/wp-content/uploads/${y} checklist pdf`,
        `site:blog.paniniamerica.net/wp-content/uploads/${y} checklist xls OR xlsx`,
        `site:assets.paniniamerica.net/checklist ${y}`,
        `site:blog.paniniamerica.net ${y} Panini checklist`
      ]),
      ...sports.map(s=>`site:blog.paniniamerica.net Panini ${s} checklist`),
      "site:assets.paniniamerica.net/checklist filetype:pdf",
      "site:blog.paniniamerica.net/wp-content/uploads checklist"
    ]
  }
];

function allowed(url:string, hosts:string[]) { try { const h=new URL(url).hostname.toLowerCase(); return hosts.some(x=>h===x||h.endsWith(`.${x}`)); } catch { return false; } }
function clean(v:string){ return v.replace(/&amp;/gi,"&").replace(/\\\//g,"/").replace(/[)>\],.;*]+$/g,"").trim(); }
function links(body:string){ const out=new Set<string>(); for(const re of [/<link>([^<]+)<\/link>/gi,/<loc>([^<]+)<\/loc>/gi,/https?:\/\/[^\s"'<>\\]+/gi]) for(const m of body.matchAll(re)) out.add(clean(m[1]||m[0])); return [...out]; }
function title(url:string){ const f=decodeURIComponent(new URL(url).pathname).split("/").filter(Boolean).pop()||"Official Checklist"; return f.replace(/\.[^.]+$/,"").replace(/[_+-]+/g," ").replace(/\s+/g," ").trim(); }
function year(v:string){ const s=v.match(/\b(20\d{2})[-_/](\d{2})\b/); return s?`${s[1]}-${s[2]}`:(v.match(/\b(19\d{2}|20\d{2})\b/)?.[1]||"Unknown"); }
function sport(v:string){ const t=v.toLowerCase(); for(const [n,a] of [["Baseball",["baseball","bowman"]],["Basketball",["basketball","nba","wnba","hoops"]],["Football",["football","nfl","gridiron"]],["Hockey",["hockey","nhl"]],["Soccer",["soccer","uefa","fifa","premier"]],["Racing",["racing","nascar","formula","f1"]],["Wrestling",["wwe","wrestling"]],["UFC",["ufc","mma"]],["Golf",["golf"]],["Multi-Sport",["national","black friday","boxing day","multi-sport"]],["Entertainment",["marvel","disney","star wars","entertainment"]]] as Array<[string,string[]]>) if(a.some(x=>t.includes(x))) return n; return "Miscellaneous"; }
async function fetchText(url:string){ const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 TCOS-Master-Index/1.0","Accept":"application/rss+xml,application/xml,text/html,*/*"},redirect:"follow",signal:AbortSignal.timeout(20000)}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }
function bing(q:string,first:number){ return `https://www.bing.com/search?format=rss&count=50&first=${first}&q=${encodeURIComponent(q)}`; }

async function run(b:Brand){
  const path=resolve(process.cwd(),b.seedPath); const existing=JSON.parse(readFileSync(path,"utf8")) as Seed[]; const map=new Map(existing.map(x=>[x.url,x]));
  for(const x of b.floor||[]) map.set(x.url,x);
  const failures:any[]=[]; let added=0; let searched=0;
  for(const q of b.queries){
    if(Date.now()-started>LIMIT_MS) break;
    for(const first of [1,51,101,151]){
      try{
        const body=await fetchText(bing(q,first)); searched++;
        for(const raw of links(body)){
          const u=clean(raw); if(!allowed(u,b.hosts)||!FILE_RE.test(u)) continue;
          const parsed=new URL(u); parsed.hash=""; const normalized=parsed.toString(); if(map.has(normalized)) continue;
          const t=title(normalized); map.set(normalized,{title:t,sport:sport(`${t} ${q}`),year:year(`${t} ${normalized}`),sourcePage:`bing:${q}`,url:normalized}); added++;
        }
      }catch(e){ failures.push({query:q,first,error:e instanceof Error?e.message:String(e)}); }
      await new Promise(r=>setTimeout(r,250));
    }
    if(searched%20===0) writeFileSync(path,JSON.stringify([...map.values()],null,2)+"\n");
  }
  const values=[...map.values()].sort((a,b)=>`${a.year}|${a.sport}|${a.title}`.localeCompare(`${b.year}|${b.sport}|${b.title}`)); writeFileSync(path,JSON.stringify(values,null,2)+"\n");
  return {manufacturer:b.name,knownBefore:existing.length,floor:b.floor?.length||0,newlyDiscovered:added,discoveredTotal:values.length,queriesAttempted:searched,failures};
}

async function main(){ mkdirSync(resolve(process.cwd(),".master-index-discovery"),{recursive:true}); const reports=[]; for(const b of brands) reports.push(await run(b)); const report={schema:"tcos.masterIndexDiscovery.v1",generatedAt:new Date().toISOString(),runtimeMs:Date.now()-started,manufacturers:reports}; writeFileSync(resolve(process.cwd(),".master-index-discovery/report.json"),JSON.stringify(report,null,2)+"\n"); console.log(JSON.stringify(reports.map(x=>({manufacturer:x.manufacturer,newlyDiscovered:x.newlyDiscovered,discoveredTotal:x.discoveredTotal,queriesAttempted:x.queriesAttempted})))); }
main().catch(e=>{console.error(e);process.exitCode=1;});
