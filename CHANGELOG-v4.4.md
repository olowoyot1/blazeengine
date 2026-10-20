# v4.4 — audit & hardening pass

## Bugs fixed
- **Deadlock on "Create sale documents"** (`create_contract`): the action opened a second DB transaction and
  tried to lock the sale row already locked by the calling transaction, so the request hung until timeout.
  Document generation now runs inside the caller's transaction (`generateSaleDocumentsInTx`).
- **Receipts/invoices could be generated for a sale with no payment proof** (accountant on a `DRAFT` sale).
  `enter_invoice` now requires payment evidence (`PROOF_SUBMITTED` / `VERIFIED`).
- **Unchecked file attachments**: deed of assignment, survey plan, soft copy, negotiation supporting document
  and expense receipt accepted any file id (raw FK error on a bad id; another user's file could be attached).
  All now go through `assertOwnedUpload`.
- Corrupted characters (`���`) in the "Payment proof awaiting approval" notification.
- Deleting a sale that has top-ups failed with a raw foreign-key error; now a clear message.

## Deployment hardening
- Startup schema migration runs under a Postgres advisory lock (safe with several serverless cold starts).
- Transaction rollback failures no longer mask the real error or return a broken connection to the pool.
- `middleware.ts` → `proxy.ts` (Next.js 16 convention; removes the deprecation warning).
- Spreadsheet exports neutralise formula-injection (`= + - @`) in text cells.
- Added `.gitignore` and `.env.example`; removed unused `ws`, `@neondatabase/serverless`, `@types/ws`;
  `@types/pg` moved to devDependencies; removed committed `tsconfig.tsbuildinfo`.

## Tests
- Test suite updated to the current workflow (payment confirmation → auto-generated account documents →
  contract/acknowledgement → document approvals → named-approver final audit) and to real, owned uploads.
- 38/38 passing; `tsc --noEmit` clean; `next build` clean with no warnings.
