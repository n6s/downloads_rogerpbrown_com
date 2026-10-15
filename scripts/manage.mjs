// Local operator tool. No admin HTTP endpoint and no stored account credentials.
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { basename, resolve } from 'node:path';
const BUCKET = 'private-downloads';
const ORIGIN = 'https://downloads.example.com';
const wrangler = process.env.WRANGLER_BIN || 'wrangler';
const local = resolve('.local');
await mkdir(local, { recursive:true, mode:0o700 });
const [command, name, ...args] = process.argv.slice(2);
if (!/^[a-z0-9-]{1,60}$/.test(name || '')) throw Error('Use a local share name containing lowercase letters, digits, hyphens.');
const path = resolve(local, `${name}.json`);
function run(args) {
  const r = spawnSync(wrangler, args, { encoding:'utf8', env:{...process.env, WRANGLER_LOG_PATH:'/tmp/roger-downloads-operator.log'} });
  // Wrangler output contains object hashes, never the capability token.
  if (r.status !== 0) throw Error(`Cloudflare operation failed. ${r.stderr || r.stdout}`);
}
const hash = t => createHash('sha256').update(t).digest('hex');
async function publish(record) {
  const manifestPath = resolve(local, `${name}.manifest.json`);
  await writeFile(manifestPath, JSON.stringify(record.manifest,null,2), {mode:0o600});
  run(['r2','object','put',`${BUCKET}/_shares/${hash(record.token)}.json`,'--remote','--file',manifestPath,'--content-type','application/json','--storage-class','Standard']);
}
if (command === 'create') {
  const [days, title, description, ...files] = args;
  if (!Number.isInteger(Number(days)) || +days < 1 || +days > 180 || !title || title.length > 200 || typeof description !== 'string' || description.length > 2000 || !files.length || files.length > 100) throw Error('create NAME DAYS TITLE DESCRIPTION FILE... (1-180 days, title max 200 characters, description max 2000 characters or empty string, 1-100 files)');
  try { await stat(path); throw Error('Share name already exists; choose a new name.'); } catch(e) { if (e.code !== 'ENOENT') throw e; }
  const sizes = await Promise.all(files.map(async f => {const s=await stat(f); if(!s.isFile() || s.size > 300*1024**2) throw Error('CLI upload limit: 300 MiB per file. Larger files require an authorized multipart upload path; the dashboard also limits uploads to 300 MB.'); return s.size;}));
  if(sizes.reduce((a,b)=>a+b,0) > 1024**3) throw Error('Conservative batch limit: 1 GiB. Check total account storage before larger transfers.');
  const accountBytes=Number(process.env.DOWNLOADS_CONFIRMED_ACCOUNT_BYTES);
  if(!Number.isSafeInteger(accountBytes) || accountBytes < 0 || !process.env.DOWNLOADS_CONFIRMED_ACCOUNT_BYTES) throw Error('Check current R2 storage across all account buckets; set DOWNLOADS_CONFIRMED_ACCOUNT_BYTES to that current total in bytes before this batch.');
  if(accountBytes+sizes.reduce((a,b)=>a+b,0) > 8_000_000_000) throw Error('Batch crosses conservative 8 GB account storage target; stop for review.');
  const token = randomBytes(32).toString('base64url');
  const prefix = randomBytes(16).toString('hex');
  const record = {token, manifest:{version:1,title,description,expiresAt:new Date(Date.now() + +days*86400000).toISOString(),files:files.map(f => ({id:randomBytes(12).toString('hex'),key:`objects/${prefix}/${randomBytes(16).toString('hex')}`,filename:basename(f)}))}};
  // Persist before uploads so an interrupted operation can be diagnosed/revoked.
  await writeFile(path,JSON.stringify(record,null,2),{flag:'wx',mode:0o600});
  for(let i=0;i<files.length;i++) run(['r2','object','put',`${BUCKET}/${record.manifest.files[i].key}`,'--remote','--file',resolve(files[i]),'--content-type','application/octet-stream','--storage-class','Standard']);
  await publish(record);
  for(const f of record.manifest.files){const r=await fetch(`${ORIGIN}/s/${record.token}/f/${f.id}`,{method:'HEAD'});const uploaded=Date.parse(r.headers.get('last-modified'));if(r.status!==200 || !Number.isFinite(uploaded))throw Error('Could not verify actual R2 upload date. Use dashboard stamp after resolving publication.');f.uploadedAt=new Date(uploaded).toISOString();}
  await writeFile(path,JSON.stringify(record,null,2),{mode:0o600});
  await publish(record);
  console.log(`Created ${name}. Link stored privately; run: node scripts/manage.mjs link ${name}`);
} else {
  const record = JSON.parse(await readFile(path,'utf8'));
  if(command === 'revoke') { record.manifest.revoked=true; await publish(record); await writeFile(path,JSON.stringify(record,null,2),{mode:0o600}); console.log('Revoked; files retained for manual cleanup.'); }
  else if(command === 'link') console.log(`${ORIGIN}/s/${record.token}`);
  else if(command === 'inspect') console.log(JSON.stringify({title:record.manifest.title,description:record.manifest.description,expiresAt:record.manifest.expiresAt,revoked:!!record.manifest.revoked,files:record.manifest.files},null,2));
  else throw Error('Commands: create, revoke, link, inspect.');
}
