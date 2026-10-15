// Local clients only. Credentials remain in the environment; never written or logged.
import {createHash,createHmac} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {ACCOUNT,BUCKET} from './config.mjs';
export {ACCOUNT,BUCKET};
const sha=b=>createHash('sha256').update(b).digest('hex');
export function storageClient(env=process.env,request=fetch){
 if(!!env.DOWNLOADS_R2_ACCESS_KEY_ID!==!!env.DOWNLOADS_R2_SECRET_ACCESS_KEY)throw Error('Incomplete dedicated R2 credentials; no fallback attempted.');
 const s3=!!(env.DOWNLOADS_R2_ACCESS_KEY_ID && env.DOWNLOADS_R2_SECRET_ACCESS_KEY);
 if(!s3 && !env.CLOUDFLARE_API_TOKEN)throw Error('No existing upload credential. See README: bucket-scoped R2 Object Read & Write setup requires approval.');
 const account=env.DOWNLOADS_ACCOUNT_ID||ACCOUNT;
 if(!account || !/^[a-f0-9]{32}$/.test(account))throw Error('Configure DOWNLOADS_ACCOUNT_ID or private .local/operator.json before uploading.');
 const host=s3?`${account}.r2.cloudflarestorage.com`:'api.cloudflare.com';
 async function call(method,key,body,payloadHash,size){
  const path=s3?`/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`:`/client/v4/accounts/${account}/r2/buckets/${BUCKET}/objects/${key.split('/').map(encodeURIComponent).join('/')}`;
  const headers={};if(body)headers['content-type']='application/octet-stream';
  if(s3){
   const date=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),day=date.slice(0,8),scope=`${day}/auto/s3/aws4_request`;
   headers.host=host;headers['x-amz-date']=date;headers['x-amz-content-sha256']=payloadHash||sha(body||'');
   if(env.DOWNLOADS_R2_SESSION_TOKEN)headers['x-amz-security-token']=env.DOWNLOADS_R2_SESSION_TOKEN;
   const names=Object.keys(headers).sort(),signed=names.join(';');
   const canonical=[method,path,'',names.map(n=>`${n}:${headers[n]}\n`).join(''),signed,headers['x-amz-content-sha256']].join('\n');
   let signing=Buffer.from('AWS4'+env.DOWNLOADS_R2_SECRET_ACCESS_KEY);for(const part of [day,'auto','s3','aws4_request'])signing=createHmac('sha256',signing).update(part).digest();
   headers.authorization=`AWS4-HMAC-SHA256 Credential=${env.DOWNLOADS_R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signed}, Signature=${createHmac('sha256',signing).update(`AWS4-HMAC-SHA256\n${date}\n${scope}\n${sha(canonical)}`).digest('hex')}`;
  }else headers.authorization='Bearer '+env.CLOUDFLARE_API_TOKEN;
  if(size!==undefined)headers['content-length']=String(size);
  const r=await request(`https://${host}${path}`,{method,headers,body,...(body?.pipe?{duplex:'half'}:{}),redirect:'error',signal:AbortSignal.timeout(method==='PUT'?600000:60000)});
  if(method==='GET' && r.status===404)return null;
  if(!r.ok)throw Error(`R2 ${method} failed (HTTP ${r.status}). No permission bypass attempted. Existing token may lack R2 access; see README authentication setup.`);
  return r;
 }
 return {mode:s3?'bucket-scoped S3 credentials':'existing Cloudflare API token',
  get:async key=>{const r=await call('GET',key);return r?Buffer.from(await r.arrayBuffer()):null;},
  hash:async key=>{const r=await call('GET',key);if(!r)throw Error('Uploaded object missing.');return hashBody(r.body);},
  put:async(key,body)=>{await call('PUT',key,body);},
  putFile:async(key,path,digest,size)=>{if(!s3 && size>300_000_000)throw Error('Large recording upload requires bucket-scoped S3 credentials; REST uploader is limited to 300 MB.');await call('PUT',key,createReadStream(path),digest,size);},
  uploadedAt:async key=>{const r=await call(s3?'HEAD':'GET',key);if(!r)throw Error('Uploaded object missing.');const t=Date.parse(r.headers.get('last-modified'));if(r.body)await r.body.cancel();if(!Number.isFinite(t))throw Error('R2 upload date unavailable; manifest not published.');return new Date(t).toISOString();}};
}
export async function hashBody(body){const h=createHash('sha256');for await(const chunk of body)h.update(chunk);return h.digest('hex');}
export async function hashFile(path){return hashBody(createReadStream(path));}
export async function accountUsage(env=process.env,request=fetch){
 const account=env.DOWNLOADS_ACCOUNT_ID||ACCOUNT;
 if(!account)return {known:false,reason:'account configuration unavailable'};
 if(!env.CLOUDFLARE_API_TOKEN)return {known:false,reason:'account analytics credential unavailable'};
 try{
  const headers={authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN};
  const buckets=await request(`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets`,{headers,signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!buckets.ok)return {known:false,reason:`account bucket inventory unavailable (HTTP ${buckets.status})`};
  const list=await buckets.json();if(!list.success || list.result?.is_truncated || !Array.isArray(list.result?.buckets))throw Error('incomplete inventory');
  const end=new Date(),start=new Date(end-864e5);
  const query=`query { viewer { accounts(filter: {accountTag: "${account}"}) { r2StorageAdaptiveGroups(limit: 10000, filter: {datetime_geq: "${start.toISOString()}", datetime_leq: "${end.toISOString()}"}, orderBy: [datetime_DESC]) { max {payloadSize metadataSize} dimensions {bucketName datetime} } } } }`;
  const r=await request('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(10000),redirect:'error'});
  const data=await r.json(),rows=data.data?.viewer?.accounts?.[0]?.r2StorageAdaptiveGroups;
  if(!r.ok || data.errors?.length || !Array.isArray(rows) || rows.length>=10000)throw Error('analytics unavailable/incomplete');
  const latest=new Map();for(const row of rows){if(!latest.has(row.dimensions.bucketName))latest.set(row.dimensions.bucketName,row);}
  let bytes=0,oldest=end.toISOString();
  for(const bucket of list.result.buckets){
   if(bucket.jurisdiction && bucket.jurisdiction!=='default')throw Error('jurisdiction inventory requires separate coverage');
   const row=latest.get(bucket.name);if(!row || !Number.isFinite(Date.parse(row.dimensions.datetime)) || end-Date.parse(row.dimensions.datetime)>6*3600e3)throw Error('missing or stale bucket metric');
   const n=row.max.payloadSize+row.max.metadataSize;if(!Number.isSafeInteger(n)||n<0)throw Error('invalid metric');bytes+=n;if(row.dimensions.datetime<oldest)oldest=row.dimensions.datetime;
  }
  return {known:true,bytes,asOf:oldest};
 }catch{return {known:false,reason:'account analytics unavailable, incomplete or stale'};}
}
export function checkBudget({deltaBytes,shareBytes,managedBytes=0},usage,env=process.env){
 const limit=(name,fallback)=>{const n=Number(env[name]??fallback);if(!Number.isSafeInteger(n)||n<=0)throw Error(`Invalid ${name}`);return n;};
 if(deltaBytes>limit('DOWNLOADS_MAX_BATCH_BYTES',100_000_000))throw Error('Planned upload exceeds conservative 100 MB batch limit (configurable DOWNLOADS_MAX_BATCH_BYTES).');
 if(shareBytes>limit('DOWNLOADS_MAX_SHARE_BYTES',500_000_000))throw Error('Active share exceeds conservative 500 MB limit (configurable DOWNLOADS_MAX_SHARE_BYTES).');
 if(managedBytes+deltaBytes>limit('DOWNLOADS_MAX_MANAGED_BYTES',1_000_000_000))throw Error('Known locally managed storage exceeds conservative 1 GB limit (DOWNLOADS_MAX_MANAGED_BYTES).');
 if(deltaBytes>0 && usage.known && usage.bytes+deltaBytes>limit('DOWNLOADS_MAX_ACCOUNT_BYTES',8_000_000_000))throw Error('Reported account storage plus this upload exceeds conservative 8 GB target.');
 return usage.known?`Account storage: ${(usage.bytes/1e6).toFixed(2)} MB as of ${usage.asOf} (analytics may lag).`:`Account storage unknown: ${usage.reason}. Local upload/share limits still apply; unknown does not mean over limit or zero. Account allowances are shared and are not a hard spending cap.`;
}
