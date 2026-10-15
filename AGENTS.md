# Project guidance

This is a private-file download service. Keep the R2 bucket private, use explicit per-share allowlists, preserve bearer URLs during content updates, and never treat an HTTP request as confirmation that a recipient saved a usable file. File unlisting, share revocation and permanent object deletion are distinct operations.

For production operator continuity on this machine, consult the ignored `.local/OPERATIONS.md` and `.local/STATUS.private.md`. They contain local record locations and the verified dashboard workflow. Do not copy private operator records, credentials, recipient links or real files into source control. Use synthetic fixtures for tests and read-only previews before real writes. Follow the current user's instructions for upload authorization and cleanup; do not infer authorization from a workflow complaint.

Account metrics unavailable means unknown, not zero or over limit. Preserve upload timestamps for unchanged content; obtain actual R2 timestamps for replacements. Upload immutable data first, verify it, then publish the share manifest last. Never use the dashboard completed-upload queue's Remove all control to clear a queue: it can delete objects. Reload between batches.

Tests: `npm test`, `npm run check`; use `npm run integration` for Worker changes, with MINIFLARE_MODULE if using an existing external package. A deployment dry run does not deploy. Document source-only features separately from verified production behavior. Public source must not imply that private data, credentials or working upload permissions are included.
