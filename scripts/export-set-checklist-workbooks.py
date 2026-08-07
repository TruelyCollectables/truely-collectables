#!/usr/bin/env python3
"""Create one deduplicated XLSX workbook per mainstream sports set."""
from __future__ import annotations
import argparse, csv, hashlib, json, os, re, shutil, unicodedata
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
try:
    import xlsxwriter
except ImportError:
    raise SystemExit("Install XlsxWriter==3.2.5")

SPORTS=("baseball","basketball","football","hockey","soccer","racing","wrestling","mma","boxing","golf","tennis","multi-sport")
NOISE=("trading set review and checklist","set review and checklist","review and checklist","trading card set","trading cards","trading card","card set","set and","product and","collection and","checklist","product","collection","set","cards","card","trading","and")
TABS=(("Base","base"),("Inserts","inserts"),("Autographs","autographs"),("Relics","relics"),("Parallels","parallels"),("Numbered","numbered"),("Short Prints","short_prints"),("Printing Plates","printing_plates"),("Unclassified","unclassified"))
HEADERS=("Card Number","Player / Subject","Team","Subset / Card Set","Parallel","Print Run","Category Tags","Sources","Source URLs","Raw Text")
AUTO=re.compile(r"\b(auto(?:graph(?:ed|s)?)?|signatures?|signed|ink)\b",re.I)
RELIC=re.compile(r"\b(relics?|memorabilia|jersey|patch|swatch|materials?|game[- ]used|fabric)\b",re.I)
PLATE=re.compile(r"\b(printing plates?|press plates?)\b",re.I)
SHORT=re.compile(r"\b(ssp|super short print|short print|image variation|photo variation|variations?)\b",re.I)
NUMBERED=re.compile(r"(?:\b(numbered|serial(?:ly)? numbered|print run|copies)\b|(?<!\d)/(?:1|2|3|4|5|8|10|15|20|25|30|35|49|50|75|99|100|125|149|175|199|249|299|399|499|599|999)\b)",re.I)
PARALLEL=re.compile(r"\b(parallels?|refractors?|prizms?|prisms?|foil|holo|chrome|sapphire|gold|silver|bronze|red|blue|green|orange|purple|pink|black|white|yellow|aqua|teal|rainbow|shimmer|wave|sparkle|cracked ice|scope|mojo|pulsar|x[- ]?fractor|superfractor|atomic|camo|tie[- ]dye|nebula|lava|vinyl|checkerboard|platinum|sepia|negative|disco|laser|velocity|peacock|zebra|tiger|giraffe|elephant|snakeskin)\b",re.I)
INSERT=re.compile(r"\b(inserts?|subset|case hits?)\b",re.I)
BASE=re.compile(r"\b(base|base set|regular set)\b",re.I)
SECTION=re.compile(r"\b(checklist|base set|base cards|inserts?|autographs?|signatures?|relics?|memorabilia|parallels?|variations?|short prints?|printing plates?|rookies?)\b",re.I)
PREFIX=re.compile(r"^\s*#?((?:[A-Z]{1,8}[- ]?)?\d{1,5}[A-Z]?(?:[-/][A-Z0-9]{1,8})?)\s*(?:[-–—.:)|\t]|\s+)\s*(.+?)\s*$",re.I)
BAD=re.compile(r"\b(tweet|share|email|rating|shop boxes|shop cards|hobby box|factory sealed|configuration|distribution|price|copyright)\b",re.I)


def clean(v): return re.sub(r"\s+"," ",str(v or "").replace("\u00a0"," ")).strip()
def slug(v,n=160):
    s=unicodedata.normalize("NFKD",str(v or "")); s=re.sub(r"[^a-zA-Z0-9]+","-",s).strip("-").lower()
    return (s or "unknown")[:n]
def norm(v): return re.sub(r"[^a-z0-9]+","",unicodedata.normalize("NFKD",clean(v)).lower())
def year_of(v):
    m=re.search(r"\b((?:18|19|20)\d{2})\b",str(v or "")); return int(m.group(1)) if m else None
def canonical_product(v):
    original=slug(v); s=unicodedata.normalize("NFKD",clean(v)).lower().replace("&"," and ")
    s=re.sub(r"[^a-z0-9]+"," ",s); s=re.sub(r"\s+"," ",s).strip()
    changed=True
    while changed and s:
        changed=False
        for suffix in NOISE:
            if s==suffix: return original
            if s.endswith(" "+suffix):
                candidate=s[:-(len(suffix)+1)].strip()
                if candidate: s=candidate; changed=True
                break
    return slug(s or v)
