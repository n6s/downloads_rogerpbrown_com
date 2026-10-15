import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
const root=path.resolve('.local/dashboard-upload');
await fs.mkdir(root,{recursive:true,mode:0o700});
for(const [name,title,description,source,days] of [
 ['anne-sample','Recording’s recording download — sample','Harmless test file. No rehearsal audio is included.','samples/Recording - sample download.txt',14],
 ['tenor-sample','Example tenor practice parts','Example practice copies for the intended choir members.','samples/Tenors - sample manuscript.pdf',90]
]){
 const token=crypto.randomBytes(32).toString('base64url');
 const hash=crypto.createHash('sha256').update(token).digest('hex');
 const key=`objects/${crypto.randomBytes(16).toString('hex')}/${crypto.randomBytes(16).toString('hex')}`;
 const manifest={version:1,title,description,expiresAt:new Date(Date.now()+days*86400000).toISOString(),files:[{id:'sample',key,filename:path.basename(source)}]};
 await fs.mkdir(path.dirname(path.join(root,key)),{recursive:true,mode:0o700});
 await fs.copyFile(source,path.join(root,key));
 await fs.mkdir(path.join(root,'_shares'),{recursive:true,mode:0o700});
 await fs.writeFile(path.join(root,`_shares/${hash}.json`),JSON.stringify(manifest),{mode:0o600});
 const record={name,token,hash,manifest,source,url:`https://downloads.example.com/s/${token}`};
 await fs.writeFile(`.local/${name}.json`,JSON.stringify(record,null,2),{mode:0o600});
}
console.log('Prepared two harmless sample files and scoped manifests locally.');
