// Production details belong in ignored local configuration, never public source.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
let local={};
try{local=JSON.parse(readFileSync(resolve('.local/operator.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
export const ACCOUNT=process.env.DOWNLOADS_ACCOUNT_ID||process.env.CLOUDFLARE_ACCOUNT_ID||local.accountId||null;
export const BUCKET=process.env.DOWNLOADS_BUCKET||local.bucket||'private-downloads';
export const ORIGIN=process.env.DOWNLOADS_ORIGIN||local.origin||'https://downloads.example.com';
if(ACCOUNT!==null&&!/^[a-f0-9]{32}$/.test(ACCOUNT))throw Error('Invalid configured Cloudflare account ID.');
if(!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(BUCKET))throw Error('Invalid configured R2 bucket.');
const origin=new URL(ORIGIN);
if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('Configure an HTTPS origin without paths or credentials.');
export const DEFAULT_SHARE=local.defaultShare||'tenors';