def canonical_key(r): return "|".join((slug(r.get("sport") or r.get("universe")),slug(r.get("season")),slug(r.get("manufacturer")),canonical_product(r.get("product"))))
def display_product(rows):
    def score(r):
        p=clean(r.get("product")); noise=sum(bool(re.search(rf"\b{x}\b",p,re.I)) for x in ("set","product","and"))
        return (int(r.get("checklistRowsMaximum") or 0)>0,-noise,len(p),p.lower())
    return clean(max(rows,key=score).get("product"))
def natural(v): return tuple(int(x) if x.isdigit() else x for x in re.split(r"(\d+)",clean(v).lower()))
def safe(v): return re.sub(r"[<>:\"/\\|?*\x00-\x1f]+","-",clean(v)).strip(" .-")[:150] or "Unknown Set"


def files_for(root,item):
    d=root/str(item.get("archivePath") or ""); out=[]
    try: meta=json.loads((d/"metadata.json").read_text("utf-8"))
    except Exception: meta={}
    for f in meta.get("files") or []:
        name=Path(str(f.get("name") or "")).name; role=str(f.get("role") or "").lower()
        if "checklist" not in role and not re.search(r"checklist\.(txt|tsv|csv)$",name,re.I): continue
        p=d/name
        if p.is_file(): out.append(p); continue
        ptr=d/(name+".DUPLICATE-OF.txt")
        if ptr.is_file():
            q=root/ptr.read_text("utf-8").strip()
            if q.is_file(): out.append(q)
    if not out:
        for name in ("checklist.txt","checklist.tsv","checklist.csv"):
            p=d/name
            if p.is_file(): out.append(p)
            ptr=d/(name+".DUPLICATE-OF.txt")
            if ptr.is_file():
                q=root/ptr.read_text("utf-8").strip()
                if q.is_file(): out.append(q)
    return list(dict.fromkeys(out))

def split_set(text):
    s=clean(text)
    if re.fullmatch(r"base(?: set)?",s,re.I): return "Base",""
    if s.lower().startswith("base "): return "Base",s[5:].strip()
    m=PARALLEL.search(s)
    return (s[:m.start()].strip(" -/"),s[m.start():].strip()) if m and m.start()>0 else (s,"")
def tags(card):
    text=" ".join(card.get(k,"") for k in ("subset","parallel","raw","section","print_run")); out=[]
    if PLATE.search(text): out.append("printing_plates")
    if AUTO.search(text): out.append("autographs")
    if RELIC.search(text): out.append("relics")
    if SHORT.search(text): out.append("short_prints")
    if clean(card.get("print_run")) or NUMBERED.search(text): out.append("numbered")
    subset=clean(card.get("subset")); parallel=clean(card.get("parallel")); base_only=bool(re.fullmatch(r"base(?: set)?",subset,re.I)) and not parallel
    if PARALLEL.search(text) or (subset.lower().startswith("base ") and not base_only): out.append("parallels")
    if base_only or (BASE.search(text) and not any(x in out for x in ("autographs","relics","printing_plates","parallels"))): out.append("base")
    if INSERT.search(text) or (subset and not subset.lower().startswith("base") and not any(x in out for x in ("autographs","relics","printing_plates"))): out.append("inserts")
    return list(dict.fromkeys(out or ["unclassified"]))
def card(source,url,number="",player="",team="",card_set="",print_run="",raw=""):
    subset,parallel=split_set(card_set); row={"number":clean(number),"player":clean(player),"team":clean(team),"subset":subset,"parallel":parallel,"print_run":clean(print_run),"section":clean(card_set),"raw":clean(raw),"sources":source,"source_urls":url}
    row["tags"]="|".join(tags(row)); return row

