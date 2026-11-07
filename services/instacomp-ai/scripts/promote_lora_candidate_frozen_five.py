#!/usr/bin/env python3
from __future__ import annotations

import argparse, asyncio, hashlib, json, platform, subprocess, tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parents[1]
COMPLETION = SERVICE_ROOT / "data/training/deal-hunter-ai-learning-latest.json"
ENABLE = SERVICE_ROOT / "scripts/enable-lora-candidate-macos.sh"
DISABLE = SERVICE_ROOT / "scripts/disable-lora-candidate-macos.sh"
RECEIPTS = SERVICE_ROOT / "data/lora-candidate"
PROVIDER = "instacomp_lora_candidate"
FROZEN = (
    ("sonia-122-base", "Sonia Citron", "122", None, "2a7d4ddd-e9f7-4ce2-904c-b1a17b33ae4f", "4366f96b6cf8b136e5ae4da70c35539d56e1793de0a42bcccbf970a892791e59"),
    ("malonga-116-ice", "Dominique Malonga", "116", "ice", "bde0577b-72e8-4e59-8287-89aaf2f9e7e2", "112f66efaa6b13de4f33e18f632a5c364c8bd2895b610d157a538748c858ba32"),
    ("sonia-13-groovy", "Sonia Citron", "13", "groovy", "c58ffc4f-e1c7-4cd9-b6e2-599af5a29044", "dd4d9c92ff0cc4b985ef0b3aa29c8bcfb882ffe27021aa8809fde3c97db7a2ad"),
    ("paige-5-ice", "Paige Bueckers", "5", "ice", "575556fe-fdd4-4083-baee-c5071ed3161f", "66531f084322d986e26c569e12a152bada033904c67b7068c00572c3efaa7d42"),
    ("rickea-118-base", "Rickea Jackson", "118", None, "70ad307e-06bb-45c2-90ea-689b6e2f302e", "bdbf4845dae6d1da4d783fd23d9c387883769cd68aee3c663b144013bb891028"),
)


def norm(v: object) -> str: return " ".join(str(v or "").strip().casefold().split())
def now() -> str: return datetime.now(timezone.utc).isoformat()

def read_json(path: Path) -> dict[str, Any]:
    try: value = json.loads(path.read_text("utf-8"))
    except Exception as exc: raise RuntimeError(f"Invalid JSON: {path}") from exc
    if not isinstance(value, dict): raise RuntimeError(f"Expected JSON object: {path}")
    return value

def text(content: Any) -> str:
    if isinstance(content, str): return content
    if isinstance(content, list):
        return "\n".join(str(x.get("text") or "") for x in content if isinstance(x, dict) and x.get("type") == "text")
    return ""

def identity(row: dict[str, Any]) -> dict[str, Any]:
    try: answer = json.loads(text(row["messages"][-1]["content"]))
    except Exception as exc: raise RuntimeError(f"Bad teacher row: {row.get('id')}") from exc
    value = answer.get("identity") if isinstance(answer, dict) else None
    if not isinstance(value, dict): raise RuntimeError(f"Teacher identity missing: {row.get('id')}")
    return value

def matches(row: dict[str, Any], case: tuple) -> bool:
    _key, player, number, marker, _rid, _fp = case; card = identity(row)
    if norm(card.get("player")) != norm(player): return False
    if norm(card.get("card_number")).lstrip("#") != norm(number).lstrip("#"): return False
    if norm(card.get("year")) not in {"", "2025"}: return False
    variants = " ".join(norm(card.get(k)) for k in ("brand","set_name","subset","parallel","variation"))
    return not marker or marker in variants

def load_rows(dataset: Path) -> list[dict[str, Any]]:
    rows, seen = [], set()
    for split in ("train", "validation"):
        path = dataset / f"{split}.jsonl"
        if not path.is_file(): raise RuntimeError(f"Missing export split: {path}")
        for line in path.read_text("utf-8").splitlines():
            if not line.strip(): continue
            row = json.loads(line); row_id = str(row.get("id") or "")
            if not row_id or row_id in seen: raise RuntimeError(f"Missing/duplicate row id: {row_id!r}")
            seen.add(row_id); row["_split"] = split; rows.append(row)
    return rows

