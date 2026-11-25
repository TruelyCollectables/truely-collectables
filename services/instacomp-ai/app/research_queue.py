"""Kingmaker market research. Explicitly authorized, read-only, checkpointed jobs."""
from __future__ import annotations
import asyncio, calendar, hashlib, json, math, re, sqlite3, statistics, time, uuid, secrets, os, tempfile, unicodedata
from contextlib import closing
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from .config import settings
from .market_comp_routes import (
    _canonical_identity, _search_ebay_ladder, _query_ladder,
    _strong_exact_title, _BROWSER_LOCK, _search_ebay_price_guide_candidates, _search_ebay, _search_ebay_active, _item_id,
)
from .research_sources import archive_sales, licensed_sales, licensed_configured
TZ = ZoneInfo("America/Denver")
UNSWORTH = Path("/Volumes/Fanxiang S101 2TB/Projects/Unsworth")
WORKER_STATUS = UNSWORTH / "workers" / "market-research.json"
LISTED = {"all3","both","ebay","ebay_mercari","mercari","website","website_mercari"}

class Command(BaseModel):
    action: Literal["list","create","run","pause","resume","cancel","edit","delete","results","history","enable_schedule","disable_schedule","preview","health"]
    id: str = ""
    run_id: str = ""
    name: str = Field(default="Research", min_length=1, max_length=100)
    kind: Literal["bulk_recomp","price_guide","investment_stash","stale_listing","market_trend","pricing_opportunity","individual"] = "bulk_recomp"
    scope: Literal["all","investment","pending","listed","need_pricing","selected"] = "pending"
    selected_ids: list[str] = Field(default_factory=list, max_length=500)
    minimum: float = Field(default=0, ge=0)
    maximum: float = Field(default=100000, ge=0)
    days: Literal[30,90,180,365] = 90
    limit: int = Field(default=10, ge=1, le=500)
    keyword: str = Field(default="", max_length=100)
    sport: str = Field(default="", max_length=60)
    player: str = Field(default="", max_length=100)
    year: str = Field(default="", max_length=20)
    product: str = Field(default="", max_length=100)
    stale_days: int = Field(default=30, ge=1, le=365)
    source: Literal["ebay_live","seller_hub_archive","licensed_api"] = "ebay_live"
    mode: Literal["research_only","recommend"] = "research_only"
    cadence: Literal["manual","daily","nightly","weekly","monthly","custom"] = "manual"
    hour: int = Field(default=2, ge=0, le=23)
    minute: int = Field(default=0, ge=0, le=59)
    weekdays: list[int] = Field(default_factory=lambda:[6], max_length=7)
    month_day: int = Field(default=1, ge=1, le=31)

def norm(value):
    return re.sub(r"[^a-z0-9]+"," ",unicodedata.normalize("NFKD",str(value or "")).encode("ascii","ignore").decode().casefold()).strip()

def obj(value):
    return value if isinstance(value,dict) else {}

def number(value, default=0):
    try:
        v=float(value)
        return v if math.isfinite(v) else default
    except (TypeError,ValueError): return default

def next_due(cfg, after):
    if cfg["cadence"]=="manual": return None
    dt=datetime.fromtimestamp(after,TZ)
    for n in range(370):
        day=dt.date()+timedelta(days=n)
        cadence=cfg["cadence"]
        if cadence in ("weekly","custom") and day.weekday() not in cfg["weekdays"]: continue
        if cadence=="monthly" and day.day!=min(cfg["month_day"],calendar.monthrange(day.year,day.month)[1]): continue
        local=datetime(day.year,day.month,day.day,cfg["hour"],cfg["minute"],tzinfo=TZ)
        stamp=local.timestamp()
        if stamp>after: return stamp
    raise ValueError("No next schedule date")

def normalized_config(raw):
    return Command(action="create",**{k:v for k,v in raw.items() if k not in ("action","id","run_id")}).model_dump(exclude={"action","id","run_id"})

