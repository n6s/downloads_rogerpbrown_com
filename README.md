# Private downloads

A small Cloudflare Worker and private R2 bucket for sharing choir recordings and manuscript PDFs with specific people. Recipients open a private link and download files for editing or practice. The project grew out of a practical need: keep one useful download page per audience while its contents change, preserve original filenames, and allow retries without exposing the rest of the bucket.

## Design

```text
Recipient's private link → Worker → private share manifest → allowlisted R2 object
```

Each audience gets an independently generated 256-bit bearer token. The Worker hashes it to locate a private manifest, then checks the manifest on every page or file request. The manifest lists individual permitted files; the caller cannot supply an object key or browse the bucket. The public source contains neither production tokens nor choir files.

Downloads stream as attachments with UTF-8 filenames. HEAD, byte ranges and If-Range support retrying downloads and inspecting metadata. Replacements receive immutable new object keys; the manifest is published last so incomplete uploads are not listed. Unchanged files retain their upload dates. Pages show actual R2 upload dates, default to newest first, and offer accessible filename/date sorting with a narrow-screen layout. The page needs no browser JavaScript or media player.

Expiring shares stop serving at their expiry. Revocation denies new requests immediately after publication of the revoked manifest. Source also supports explicitly non-expiring, revocable shares for a persistent bookmark; an omitted expiry fails closed. See [STATUS.md](STATUS.md) for what is actually deployed.

## Access and privacy boundaries

- Links are bearer credentials: anyone who receives one can download that share. This is recipient-scoped sharing, not identity-based authentication. There is no per-person login or download-confirmation audit.
- R2 public access stays disabled. The Worker exposes no upload/admin endpoint or bucket listing. Queries, writes, traversal attempts, unknown files and invalid/revoked/expired shares are denied.
- Responses disable caching/indexing and referrers. The page loads no external scripts or analytics; Worker observability is disabled in the example deployment. Providers and browser history may still retain URLs.
- Downloading never deletes a file. Unlisting, revocation and permanent storage cleanup are separate actions. Revocation cannot recall saved copies or stop downloads already underway.

The design relies on secret random tokens and private R2 access. Knowing the source, bucket name or Cloudflare account identifier does not authorize a download. The local operator tools require separate authenticated R2 write access.

## Run and verify

Tested with Node.js 24. Install the declared development dependencies for Wrangler and Miniflare:

```bash
npm install
npm test
npm run check
npm run integration
```

Unit/operator tests cover audience isolation, expiry/revocation, traversal/write denial, streaming/ranges, filenames and HTML escaping, upload-date sorting, unchanged-file detection, replacements, cost guards and interrupted publication. Integration tests use real local workerd/R2 behavior with generated harmless PDF/text fixtures. They do not access the production bucket. `MINIFLARE_MODULE` can select an existing installed Miniflare package.

## Deploy and update

The deployment uses one Worker, one R2 binding and a dedicated hostname; workers.dev and previews are disabled. Adapt the example `wrangler.jsonc` to an account and hostname you control, keep the bucket private, and use an authorized Wrangler login or deployment token. Check existing DNS and hostname assignments before deploying:

```bash
npx wrangler deploy --dry-run
npx wrangler deploy
```

A file update does not require a Worker restart. Operator records live under ignored `.local/`, containing the share token, manifest, source hashes and prepared upload paths. They need a private backup; cloning this repository does not recover existing shares. Keep credentials in the environment, outside Git. Configure operator targets through `DOWNLOADS_ACCOUNT_ID`, `DOWNLOADS_BUCKET` and `DOWNLOADS_ORIGIN`, or private `.local/operator.json` with `accountId`, `bucket` and `origin`. The checked-in deployment file uses example identifiers; an operator can keep a real configuration at `.local/wrangler.production.jsonc` and pass `--config` explicitly.

For an existing configured PDF share:

```bash
npm run update -- SHARE_NAME --dry-run
```

This reports additions, replacements, unlisted files and added storage bytes without uploading or changing share state. The automatic update path can confirm a plan, upload changed files, verify hashes/dates and publish the manifest last when suitable R2 credentials are available. It is tested with synthetic storage; live upload permission has not been established in the current deployment. `scripts/dashboard.mjs` supports the separately verified dashboard-assisted preparation, timestamp and verification workflow. Its private production runbook is kept outside tracked source.

There is no required manual byte-total conversion. Tools attempt account metrics using existing permissions and explicitly distinguish unavailable metrics from known over-limit usage. Configurable conservative batch/share limits still apply. Account-wide allowances, analytics lag and unrelated account activity mean these controls are not a hard billing cap.

## Tradeoffs and next steps

The deliberately small download surface is easy to inspect, but bearer links can be forwarded and local operator state must be protected. Automatic deletion after a request would be unreliable because scanners, partial downloads and retries can look like completed downloads. Large recordings also need a suitable upload path: the proven dashboard route is limited to 300 MB per file. Multipart upload and a recording-specific self-service interface are not implemented.

Useful next steps are a reproducible dependency lockfile, CI for the existing tests, an authenticated live upload test using disposable fixtures, and deployment of the explicit persistent-share option before issuing a permanent recording bookmark. Production recipient links and real content should remain private even if this source is published.

## How this was built

Roger Brown supplied the real choir workflow, product requirements and operational decisions. OpenAI Codex assisted with implementation, tests, documentation and deployment verification. This project demonstrates the resulting design choices and their tested limits; it does not claim the code was written without AI assistance or independently security-audited.

## License

MIT © 2026 Roger Brown. See [LICENSE](LICENSE). Development dependencies retain their own licenses; no dependency source is vendored here. The PDF/text fixtures are generated samples containing no music or manuscript scans.
