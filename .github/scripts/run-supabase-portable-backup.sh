#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${SUPABASE_ACCESS_TOKEN:?Missing SUPABASE_ACCESS_TOKEN}"
: "${SUPABASE_PROJECT_REF:?Missing SUPABASE_PROJECT_REF}"
: "${PINNED_MAIN_SHA:?Missing PINNED_MAIN_SHA}"

ROOT=/tmp/tc-supabase-portable
DB="$ROOT/database"
AUTH="$ROOT/auth"
STORE="$ROOT/storage/objects"
META="$ROOT/metadata"
mkdir -p "$DB" "$AUTH" "$STORE" "$META"

echo "createdAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$META/backup-context.txt"
echo "projectRef=$SUPABASE_PROJECT_REF" >> "$META/backup-context.txt"
echo "pinnedMainSha=$PINNED_MAIN_SHA" >> "$META/backup-context.txt"

# Supabase CLI logical dumps. Capture only status, never command stderr, in the archive.
: > "$META/database-dump-status.txt"
if timeout 5m npx --yes supabase@latest link --project-ref "$SUPABASE_PROJECT_REF" >/tmp/tc-sb-link.out 2>/tmp/tc-sb-link.err; then
  echo 'OK link' >> "$META/database-dump-status.txt"
else
  echo "FAIL link exit=$?" >> "$META/database-dump-status.txt"
fi
rm -f /tmp/tc-sb-link.out /tmp/tc-sb-link.err

run_dump() {
  local label="$1"; shift
  echo "START $label" >> "$META/database-dump-status.txt"
  if timeout 35m npx --yes supabase@latest "$@" >/tmp/tc-sb.out 2>/tmp/tc-sb.err; then
    echo "OK $label" >> "$META/database-dump-status.txt"
  else
    echo "FAIL $label exit=$?" >> "$META/database-dump-status.txt"
  fi
  rm -f /tmp/tc-sb.out /tmp/tc-sb.err
}

run_dump roles db dump --linked -f "$DB/roles.sql" --role-only
run_dump schema db dump --linked -f "$DB/schema.sql"
run_dump data db dump --linked -f "$DB/data.sql" --use-copy --data-only -x storage.buckets_vectors -x storage.vector_indexes
run_dump migration-schema db dump --linked -f "$DB/migration-schema.sql" --schema supabase_migrations
run_dump migration-data db dump --linked -f "$DB/migration-data.sql" --use-copy --data-only --schema supabase_migrations

if timeout 20m npx --yes supabase@latest db diff --linked --schema auth,storage > "$DB/auth-storage-custom-changes.sql" 2>/tmp/tc-sb-diff.err; then
  echo 'OK auth-storage-diff' >> "$META/database-dump-status.txt"
else
  echo "FAIL auth-storage-diff exit=$?" >> "$META/database-dump-status.txt"
  rm -f "$DB/auth-storage-custom-changes.sql"
fi
rm -f /tmp/tc-sb-diff.err

