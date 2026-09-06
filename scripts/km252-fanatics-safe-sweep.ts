import { mkdir, readFile, writeFile } from "node:fs/promises";
import { getFanaticsExactSoldProvider } from "../src/lib/instacomp-fanatics-sold-provider";
const rows=JSON.parse(await readFile("audits/km252-pricing-input-20260906.json","utf8"));
const review=new Set([169,174,181,234]);
const ready=rows.filter((r:any)=>!review.has(Number(r.n)) && ["PERFECT","FIXED → PERFECT"].includes(String(r?.proof?.category||"")));
const out:any[]=[]; let live=0, sales=0, errors=0;
for (let i=0;i<ready.length;i++) {
  const r=ready[i];
  const p=await getFanaticsExactSoldProvider({exactTitle:r.title,ai:r.ai});
  const row={n:r.n,id:r.id,title:r.title,status:p.status,count:p.results.length,message:p.message,results:p.results};
  out.push(row);
  if(p.status==="live"&&p.results.length){live++;sales+=p.results.length;}
  if(p.status==="error")errors++;
  if((i+1)%20===0||i+1===ready.length) console.log("FANATICS_SAFE",i+1,"/",ready.length,"live",live,"sales",sales,"errors",errors);
  await new Promise(res=>setTimeout(res,1250));
}
await mkdir("artifacts/km252-fanatics",{recursive:true});
await writeFile("artifacts/km252-fanatics/results.json",JSON.stringify(out,null,2));
await writeFile("artifacts/km252-fanatics/summary.json",JSON.stringify({ready:ready.length,cardsWithExactSales:live,totalExactSales:sales,errors,noExactSales:ready.length-live},null,2));
console.log("FANATICS_SAFE_DONE",JSON.stringify({ready:ready.length,cardsWithExactSales:live,totalExactSales:sales,errors,noExactSales:ready.length-live}));
