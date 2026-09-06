import fs from 'node:fs';
const all=JSON.parse(fs.readFileSync('audits/km252-pricing-input-20260906.json','utf8'));
const n=Number(process.env.KM252_ONLY_N||68);
const item=all.find(x=>Number(x.n)===n); if(!item) throw new Error('target card missing');
const prompt=[
  'You are a strict sports-card sold-market researcher.',
  'Search eBay only for completed/sold listings for the EXACT card below.',
  'Never return a similar card. Player, year, product/set, card number, parallel, print-run denominator, autograph/relic state, raw/graded state, grading company and grade must match exactly.',
  'Only include a row if the direct ebay.com/itm URL, sold/completed status, sold date, item price, shipping price and exact identity are all supported by web-search evidence.',
  'Use shippingPrice 0 only when free shipping is explicit. Omit uncertain rows.',
  'Return JSON only: {"sold":[{"title":"","itemPrice":0,"shippingPrice":0,"soldAt":"YYYY-MM-DD","url":"https://www.ebay.com/itm/123","evidence":""}],"notes":""}',
  `TARGET=${JSON.stringify({title:item.title,identity:item.ai})}`,
].join('\n');
const res=await fetch('http://127.0.0.1:8799/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt}),signal:AbortSignal.timeout(180000)});
const payload=await res.json().catch(()=>({}));
fs.mkdirSync('artifacts/km252-cloudflare-ai-smoke',{recursive:true});
fs.writeFileSync('artifacts/km252-cloudflare-ai-smoke/result.json',JSON.stringify({n,title:item.title,http:res.status,...payload},null,2));
const result=payload?.result;
const text=typeof result?.response==='string'?result.response:Array.isArray(result?.output)?result.output.flatMap(x=>Array.isArray(x?.content)?x.content:[]).filter(x=>x?.type==='output_text').map(x=>x.text).join('\n'):'';
console.log('CF_AI_BINDING_SMOKE',JSON.stringify({n,http:res.status,ok:payload?.ok===true,resultType:typeof result,textChars:text.length,error:payload?.error||null}));
if(text) console.log('CF_AI_TEXT_PREVIEW',text.slice(0,1800));
if(!res.ok||payload?.ok!==true) process.exitCode=2;
