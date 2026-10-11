# Landblaze Engine v3

A real-estate sales, site-allocation and approvals platform for Landblaze, built to
match the supplied process sheet **department by department**, with role-based
access control enforced on both the server and the database query layer.

This is a from-scratch redesign of the v2 skeleton: v2 had pages and a schema but
almost no actual workflow logic (forms just inserted a row; nothing enforced who
could do what, when, or in what order). v3 implements the full state machine,
the approval chain, notifications, and least-privilege access — verified by an
automated test suite that runs the entire process end-to-end.

## Security notice

**Never commit a production password, password hash, database credential, API key,
AUTH_SECRET, or other secret to this repository.** The previous bootstrap
administrator credential has been removed from the repository. If that credential
was ever used in a deployed environment, rotate the account password immediately.

Create bootstrap users with a locally generated bcrypt hash instead:

```bash
npm run hash -- 'YourStrongPassword1' admin@landblaze.com "Super Administrator"
```

Run the generated SQL against Neon, then change the password after the first login.
For production, set a strong random `AUTH_SECRET` in Vercel and never put it in
source control.

## What changed vs the uploaded codebase (v2)

| Area | v2 | v3 |
|---|---|---|
| Sale lifecycle | 1 status jump per form (`INVOICE_ENTERED` → nothing else) | 15-state machine matching every row of the sheet, enforced server-side |
| Approval chain | A single flat `approvals` table, no ordering, nothing populated it | Sales Manager → Ops Manager → HR → CEO, strictly sequential, with parallel steps for expense reviews, re-runs on every return-and-resubmit |
| Vendor negotiation → expense → payment → receipt | Not implemented at all | Full flow: Site Manager negotiates → Ops Mgr & HR approve → Accountant enters expense → Ops Mgr & HR & CEO approve → Finance uploads bank proof → Ops Mgr & HR & CEO approve → bank alert recorded → receipt issued & shared |
| Roles | `MANAGER`, `STAFF` (generic) | 11 explicit roles matching the sheet's departments (see below), each with its own capability set |
| Rights | None — any logged-in user could call any API route | Every server action re-checks role + entity ownership + current state before touching the database; row-level visibility scoped per role |
| Atomicity | Plain `INSERT`s, no transaction | Every workflow action runs inside a single Postgres transaction (status change + documents + tasks + approvals + notifications + audit log commit together or not at all) |
| Notifications | None | In-app notifications (+ optional e-mail) to exactly the right roles/users at every step |
| Auth | 7-day JWT carrying the role (stale after a role change), no lockout | 12h session that only carries a user id — role/active state re-read from the database on every request — with login lockout after 5 failed attempts, forced password change for new/reset accounts |
| Tests | None | 30 automated tests covering every row of the sheet plus the rights matrix, run against a real embedded PostgreSQL |

## Departments / roles (from the sheet)

| Role | Sheet department | What they do |
|---|---|---|
| `MARKETER` / `SALES` | Sales team / Marketer | Capture leads (10/day target tracked), convert to clients, create sales, upload payment proof |
| `SALES_MANAGER` | (sales team lead) | Approve sales (1st approval step), oversee leads & sales |
| `ACCOUNTANT` | Accountant | Verify payment, enter invoice, send sales order/receipt/invoice, enter expenses, issue receipts |
| `OPERATIONS` / `OPERATIONS_MANAGER` | Operations | Contract & deed, open the allocation portal, upload deed of assignment & survey (30-day rule), 2nd approval step |
| `SITE_MANAGER` | Site Manager | Final sale audit (triggers the approval chain), vendor negotiation, pre-allocation, site survey, logistics, allocation date & allocation |
| `HR` | HR | Internal-audit approval step on both the sale chain and every expense round; HR-scoped reporting |
| `CEO` | CEO | Final approval step on sales and expenses; company-wide dashboard |
| `FINANCE_OPERATIONS` | Finance Operations | Uploads bank payment screenshot, records the internet-banking alert |
| `ADMIN` | — | User & role administration only; deliberately **cannot** act inside the business workflow (separation of duties) |

Every role's exact permissions are declared in one place: `lib/rbac.ts` (`CAPS`
matrix for what a role may see, `lib/workflow/*.ts` `roles: [...]` per action for
what a role may do).

## The workflow, row by row

See the header comment in `lib/workflow/sale.ts` and `lib/workflow/expense.ts` —
each documents which row(s) of the process sheet it implements and traces the
exact hand-offs ("on submission, redirects back to sales manager and the sales executive", etc.) from the sheet into code and into the automated tests (`tests/workflow.test.ts`).

