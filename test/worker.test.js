import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { tokenHash, disposition, parseRange } from '../src/worker.js';
const a = 'A'.repeat(43), b = 'B'.repeat(43);
const keyA = `objects/${'a'.repeat(32)}/${'1'.repeat(32)}`;
const keyB = `objects/${'b'.repeat(32)}/${'2'.repeat(32)}`;
async function fixture() {
  const manifests = new Map();
  const make=(title,id,key)=>({version:1,title,expiresAt:'2099-01-01T00:00:00Z',files:[{id,key,filename:`${title}.pdf`}]});
  manifests.set(`_shares/${await tokenHash(a)}.json`,make('Recording','anne',keyA));
  manifests.set(`_shares/${await tokenHash(b)}.json`,make('Tenors','tenors',keyB));
  const calls=[];
  const env={DOWNLOADS:{
    async head(key) { calls.push(['head',key]); return {size:10,etag:'v1',httpEtag:'"v1"',uploaded:new Date('2026-01-01')}; },
    async get(key,opts) { calls.push(['get',key,opts]); if(key.startsWith('_shares/')) {const m=manifests.get(key); return m ? {json:async()=>m}:null;}
      const bytes=new TextEncoder().encode('0123456789'); const r=opts?.range;
      return {body:new ReadableStream({start(c){c.enqueue(r?bytes.slice(r.offset,r.offset+r.length):bytes);c.close();}})};
    }
  }};
  const request=(path,options={})=>worker.fetch(new Request(`https://downloads.example.com${path}`,options),env);
  return {request,calls,manifests};
}
test('valid share list, scoped filenames and security headers',async()=>{const f=await fixture(); const r=await f.request(`/s/${a}`); const html=await r.text(); assert.equal(r.status,200); assert.match(html,/Recording.pdf/); assert.doesNotMatch(html,/Tenors|objects\//); assert.equal(r.headers.get('Cache-Control'),'private, no-store, max-age=0'); assert.equal(r.headers.get('Referrer-Policy'),'no-referrer'); assert.equal(r.headers.get('X-Robots-Tag'),'noindex, nofollow, noarchive');});
test('invalid, expired, revoked links all fail closed',async()=>{const f=await fixture(); assert.equal((await f.request('/s/invalid')).status,404); assert.equal((await f.request(`/s/${'C'.repeat(43)}`)).status,404); const m=f.manifests.get(`_shares/${await tokenHash(a)}.json`); m.expiresAt='2000-01-01'; assert.equal((await f.request(`/s/${a}`)).status,404); m.expiresAt='2099-01-01';m.revoked=true;assert.equal((await f.request(`/s/${a}/f/anne`)).status,404);assert.ok(!f.calls.some(c=>c[0]==='head'));});
test('cross-share access, traversal, public listing, queries, writes rejected',async()=>{const f=await fixture(); for(const path of ['/', '/objects/', '/_shares/', `/s/${a}/f/tenors`, `/s/${b}/f/anne`, `/s/${a}/f/%2e%2e%2fsecret`, `/s/${a}?key=secret`]) assert.equal((await f.request(path)).status,404,path); assert.equal((await f.request(`/s/${a}`,{method:'POST'})).status,405); assert.ok(!f.calls.some(c=>c[0]==='head'));});
test('full streaming download and repeat retries preserve manifest',async()=>{const f=await fixture(); for(let i=0;i<2;i++){const r=await f.request(`/s/${a}/f/anne`);assert.equal(r.status,200);assert.match(r.headers.get('Content-Disposition'),/^attachment;/);assert.equal(await r.text(),'0123456789');} assert.equal((await f.request(`/s/${a}`)).status,200);});
test('HEAD reads metadata but no file body, Range ignored',async()=>{const f=await fixture(); const r=await f.request(`/s/${a}/f/anne`,{method:'HEAD',headers:{Range:'bytes=2-4'}});assert.equal(r.status,200);assert.equal(r.headers.get('Content-Length'),'10');assert.equal(await r.text(),'');assert.ok(!f.calls.some(c=>c[0]==='get' && c[1]===keyA));});
test('ranges, suffix, unsatisfiable, If-Range and replacement guard',async()=>{const f=await fixture();for(const [range,body] of [['bytes=2-4','234'],['bytes=-3','789'],['bytes=8-','89']]){const r=await f.request(`/s/${a}/f/anne`,{headers:{Range:range}});assert.equal(r.status,206);assert.equal(await r.text(),body);}for(const range of ['bytes=99-','bytes=2-1','bytes=0-1,5-6','bytes=-0'])assert.equal((await f.request(`/s/${a}/f/anne`,{headers:{Range:range}})).status,416); const r=await f.request(`/s/${a}/f/anne`,{headers:{Range:'bytes=2-4','If-Range':'"old"'}});assert.equal(r.status,200); assert.equal(await r.text(),'0123456789');assert.equal(f.calls.find(c=>c[2]?.onlyIf)?.[2].onlyIf.etagMatches,'v1');});
test('filename header escaping, HTML escaping, malformed manifest',async()=>{const h=disposition('café";\r\n/\\.pdf');assert.ok(!/[\r\n]/.test(h));assert.match(h,/filename\*=UTF-8''caf%C3%A9/);const f=await fixture();const m=f.manifests.get(`_shares/${await tokenHash(a)}.json`);m.title='<script>bad</script>';m.files[0].filename='"<img>.pdf';assert.match(await (await f.request(`/s/${a}`)).text(),/&lt;script&gt;/);m.files[0].key='_shares/secret';assert.equal((await f.request(`/s/${a}`)).status,404);});
test('storage failures return generic uncached response',async()=>{const r=await worker.fetch(new Request(`https://example.com/s/${a}`),{DOWNLOADS:{get(){throw Error('private details');}}});assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/private details/);});
test('range parser clamps and handles empty objects',()=>{assert.deepEqual(parseRange('bytes=8-99',10),{offset:8,length:2});assert.equal(parseRange('bytes=0-',0),false);assert.equal(parseRange('bytes=999999999999999999999-',10),false);});

 test('plain-text description is escaped and optional; invalid types and length denied',async()=>{const f=await fixture();const m=f.manifests.get(`_shares/${await tokenHash(a)}.json`);m.title='Example tenor practice parts';m.description='Example practice copies for the intended choir members.';let html=await(await f.request(`/s/${a}`)).text();assert.match(html,/Example tenor practice parts/);assert.match(html,/Example practice copies for the intended choir members\./);m.description='<script>alert("x")</script> & \'quote\'\nsecond line';html=await(await f.request(`/s/${a}`)).text();assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quote&#39;\nsecond line'));assert.doesNotMatch(html,/<script>/);for(const invalid of [null,{},'x'.repeat(2001)]){m.description=invalid;assert.equal((await f.request(`/s/${a}`)).status,404);}delete m.description;assert.equal((await f.request(`/s/${a}`)).status,200);});