def parse_file(path,source,url):
    try: text=path.read_text("utf-8",errors="replace")
    except OSError: return []
    lines=text.splitlines(); first=lines[0] if lines else ""; delim="\t" if "\t" in first else "," if "," in first else None
    if delim:
        headers=[slug(x,80).replace("-","_") for x in next(csv.reader([first],delimiter=delim))]
        joined="|".join(headers)
        if any(x in joined for x in ("player","subject","name")) and any(x in joined for x in ("card_set","subset","parallel","card_number","number")):
            out=[]
            for rr in csv.DictReader(lines,delimiter=delim):
                r={slug(k,80).replace("-","_"):clean(v) for k,v in rr.items() if k is not None}
                player=next((r.get(k,"") for k in ("player","subject","name","card_name") if r.get(k)),"")
                number=next((r.get(k,"") for k in ("card_number","number","card_no","card") if r.get(k)),"")
                cset=next((r.get(k,"") for k in ("card_set","subset","set","parallel") if r.get(k)),"")
                pr=next((r.get(k,"") for k in ("print_run","copies","serial","numbered_to") if r.get(k)),"")
                team=next((r.get(k,"") for k in ("team","club") if r.get(k)),"")
                if any((player,number,cset)): out.append(card(source,url,number,player,team,cset,pr," | ".join(x for x in (number,player,team,cset,pr) if x)))
            return out
    out=[]; section=""
    for line in map(clean,lines):
        if not line: continue
        if len(line)<=180 and SECTION.search(line) and not PREFIX.match(line): section=line.rstrip(":"); continue
        m=PREFIX.match(line)
        if not m: continue
        number,body=clean(m.group(1)),clean(m.group(2))
        if re.fullmatch(r"(?:19|20)\d{2}",number) or BAD.search(body) or len(body)<3 or body.lower() in {"share","shares","email","tweet"}: continue
        player,team=body,""
        if " - " in body:
            a,b=body.rsplit(" - ",1)
            if 1<=len(b.split())<=6: player,team=a.strip(),b.strip()
        serial=re.search(r"(?<!\d)/(\d{1,4})\b",body); pr=serial.group(1) if serial else ""
        out.append(card(source,url,number,player,team,section,pr,line))
    return out

def merge_cards(rows):
    merged={}
    for r in rows:
        key="|".join(norm(r.get(k)) for k in ("number","player","team","subset","parallel","print_run")) or norm(r.get("raw"))
        if not key: continue
        e=merged.setdefault(key,dict(r))
        for k in ("number","player","team","subset","parallel","print_run","raw"):
            if not e.get(k) and r.get(k): e[k]=r[k]
        for k in ("sources","source_urls","tags"):
            e[k]="|".join(dict.fromkeys(x for v in (e.get(k,""),r.get(k,"")) for x in v.split("|") if x))
    return sorted(merged.values(),key=lambda r:(clean(r.get("subset")).lower(),clean(r.get("parallel")).lower(),natural(r.get("number")),clean(r.get("player")).lower()))

def add_sheet(wb,name,rows,fmt):
    ws=wb.add_worksheet(name); ws.freeze_panes(1,0); ws.hide_gridlines(2)
    for i,w in enumerate((14,30,22,30,25,12,30,24,40,60)): ws.set_column(i,i,w)
    for i,h in enumerate(HEADERS): ws.write(0,i,h,fmt["header"])
    for y,r in enumerate(rows,1):
        values=(r.get("number",""),r.get("player",""),r.get("team",""),r.get("subset",""),r.get("parallel",""),r.get("print_run",""),r.get("tags","").replace("|",", "),r.get("sources","").replace("|",", "),r.get("source_urls","").replace("|","\n"),r.get("raw",""))
        for x,v in enumerate(values): ws.write(y,x,v,fmt["wrap"] if x>=6 else fmt["cell"])
    if rows: ws.autofilter(0,0,len(rows),len(HEADERS)-1)
    else: ws.write(1,0,"No rows classified in this category.",fmt["muted"])

