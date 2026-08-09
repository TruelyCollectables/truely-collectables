#!/usr/bin/env node
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}
function requireText(source, text, label) {
  if (!source.includes(text)) throw new Error(`Missing ${label}: ${text}`);
}
function forbidText(source, text, label) {
  if (source.includes(text)) throw new Error(`Forbidden ${label}: ${text}`);
}

const models = read('services/instacomp-ai/app/models.py');
const storage = read('services/instacomp-ai/app/storage.py');
const training = read('services/instacomp-ai/app/training.py');
const main = read('services/instacomp-ai/app/main.py');
const bridge = read('src/lib/instacomp-ai-local.ts');
const live = read('src/app/api/instacomp/live-scan/route.ts');
const updater = read('services/instacomp-ai/scripts/update-live-from-main.sh');
const migration = read('supabase/migrations/20260809032000_instacomp_card_uuid_tracking.sql');

requireText(models, 'card_uuid: str', 'Mac scan response card UUID');
requireText(models, 'card_uuid: str | None = None', 'training metadata card UUID');
requireText(storage, 'card_uuid_for_image_pair', 'exact-pair card UUID lookup');
requireText(storage, 'WHERE image_pair_sha256 = ? AND card_uuid IS NOT NULL', 'exact-only card UUID reuse');
requireText(main, 'return requested_uuid or exact_pair_uuid or first_scan_id', 'first scan UUID promotion');
requireText(main, 'card_uuid: str | None = Form(default=None)', 'rescan card UUID input');
requireText(main, 'card_uuid=physical_card_uuid', 'saved physical card UUID');
requireText(training, 'key = example.card_uuid or f"scan:{example.scan_id}"', 'latest truth by physical card');
requireText(training, '"card_uuid": example.card_uuid', 'training metadata tracking');
const answerBlock = training.split('def _training_answer', 2)[1]?.split('def _dataset_row', 1)[0] || '';
forbidText(answerBlock, 'card_uuid', 'physical UUID as a visual training target');
requireText(bridge, 'internalCardUuid: string;', 'Vercel internal receipt UUID');
requireText(bridge, 'body.append("card_uuid", safeCardUuid(params.cardUuid))', 'rescan UUID bridge');
requireText(live, 'cardUuid: params.cardUuid', 'cloud scan JSON UUID persistence');
requireText(live, 'cardUuid,', 'live scan UUID response');
requireText(updater, '--cwd "$repo_root"', 'Vercel commands anchored to repository root');
requireText(updater, 'ensure_vercel_link', 'automatic Vercel link repair');
for (const table of ['instacomp_scans', 'inventory_items', 'products', 'order_items']) {
  requireText(migration, `${table} ADD COLUMN IF NOT EXISTS card_uuid uuid`, `${table}.card_uuid migration`);
}
console.log('PASS permanent physical card UUID contract');