def fixtures(dataset: Path, require_images: bool = True) -> list[dict[str, Any]]:
    rows, out, used = load_rows(dataset), [], set()
    for case in FROZEN:
        candidates = [r for r in rows if matches(r, case)]
        if not candidates: raise RuntimeError(f"Frozen fixture missing: {case[1]} #{case[2]}")
        def rank(r):
            meta = r.get("metadata") if isinstance(r.get("metadata"), dict) else {}
            exact_id, exact_fp = norm(meta.get("registry_identity_id")) == norm(case[4]), norm(meta.get("registry_fingerprint_sha256")) == norm(case[5])
            return (0 if exact_id and exact_fp else 1 if exact_id or exact_fp else 2, 0 if r["_split"] == "validation" else 1, str(r["id"]))
        row = sorted(candidates, key=rank)[0]; row_id = str(row["id"])
        if row_id in used: raise RuntimeError(f"Frozen fixture reused: {row_id}")
        used.add(row_id); images = [Path(str(x)).expanduser().resolve() for x in row.get("images") or []]
        if not images: raise RuntimeError(f"Frozen fixture has no images: {case[0]}")
        if require_images and any(not p.is_file() for p in images): raise RuntimeError(f"Frozen fixture image missing: {case[0]}")
        out.append({"case":case,"row_id":row_id,"split":row["_split"],"images":images})
    if len(out) != 5: raise RuntimeError("Frozen-five resolver did not return five fixtures")
    return out

def file_sha(path: Path) -> str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024), b""): h.update(chunk)
    return h.hexdigest()

def completion_gate() -> tuple[dict[str,Any],Path,Path]:
    r=read_json(COMPLETION); checks=r.get("checks")
    if r.get("status") != "complete_and_validated" or r.get("complete") is not True: raise RuntimeError("Learning receipt is not complete_and_validated")
    if not isinstance(checks,dict) or not checks or not all(v is True for v in checks.values()): raise RuntimeError("Not every learning promotion check is true")
    if int(r.get("inventory_eligible_learned") or 0) != int(r.get("inventory_eligible_total") or -1): raise RuntimeError("Eligible inventory is not fully learned")
    if int(r.get("held_out_validation_examples") or 0) != 30: raise RuntimeError("Locked validation is not exactly 30")
    adapter=Path(str(r.get("adapter_directory") or "")).expanduser().resolve(); dataset=Path(str(r.get("dataset_path") or "")).expanduser().resolve()
    if not (adapter/"adapters.safetensors").is_file() or not dataset.is_dir(): raise RuntimeError("Validated adapter/dataset artifact is missing")
    return r,adapter,dataset

def suggestion_gate(s: dict[str,Any], adapter_sha: str) -> None:
    raw=s.get("raw")
    if s.get("provider") != PROVIDER: raise RuntimeError(f"Candidate provider was not used: {s.get('provider')!r}")
    if not isinstance(raw,dict) or raw.get("lora_candidate_fallback") is True: raise RuntimeError(f"Candidate fallback detected: {(raw or {}).get('lora_candidate_error')}")
    if raw.get("validation_eligible") is not True or norm(raw.get("adapter_weights_sha256")) != norm(adapter_sha): raise RuntimeError("Candidate provenance/adapter hash mismatch")

def registry_gate(r: dict[str,Any], case: tuple) -> None:
    key,player,number,_marker,rid,fp=case; ident=r.get("identity")
    if r.get("outcome") != "exact_match" or norm(r.get("identity_id")) != norm(rid): raise RuntimeError(f"Registry exact UUID regression: {key}")
    if f"registry_fingerprint:{fp}" not in (r.get("source_receipts") or []): raise RuntimeError(f"Registry fingerprint regression: {key}")
    if not isinstance(ident,dict) or norm(ident.get("player")) != norm(player) or norm(ident.get("card_number")).lstrip("#") != norm(number): raise RuntimeError(f"Registry identity regression: {key}")
def rounds_gate(rounds: list[dict[str,Any]]) -> None:
    wanted={c[0] for c in FROZEN}
    if len(rounds)!=2: raise RuntimeError("Exactly two Production rounds are required")
    for n,r in enumerate(rounds,1):
        cases=r.get("cases")
        if r.get("passed") is not True or not isinstance(cases,list) or len(cases)!=5 or {x.get("key") for x in cases}!=wanted: raise RuntimeError(f"Round {n} was not exact 5/5")
        if any(x.get("candidate_provider")!=PROVIDER or x.get("candidate_fallback") is True for x in cases): raise RuntimeError(f"Round {n} contains fallback/non-candidate evidence")