def write_one(task):
    root=Path(task["root"]); out=Path(task["out"]); c=task["canonical"]; items=task["items"]
    raw=[]; sources=[]; reported=0
    for item in items:
        source=str(item.get("source") or "unknown"); url=str(item.get("sourceUrl") or ""); reported=max(reported,int(item.get("checklistRows") or 0)); parsed=0
        for p in files_for(root,item):
            rows=parse_file(p,source,url); parsed+=len(rows); raw.extend(rows)
        sources.append((source,clean(item.get("title")),clean(item.get("status")),int(item.get("checklistRows") or 0),parsed,url,clean(item.get("archivePath"))))
    cards=merge_cards(raw); by=defaultdict(list)
    for r in cards:
        for t in r.get("tags","unclassified").split("|"): by[t or "unclassified"].append(r)
    h=hashlib.sha1(c["canonicalSetKey"].encode()).hexdigest()[:10]
    rel=Path(slug(c["sport"]))/str(c["year"])/slug(c["manufacturer"])/(safe(f"{c['season']} {c['manufacturer']} {c['product']}")+f"--{h}.xlsx")
    path=out/rel; path.parent.mkdir(parents=True,exist_ok=True)
    wb=xlsxwriter.Workbook(str(path),{"constant_memory":True,"strings_to_urls":False})
    fmt={"title":wb.add_format({"bold":True,"font_size":16,"font_color":"#FFFFFF","bg_color":"#17365D"}),"header":wb.add_format({"bold":True,"font_color":"#FFFFFF","bg_color":"#1F4E78","border":1,"align":"center"}),"label":wb.add_format({"bold":True,"bg_color":"#D9EAF7","border":1}),"cell":wb.add_format({"border":1,"valign":"top"}),"wrap":wb.add_format({"border":1,"valign":"top","text_wrap":True}),"muted":wb.add_format({"italic":True,"font_color":"#666666"})}
    s=wb.add_worksheet("Summary"); s.hide_gridlines(2); s.set_column(0,0,28); s.set_column(1,1,85); s.merge_range("A1:B1",f"{c['season']} {c['manufacturer']} {c['product']}",fmt["title"])
    details=(("Canonical Set Key",c["canonicalSetKey"]),("Sport",c["sport"]),("Season",c["season"]),("Year",c["year"]),("Manufacturer",c["manufacturer"]),("Product",c["product"]),("Aliases merged"," | ".join(c["aliases"])),("Exact keys merged"," | ".join(c["exactSetKeys"])),("Duplicate set records collapsed",c["duplicateRecordsCollapsed"]),("Source records",len(items)),("Source-reported max rows",reported),("Parsed rows before card dedupe",len(raw)),("Unique card rows",len(cards)),("Rows removed as duplicates",max(0,len(raw)-len(cards))))
    for y,(a,b) in enumerate(details,1): s.write(y,0,a,fmt["label"]); s.write(y,1,b,fmt["wrap"])
    add_sheet(wb,"All Cards",cards,fmt)
    for name,t in TABS: add_sheet(wb,name,by[t],fmt)
    sw=wb.add_worksheet("Sources"); sw.freeze_panes(1,0); sw.hide_gridlines(2)
    sh=("Source","Title","Status","Reported Rows","Parsed Rows","Source URL","Archive Path")
    for x,(a,w) in enumerate(zip(sh,(20,55,20,14,14,55,75))): sw.write(0,x,a,fmt["header"]); sw.set_column(x,x,w)
    for y,row in enumerate(sources,1):
        for x,v in enumerate(row): sw.write(y,x,v,fmt["wrap"] if x in (1,5,6) else fmt["cell"])
    wb.close()
    return {**c,"sourceItems":len(items),"reportedRowsMaximum":reported,"parsedRows":len(raw),"uniqueCardRows":len(cards),"duplicateCardRowsRemoved":max(0,len(raw)-len(cards)),"workbookPath":rel.as_posix(),"workbookBytes":path.stat().st_size}

