// One-command local PDF update. No credential storage, public admin endpoint or remote deletion.
import {readFile,writeFile,mkdir,readdir,stat,copyFile,chmod} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {fileURLToPath} from 'node:url';
import {ORIGIN,DEFAULT_SHARE} from './config.mjs';
import {storageClient,accountUsage,checkBudget,hashFile,hashBody} from './storage.mjs';
export const hash=b=>createHash('sha256').update(b).digest('hex');
export async function planUpdate(record){
 if(record.pending)throw Error('An earlier dashboard operation is unfinished; finish/verify it before update.');
 if(record.manifest.revoked || (record.manifest.expiresAt!==null && Date.parse(record.manifest.expiresAt)<=Date.now()))throw Error('Share expired or revoked.');
 const folder=record.config?.folder;if(!folder)throw Error('Share has no PDF source folder configuration.');
 const names=(await readdir(folder)).filter(n=>/\.pdf$/i.test(n)).sort();if(!names.length||names.length>100)throw Error('Source folder needs 1-100 PDFs.');
 const next=structuredClone(record),uploads=[],changes=[];next.manifest.files=[];next.sources={};next.retired??=[];
 for(const filename of names){
  if(filename.length>180||/[\r\n"\\]/.test(filename))throw Error('Unsupported filename');
  const source=join(folder,filename),s=await stat(source);if(!s.isFile()||s.size>300_000_000)throw Error('Each PDF must be a regular file no larger than 300 MB.');
  const bytes=await readFile(source);if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error(`Not a PDF: ${filename}`);
  const sha256=hash(bytes),old=record.manifest.files.find(f=>f.filename===filename);
  let file=old && record.sources[filename]?.sha256===sha256?structuredClone(old):null;
  if(!file){file={id:randomBytes(12).toString('hex'),key:`objects/${record.prefix}/${randomBytes(16).toString('hex')}`,filename};uploads.push({source,sha256,bytes:s.size,id:file.id});changes.push(`${old?'Replace':'Add'}: ${filename} (${s.size} bytes)`);}
  next.manifest.files.push(file);next.sources[filename]={sha256,bytes:s.size};
 }
 const removed=record.manifest.files.filter(f=>!next.manifest.files.some(n=>n.key===f.key));
 for(const f of removed){next.retired.push({...f,bytes:record.sources[f.filename]?.bytes});if(!names.includes(f.filename))changes.push(`Unlist: ${f.filename} (stored copy retained)`);}
 return {previous:record,next,uploads,changes,deltaBytes:uploads.reduce((n,f)=>n+f.bytes,0),shareBytes:Object.values(next.sources).reduce((n,f)=>n+f.bytes,0)};
}
export async function executeUpdate(plan,store,savePending,verify){
 const key=`_shares/${hash(plan.next.token)}.json`,current=await store.get(key);
 const target=()=>Buffer.from(JSON.stringify(plan.next.manifest,null,2));
 const same=(a,b)=>a===null||b===null?a===b:JSON.stringify(JSON.parse(a))===JSON.stringify(JSON.parse(b));
 const previous=plan.previous?JSON.stringify(plan.previous.manifest):null;
 // On retry after uncertain publication, verify and finalize instead of uploading again.
 if(same(current,target())){await verify(plan.next);return plan.next;}
 if(!same(current,previous))throw Error('Remote manifest changed; refusing to overwrite another update.');
 for(const upload of plan.uploads){
  const file=plan.next.manifest.files.find(f=>f.id===upload.id);
  if(!file.uploadedAt){
   if(await hashFile(upload.snapshot)!==upload.sha256)throw Error('Private snapshot changed; stopping.');
   if(store.putFile)await store.putFile(file.key,upload.snapshot,upload.sha256,upload.bytes);else await store.put(file.key,await readFile(upload.snapshot));
   file.uploadedAt=await store.uploadedAt(file.key);await savePending(plan);
  }
  if((store.hash?await store.hash(file.key):hash(await store.get(file.key)))!==upload.sha256)throw Error('Uploaded bytes do not match local SHA-256; manifest not published.');
 }
 // Recheck immediately before atomic publication; local lock prevents overlapping runs here.
 if(!same(await store.get(key),previous))throw Error('Remote manifest changed during upload; refusing publication.');
 await savePending(plan);await store.put(key,target());
 await verify(plan.next);return plan.next;
}
export async function verifyHosted(record){
 const base=`${ORIGIN}/s/${record.token}`;
 const page=await fetch(base,{redirect:'error'});if(page.status!==200)throw Error('Published share page verification failed.');
 const html=await page.text();if((html.match(/>Download<\/a>/g)||[]).length!==record.manifest.files.length)throw Error('Published file count differs.');
 for(const f of record.manifest.files){const r=await fetch(`${base}/f/${f.id}`,{redirect:'error'});if(r.status!==200 || await hashBody(r.body)!==record.sources[f.filename].sha256 || !r.headers.get('content-disposition')?.startsWith('attachment;'))throw Error('Hosted PDF hash/attachment verification failed.');}
}
export async function main(args=process.argv.slice(2)){
 const name=args.find(a=>!a.startsWith('--'))||DEFAULT_SHARE;
 if(!/^[a-z0-9-]{1,60}$/.test(name)||args.some(a=>a.startsWith('--')&&!['--dry-run','--yes'].includes(a)))throw Error('Usage: npm run update -- [SHARE] [--dry-run|--yes]');
 const local=resolve('.local'),recordPath=join(local,`${name}.json`),pendingPath=join(local,`${name}.update.json`),lockPath=join(local,`${name}.update.lock`);
 const record=JSON.parse(await readFile(recordPath,'utf8'));
 let pending;try{pending=JSON.parse(await readFile(pendingPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const plan=pending||await planUpdate(record);
 if(pending && JSON.stringify(record)!==JSON.stringify(plan.previous) && JSON.stringify(record)!==JSON.stringify(plan.next))throw Error('Local share record changed since interrupted update; stop for review.');
 console.log(`Share: ${record.manifest.title}\nFolder: ${record.config.folder}\n${pending?'Resume prepared update':'Update plan'}: ${plan.uploads.length} upload(s), ${plan.deltaBytes} added storage bytes, ${plan.shareBytes} active-share bytes. Existing links and expiry retained.`);
 for(const change of plan.changes)console.log(change);
 if(!plan.changes.length){console.log('Already up to date. No remote writes or account audit needed.');return;}
 let managedBytes=0;for(const n of await readdir(local)){if(!/^[a-z0-9-]+\.json$/.test(n))continue;try{const r=JSON.parse(await readFile(join(local,n),'utf8'));if(r.manifest&&r.sources)managedBytes+=Object.values(r.sources).reduce((s,f)=>s+(f.bytes||0),0)+(r.retired||[]).reduce((s,f)=>s+(f.bytes||0),0);}catch{}}
 console.log(checkBudget({...plan,managedBytes},await accountUsage()));
 if(args.includes('--dry-run')){console.log('Dry run: no local share state changed and no remote writes.');return;}
 const store=storageClient();
 // Permission preflight is read-only and precedes confirmation or any private staging.
 await store.get(`_shares/${hash(record.token)}.json`);
 if(!args.includes('--yes')){
  if(!process.stdin.isTTY)throw Error('Review the dry run, then explicitly approve with --yes, or rerun interactively to confirm.');
  const terminal=createInterface({input:process.stdin,output:process.stdout});let answer;try{answer=await terminal.question('Upload and publish exactly this plan? [y/N] ');}finally{terminal.close();}if(!/^y(es)?$/i.test(answer.trim())){console.log('Cancelled. Nothing uploaded.');return;}
 }
 const {open,unlink}=await import('node:fs/promises');let lock;
 try{lock=await open(lockPath,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('Another update is active or interrupted. Review the local .update.lock before clearing a stale lock.');throw e;}
 const save=async(p,v)=>{const temp=p+'.tmp';await writeFile(temp,JSON.stringify(v,null,2),{mode:0o600});await chmod(temp,0o600);const {rename}=await import('node:fs/promises');await rename(temp,p);};
 try{
  if(!pending){const operation=join(local,'uploads',`${name}-auto-${Date.now()}`);await mkdir(operation,{recursive:true,mode:0o700});
   for(const u of plan.uploads){u.snapshot=join(operation,u.id);await copyFile(u.source,u.snapshot);await chmod(u.snapshot,0o600);if(await hashFile(u.snapshot)!==u.sha256)throw Error('Source changed since plan; rerun to review.');}
   await save(pendingPath,plan);
  }
  const next=await executeUpdate(plan,store,p=>save(pendingPath,p),verifyHosted);next.pending=false;
  await save(recordPath,next);await unlink(pendingPath);
  console.log('Published and verified all PDF hashes. Same share link; no stored copies deleted.');
 }finally{await lock.close();await unlink(lockPath);}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
