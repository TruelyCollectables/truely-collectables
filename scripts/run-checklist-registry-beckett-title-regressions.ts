import assert from "node:assert/strict";
import { parseBeckettReferenceHtml } from "../src/lib/checklist-registry/beckett-reference-html";
function plan(title:string, sport:string, year:any, manufacturer:string, product:string) {
 const html=`<html><head><title>${title}</title></head><body><h1>${title}</h1><h2>${title} Checklist</h2><p>#1 One, A<br>#2 Two, B<br>#3 Three, C</p></body></html>`;
 return parseBeckettReferenceHtml({sourceUrl:'https://www.beckett.com/news/test/',originalFilename:'x.html',mimeType:'text/html',content:html,retrievedAt:'2026-09-09T00:00:00Z',authority:'approved_reference_dataset',redistributionAllowed:false,targetContext:{sport,year,season:String(year),manufacturer,product}} as any);
}
const errs=(p:any)=>p.validation.issues.filter((x:any)=>x.severity==='error').map((x:any)=>x.code);
assert(!errs(plan('2023 Donruss Optic Football Checklist, Team Set Lists and Details','football',2023,'Panini','Donruss Optic')).includes('beckett_target_page_mismatch'));
assert(!errs(plan('2022-23 O-Pee-Chee Hockey Checklist, Team Set Lists, Odds and Details','hockey','2022-23','Upper Deck','O-Pee-Chee')).includes('beckett_target_page_mismatch'));
assert(!errs(plan('2025-26 SP Hockey Checklist, Team Set Lists and Details','hockey','2025-26','Upper Deck','SP')).includes('beckett_target_page_mismatch'));
assert(errs(plan('2023 Donruss Optic Football Checklist','basketball',2023,'Panini','Donruss Optic')).includes('beckett_target_page_mismatch'));
assert(errs(plan('2023 Donruss Optic Football Checklist','football',2022,'Panini','Donruss Optic')).includes('beckett_target_page_mismatch'));
assert(errs(plan('2023 Donruss Optic Football Checklist','football',2023,'Panini','Donruss Elite')).includes('beckett_target_page_mismatch'));
console.log(JSON.stringify({ok:true,cases:6}));