def visible(s) -> str:
    e=s.evidence
    return "\n".join(dict.fromkeys([*e.visible_text,*e.front_visible_text,*e.back_visible_text,*e.logos,*e.front_notes,*e.back_notes]))

async def run_round(number:int, fx:list[dict[str,Any]], adapter_sha:str) -> dict[str,Any]:
    from app.checklist import checklist_gateway
    from app.config import settings
    from app.local_vision import analyze_local_vision
    from app.ollama import OllamaReader
    if settings.lora_candidate_enabled is not True: raise RuntimeError("Candidate setting did not reload enabled")
    reader=OllamaReader(settings); out=[]
    for item in fx:
        case=item["case"]; paths=item["images"]; front=paths[0].read_bytes(); back=paths[1].read_bytes() if len(paths)>1 else None
        vision=await analyze_local_vision(front,back,settings); s=await reader.analyze(front,back,local_vision=vision); suggestion_gate(s.model_dump(mode="json"),adapter_sha)
        reg=await checklist_gateway.match(s.identity,visible(s)); registry_gate(reg.model_dump(mode="json"),case)
        out.append({"key":case[0],"player":case[1],"card_number":case[2],"fixture_row_id":item["row_id"],"fixture_split":item["split"],"candidate_provider":s.provider,"candidate_fallback":bool(s.raw.get("lora_candidate_fallback")),"candidate_identity":s.identity.model_dump(mode="json"),"registry_identity_id":reg.identity_id,"registry_fingerprint_sha256":case[5],"passed":True})
        print(f"ROUND {number} PASS {case[1]} #{case[2]} provider={s.provider} registry={reg.identity_id}",flush=True)
    return {"round":number,"passed":len(out)==5,"cases":out}

def activation_receipt(started:float,adapter:Path,sha:str) -> dict[str,Any]:
    for path in sorted(RECEIPTS.glob("activation-*.json"),key=lambda p:p.stat().st_mtime,reverse=True):
        if path.stat().st_mtime < started-2: continue
        r=read_json(path)
        if Path(str(r.get("adapter") or "")).expanduser().resolve()==adapter and norm(r.get("adapter_weights_sha256"))==norm(sha) and r.get("runtime_candidate_enabled") is True and r.get("validation_eligible") is True:
            r["_path"]=str(path); return r
    raise RuntimeError("Fresh matching activation receipt was not produced")
def write_receipt(data:dict[str,Any]) -> Path:
    RECEIPTS.mkdir(parents=True,exist_ok=True); path=RECEIPTS/f"frozen-five-promotion-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"; tmp=path.with_suffix(".json.tmp"); tmp.write_text(json.dumps(data,indent=2)+"\n","utf-8"); tmp.replace(path); return path

def self_test() -> int:
    with tempfile.TemporaryDirectory() as d:
        root=Path(d); img=root/"x.jpg"; img.write_bytes(b"x"); rows=[]
        for i,c in enumerate(FROZEN):
            ident={"player":c[1],"year":"2025","brand":"Panini","set_name":"Groovy" if c[3]=="groovy" else "Prizm WNBA","card_number":c[2],"parallel":"Prizms Ice" if c[3]=="ice" else "Base"}
            rows.append({"id":f"row-{i}","images":[str(img)],"messages":[{"content":[]},{"content":[{"type":"text","text":json.dumps({"identity":ident})}]}],"metadata":{"registry_identity_id":c[4],"registry_fingerprint_sha256":c[5]}})
        alt=json.loads(json.dumps(rows[0])); alt["id"]="zz-copy"; rows.append(alt); (root/"train.jsonl").write_text(""); (root/"validation.jsonl").write_text("".join(json.dumps(r)+"\n" for r in rows))
        assert [x["row_id"] for x in fixtures(root)]==[x["row_id"] for x in fixtures(root)] and fixtures(root)[0]["row_id"]=="row-0"
        sha="a"*64; good={"provider":PROVIDER,"raw":{"validation_eligible":True,"adapter_weights_sha256":sha}}; suggestion_gate(good,sha)
        bad=json.loads(json.dumps(good)); bad["raw"]["lora_candidate_fallback"]=True
        try: suggestion_gate(bad,sha); raise AssertionError("fallback accepted")
        except RuntimeError: pass
        c=FROZEN[0]; reg={"outcome":"exact_match","identity_id":c[4],"identity":{"player":c[1],"card_number":c[2]},"source_receipts":[f"registry_fingerprint:{c[5]}"]}; registry_gate(reg,c); reg["identity_id"]="wrong"
        try: registry_gate(reg,c); raise AssertionError("bad UUID accepted")
        except RuntimeError: pass
        good_cases=[{"key":c[0],"candidate_provider":PROVIDER,"candidate_fallback":False} for c in FROZEN]; rounds_gate([{"passed":True,"cases":good_cases},{"passed":True,"cases":good_cases}]); bad_cases=json.loads(json.dumps(good_cases)); bad_cases[-1]["candidate_fallback"]=True
        try: rounds_gate([{"passed":True,"cases":good_cases},{"passed":True,"cases":bad_cases}]); raise AssertionError("round-two fallback accepted")
        except RuntimeError: pass
    print("PASS fixture determinism\nPASS candidate provenance/fallback gate\nPASS Registry UUID/fingerprint gate\nPASS exact two-round 5/5 gate"); return 0