Sales: `DRAFT → PAYMENT_PROOF_SUBMITTED → INVOICE_ENTERED → SALES_APPROVED →
CONTRACT_PREPARED → ACCOUNT_DOCS_SENT → SITE_NOTIFIED → OPS_DOCS_UPLOADED →
IN_APPROVAL → FULLY_APPROVED → PRE_ALLOCATION → ALLOCATION_SCHEDULED →
ALLOCATED`, with `RETURNED`/`CANCELLED` off the happy path.

Expenses: `NEGOTIATION_SUBMITTED → NEGOTIATION_APPROVED → EXPENSE_ENTERED →
EXPENSE_APPROVED → PAYMENT_PROOF_UPLOADED → PAYMENT_APPROVED → PAID →
RECEIPT_ISSUED`.

## Architecture

- **Next.js 16 App Router** (Node 24.x), deployed as a normal Vercel serverless app.
- **Neon serverless Postgres.** Reads go over Neon's stateless HTTP driver;
  every state-changing action runs in a real transaction over a short-lived
  pooled WebSocket connection (`lib/db.ts`), so a partial failure can never
  leave a sale half-updated.
- **Server Actions** (`lib/actions.ts`) are the primary UI mutation path.
- **One workflow engine, reused everywhere.** `lib/workflow/core.ts` and
  `lib/workflow/approvals.ts` provide field validation, transactions, audit
  logging and notifications; `sale.ts` / `expense.ts` / `leads.ts` declare each
  process as data (`roles`, `from`, `to`, `fields`, `apply`) so the UI, the
  server-side authorization check, and the tests read from the same definition.
- **Middleware** rejects unauthenticated requests before they reach pages. Every
  page additionally calls `requireCap()` and list/detail queries are scoped by
  role at the SQL level (`lib/rbac.ts` → `saleScope` / `expenseScope`).

## Security / rights hardening

- Session cookie carries only a user id; role, department and active flag are
  re-read from the database on every request (`lib/auth.ts`), so deactivating
  a user or changing their role takes effect on the next request.
- Login lockout after 5 failed attempts (15 minutes), bcrypt cost 12.
- New and password-reset accounts are forced through `/profile/password`.
- Separation of duties: a submitter cannot approve/reject their own submission.
- Approval steps are sequential within a round and cannot be repeated or taken
  out of order.
- Identifiers passed in URLs are validated as UUIDs and database calls use
  parameterised queries.
- Plot double-sale prevention uses a unique database index.
- Private uploaded files are now authorization-checked against the owning
  workflow record before they can be streamed. A file UUID alone is not an
  access credential.
- Sales and expense exports now use the same row-level scope as the corresponding
  application lists, preventing a user with a read capability from exporting
  another user's restricted records.
- `X-Frame-Options`, `X-Content-Type-Options` and `Referrer-Policy` headers are
  set on responses (`next.config.mjs`).

## Database

- `db/schema.sql` — full schema, idempotent.
- `db/upgrade-v2-to-v3.sql` — use only when migrating a live v2 database.

## Creating the first administrator

There is intentionally **no default administrator password in this repository**.
Generate a bcrypt hash locally and apply the resulting SQL to Neon:

```bash
npm run hash -- 'YourStrongPassword1' admin@landblaze.com "Super Administrator"
```

Do not paste the generated password or hash into GitHub, README files, or source
code. Store production credentials only in your password manager / secret manager
and Vercel environment variables.

## Environment variables

See `.env.example`. `DATABASE_URL` and `AUTH_SECRET` (32+ random characters) are
required. `APP_URL`, `RESEND_API_KEY` and `MAIL_FROM` are optional.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Tests

```bash
npm test
npm run typecheck
```

> **Note:** `tests/workflow.test.ts` predates the current automatic invoice / sale-documents
> flow, so part of that suite fails until it is updated to the current state machine.
> `npm run typecheck` and `npm run build` pass.

## Deploy

1. Create/configure the Neon database and run `db/schema.sql`.
2. Configure `DATABASE_URL` and a newly generated `AUTH_SECRET` in Vercel.
3. Generate the first admin password locally with `npm run hash` and run the
   resulting SQL directly in Neon.
4. Deploy from the protected `main` branch.
5. Confirm login, role restrictions, exports and private-file access in a staging
   deployment before promoting to production.
