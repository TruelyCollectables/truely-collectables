#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${SUPABASE_ACCESS_TOKEN:?Missing SUPABASE_ACCESS_TOKEN}"
: "${SUPABASE_PROJECT_REF:?Missing SUPABASE_PROJECT_REF}"
: "${PINNED_MAIN_SHA:?Missing PINNED_MAIN_SHA}"

ROOT=/tmp/tc-supabase-portable
DB="$ROOT/database"
APP="$ROOT/application-data"
AUTH="$ROOT/auth"
STORE="$ROOT/storage/objects"
META="$ROOT/metadata"
CONFIG="$ROOT/provider-config"
rm -rf "$ROOT"
mkdir -p "$DB" "$APP" "$AUTH" "$STORE" "$META" "$CONFIG"

printf 'createdAt=%s\nprojectRef=%s\npinnedMainSha=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SUPABASE_PROJECT_REF" "$PINNED_MAIN_SHA" > "$META/backup-context.txt"
: > "$META/database-dump-status.txt"

# Warm the CLI cache once, then link with a hard deadline.
timeout 3m npx --yes supabase@latest --version >/dev/null 2>&1 || true
if timeout 4m npx --yes supabase@latest link --project-ref "$SUPABASE_PROJECT_REF" >/tmp/tc-sb-link.out 2>/tmp/tc-sb-link.err; then
  echo 'OK link' >> "$META/database-dump-status.txt"
else
  echo "FAIL link exit=$?" >> "$META/database-dump-status.txt"
fi
rm -f /tmp/tc-sb-link.out /tmp/tc-sb-link.err

# Run independent logical dumps concurrently so one slow provider connection cannot serialize the whole backup.
run_dump() {
  local label="$1"; shift
  local status="$META/status-$label.txt"
  echo "START $label" > "$status"
  if timeout 12m npx --yes supabase@latest "$@" >"/tmp/tc-$label.out" 2>"/tmp/tc-$label.err"; then
    echo "OK $label" > "$status"
  else
    echo "FAIL $label exit=$?" > "$status"
  fi
  rm -f "/tmp/tc-$label.out" "/tmp/tc-$label.err"
}

