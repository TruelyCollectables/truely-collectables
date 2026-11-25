"""Research queue acceptance tests; never write to production inventory."""
import asyncio
import json
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from app import research_queue as rq

def fixture(path):
    with sqlite3.connect(path) as c:
        c.executescript("CREATE TABLE master_listing_projection(inventory_item_id TEXT PRIMARY KEY,folder TEXT,pending_queue TEXT,group_key TEXT,row_json TEXT); CREATE TABLE commercial_inventory(inventory_item_id TEXT PRIMARY KEY,raw_json TEXT,player TEXT,sport TEXT);")
        for i,player,price,folder,verified in [
            ("a","Caitlin Clark",20,"all3",True),("b","Caitlin Clark",20,"all3",True),
            ("c","Cameron Brink",30,"pending",True),("d","Caitlin Clark",20,"investment",True),
            ("e","Unverified Player",25,"need_pricing",False)]:
            title=f"2024 Panini Select WNBA {player} #72"
            meta={"instacomp":{"humanVerified":verified,"identity":{"year":"2024","manufacturer":"Panini","product":"Select WNBA","player":player,"cardNumber":"72","parallel":"Base","sport":"Basketball"}}}
            row={"title":title,"status":"active" if folder=="all3" else "draft","price":price,"sport":"Basketball","metadata":meta}
            c.execute("INSERT INTO master_listing_projection VALUES(?,?,?,?,?)",(i,folder,"listings","",json.dumps(row)))
            c.execute("INSERT INTO commercial_inventory VALUES(?,?,?,?)",(i,json.dumps(meta),player,"Basketball"))
def cmd(q,action,**kwargs):return q.command(rq.Command(action=action,**kwargs))
def create(q,**kwargs):return cmd(q,"create",**kwargs)["jobs"][0]["id"]
def job(q,i):return next(j for j in cmd(q,"list")["jobs"] if j["id"]==i)
def fake(query,ident):pass
async def sold(query,ident):
    date=datetime.now(timezone.utc).isoformat()
    title=f"2024 Panini Select WNBA {ident['player']} #72"
    return [{"title":title,"sold_at":date,"item_price":n,"shipping_price":2,"best_offer_unknown":False,"url":f"https://www.ebay.com/itm/{100000000001+k}"} for k,n in enumerate((10,12,14))],{"status":"live","attempts":[{"status":"live"}]}
async def blocked(query,ident):return [],{"status":"challenge","attempts":[{"status":"challenge"}]}
def test_job_lifecycle(tmp_path):
    inv=tmp_path/"inventory.db";fixture(inv);before=inv.read_bytes()
    q=rq.Queue(tmp_path/"jobs.db",inv)
    result=cmd(q,"preview",scope="listed",sport="Basketball",minimum=20,maximum=25)
    assert result["summary"]["selected"]==1 and result["summary"]["skipped"]["Duplicate identity"]==1
    assert cmd(q,"preview",scope="need_pricing")["summary"]["selected"]==0
    i=create(q,scope="listed",mode="recommend",limit=1);assert job(q,i)["state"]=="paused" and not job(q,i)["schedule_enabled"]
    cmd(q,"run",id=i);cmd(q,"pause",id=i);assert job(q,i)["state"]=="paused"
    cmd(q,"resume",id=i)
    q=rq.Queue(tmp_path/"jobs.db",inv);assert job(q,i)["state"]=="paused"
    cmd(q,"resume",id=i);asyncio.run(q.tick(sold))
    assert job(q,i)["state"]=="completed"
    r=json.loads(cmd(q,"results",id=i)["items"][0]["result"])
    assert r["median"]==14 and r["recommendation"]["price"]==17.99 and r["recommendation"]["status"]=="approval_required"
    assert inv.read_bytes()==before
    cmd(q,"run",id=i);asyncio.run(q.tick(blocked));assert job(q,i)["state"]=="paused" and job(q,i)["failures"]==1
    cmd(q,"cancel",id=i);assert job(q,i)["state"]=="cancelled"
    assert len(cmd(q,"history",id=i)["runs"])==2
    cmd(q,"delete",id=i);assert not cmd(q,"list")["jobs"]
    assert inv.read_bytes()==before
def test_schedule_and_restart(tmp_path):
    inv=tmp_path/"inventory.db";fixture(inv);q=rq.Queue(tmp_path/"jobs.db",inv)
    i=create(q,scope="pending",cadence="weekly",weekdays=[6],hour=2,minute=0)
    cmd(q,"enable_schedule",id=i);assert job(q,i)["next_due"]>time.time()
    due=datetime.fromtimestamp(job(q,i)["next_due"],rq.TZ);assert due.weekday()==6 and due.hour==2
    q=rq.Queue(tmp_path/"jobs.db",inv);assert job(q,i)["schedule_enabled"]
    with q.db() as c:c.execute("UPDATE jobs SET next_due=? WHERE id=?",(time.time()-2,i))
    q.schedule();q.schedule()
    assert len(cmd(q,"history",id=i)["runs"])==1
    asyncio.run(q.tick(sold));assert job(q,i)["state"]=="completed"
    assert job(q,i)["next_due"]>time.time()
    cmd(q,"disable_schedule",id=i);assert job(q,i)["next_due"] is None
    s=create(q,scope="investment",kind="investment_stash",cadence="weekly")
    try:cmd(q,"enable_schedule",id=s)
    except HTTPException as e:assert e.status_code==409
    else:raise AssertionError("duplicate native stash schedule enabled")
def test_provider_stops_after_block(tmp_path):
    inv=tmp_path/"inventory.db";fixture(inv);q=rq.Queue(tmp_path/"jobs.db",inv)
    calls=[]
    async def fail(query):
        calls.append(query);return [],{"status":"challenge","message":"CAPTCHA"}
    with patch.object(rq,"_search_ebay",fail),patch("app.scan_priority.scan_priority_active",return_value=False):
        rows,cov=asyncio.run(q.provider(["one","two","three"],{}))
    assert not rows and cov["status"]=="challenge" and calls==["one"]
def test_api_auth(tmp_path):
    inv=tmp_path/"inventory.db";fixture(inv);app=FastAPI();rq.install(app,None,tmp_path/"jobs.db",inv)
    with patch.object(rq.settings,"api_key","research-test-key"),TestClient(app) as c:
        assert c.post("/v1/research-queue",json={"action":"list"}).status_code==401
        h={"X-InstaComp-AI-Key":"research-test-key"}
        assert c.post("/v1/research-queue",headers=h,json={"action":"list"}).status_code==200
        assert c.post("/v1/research-queue",headers=h,json={"action":"health"}).status_code==200
    with patch.object(rq.settings,"api_key",None),TestClient(app) as c:
        assert c.post("/v1/research-queue",headers=h,json={"action":"list"}).status_code==401