def build(root,out,start,end,limit=None):
    audited=root/"phase1-sports-2000-plus"/"sports-sets.json"
    sets=json.loads((audited if audited.is_file() else root/"master-sets.json").read_text("utf-8")); items=json.loads((root/"source-items.json").read_text("utf-8"))
    scope=[]
    for r in sets:
        sport=slug(r.get("sport") or r.get("universe")); year=r.get("year") if isinstance(r.get("year"),int) else year_of(r.get("season"))
        if sport in SPORTS and year is not None and start<=year<=end:
            q=dict(r); q["sport"]=sport; q["year"]=year; scope.append(q)
    groups=defaultdict(list); exact={}
    for r in scope: groups[canonical_key(r)].append(r); exact[str(r.get("exactSetKey"))]=canonical_key(r)
    source=defaultdict(list)
    for i in items:
        if exact.get(str(i.get("exactSetKey") or "")): source[exact[str(i.get("exactSetKey"))]].append(i)
    canonical=[]; dups=[]
    for key,rows in groups.items():
        aliases=sorted({clean(r.get("product")) for r in rows if clean(r.get("product"))}); keys=sorted({str(r.get("exactSetKey")) for r in rows if r.get("exactSetKey")})
        c={"canonicalSetKey":key,"sport":rows[0]["sport"],"year":rows[0]["year"],"season":clean(rows[0].get("season")),"manufacturer":clean(rows[0].get("manufacturer")),"product":display_product(rows),"aliases":aliases,"exactSetKeys":keys,"duplicateRecordsCollapsed":len(rows)-1,"reportedRowsMaximum":max(int(r.get("checklistRowsMaximum") or 0) for r in rows)}
        canonical.append(c)
        if len(rows)>1: dups.append({"canonicalSetKey":key,"sport":c["sport"],"season":c["season"],"manufacturer":c["manufacturer"],"product":c["product"],"recordsCollapsed":len(rows)-1,"aliases":" | ".join(aliases),"exactSetKeys":" | ".join(keys)})
    canonical.sort(key=lambda r:(r["sport"],r["year"],r["manufacturer"].lower(),r["product"].lower()))
    if limit: canonical=canonical[:limit]
    tasks=[{"root":str(root),"out":str(out),"canonical":c,"items":source.get(c["canonicalSetKey"],[])} for c in canonical]
    by=[]
    for sport in SPORTS:
        rows=[r for r in canonical if r["sport"]==sport]
        if rows:
            ready=sum(int(r["reportedRowsMaximum"]>0) for r in rows); by.append({"sport":sport,"canonicalSets":len(rows),"setsWithChecklistRows":ready,"setsMissingChecklistRows":len(rows)-ready,"knownSetChecklistReadiness":ready/len(rows),"duplicateSetRecordsRemoved":sum(r["duplicateRecordsCollapsed"] for r in rows)})
    ready=sum(int(r["reportedRowsMaximum"]>0) for r in canonical)
    manifest={"schema":"tcos.checklistWorkbookExport.v1","startYear":start,"endYear":end,"rawExactSets":len(scope),"canonicalSets":len(canonical),"setsWithChecklistRows":ready,"setsMissingChecklistRows":len(canonical)-ready,"knownSetChecklistReadiness":ready/len(canonical),"duplicateGroups":len(dups),"duplicateSetRecordsRemoved":sum(r["duplicateRecordsCollapsed"] for r in canonical),"bySport":by,"percentageDefinition":"setsWithChecklistRows / canonicalSets among currently known mainstream sports set identities","limitation":"A true all-market completion percentage requires an authoritative expected-release denominator."}
    return tasks,dups,manifest

def write_csv(path,rows,headers):
    with path.open("w",newline="",encoding="utf-8") as f:
        w=csv.DictWriter(f,fieldnames=headers,extrasaction="ignore"); w.writeheader()
        for r in rows:
            q={k:("|".join(map(str,v)) if isinstance(v,list) else json.dumps(v,sort_keys=True) if isinstance(v,dict) else v) for k,v in r.items()}; w.writerow(q)