run_dump roles db dump --linked -f "$DB/roles.sql" --role-only & p1=$!
run_dump schema db dump --linked -f "$DB/schema.sql" & p2=$!
run_dump data db dump --linked -f "$DB/data.sql" --use-copy --data-only -x storage.buckets_vectors -x storage.vector_indexes & p3=$!
run_dump migration-schema db dump --linked -f "$DB/migration-schema.sql" --schema supabase_migrations & p4=$!
run_dump migration-data db dump --linked -f "$DB/migration-data.sql" --use-copy --data-only --schema supabase_migrations & p5=$!
(
  if timeout 10m npx --yes supabase@latest db diff --linked --schema auth,storage > "$DB/auth-storage-custom-changes.sql" 2>/tmp/tc-sb-diff.err; then
    echo 'OK auth-storage-diff' > "$META/status-auth-storage-diff.txt"
  else
    echo "FAIL auth-storage-diff exit=$?" > "$META/status-auth-storage-diff.txt"
    rm -f "$DB/auth-storage-custom-changes.sql"
  fi
  rm -f /tmp/tc-sb-diff.err
) & p6=$!
wait "$p1" "$p2" "$p3" "$p4" "$p5" "$p6" || true
cat "$META"/status-*.txt >> "$META/database-dump-status.txt"
rm -f "$META"/status-*.txt
for f in "$DB"/*; do [ -f "$f" ] && printf '%s\t%s\n' "$(basename "$f")" "$(wc -c < "$f")" >> "$META/database-file-sizes.tsv"; done

# Independent provider config, application rows, Auth-user evidence, and Storage bytes.
mkdir -p /tmp/tc-supabase-tool
cd /tmp/tc-supabase-tool
npm init -y >/dev/null 2>&1
npm install --silent --no-audit --no-fund @supabase/supabase-js@2
node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const root='/tmp/tc-supabase-portable';
const meta=path.join(root,'metadata');
const authDir=path.join(root,'auth');
const appDir=path.join(root,'application-data');
const configDir=path.join(root,'provider-config');
const objRoot=path.join(root,'storage','objects');
const ref=process.env.SUPABASE_PROJECT_REF;
const token=process.env.SUPABASE_ACCESS_TOKEN;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>String(s||'').replace(/[\\/\0]/g,'_')||'_';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifest={createdAt:new Date().toISOString(),projectRef:ref,pinnedMainSha:process.env.PINNED_MAIN_SHA,applicationTables:[],applicationRows:0,applicationErrors:[],authUsers:0,authErrors:[],buckets:[],objects:[],storageBytes:0,storageErrors:[],providerConfig:[]};
async function retry(fn,attempts=6){let last;for(let i=0;i<attempts;i++){try{const r=await fn();if(!r?.error)return r;last=r;const s=Number(r.error?.status||r.error?.statusCode||0);if(![429,500,502,503,504,520,522,524,544].includes(s))return r;}catch(e){last={data:null,error:e};}await sleep(Math.min(7000,600*2**Math.min(i,4)));}return last||{data:null,error:new Error('retry exhausted')};}
async function fetchTimeout(url,options={},ms=25000){const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);try{return await fetch(url,{...options,signal:c.signal});}finally{clearTimeout(t)}}
const mgmtHeaders={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};

// Capture provider-side configuration and backup inventory. Never print response bodies.
for(const [name,endpoint] of [
  ['project',`/v1/projects/${ref}`],['database-backups',`/v1/projects/${ref}/database/backups`],['auth-config',`/v1/projects/${ref}/config/auth`],['storage-config',`/v1/projects/${ref}/config/storage`],['realtime-config',`/v1/projects/${ref}/config/realtime`],['postgres-config',`/v1/projects/${ref}/config/database/postgres`],['pooler-config',`/v1/projects/${ref}/config/database/pooler`],['postgrest-config',`/v1/projects/${ref}/postgrest`]
]){
  try{const r=await fetchTimeout(`https://api.supabase.com${endpoint}`,{headers:mgmtHeaders});const text=await r.text();fs.writeFileSync(path.join(configDir,`${name}.json`),JSON.stringify({status:r.status,ok:r.ok,body:(()=>{try{return JSON.parse(text)}catch{return text}})()},null,2)+'\n',{mode:0o600});manifest.providerConfig.push({name,status:r.status,ok:r.ok});}catch(e){manifest.providerConfig.push({name,status:0,ok:false,error:e.message});}
}

const keyResponse=await fetchTimeout(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,{headers:mgmtHeaders});
if(!keyResponse.ok) throw new Error(`Management API key retrieval failed HTTP ${keyResponse.status}`);
const keys=await keyResponse.json();
const server=keys.find(x=>String(x?.name||'').toLowerCase()==='service_role'&&x?.api_key)||keys.find(x=>String(x?.type||'').toLowerCase()==='secret'&&x?.api_key)||keys.find(x=>String(x?.api_key||'').startsWith('sb_secret_'));
if(!server?.api_key) throw new Error('No server-side Supabase API key resolved');
const projectUrl=`https://${ref}.supabase.co`;
const sb=createClient(projectUrl,server.api_key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});

// Portable application-data fallback through PostgREST OpenAPI + service-role pagination.
try{
  const r=await fetchTimeout(`${projectUrl}/rest/v1/`,{headers:{apikey:server.api_key,Authorization:`Bearer ${server.api_key}`,Accept:'application/openapi+json'}},30000);
  if(!r.ok) throw new Error(`OpenAPI HTTP ${r.status}`);
  const spec=await r.json();
  fs.writeFileSync(path.join(meta,'postgrest-openapi.json'),JSON.stringify(spec,null,2)+'\n',{mode:0o600});
  const defs=Object.keys(spec?.definitions||{}).filter(n=>!n.startsWith('_')).sort();
  let cursor=0;
  async function tableWorker(){for(;;){const i=cursor++;if(i>=defs.length)return;const table=defs[i];const out=fs.createWriteStream(path.join(appDir,`${clean(table)}.jsonl`),{mode:0o600});let offset=0,count=0,failed=false;for(;;){const q=await retry(()=>sb.from(table).select('*').range(offset,offset+999));if(q?.error){manifest.applicationErrors.push({table,error:q.error.message||String(q.error)});failed=true;break;}const rows=q.data||[];for(const row of rows)out.write(JSON.stringify(row)+'\n');count+=rows.length;if(rows.length<1000)break;offset+=rows.length;}await new Promise(resolve=>out.end(resolve));manifest.applicationTables.push({table,rows:count,complete:!failed});manifest.applicationRows+=count;}}
  await Promise.all(Array.from({length:Math.min(6,Math.max(1,defs.length))},()=>tableWorker()));
}catch(e){manifest.applicationErrors.push({operation:'openapi-export',error:e.message});}

// Admin Auth-user export (provider-level physical backup remains preferred for exact Auth continuity).
const users=fs.createWriteStream(path.join(authDir,'users.jsonl'),{mode:0o600});
for(let page=1;;page++){const r=await retry(()=>sb.auth.admin.listUsers({page,perPage:1000}));if(r?.error){manifest.authErrors.push({page,error:r.error.message||String(r.error)});break;}const rows=r?.data?.users||[];for(const u of rows)users.write(JSON.stringify(u)+'\n');manifest.authUsers+=rows.length;if(rows.length<1000)break;}
await new Promise(resolve=>users.end(resolve));

// Best-effort raw Auth evidence through Management SQL, preserving the response encrypted in this archive.
for(const [name,query] of [
  ['auth-users-sql','select row_to_json(t) as row from auth.users t order by id limit 5000'],
  ['auth-identities-sql','select row_to_json(t) as row from auth.identities t order by id limit 5000']
]){
  try{const r=await fetchTimeout(`https://api.supabase.com/v1/projects/${ref}/database/query/read-only`,{method:'POST',headers:mgmtHeaders,body:JSON.stringify({query,parameters:[]})},30000);const text=await r.text();fs.writeFileSync(path.join(authDir,`${name}.json`),JSON.stringify({status:r.status,ok:r.ok,body:(()=>{try{return JSON.parse(text)}catch{return text}})()},null,2)+'\n',{mode:0o600});}catch(e){fs.writeFileSync(path.join(authDir,`${name}.json`),JSON.stringify({status:0,ok:false,error:e.message},null,2)+'\n',{mode:0o600});}
}

const br=await retry(()=>sb.storage.listBuckets({limit:1000,offset:0}));
if(br?.error){manifest.storageErrors.push({operation:'listBuckets',error:br.error.message||String(br.error)});} else {
  async function collect(bucket,prefix='',out=[]){let offset=0;for(;;){const r=await retry(()=>sb.storage.from(bucket).list(prefix,{limit:1000,offset,sortBy:{column:'name',order:'asc'}}));if(r?.error){manifest.storageErrors.push({bucket,prefix,operation:'list',error:r.error.message||String(r.error)});return out;}const rows=r.data||[];for(const item of rows){const p=prefix?`${prefix}/${item.name}`:item.name;if(item.id===null||item.id===undefined)await collect(bucket,p,out);else out.push({bucket,path:p,metadata:item.metadata||null});}if(rows.length<1000)break;offset+=rows.length;}return out;}
  for(const b of br.data||[]){manifest.buckets.push({id:b.id,name:b.name,public:b.public,fileSizeLimit:b.file_size_limit??null,allowedMimeTypes:b.allowed_mime_types??null});const items=await collect(b.id);let cursor=0;async function worker(){for(;;){const i=cursor++;if(i>=items.length)return;const item=items[i];const r=await retry(()=>sb.storage.from(item.bucket).download(item.path));if(r?.error||!r?.data){manifest.storageErrors.push({bucket:item.bucket,path:item.path,operation:'download',error:r?.error?.message||'No data'});continue;}const bytes=Buffer.from(await r.data.arrayBuffer());const target=path.join(objRoot,clean(item.bucket),...item.path.split('/').map(clean));fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,bytes,{mode:0o600});manifest.storageBytes+=bytes.length;manifest.objects.push({bucket:item.bucket,path:item.path,bytes:bytes.length,sha256:sha(bytes),localPath:path.relative(root,target),metadata:item.metadata});}}await Promise.all(Array.from({length:Math.min(8,Math.max(1,items.length))},()=>worker()));}
}
fs.writeFileSync(path.join(meta,'portable-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
fs.writeFileSync(path.join(meta,'portable-summary.txt'),[`createdAt=${manifest.createdAt}`,`applicationTables=${manifest.applicationTables.length}`,`applicationRows=${manifest.applicationRows}`,`applicationErrors=${manifest.applicationErrors.length}`,`authUsers=${manifest.authUsers}`,`authErrors=${manifest.authErrors.length}`,`storageBuckets=${manifest.buckets.length}`,`storageObjects=${manifest.objects.length}`,`storageBytes=${manifest.storageBytes}`,`storageErrors=${manifest.storageErrors.length}`].join('\n')+'\n',{mode:0o600});
console.log(`Portable snapshot: appRows=${manifest.applicationRows}; auth=${manifest.authUsers}; storageObjects=${manifest.objects.length}; errors=${manifest.applicationErrors.length+manifest.authErrors.length+manifest.storageErrors.length}`);
NODE

cd /tmp
cat > "$META/RECOVERY-NOTES.txt" <<EOF
Production source SHA: $PINNED_MAIN_SHA
Supabase project ref: $SUPABASE_PROJECT_REF
Database SQL files are Supabase CLI logical dumps when their status is OK.
application-data/*.jsonl is an independent PostgREST/service-role row backup.
Auth user evidence and Storage object bytes are captured independently.
Provider backup/config inventory is included for the strongest same-provider restore path.
EOF
(cd "$ROOT" && find . -type f -print0 | sort -z | xargs -0 sha256sum > metadata/PLAINTEXT-SHA256SUMS.txt)
tar -czf /tmp/TruelyCollectables-supabase-portable-2026-08-15.tar.gz tc-supabase-portable
openssl rand -base64 48 > /tmp/TruelyCollectables-supabase-portable-2026-08-15.recovery-key.txt
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 310000 -md sha256 -in /tmp/TruelyCollectables-supabase-portable-2026-08-15.tar.gz -out /tmp/TruelyCollectables-supabase-portable-2026-08-15.tar.gz.enc -pass file:/tmp/TruelyCollectables-supabase-portable-2026-08-15.recovery-key.txt
sha256sum /tmp/TruelyCollectables-supabase-portable-2026-08-15.tar.gz.enc > /tmp/TruelyCollectables-supabase-portable-2026-08-15.sha256
rm -f /tmp/TruelyCollectables-supabase-portable-2026-08-15.tar.gz
