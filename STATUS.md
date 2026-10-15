# Implementation and deployment status

The private download service is deployed with one private R2 bucket and a Worker on a dedicated hostname. The deployed version supports attachment downloads, audience isolation, expiring/revoked links, original filenames, range requests, actual upload dates and filename/date sorting. Desktop and narrow-screen browser checks passed. Production files/links and operator details are excluded from this document.

The uploaded-date/sorting release was verified in production on October 15, 2026. The existing dated production share remains unchanged. A specifically requested sample link was subsequently revoked; its listing and file GET/HEAD requests returned 404 while unrelated active shares remained 200. Its stored objects were retained.

## Prepared locally; not deployed or proven on live R2 writes

- Explicit non-expiring manifests (`expiresAt:null`) for a persistent, revocable bookmark. Dated shares keep their expiry; absent expiry still fails closed. No real persistent recording share has been created.
- An automatic PDF update path with a no-write dry run, exact added bytes, unchanged-file skipping, immutable replacements, hash/date verification, manifest-last publication, private retry state and local overlap protection.
- Automatic best-effort account metrics and configurable cost guardrails replacing the mandatory manual byte-total audit. Unavailable metrics are reported as unknown.

The existing deployment token is denied R2 object access, and the saved Wrangler OAuth login could not refresh. Automated real uploads remain blocked by authentication. No new credentials or permissions were created; the existing signed-in dashboard remains the verified upload route. A prepared S3 client accepts only explicitly dedicated environment credentials and has synthetic tests, not a successful live write test. No new real PDFs or recordings were uploaded during this UX work.

Local validation passed: 12 Worker tests, dashboard operator tests, 8 update/auth/budget tests, syntax checks, Miniflare/workerd integration and a Wrangler deployment dry run. These results do not imply the prepared changes have been deployed.

Private operator continuity is in ignored `.local/OPERATIONS.md` and `.local/STATUS.private.md`. Public history is sanitized to remove production account/deployment identifiers, personal operational paths and private author email. Original history and uncommitted work are preserved in a verified private backup outside this repository. Publishing source does not deploy the prepared Worker changes or publish private share data.
