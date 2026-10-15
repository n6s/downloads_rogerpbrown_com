const security = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Pragma': 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Strict-Transport-Security': 'max-age=31536000',
};
const response = (body, status = 200, extra = {}) => new Response(body, { status, headers: { ...security, ...extra } });
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function tokenHash(token) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function disposition(name) {
  const clean = Array.from(String(name).toWellFormed().normalize('NFC').replace(/[\u0000-\u001f\u007f/\\]/g, '_')).slice(0, 180).join('') || 'download';
  const fallback = clean.replace(/[^\x20-\x7e]|["\\;]/g, '_');
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
export function parseRange(value, size) {
  if (!value) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!m || (!m[1] && !m[2]) || size === 0) return false;
  let start, end;
  if (!m[1]) { const suffix = Number(m[2]); if (!Number.isSafeInteger(suffix) || suffix < 1) return false; start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(m[1]); end = m[2] ? Number(m[2]) : size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return false;
  end = Math.min(end, size - 1);
  return { offset: start, length: end - start + 1 };
}
function validManifest(m) {
  return m && m.version === 1 && typeof m.title === 'string' && m.title.length <= 200 &&
    (m.description === undefined || (typeof m.description === 'string' && m.description.length <= 2000)) && !m.revoked &&
    Number.isFinite(Date.parse(m.expiresAt)) && Date.parse(m.expiresAt) > Date.now() &&
    Array.isArray(m.files) && m.files.length <= 100 && m.files.every(f =>
      f && /^[a-zA-Z0-9_-]{1,80}$/.test(f.id) && /^objects\/[a-f0-9]{32}\/[a-f0-9]{32}$/.test(f.key) &&
      typeof f.filename === 'string' && f.filename.length <= 180);
}
function page(m, token) {
  const items = m.files.map(f => `<li><span>${escapeHtml(f.filename)}</span><a href="/s/${token}/f/${f.id}">Download</a></li>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(m.title)} · Downloads</title><style>body{font:18px/1.5 system-ui,sans-serif;background:#f5f4f0;color:#203438;margin:0;padding:7vh 5vw}main{max-width:760px;margin:auto}small{color:#52666a}h1{font-size:2rem;line-height:1.2}.description{white-space:pre-wrap;overflow-wrap:anywhere}ul{list-style:none;padding:0;margin:2rem 0}li{display:flex;align-items:center;justify-content:space-between;gap:1.5rem;background:white;border:1px solid #d6ddda;border-radius:12px;margin:12px 0;padding:20px}span{overflow-wrap:anywhere}a{background:#215b51;color:white;padding:10px 16px;border-radius:8px;text-decoration:none;white-space:nowrap}a:hover,a:focus-visible{background:#103d35;outline:3px solid #d6b85e}footer{font-size:.9rem;color:#52666a}@media(max-width:460px){li{align-items:flex-start;flex-direction:column}}</style><main><small>PRIVATE FILE SHARING</small><h1>${escapeHtml(m.title)}</h1>${m.description ? `<p class="description">${escapeHtml(m.description)}</p>` : ''}<p>Choose a file to save it to your computer.</p><ul>${items}</ul><footer>This private link expires ${escapeHtml(m.expiresAt.slice(0,10))} (UTC). Keep it with the intended recipients. Downloads can be retried.</footer></main></html>`;
}
export default {
  async fetch(request, env) {
    const head = request.method === 'HEAD';
    if (!['GET','HEAD'].includes(request.method)) return response(null, 405, { Allow: 'GET, HEAD' });
    const url = new URL(request.url);
    const match = /^\/s\/([A-Za-z0-9_-]{43})(?:\/f\/([A-Za-z0-9_-]{1,80}))?\/?$/.exec(url.pathname);
    if (!match || url.search) return response(head ? null : 'Link unavailable.', 404);
    try {
      // No list operation or user-controlled object key is ever accepted.
      const manifestObject = await env.DOWNLOADS.get(`_shares/${await tokenHash(match[1])}.json`);
      if (!manifestObject) return response(head ? null : 'Link unavailable.', 404);
      const manifest = await manifestObject.json();
      if (!validManifest(manifest)) return response(head ? null : 'Link unavailable.', 404);
      if (!match[2]) return response(head ? null : page(manifest, match[1]), 200, {'Content-Type':'text/html; charset=utf-8'});
      const file = manifest.files.find(f => f.id === match[2]);
      if (!file) return response(head ? null : 'Link unavailable.', 404);
      const meta = await env.DOWNLOADS.head(file.key);
      if (!meta) return response(head ? null : 'File unavailable.', 404);
      const headers = {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': disposition(file.filename),
        'Accept-Ranges': 'bytes', 'ETag': meta.httpEtag,
        'Last-Modified': meta.uploaded.toUTCString(),
      };
      // Per HTTP semantics, Range is ignored on HEAD. Honor If-Range only on exact validators.
      const ifRange = request.headers.get('If-Range');
      const range = head || (ifRange && ifRange !== meta.httpEtag && ifRange !== headers['Last-Modified']) ? null : parseRange(request.headers.get('Range'), meta.size);
      if (range === false) return response(null, 416, {...headers, 'Content-Range': `bytes */${meta.size}`});
      headers['Content-Length'] = String(range ? range.length : meta.size);
      if (range) headers['Content-Range'] = `bytes ${range.offset}-${range.offset + range.length - 1}/${meta.size}`;
      if (head) return response(null, 200, headers);
      // R2's conditional read prevents a replacement racing with the metadata lookup.
      const object = await env.DOWNLOADS.get(file.key, { onlyIf: { etagMatches: meta.etag }, ...(range ? { range } : {}) });
      if (!object || !object.body) return response('File changed; retry the download.', 409);
      return response(object.body, range ? 206 : 200, headers);
    } catch {
      // Never log the request URL or capability token.
      return response(head ? null : 'Temporarily unavailable. Please retry.', 503);
    }
  }
};
