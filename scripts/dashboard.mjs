// Prepare private local upload files; Cloudflare writes happen only in its dashboard.
import {mkdir,readFile,writeFile,readdir,stat,copyFile,chmod} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const [command,name,configPath]=process.argv.slice(2);
if(!/^[a-z0-9-]{1,60}$/.test(name||'')) throw Error('Usage: node scripts/dashboard.mjs new|sync|revoke|verify NAME [CONFIG.json]');
const local=resolve('.local'); await mkdir(local,{recursive:true,mode:0o700}); await chmod(local,0o700);
const recordPath=join(local,`${name}.json`); const digest=b=>createHash('sha256').update(b).digest('hex');
const save=async(p,v)=>writeFile(p,JSON.stringify(v,null,2),{mode:0o600});
let record;
try {record=JSON.parse(await readFile(recordPath,'utf8'));} catch(e){if(e.code!=='ENOENT')throw e;}
if(command==='cleanup-plan'){
 if(!record)throw Error('Unknown share');
 if(!record.manifest.revoked || record.pending)throw Error('Revoke, publish and verify before cleanup.');
 console.log(JSON.stringify({bucket:'private-downloads',files:[...record.manifest.files,...record.retired],keepManifest:true},null,2));process.exit(0);
}
if(command==='verify'){
 if(!record)throw Error('Unknown share');
 const base=`https://downloads.example.com/s/${record.token}`;
 const page=await fetch(base); const html=await page.text();
 if(record.manifest.revoked){assert.equal(page.status,404);for(const f of record.manifest.files)assert.equal((await fetch(`${base}/f/${f.id}`)).status,404);console.log('Verified revoked page and all file links return 404.');}
 else {
 assert.equal(page.status,200); assert.equal((html.match(/>Download<\/a>/g)||[]).length,record.manifest.files.length);
 for(const f of record.manifest.files){
 assert.ok(html.includes(f.filename)); const url=`${base}/f/${f.id}`;
 const r=await fetch(url);assert.equal(r.status,200);assert.equal(r.headers.get('content-disposition'),`attachment; filename="${f.filename}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
 const bytes=Buffer.from(await r.arrayBuffer());assert.equal(digest(bytes),record.sources[f.filename].sha256);assert.equal(bytes.length,record.sources[f.filename].bytes);
 const h=await fetch(url,{method:'HEAD'});assert.equal(h.status,200);assert.equal((await h.arrayBuffer()).byteLength,0);
 const range=await fetch(url,{headers:{range:'bytes=0-9'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(0,10));
 console.log(`Verified ${f.filename}: ${bytes.length} bytes, SHA-256 ${digest(bytes)}, attachment, HEAD, range.`);
 }
 assert.equal((await fetch(`${base}/f/not-listed`)).status,404);
 console.log('Verified complete listing, byte hashes, filenames, ranges and unlisted-file denial.');
 }
 record.pending=false; await save(recordPath,record);
 await save(join(local,`${name}.verification.json`),{at:new Date().toISOString(),revoked:!!record.manifest.revoked,files:record.manifest.files.map(f=>({filename:f.filename,...record.sources[f.filename]}))});
 process.exit(0);
}
if(!['new','sync','revoke'].includes(command))throw Error('Commands: new, sync, revoke, verify');
if(command==='new' && record)throw Error('Share exists; choose another name or use sync.');
if(command!=='new' && !record)throw Error('Unknown share');
if(command==='sync' && record.pending)throw Error('Finish the existing upload and verify first; prepared paths are in .local/NAME.json lastUpload.');
const old=record?structuredClone(record):null;
const config=command==='new'?JSON.parse(await readFile(resolve(configPath),'utf8')):record.config;
if(command!=='revoke'){
 if(!config||!config.title||config.title.length>200||typeof config.description!=='string'||config.description.length>2000)throw Error('Invalid title/description');
 const expiry=Date.parse(config.expiresAt);if(!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+180*864e5)throw Error('Expiry must be future and within 180 days');
 if(record?.manifest.revoked)throw Error('Revoked share: create a new share instead.');
}
const operation=join(local,'uploads',`${name}-${Date.now()}-${randomBytes(3).toString('hex')}`);
await mkdir(join(operation,'data'),{recursive:true,mode:0o700});await mkdir(join(operation,'manifest'),{mode:0o700});
let addedBytes=0;let uploads=0;
if(command==='new')record={token:randomBytes(32).toString('base64url'),prefix:randomBytes(16).toString('hex'),config:{...config,folder:resolve(config.folder)},sources:{},retired:[],manifest:{version:1,title:config.title,description:config.description,expiresAt:config.expiresAt,files:[]}};
if(command==='revoke')record.manifest.revoked=true;
else {
 const folder=record.config.folder; const filenames=(await readdir(folder)).filter(f=>/\.pdf$/i.test(f)).sort();
 if(!filenames.length||filenames.length>100)throw Error('Folder needs 1-100 PDFs');
 const files=[];const sources={};
 for(const filename of filenames){
 if(filename.length>180||/[\r\n"\\]/.test(filename))throw Error('Unsupported filename');
 const source=join(folder,filename);const s=await stat(source);if(!s.isFile()||s.size>300_000_000)throw Error('Dashboard max 300 MB/file');
 const bytes=await readFile(source);if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('Not a PDF');
 const sha256=digest(bytes);let f=old?.manifest.files.find(f=>f.filename===filename && old.sources[filename]?.sha256===sha256);
 if(!f){f={id:randomBytes(12).toString('hex'),key:`objects/${record.prefix}/${randomBytes(16).toString('hex')}`,filename};await copyFile(source,join(operation,'data',f.key.split('/').at(-1)));await chmod(join(operation,'data',f.key.split('/').at(-1)),0o600);uploads++;addedBytes+=s.size;}
 files.push(f);sources[filename]={sha256,bytes:s.size};
 }
 const accountBytes=Number(process.env.DOWNLOADS_CONFIRMED_ACCOUNT_BYTES);
 if(!process.env.DOWNLOADS_CONFIRMED_ACCOUNT_BYTES||!Number.isSafeInteger(accountBytes)||accountBytes<0||addedBytes+accountBytes>8_000_000_000||addedBytes>1e9)throw Error('Check all-account R2 usage; set DOWNLOADS_CONFIRMED_ACCOUNT_BYTES. Conservative limits: 8 GB account, 1 GB batch.');
 record.retired.push(...(old?.manifest.files||[]).filter(f=>!files.some(n=>n.key===f.key)));record.manifest.files=files;record.sources=sources;
}
if(old)await save(join(operation,'previous-record.json'),old);
const manifestFile=join(operation,'manifest',`${digest(record.token)}.json`);await save(manifestFile,record.manifest);
record.pending=true;
record.lastUpload={operation,dataPrefix:`objects/${record.prefix}/`,manifestPrefix:'_shares/'};
await save(recordPath,record);
console.log(`Prepared ${uploads} new/changed PDFs (${addedBytes} bytes). Nothing uploaded yet.`);
if(uploads)console.log(`1. R2 bucket private-downloads: open/create folder ${record.lastUpload.dataPrefix}; Upload > Files > select ALL files inside ${join(operation,'data')}. Wait for every upload to succeed.`);
console.log(`2. In the SAME bucket open _shares/: Upload > Files > ${manifestFile}. Confirm overwrite for sync/revoke only. Publish manifest LAST.`);
console.log(`3. Run: node scripts/dashboard.mjs verify ${name}`);
console.log(`4. Only after verification: node scripts/manage.mjs link ${name}`);
console.log('Retired data is retained. No automatic deletions. If interrupted, use the same prepared files; do not run sync again until finished or restored from previous-record.json.');