def identity_for(r):
    m=obj(r.get("metadata"));ic=obj(m.get("instacomp"));sr=obj(m.get("seller_review"))
    if not (ic.get("trustedForIdentity") is True or ic.get("humanVerified") is True or sr.get("identity_confirmed") is True):
        return None,"Unverified identity"
    merged={}
    for layer in (obj(m.get("identity")),obj(ic.get("ai")),obj(ic.get("identity")),obj(obj(ic.get("checklistIdentity")).get("lockedFields")),obj(ic.get("manualIdentity")) if ic.get("manualIdentityLocked") else {}):
        merged.update({k:v for k,v in layer.items() if v not in (None,"")})
    title=str(r.get("title") or "")
    # Recover explicitly printed fields, only on already verified records.
    year=re.match(r"(20\d\d(?:-\d\d)?|19\d\d(?:-\d\d)?)\b",title)
    card=re.search(r"#([A-Za-z0-9-]+)",title)
    if year: merged.setdefault("year",year.group(1))
    if card: merged.setdefault("cardNumber",card.group(1))
    if r.get("player"): merged.setdefault("player",r["player"])
    if "Young Guns" in title and ("UD S1" in title or "Series 1" in title):
        merged.setdefault("product","Upper Deck Series 1");merged.setdefault("manufacturer","Upper Deck");merged.setdefault("brand","Upper Deck");merged.setdefault("subset","Young Guns");merged.setdefault("setName","Young Guns")
        if norm(merged.get("product")) in ("series 1","ud s1","upper deck series 1 hockey"):merged["product"]="Upper Deck Series 1"
        match=re.search(r"Young Guns #\S+ (.+?)(?: RC)?$",title)
        if match and (not merged.get("player") or merged["player"]==title): merged["player"]=match.group(1)
        merged.setdefault("parallel","Base")
    if "Topps Flagship Football" in title:
        merged.setdefault("product","Topps Flagship Football");merged.setdefault("manufacturer","Topps")
    if merged.get("player"): merged["player"]=re.sub(r"\s+RC$","",str(merged["player"])).strip()
    asset=obj(m.get("collectible_asset"))
    if not merged.get("parallel") and asset.get("parallel_name"): merged["parallel"]=asset["parallel_name"]
    if not any(merged.get(k) for k in ("serialNumber","serial_number","serialRun","serial_run")) and asset.get("print_run"):
        merged["serialRun"]="/"+str(asset["print_run"]).lstrip("/")
    ident=_canonical_identity(merged)
    if not all(ident.get(k) for k in ("year","player","card_number","product")) or ident.get("player")==title: return None,"Incomplete verified identity"
    if not ident.get("parallel"):
        # Blank is the market comparator's unmodified/base finish, not a fabricated variant.
        ident["parallel"]=""
    sport=str(r.get("sport") or merged.get("sport") or "").strip()
    if not sport:
        sport=next((s for s in ("Hockey","Football","Basketball","Baseball","Soccer") if s.casefold() in title.casefold()),"")
    ident["sport"]=sport
    return ident,""

def identity_key(ident):
    fields={k:norm(ident.get(k)) for k in ("year","player","card_number","manufacturer","product","subset","parallel","grading_company","grade_value")}
    if fields["parallel"] in ("base","base set"): fields["parallel"]=""
    serial=str(ident.get("serial_number") or "")
    fields["serial"]=serial.rsplit("/",1)[-1].strip()
    fields["auto"]=bool(ident.get("is_auto"));fields["relic"]=bool(ident.get("is_relic"))
    return hashlib.sha256(json.dumps(fields,sort_keys=True).encode()).hexdigest()

class DeferredResearch(Exception):pass

