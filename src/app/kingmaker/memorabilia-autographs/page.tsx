'use client';
import { useState, type FormEvent } from 'react';

export default function MemorabiliaAutographs() {
 const [result,setResult]=useState<Record<string,unknown>|null>(null);
 const [busy,setBusy]=useState(false);
 async function submit(e:FormEvent<HTMLFormElement>) {
  e.preventDefault();setBusy(true);setResult(null);
  try {
   const data=new FormData(e.currentTarget);data.set('autographSuspected','true');
   const res=await fetch('/api/kingmaker/memorabilia-autograph',{method:'POST',body:data,credentials:'same-origin'});
   const json=await res.json();setResult(json);
  } catch {setResult({error:'Analysis request failed'});} finally {setBusy(false);}
 }
 return <main style={{maxWidth:760,margin:'2rem auto',padding:20}}>
  <h1>Memorabilia Autograph Research</h1>
  <p>Non-card collectibles only. Experimental visual matches are not authentication. No listings are published.</p>
  <form onSubmit={submit} style={{display:'grid',gap:12}}>
   <label>Item description <input name="title" required placeholder="Vegas Golden Knights signed puck" style={{width:'100%',padding:8}}/></label>
   <label>Item category <select name="category" defaultValue="memorabilia"><option value="memorabilia">Memorabilia</option><option value="autographs">Autographs</option><option value="sports_cards">Trading card (excluded)</option></select></label>
   <label>Photograph <input name="image" type="file" accept="image/jpeg,image/png,image/webp" required/></label>
   <button type="submit" disabled={busy}>{busy?'Analyzing…':'Analyze autograph'}</button>
  </form>
  {result && <section aria-live="polite"><h2>Evidence report</h2><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(result,null,2)}</pre></section>}
 </main>;
}