def main() -> int:
    p=argparse.ArgumentParser(); p.add_argument("--self-test",action="store_true"); p.add_argument("--adapter",type=Path); a=p.parse_args()
    if a.self_test: return self_test()
    if platform.system()!="Darwin": raise SystemExit("Frozen-five Production promotion must run on the Apple Silicon Mac.")
    receipt,validated,dataset=completion_gate(); adapter=a.adapter.expanduser().resolve() if a.adapter else validated
    if adapter!=validated: raise SystemExit("Explicit adapter does not match complete_and_validated receipt")
    sha=file_sha(adapter/"adapters.safetensors"); fx=fixtures(dataset,True); print("FROZEN FIVE FIXTURES: "+", ".join(f"{x['case'][1]} #{x['case'][2]}[{x['split']}:{x['row_id']}]" for x in fx),flush=True)
    started=datetime.now(timezone.utc).timestamp(); activated=False; rounds=[]; activation=None
    try:
        subprocess.run(["bash",str(ENABLE),str(adapter)],cwd=REPO_ROOT,check=True); activated=True; activation=activation_receipt(started,adapter,sha)
        rounds=[asyncio.run(run_round(1,fx,sha)),asyncio.run(run_round(2,fx,sha))]; rounds_gate(rounds)
    except BaseException as exc:
        if activated: subprocess.run(["bash",str(DISABLE)],cwd=REPO_ROOT,check=False)
        data={"schema_version":"tcos.instacomp-ai.lora-frozen-five-promotion.v1","created_at":now(),"status":"failed_rolled_back" if activated else "failed_before_activation","complete":False,"adapter":str(adapter),"adapter_weights_sha256":sha,"dataset":str(dataset),"dataset_sha256":receipt.get("dataset_sha256"),"rounds":rounds,"error_type":type(exc).__name__,"error":str(exc)[:1000],"runtime_candidate_enabled_after_failure":False if activated else None,"automatic_deployment":False}; path=write_receipt(data); print(json.dumps(data,indent=2)); print(f"FROZEN FIVE FAILURE RECEIPT: {path}")
        if isinstance(exc,KeyboardInterrupt): raise
        return 2
    data={"schema_version":"tcos.instacomp-ai.lora-frozen-five-promotion.v1","created_at":now(),"status":"promoted_runtime_candidate","complete":True,"adapter":str(adapter),"adapter_weights_sha256":sha,"validation_receipt":receipt.get("validation_receipt"),"dataset":str(dataset),"dataset_sha256":receipt.get("dataset_sha256"),"activation_receipt":activation.get("_path") if activation else None,"frozen_five_source":"historical_final_registry_v3_live_proof_55b0866947a05125371fd9d5554d1f497fbc19ff","rounds":rounds,"passes":2,"cards_per_pass":5,"candidate_fallbacks":0,"critical_regressions":0,"runtime_candidate_enabled":True,"registry_remains_identity_authority":True,"automatic_deployment":False,"automatic_promotion":False,"nothing_published":True}; path=write_receipt(data); print(json.dumps(data,indent=2)); print(f"FROZEN FIVE PROMOTION RECEIPT: {path}"); return 0

if __name__=="__main__": raise SystemExit(main())