def write_index(out,m,rows,dups):
    p=out/"TCOS-Checklist-Workbook-Index.xlsx"; wb=xlsxwriter.Workbook(str(p),{"constant_memory":True,"strings_to_urls":False})
    title=wb.add_format({"bold":True,"font_size":18,"font_color":"#FFFFFF","bg_color":"#17365D"}); head=wb.add_format({"bold":True,"font_color":"#FFFFFF","bg_color":"#1F4E78","border":1}); cell=wb.add_format({"border":1,"valign":"top"}); wrap=wb.add_format({"border":1,"valign":"top","text_wrap":True}); pct=wb.add_format({"border":1,"num_format":"0.00%"})
    o=wb.add_worksheet("Overview"); o.set_column(0,0,36); o.set_column(1,1,80); o.merge_range("A1:B1","TCOS Mainstream Sports Checklist Coverage",title)
    vals=(("Raw exact-key sets",m["rawExactSets"]),("Canonical sets after dedupe",m["canonicalSets"]),("Duplicate records removed",m["duplicateSetRecordsRemoved"]),("Duplicate groups",m["duplicateGroups"]),("Sets with checklist rows",m["setsWithChecklistRows"]),("Sets missing checklist rows",m["setsMissingChecklistRows"]),("Known-set checklist readiness",m["knownSetChecklistReadiness"]),("Limitation",m["limitation"]))
    for y,(a,b) in enumerate(vals,1): o.write(y,0,a,head); o.write(y,1,b,pct if a.startswith("Known-set") else wrap)
    s=wb.add_worksheet("Sets"); h=("Sport","Year","Season","Manufacturer","Product","Ready","Unique Rows","Duplicates Collapsed","Sources","Workbook Path","Canonical Key","Aliases")
    for x,a in enumerate(h): s.write(0,x,a,head); s.set_column(x,x,(16,9,12,20,42,10,14,18,10,75,70,60)[x])
    for y,r in enumerate(rows,1):
        v=(r["sport"],r["year"],r["season"],r["manufacturer"],r["product"],"YES" if r["reportedRowsMaximum"]>0 else "NO",r["uniqueCardRows"],r["duplicateRecordsCollapsed"],r["sourceItems"],r["workbookPath"],r["canonicalSetKey"]," | ".join(r["aliases"]))
        for x,z in enumerate(v): s.write(y,x,z,wrap if x in (4,9,10,11) else cell)
    s.freeze_panes(1,0); s.autofilter(0,0,len(rows),len(h)-1)
    d=wb.add_worksheet("Duplicate Groups"); dh=("Canonical Key","Sport","Season","Manufacturer","Product","Records Collapsed","Aliases","Exact Keys")
    for x,a in enumerate(dh): d.write(0,x,a,head); d.set_column(x,x,(70,16,12,20,42,18,80,100)[x])
    for y,r in enumerate(dups,1):
        for x,k in enumerate(("canonicalSetKey","sport","season","manufacturer","product","recordsCollapsed","aliases","exactSetKeys")): d.write(y,x,r[k],wrap if x in (0,4,6,7) else cell)
    wb.close()
def main():
    a=argparse.ArgumentParser(); a.add_argument("--master-root",default=os.getenv("CHECKLIST_MASTER_ROOT",".card-checklist-master-archive")); a.add_argument("--output",default=os.getenv("CHECKLIST_WORKBOOK_OUTPUT",".card-checklist-set-workbooks")); a.add_argument("--start-year",type=int,default=int(os.getenv("CHECKLIST_WORKBOOK_START_YEAR","2000"))); a.add_argument("--end-year",type=int,default=int(os.getenv("CHECKLIST_WORKBOOK_END_YEAR","2026"))); a.add_argument("--workers",type=int,default=int(os.getenv("CHECKLIST_WORKBOOK_WORKERS","4"))); a.add_argument("--limit",type=int); a.add_argument("--clean",action="store_true"); x=a.parse_args()
    root=Path(x.master_root).resolve(); out=Path(x.output).resolve()
    if x.clean and out.exists(): shutil.rmtree(out)
    out.mkdir(parents=True,exist_ok=True); tasks,dups,m=build(root,out,x.start_year,x.end_year,x.limit)
    if x.workers<=1:
        rows=[write_one(t) for t in tasks]
    else:
        with ProcessPoolExecutor(max_workers=x.workers) as ex: rows=list(ex.map(write_one,tasks,chunksize=1))
    rows.sort(key=lambda r:(r["sport"],r["year"],r["manufacturer"].lower(),r["product"].lower())); m.update({"generatedWorkbooks":len(rows),"generatedWorkbookBytes":sum(r["workbookBytes"] for r in rows),"parsedUniqueCardRows":sum(r["uniqueCardRows"] for r in rows),"duplicateCardRowsRemoved":sum(r["duplicateCardRowsRemoved"] for r in rows)})
    (out/"manifest.json").write_text(json.dumps(m,indent=2)+"\n"); (out/"set-workbooks.json").write_text(json.dumps(rows,indent=2)+"\n"); (out/"duplicate-set-groups.json").write_text(json.dumps(dups,indent=2)+"\n")
    write_csv(out/"set-workbooks.csv",rows,["sport","year","season","manufacturer","product","canonicalSetKey","duplicateRecordsCollapsed","sourceItems","reportedRowsMaximum","parsedRows","uniqueCardRows","duplicateCardRowsRemoved","workbookPath","workbookBytes","aliases","exactSetKeys"]); write_csv(out/"duplicate-set-groups.csv",dups,["canonicalSetKey","sport","season","manufacturer","product","recordsCollapsed","aliases","exactSetKeys"]); write_index(out,m,rows,dups); print(json.dumps(m))
if __name__=="__main__": main()