for f in "$DB"/*; do
  [ -f "$f" ] || continue
  printf '%s\t%s\n' "$(basename "$f")" "$(wc -c < "$f")" >> "$META/database-file-sizes.tsv"
done

# Independent Auth + Storage bytes copy using a temporary server-side API key.
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
const objRoot=path.join(root,'storage','objects');
const ref=process.env.SUPABASE_PROJECT_REF;
const token=process.env.SUPABASE_ACCESS_TOKEN;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const manifest={createdAt:new Date().toISOString(),projectRef:ref,pinnedMainSha:process.env.PINNED_MAIN_SHA,authUsers:0,authErrors:[],buckets:[],objects:[],storageBytes:0,storageErrors:[]};
const clean=s=>String(s||'').replace(/[\\/\0]/g,'_')||'_';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function retry(fn,attempts=8){let last;for(let i=0;i<attempts;i++){try{const r=await fn();if(!r?.error)return r;last=r;const s=Number(r.error?.status||r.error?.statusCode||0);if(![429,500,502,503,504,520,522,524,544].includes(s))return r;}catch(e){last={data:null,error:e};}await sleep(Math.min(10000,750*2**Math.min(i,4)));}return last||{data:null,error:new Error('retry exhausted')};}

const keyResponse=await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});
if(!keyResponse.ok) throw new Error(`Management API key retrieval failed HTTP ${keyResponse.status}`);
const keys=await keyResponse.json();
const server=keys.find(x=>String(x?.name||'').toLowerCase()==='service_role'&&x?.api_key)||keys.find(x=>String(x?.type||'').toLowerCase()==='secret'&&x?.api_key)||keys.find(x=>String(x?.api_key||'').startsWith('sb_secret_'));
if(!server?.api_key) throw new Error('No server-side Supabase API key resolved');
const sb=createClient(`https://${ref}.supabase.co`,server.api_key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});

const users=fs.createWriteStream(path.join(authDir,'users.jsonl'),{mode:0o600});
for(let page=1;;page++){
  const r=await retry(()=>sb.auth.admin.listUsers({page,perPage:1000}));
  if(r?.error){manifest.authErrors.push({page,error:r.error.message||String(r.error)});break;}
  const rows=r?.data?.users||[];
  for(const u of rows) users.write(JSON.stringify(u)+'\n');
  manifest.authUsers+=rows.length;
  if(rows.length<1000) break;
}
await new Promise(resolve=>users.end(resolve));

const br=await retry(()=>sb.storage.listBuckets({limit:1000,offset:0}));
if(br?.error){manifest.storageErrors.push({operation:'listBuckets',error:br.error.message||String(br.error)});} else {
  async function collect(bucket,prefix='',out=[]){let offset=0;for(;;){const r=await retry(()=>sb.storage.from(bucket).list(prefix,{limit:1000,offset,sortBy:{column:'name',order:'asc'}}));if(r?.error){manifest.storageErrors.push({bucket,prefix,operation:'list',error:r.error.message||String(r.error)});return out;}const rows=r.data||[];for(const item of rows){const p=prefix?`${prefix}/${item.name}`:item.name;if(item.id===null||item.id===undefined)await collect(bucket,p,out);else out.push({bucket,path:p,metadata:item.metadata||null});}if(rows.length<1000)break;offset+=rows.length;}return out;}
  for(const b of br.data||[]){
    manifest.buckets.push({id:b.id,name:b.name,public:b.public,fileSizeLimit:b.file_size_limit??null,allowedMimeTypes:b.allowed_mime_types??null});
    const items=await collect(b.id);
    let cursor=0;
    async function worker(){for(;;){const i=cursor++;if(i>=items.length)return;const item=items[i];const r=await retry(()=>sb.storage.from(item.bucket).download(item.path));if(r?.error||!r?.data){manifest.storageErrors.push({bucket:item.bucket,path:item.path,operation:'download',error:r?.error?.message||'No data'});continue;}const bytes=Buffer.from(await r.data.arrayBuffer());const target=path.join(objRoot,clean(item.bucket),...item.path.split('/').map(clean));fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,bytes,{mode:0o600});manifest.storageBytes+=bytes.length;manifest.objects.push({bucket:item.bucket,path:item.path,bytes:bytes.length,sha256:sha(bytes),localPath:path.relative(root,target),metadata:item.metadata});}}
    await Promise.all(Array.from({length:Math.min(8,Math.max(1,items.length))},()=>worker()));
  }
}
fs.writeFileSync(path.join(meta,'portable-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
fs.writeFileSync(path.join(meta,'portable-summary.txt'),[`createdAt=${manifest.createdAt}`,`authUsers=${manifest.authUsers}`,`authErrors=${manifest.authErrors.length}`,`storageBuckets=${manifest.buckets.length}`,`storageObjects=${manifest.objects.length}`,`storageBytes=${manifest.storageBytes}`,`storageErrors=${manifest.storageErrors.length}`].join('\n')+'\n',{mode:0o600});
console.log(`Auth users=${manifest.authUsers}; Storage buckets=${manifest.buckets.length}; objects=${manifest.objects.length}; errors=${manifest.authErrors.length+manifest.storageErrors.length}`);
NODE

cd /tmp
cat > "$META/RECOVERY-NOTES.txt" <<EOF
Production source SHA: $PINNED_MAIN_SHA
Supabase project ref: $SUPABASE_PROJECT_REF
Database files are Supabase CLI logical dumps when each status is OK.
Auth users and Storage object bytes are independently exported as additional recovery evidence.
EOF
(cd "$ROOT" && find . -type f -print0 | sort -z | xargs -0 sha256sum > metadata/PLAINTEXT-SHA256SUMS.txt)
tar -czf /tmp/TruelyCollectables-supabase-portable-2026-08-15.tar.gz tc-supabase-portable
openssl rand -base64 48 > /tmp/TruelyCollectables-supabase-portable-2026-08-15.recovery-key.txt
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 310000 -md sha256 \
  -in /tmp/TruelyCollectables-supabase-portable-2026-08-15.tar.gz \
  -out /tmp/TruelyCollectables-supabase-portable-2026-08-15.tar.gz.enc \
  -pass file:/tmp/TruelyCollectables-supabase-portable-2026-08-15.recovery-key.txt
sha256sum /tmp/TruelyCollectables-supabase-portable-2026-08-15.tar.gz.enc > /tmp/TruelyCollectables-supabase-portable-2026-08-15.sha256
rm -f /tmp/TruelyCollectables-supabase-portable-2026-08-15.tar.gz
