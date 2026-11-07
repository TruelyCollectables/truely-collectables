import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedAccountFromRequest } from '../../../../lib/kingmaker-local-auth';
import { shouldRunMemorabiliaAutograph } from '../../../../lib/kingmaker-memorabilia-autograph-policy';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const execFileAsync = promisify(execFile);
const ENGINE = '/Volumes/Fanxiang S101 2TB/Projects/CodingAI_Project/06_Tools/AutographEngine';

export async function POST(request: NextRequest) {
  const account = await getAuthenticatedAccountFromRequest(request);
  if (!account) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Multipart form required' }, { status: 400 });
  const title = String(form.get('title') || '');
  const category = String(form.get('category') || '');
  const sport = String(form.get('sport') || '');
  const signal = form.get('autographSuspected') === 'true';
  const gate = shouldRunMemorabiliaAutograph({ title, category, sport, autographSuspected: signal });
  if (!gate.run) return NextResponse.json({ status: 'skipped', reason: gate.reason });
  const image = form.get('image');
  if (!(image instanceof File) || !['image/jpeg','image/png','image/webp'].includes(image.type) || image.size > 12_000_000 || image.size === 0)
    return NextResponse.json({ error: 'JPEG, PNG or WebP image required (max 12 MB)' }, { status: 400 });
  const dir = await mkdtemp(path.join(tmpdir(), 'kingmaker-autograph-'));
  try {
    const filename = path.join(dir, 'input' + (image.type === 'image/png' ? '.png' : image.type === 'image/webp' ? '.webp' : '.jpg'));
    await writeFile(filename, Buffer.from(await image.arrayBuffer()));
    const { stdout } = await execFileAsync(path.join(ENGINE,'.venv/bin/python'), [path.join(ENGINE,'autograph_engine.py'),filename,'--type',category || title || 'memorabilia'], { timeout: 45000, maxBuffer: 1024 * 1024 });
    const report = JSON.parse(stdout);
    return NextResponse.json({ ...report, image: 'uploaded-image', source: 'experimental-local-engine' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Local autograph analysis unavailable' }, { status: 503 });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