class Queue:
    def __init__(self,path,inventory):
        self.path=Path(path);self.inventory=Path(inventory)
        with closing(self.db()) as c,c:
            c.executescript("""
            CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,config TEXT NOT NULL,state TEXT NOT NULL,created REAL NOT NULL,note TEXT DEFAULT '',failures INTEGER DEFAULT 0);
            CREATE TABLE IF NOT EXISTS items(job TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,result TEXT,PRIMARY KEY(job,id));
            CREATE TABLE IF NOT EXISTS research_runs(id TEXT PRIMARY KEY,job TEXT NOT NULL,started REAL NOT NULL,finished REAL,state TEXT NOT NULL,config TEXT NOT NULL,trigger TEXT NOT NULL,note TEXT DEFAULT '');
            CREATE TABLE IF NOT EXISTS research_items(run TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,result TEXT,PRIMARY KEY(run,id));
            CREATE INDEX IF NOT EXISTS research_runs_job ON research_runs(job,started);
            """)
            cols={r["name"] for r in c.execute("PRAGMA table_info(jobs)")}
            for key,typ in [("active_run","TEXT"),("schedule_enabled","INTEGER NOT NULL DEFAULT 0"),("next_due","REAL"),("last_success","REAL")]:
                if key not in cols:c.execute(f"ALTER TABLE jobs ADD COLUMN {key} {typ}")
            # Preserve any jobs created by the preliminary queue.
            for j in c.execute("SELECT * FROM jobs WHERE active_run IS NULL").fetchall():
                old=c.execute("SELECT * FROM items WHERE job=?",(j["id"],)).fetchall()
                if not old:continue
                run=str(uuid.uuid4())
                state="paused" if j["state"]=="running" else j["state"]
                c.execute("INSERT INTO research_runs(id,job,started,state,config,trigger,note) VALUES(?,?,?,?,?,?,?)",(run,j["id"],j["created"],state,j["config"],"legacy",j["note"]))
                c.executemany("INSERT INTO research_items(run,id,payload,state,result) VALUES(?,?,?,?,?)",[(run,r["id"],r["payload"],"queued" if r["state"]=="running" else r["state"],r["result"]) for r in old])
                c.execute("UPDATE jobs SET active_run=?,state=? WHERE id=?",(run,state,j["id"]))
            c.execute("UPDATE jobs SET state='paused',schedule_enabled=0,next_due=NULL,note='Interrupted by restart; resume explicitly' WHERE state='running'")
            c.execute("UPDATE research_runs SET state='paused' WHERE state='running'")
            c.execute("UPDATE research_items SET state='queued' WHERE state='running'")
        self._lock=asyncio.Lock()
    def db(self):
        c=sqlite3.connect(self.path,timeout=10);c.row_factory=sqlite3.Row;return c
    def select(self,cfg):
        cfg=normalized_config(cfg)
        with closing(sqlite3.connect(str(self.inventory),timeout=10)) as c:
            c.execute("PRAGMA query_only=ON")
            rows=c.execute("""SELECT p.inventory_item_id,p.folder,p.pending_queue,p.group_key,p.row_json,c.raw_json,c.player,c.sport
                FROM master_listing_projection p LEFT JOIN commercial_inventory c USING(inventory_item_id) ORDER BY p.inventory_item_id""").fetchall()
        selected={};skips={};matched=0
        def skip(reason):skips[reason]=skips.get(reason,0)+1
        for iid,folder,pq,group,raw,source,player,sport in rows:
            r=json.loads(raw)
            source_m=obj(json.loads(source)) if source else {}
            projection_m=obj(r.get("metadata"))
            r["metadata"]={**source_m,**projection_m,"instacomp":{**obj(source_m.get("instacomp")),**obj(projection_m.get("instacomp"))}}
            if sport and not r.get("sport"):r["sport"]=sport
            if player and player!=r.get("title") and not r.get("player"):r["player"]=player
            scope=cfg["scope"];status=str(r.get("status") or "").lower()
            if scope=="selected" and iid not in cfg["selected_ids"]:continue
            if scope=="listed" and (folder not in LISTED or status!="active"):continue
            if scope=="pending" and folder!="pending" and pq!="redo_pending_resale":continue
            if scope in ("investment","need_pricing") and folder!=scope:continue
            if cfg["kind"]=="investment_stash" and folder!="investment":continue
            if folder=="investment" and cfg["mode"]!="research_only":continue
            if status in ("sold","deleted","archived"):continue
            price=number(r.get("price"))
            if not cfg["minimum"]<=price<=cfg["maximum"] or norm(cfg["keyword"]) not in norm(r.get("title")):continue
            matched+=1
            ident,reason=identity_for(r)
            if not ident:skip(reason);continue
            if any(norm(cfg[k]) not in norm(ident.get(k)) for k in ("sport","player","year","product")):skip("Identity filter");continue
            if cfg["kind"]=="stale_listing":
                if folder not in LISTED or status!="active":skip("Not an active listing");continue
                ic=obj(obj(r.get("metadata")).get("instacomp"));checked=ic.get("pricingCheckedAt")
                try:
                    when=datetime.fromisoformat(str(checked).replace("Z","+00:00"))
                    if when.tzinfo is None:when=when.replace(tzinfo=timezone.utc)
                    if datetime.now(timezone.utc)-when<timedelta(days=cfg["stale_days"]):skip("Price recently checked");continue
                except (TypeError,ValueError):pass
            key=identity_key(ident)
            if key in selected:
                selected[key]["ids"].append(iid);skip("Duplicate identity");continue
            if len(selected)>=cfg["limit"]:skip("Card limit");continue
            selected[key]={"ids":[iid],"title":r.get("title",""),"identity":ident,"price":price,"folder":folder}
        return [(p["ids"][0],json.dumps(p)) for p in selected.values()],{"matched":matched,"selected":len(selected),"skipped":skips}
    def candidates(self,cfg):return self.select(cfg)[0]
    def _jobs(self,c):
        return [dict(x) for x in c.execute("""SELECT j.*,
        (SELECT count(*) FROM research_items i WHERE i.run=j.active_run) total,
        (SELECT count(*) FROM research_items i WHERE i.run=j.active_run AND i.state='done') done
        FROM jobs j WHERE j.state!='deleted' ORDER BY j.created DESC LIMIT 500""")]
    def _start(self,c,j,trigger):
        if c.execute("SELECT 1 FROM jobs WHERE state='running' LIMIT 1").fetchone() or c.execute("SELECT 1 FROM research_items WHERE state='running' LIMIT 1").fetchone():raise HTTPException(409,"Another research job is running or finishing a card")
        if j["state"] in ("cancelled","deleted","running"):raise HTTPException(409,"Job cannot be started")
        if j["active_run"] and c.execute("SELECT 1 FROM research_items WHERE run=? AND state IN ('queued','running')",(j["active_run"],)).fetchone():raise HTTPException(409,"Resume or cancel the existing run")
        cfg=normalized_config(json.loads(j["config"]));rows,summary=self.select(cfg);rid=str(uuid.uuid4());now=time.time()
        state="running" if rows else "completed";note="" if rows else "No eligible cards; review selection filters"
        c.execute("INSERT INTO research_runs(id,job,started,finished,state,config,trigger,note) VALUES(?,?,?,?,?,?,?,?)",(rid,j["id"],now,None if rows else now,state,json.dumps(cfg),trigger,note))
        c.executemany("INSERT INTO research_items(run,id,payload,state) VALUES(?,?,?,'queued')",[(rid,i,p) for i,p in rows])
        due=next_due(cfg,now) if j["schedule_enabled"] else None
        c.execute("UPDATE jobs SET active_run=?,state=?,note=?,failures=0,next_due=? WHERE id=?",(rid,state,note,due,j["id"]))
        return summary
    def command(self,q):
        cfg=q.model_dump(exclude={"action","id","run_id"});a=q.action
        if a in ("create","edit","preview"):
            if q.source!="ebay_live" and q.mode!="research_only":raise HTTPException(400,"Alternate sources are research-only")
            if q.source!="ebay_live" and q.kind=="price_guide":raise HTTPException(400,"Historical eBay Price Guide requires its own live provider")
            if q.source=="seller_hub_archive" and q.cadence!="manual":raise HTTPException(400,"Archived evidence is not a recurring fresh research source")
            if q.source=="licensed_api" and not licensed_configured():raise HTTPException(409,"Licensed API not configured")
            if q.maximum<q.minimum:raise HTTPException(400,"Invalid price range")
            if q.scope=="selected" and not q.selected_ids:raise HTTPException(400,"Select at least one card")
            if q.cadence in ("weekly","custom") and (not q.weekdays or any(d<0 or d>6 for d in q.weekdays)):raise HTTPException(400,"Select valid weekdays")
            if (q.kind=="investment_stash" or q.scope=="investment") and (q.scope!="investment" or q.mode!="research_only"):raise HTTPException(400,"Investment Stash must be research only")
        if a=="health":
            with closing(self.db()) as c:
                jobs=self._jobs(c)
            return {"ok":True,"health":{"worker":self.worker_health(jobs),"investment_stash":self.native_status()}}
        if a=="preview":
            rows,summary=self.select(cfg);return {"ok":True,"summary":summary,"items":[{"id":i,"payload":p} for i,p in rows]}
        with closing(self.db()) as c,c:
            c.execute("BEGIN IMMEDIATE")
            if a=="create":
                jid=str(uuid.uuid4());c.execute("INSERT INTO jobs(id,config,state,created) VALUES(?,?,'paused',?)",(jid,json.dumps(cfg),time.time()))
            elif a=="list":pass
            else:
                j=c.execute("SELECT * FROM jobs WHERE id=? AND state!='deleted'",(q.id,)).fetchone()
                if not j:raise HTTPException(404,"Job not found")
                state=j["state"];jid=j["id"];run=j["active_run"]
                if a=="history":
                    return {"ok":True,"runs":[dict(r) for r in c.execute("SELECT * FROM research_runs WHERE job=? ORDER BY started DESC LIMIT 500",(jid,))]}
                if a=="results":
                    rid=q.run_id or run
                    if not rid:return {"ok":True,"items":[]}
                    if not c.execute("SELECT 1 FROM research_runs WHERE id=? AND job=?",(rid,jid)).fetchone():raise HTTPException(404,"Run not found")
                    return {"ok":True,"items":[dict(x) for x in c.execute("SELECT id,payload,state,result FROM research_items WHERE run=? ORDER BY id",(rid,))]}
                if a=="edit" and state!="running":
                    if run and c.execute("SELECT 1 FROM research_items WHERE run=? AND state IN ('queued','running')",(run,)).fetchone():raise HTTPException(409,"Cancel or finish the paused execution before editing")
                    c.execute("UPDATE jobs SET config=?,schedule_enabled=0,next_due=NULL,state='paused' WHERE id=?",(json.dumps(cfg),jid))
                elif a=="run":self._start(c,j,"manual")
                elif a=="pause" and state=="running":
                    c.execute("UPDATE jobs SET state='paused',schedule_enabled=0,next_due=NULL,note='Paused by operator' WHERE id=?",(jid,))
                    c.execute("UPDATE research_runs SET state='paused' WHERE id=?",(run,))
                elif a=="resume" and state=="paused" and run and c.execute("SELECT 1 FROM research_items WHERE run=? AND state='queued'",(run,)).fetchone():
                    if c.execute("SELECT 1 FROM jobs WHERE state='running'").fetchone() or c.execute("SELECT 1 FROM research_items WHERE state='running'").fetchone():raise HTTPException(409,"Another research job is running or finishing a card")
                    c.execute("UPDATE jobs SET state='running',failures=0,note='' WHERE id=?",(jid,))
                    c.execute("UPDATE research_runs SET state='running' WHERE id=?",(run,))
                elif a=="cancel" and state in ("paused","running"):
                    c.execute("UPDATE jobs SET state='cancelled',schedule_enabled=0,next_due=NULL WHERE id=?",(jid,))
                    c.execute("UPDATE research_runs SET state='cancelled',finished=? WHERE id=?",(time.time(),run))
                    c.execute("UPDATE research_items SET state='cancelled' WHERE run=? AND state='queued'",(run,))
                elif a=="delete" and state!="running":
                    if run and c.execute("SELECT 1 FROM research_items WHERE run=? AND state='running'",(run,)).fetchone():raise HTTPException(409,"Wait for current card to stop")
                    c.execute("UPDATE jobs SET state='deleted',schedule_enabled=0,next_due=NULL WHERE id=?",(jid,))
                elif a=="enable_schedule" and state in ("paused","completed"):
                    old=normalized_config(json.loads(j["config"]))
                    if old["scope"]=="investment" or old["kind"]=="investment_stash":raise HTTPException(409,"Native Unsworth Investment Stash schedule owns this job; no duplicate schedule")
                    if run and c.execute("SELECT 1 FROM research_items WHERE run=? AND state IN ('queued','running')",(run,)).fetchone():raise HTTPException(409,"Finish or cancel the paused run first")
                    due=next_due(old,time.time())
                    if due is None:raise HTTPException(400,"Configure a recurring schedule first")
                    c.execute("UPDATE jobs SET schedule_enabled=1,next_due=?,note='' WHERE id=?",(due,jid))
                elif a=="disable_schedule":c.execute("UPDATE jobs SET schedule_enabled=0,next_due=NULL WHERE id=?",(jid,))
                else:raise HTTPException(409,"Action not allowed in current job state")
            return {"ok":True,"jobs":self._jobs(c)}
    def schedule(self,now=None):
        now=time.time() if now is None else now
        with closing(self.db()) as c,c:
            c.execute("BEGIN IMMEDIATE")
            if c.execute("SELECT 1 FROM jobs WHERE state='running'").fetchone() or c.execute("SELECT 1 FROM research_items WHERE state='running'").fetchone():return
            j=c.execute("SELECT * FROM jobs WHERE schedule_enabled=1 AND next_due<=? AND state IN ('paused','completed') ORDER BY next_due LIMIT 1",(now,)).fetchone()
            if j:self._start(c,j,"scheduled")
    @staticmethod
    def native_status():
        try:
            status=json.loads((UNSWORTH/"workers"/"investment-stash.json").read_text())
            return {k:status.get(k) for k in ("name","state","last_run","last_run_ok","schedule_local","timezone","detail")}
        except (OSError,ValueError):return {"state":"unavailable"}
    def worker_health(self,jobs=None):
        if jobs is None:
            with closing(self.db()) as c:jobs=self._jobs(c)
        return {"name":"market-research","owner":"Unsworth","state":"attention" if any(j["failures"] for j in jobs) else "running" if any(j["state"]=="running" for j in jobs) else "idle","last_run":datetime.now(TZ).isoformat(),"last_run_ok":not any(j["failures"] for j in jobs),"detail":{"jobs":len(jobs),"running":sum(j["state"]=="running" for j in jobs),"scheduled":sum(bool(j["schedule_enabled"]) for j in jobs),"paused_with_errors":sum(bool(j["failures"]) for j in jobs),"failures":[{"id":j["id"],"note":j["note"]} for j in jobs if j["failures"]],"next_due":min((j["next_due"] for j in jobs if j["next_due"]),default=None)}}
    def publish_health(self):
        # Only the canonical production queue publishes Unsworth worker state.
        if self.path.name!="kingmaker_research.sqlite3" or self.inventory.name!="kingmaker_commercial_inventory.sqlite3" or not WORKER_STATUS.parent.is_dir():return
        status=self.worker_health()
        fd,tmp=tempfile.mkstemp(dir=WORKER_STATUS.parent,prefix=".market-research-")
        try:
            with os.fdopen(fd,"w") as f:json.dump(status,f,allow_nan=False);f.flush();os.fsync(f.fileno())
            os.replace(tmp,WORKER_STATUS)
        finally:
            if os.path.exists(tmp):os.unlink(tmp)
    async def provider(self,queries,identity):
        """Stop at first provider error; never retry a CAPTCHA or authentication block."""
        from .scan_priority import scan_priority_active
        rows=[];seen=set();attempts=[]
        for query in list(dict.fromkeys(queries))[:3]:
            if scan_priority_active():raise DeferredResearch("Foreground scan priority")
            batch,coverage=await _search_ebay(query)
            status=coverage.get("status")
            attempts.append({"query":query,"status":status,"rawCount":len(batch),"message":coverage.get("message"),"searchUrl":coverage.get("searchUrl")})
            if status not in ("live","no_matches"):
                return [],{"status":status or "error","attempts":attempts,"message":coverage.get("message")}
            for row in batch:
                key=_item_id(str(row.get("url","")))
                if key and key not in seen:seen.add(key);rows.append(row)
            if any(_strong_exact_title(r["title"],identity)[0] for r in rows):break
        return rows,{"status":"live" if rows else "no_matches","attempts":attempts,"resultCount":len(rows)}
    async def tick(self,search=None):
        async with self._lock:
            if search is None:
                # Never queue background work ahead of an active interactive scan.
                from .scan_priority import scan_priority_active
                if scan_priority_active() or _BROWSER_LOCK.locked():return
                # Fail closed if the market provider does not have the isolated broker.
                from . import market_comp_routes
                import inspect
                if "BrowserTask" not in inspect.getsource(market_comp_routes._run_osascript):
                    raise RuntimeError("Headless provider not installed; research refused")
            self.schedule()
            with closing(self.db()) as c,c:
                c.execute("BEGIN IMMEDIATE")
                row=c.execute("""SELECT i.*,r.config,r.job FROM research_items i JOIN research_runs r ON r.id=i.run JOIN jobs j ON j.active_run=r.id WHERE j.state='running' AND i.state='queued' ORDER BY r.started,i.id LIMIT 1""").fetchone()
                if not row:return
                c.execute("UPDATE research_items SET state='running' WHERE run=? AND id=?",(row["run"],row["id"]))
            p=json.loads(row["payload"]);cfg=normalized_config(json.loads(row["config"]));failure=None
            archive_rows=[];archive_coverage=None
            try:
                if cfg["source"]=="seller_hub_archive":
                    rows,coverage=await asyncio.to_thread(archive_sales,p,cfg["days"],_strong_exact_title)
                    guide=None;guide_coverage=None
                    if coverage["status"]=="archive_unavailable":raise RuntimeError(coverage["message"])
                elif cfg["source"]=="licensed_api":
                    rows,coverage=await licensed_sales(p["identity"],cfg["days"],_strong_exact_title)
                    guide=None;guide_coverage=None
                    if coverage["status"] not in ("live","no_matches"):raise RuntimeError(coverage["message"])
                else:
                    async with _BROWSER_LOCK:
                        rows,coverage=await (search or self.provider)(_query_ladder(p["identity"],p["title"]),p["identity"])
                        if coverage.get("status") not in ("live","no_matches") or any(a.get("status") not in ("live","no_matches") for a in coverage.get("attempts",[])):raise RuntimeError("Provider unavailable: "+str(coverage.get("status"))+" — "+str(coverage.get("message") or ""))
                        guide=None;guide_coverage=None
                        if cfg["kind"]=="price_guide":
                            exact=[r for r in rows if _strong_exact_title(r["title"],p["identity"])[0]]
                            if not exact:
                                from .scan_priority import scan_priority_active
                                if scan_priority_active():raise DeferredResearch("Foreground scan priority")
                                active,ac=await _search_ebay_active(_query_ladder(p["identity"],p["title"])[0])
                                if ac.get("status") not in ("live","no_matches"):raise RuntimeError("Price Guide listing lookup unavailable: "+str(ac.get("message") or ac.get("status")))
                                exact=[r for r in active if _strong_exact_title(r["title"],p["identity"])[0]]
                            from .scan_priority import scan_priority_active
                            if scan_priority_active():raise DeferredResearch("Foreground scan priority")
                            guide,guide_coverage=await _search_ebay_price_guide_candidates(exact,p["identity"],max_attempts=1)
                            if guide_coverage.get("status") in ("error","challenge"):raise RuntimeError("Price Guide unavailable: "+str(guide_coverage.get("message")))
                cutoff=datetime.now(timezone.utc).date()-timedelta(days=cfg["days"]);sold=[];evidence_seen=set()
                for r in rows:
                    if not _strong_exact_title(r["title"],p["identity"])[0] or r.get("shipping_price") is None or r.get("best_offer_unknown") is not False:continue
                    key=_item_id(str(r.get("url","")))
                    if not key or key in evidence_seen:continue
                    try:
                        date=datetime.fromisoformat(r["sold_at"]).date()
                        if not cutoff<=date<=datetime.now(timezone.utc).date():continue
                        item=float(r["item_price"]);shipping=float(r["shipping_price"])
                        if math.isfinite(item+shipping) and item>0 and shipping>=0:
                            evidence_seen.add(key)
                            sold.append({"price":round(item+shipping,2),"item_price":item,"shipping_price":shipping,"date":r["sold_at"],"url":r["url"],"title":r["title"],"source":r.get("source","ebay_direct"),"capturedAt":r.get("captured_at")})
                    except (ValueError,TypeError,KeyError):continue
                median=statistics.median([r["price"] for r in sold]) if sold else None
                result={"coverage":coverage,"sold":sold,"median":median,"checkedAt":datetime.now(timezone.utc).isoformat(),"lookbackDays":cfg["days"],"coverageComplete":False,"note":coverage.get("message") or "Public eBay sold search does not guarantee the full requested period; no valuation is inferred from missing rows.","priceGuide":guide,"priceGuideCoverage":guide_coverage}
                if cfg["source"]=="ebay_live" and cfg["mode"]=="recommend" and p.get("folder")!="investment" and median is not None and len(sold)>=3:
                    result["recommendation"]={"price":round(max(2.99,math.floor(median*1.25)+.99),2),"status":"approval_required","currentPrice":p.get("price"),"note":"Recommendation only; never applied by research."}
            except DeferredResearch:
                with closing(self.db()) as c,c:
                    j=c.execute("SELECT state FROM jobs WHERE id=?",(row["job"],)).fetchone()
                    c.execute("UPDATE research_items SET state=? WHERE run=? AND id=?",("cancelled" if j["state"] in ("cancelled","deleted") else "queued",row["run"],row["id"]))
                return
            except Exception as e:
                failure=str(e)[:300];result={"error":failure}
                if cfg["source"]=="ebay_live" and search is None:
                    archive_rows,archive_coverage=await asyncio.to_thread(archive_sales,p,cfg["days"],_strong_exact_title)
                    result["archiveCoverage"]=archive_coverage
                    result["archivedSold"]=[{"price":round(r["item_price"]+r["shipping_price"],2),"item_price":r["item_price"],"shipping_price":r["shipping_price"],"date":r["sold_at"],"url":r["url"],"title":r["title"],"capturedAt":r["captured_at"],"source":"seller_hub_archive"} for r in archive_rows]
                    result["archivedMedian"]=statistics.median([r["price"] for r in result["archivedSold"]]) if archive_rows else None
                    result["note"]="Live provider failed. Archived data is separate historical evidence, never current pricing."
            with closing(self.db()) as c,c:
                c.execute("BEGIN IMMEDIATE");j=c.execute("SELECT state FROM jobs WHERE id=?",(row["job"],)).fetchone();state=j["state"]
                if state in ("cancelled","deleted"):
                    c.execute("UPDATE research_items SET state='cancelled' WHERE run=? AND id=?",(row["run"],row["id"]));return
                c.execute("UPDATE research_items SET state=?,result=? WHERE run=? AND id=?",("queued" if failure else "done",json.dumps(result),row["run"],row["id"]))
                if failure:
                    c.execute("UPDATE jobs SET state='paused',schedule_enabled=0,next_due=NULL,note=?,failures=failures+1 WHERE id=?",(failure,row["job"]))
                    c.execute("UPDATE research_runs SET state='paused',note=? WHERE id=?",(failure,row["run"]))
                elif not c.execute("SELECT 1 FROM research_items WHERE run=? AND state IN ('queued','running')",(row["run"],)).fetchone():
                    c.execute("UPDATE jobs SET state='completed',last_success=?,note='' WHERE id=?",(time.time(),row["job"]))
                    c.execute("UPDATE research_runs SET state='completed',finished=? WHERE id=?",(time.time(),row["run"]))
    async def loop(self):
        while True:
            await asyncio.sleep(30)
            try:
                await self.tick()
                await asyncio.to_thread(self.publish_health)
            except Exception as e:print("Research queue error:",str(e)[:200],flush=True)

def install(app,require_key,path,inventory):
    q=Queue(path,inventory)
    def strict_key(x_instacomp_ai_key: str|None=Header(default=None)):
        expected=settings.api_key
        if not expected or not x_instacomp_ai_key or not secrets.compare_digest(str(expected),x_instacomp_ai_key):
            raise HTTPException(401,"Invalid or missing research API key")
    router=APIRouter(dependencies=[Depends(strict_key)])
    @router.post("/v1/research-queue")
    def command(req:Command):return q.command(req)
    app.include_router(router)
    async def start():app.state.research_task=asyncio.create_task(q.loop())
    async def stop():
        app.state.research_task.cancel()
        try:await app.state.research_task
        except asyncio.CancelledError:pass
    app.add_event_handler("startup",start);app.add_event_handler("shutdown",stop)
