import fs from 'node:fs';
const all = JSON.parse(fs.readFileSync('audits/km252-pricing-input-20260906.json','utf8'));
const item = all.find(x => Number(x.n) === Number(process.env.KM252_ONLY_N || 68));
if (!item) throw new Error('target card missing');
const account = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
if (!account || !token) throw new Error('cloudflare credentials missing');
const prompt = [
  'You are a strict sports-card sold-market researcher.',
  'Search eBay only. Find direct completed/sold listings for the exact card identity below.',
  'Never return a similar card. Player, year, set/product, card number, parallel, serial denominator, autograph/relic and grading state must match exactly.',
  'Only include a row if the direct ebay.com/itm URL, sold/completed status, sold date, item price, shipping price, and exact identity are all visible or directly supported by the search evidence.',
  'Use 0 shipping only if free shipping is explicit. If anything is uncertain, omit the row.',
  'Return JSON only: {"sold":[{"title":"","itemPrice":0,"shippingPrice":0,"soldAt":"YYYY-MM-DD","url":"https://www.ebay.com/itm/123","evidence":""}],"notes":""}',
  `TARGET=${JSON.stringify({title:item.title,identity:item.ai})}`,
].join('\n');
const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/v1/responses`, {
  method:'POST',
  headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','cf-aig-zdr':'true'},
  body:JSON.stringify({
    model:'openai/gpt-4o-mini',
    input:prompt,
    max_output_tokens:3000,
    tools:[{type:'web_search_preview',search_context_size:'high',filters:{allowed_domains:['ebay.com']}}],
  }),
  signal:AbortSignal.timeout(180000),
});
const payload = await response.json().catch(()=>({}));
const text = Array.isArray(payload?.output) ? payload.output.flatMap(x=>Array.isArray(x?.content)?x.content:[]).filter(x=>x?.type==='output_text').map(x=>x.text).join('\n') : '';
const safe = {http:response.status,ok:response.ok,model:payload?.model||null,id:payload?.id||null,error:payload?.error?.message||payload?.errors?.[0]?.message||null,text:text.slice(0,12000)};
fs.mkdirSync('artifacts/km252-cloudflare-smoke',{recursive:true});
fs.writeFileSync('artifacts/km252-cloudflare-smoke/result.json',JSON.stringify(safe,null,2));
console.log('CF_WEB_SMOKE',JSON.stringify({http:safe.http,ok:safe.ok,model:safe.model,error:safe.error,textChars:safe.text.length}));
if(!response.ok) process.exitCode=2;
