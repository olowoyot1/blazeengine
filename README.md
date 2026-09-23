# Landblaze Engine v3

A real-estate sales, site-allocation and approvals platform for Landblaze, built to
match the supplied process sheet **department by department**, with role-based
access control enforced on both the server and the database query layer.

This is a from-scratch redesign of the v2 skeleton: v2 had pages and a schema but
almost no actual workflow logic (forms just inserted a row; nothing enforced who
could do what, when, or in what order). v3 implements the full state machine,
the approval chain, notifications, and least-privilege access — verified by an
automated test suite that runs the entire process end-to-end.

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
exact hand-offs ("on submission, redirects back to sales manager and the sales
executive", "Ops and HR approved first", etc.) from the sheet into code and
into the automated tests (`tests/workflow.test.ts`).

Sales: `DRAFT → PAYMENT_PROOF_SUBMITTED → INVOICE_ENTERED → SALES_APPROVED →
CONTRACT_PREPARED → ACCOUNT_DOCS_SENT → SITE_NOTIFIED → OPS_DOCS_UPLOADED →
IN_APPROVAL → FULLY_APPROVED → PRE_ALLOCATION → ALLOCATION_SCHEDULED →
ALLOCATED`, with `RETURNED`/`CANCELLED` off the happy path.

Expenses: `NEGOTIATION_SUBMITTED → NEGOTIATION_APPROVED → EXPENSE_ENTERED →
EXPENSE_APPROVED → PAYMENT_PROOF_UPLOADED → PAYMENT_APPROVED → PAID →
RECEIPT_ISSUED`.

## Architecture

- **Next.js 15 App Router**, deployed as a normal Vercel serverless app (no VPS,
  no always-on Node process, no Redis, no background worker/cron).
- **Neon serverless Postgres.** Reads go over Neon's stateless HTTP driver;
  every state-changing action runs in a real transaction over a short-lived
  pooled WebSocket connection (`lib/db.ts`), so a partial failure can never
  leave a sale half-updated.
- **Server Actions** (`lib/actions.ts`) are the only way the UI mutates data —
  there is no public REST surface to attack beyond `/api/auth`.
- **One workflow engine, reused everywhere.** `lib/workflow/core.ts` and
  `lib/workflow/approvals.ts` provide field validation, transactions, audit
  logging and notifications; `sale.ts` / `expense.ts` / `leads.ts` declare each
  process as data (`roles`, `from`, `to`, `fields`, `apply`) so the UI, the
  server-side authorization check, and the tests all read from the same
  definition — a role or a status can't drift out of sync between the button
  the user sees and the check the server enforces.
- **Middleware** (`middleware.ts`) rejects any unauthenticated request before
  it reaches a page. Every page additionally calls `requireCap()` so
  capabilities are enforced twice (defence in depth), and every list/detail
  query is scoped by role at the SQL level (`lib/rbac.ts` → `saleScope` /
  `expenseScope`) so a Finance Operations user's query can never even see a
  row of `sales`.

## v3.1 — fixes for gaps found in review

A follow-up review of v3.0 surfaced six real gaps, each verified against the code
and then closed (with a regression test per fix, in `tests/workflow.test.ts` under
"Hardening fixes"):

| Gap | Fix |
|---|---|
| A stolen session cookie kept working after the password was changed or reset — sessions only checked user id, never the password | `users.session_version`: bumped on every password change/reset; the JWT carries the version it was issued under, so a bump instantly invalidates every other already-issued cookie for that account. The user's own current session is reissued so they aren't logged out by their own password change. |
| An administrator could reset any user's password (including CEO/HR) and use the account with no accountability trail | `resetUserPassword` and role changes onto approval-critical roles now require a written reason (kept in `audit_logs`) and e-mail the affected user, so takeover or escalation is visible to the person it happened to, not just the admin doing it |
| The Sales Manager who approved a sale earlier could also complete the chain's "Sales Manager approval" step on the same sale — same person signing off twice under two hats | `sales.gate_approved_by` records who ran `approve_sale`; the approval engine's new `conflict` hook blocks that same person from later deciding the chain's Sales Manager step |
| An Accountant's invoice amount was never checked against what the Sales Executive originally quoted | `sales.quoted_amount` is captured at sale creation; `enter_invoice` requires a written reason for any difference over 2%, and flags it in the notification to the Sales Manager |
| An expense could be inflated to any amount above the negotiated price by supplying any non-empty "reason" text | A hard ceiling: more than 50% above the negotiated amount is rejected outright and must go back through a fresh negotiation instead |
| Rejecting an expense (or a vendor negotiation) was a dead end — the only way forward was starting over from scratch, discarding all the negotiated/entered detail | A rejected *negotiated* expense now recovers to `NEGOTIATION_APPROVED` for the Accountant to correct and re-enter; a rejected negotiation gets a new `revise_negotiation` action for the Site Manager to correct terms and resubmit for a fresh review round |
| "Evidence" documents were unverified URLs — the same link could be pasted as proof more than once | Payment proof, bank payment proof and receipt links are checked against every other use of that exact link anywhere in the system and rejected if reused. (This is a partial mitigation only — it cannot verify a link's actual content, since there is no file-storage integration in this build.) |

One gap from the review is **not** fixed here because it isn't really fixable in
code: documents are links, not uploaded/verified files, so the system can never be
fully sure a "proof" link shows what it claims to. The duplicate-link check above
catches the laziest form of reuse but not a determined fabrication — closing this
properly needs real file storage with checksums, which is a larger, separate
feature.

## Security / rights hardening in this version

- Session cookie carries only a user id; role, department and active flag are
  re-read from the database on every request (`lib/auth.ts`), so deactivating
  a user or changing their role takes effect on their very next request.
- Login lockout after 5 failed attempts (15 minutes), constant-shape response
  to prevent user enumeration, bcrypt cost 12.
- New and password-reset accounts are forced through `/profile/password`
  before they can use the app.
- Separation of duties: a submitter can never approve/reject their own
  submission (`lib/workflow/approvals.ts`); `ADMIN` administers users but is
  excluded from every business capability so a single account can't both
  create and approve a sale.
- Approval steps are strictly sequential within a round (`seq`); an approver
  cannot act out of order, twice, or on someone else's role. Rejecting a
  round cancels the remaining pending steps atomically.
- All identifiers passed in URLs are validated as UUIDs before hitting SQL;
  every database call uses parameterised queries (tagged templates /
  `$1,$2…`), never string interpolation.
- Plot double-sale prevention: a unique index blocks two live sales from
  claiming the same property + plot reference.
- `X-Frame-Options`, `X-Content-Type-Options` and `Referrer-Policy` headers set
  on every response (`next.config.mjs`).

## Reports (role-scoped, `/reports`)

- **Sales**: leads & daily target per marketer, sales value by executive, 12-month trend.
- **Operations**: task backlog, overdue allocation documents, portal-open → docs-uploaded cycle time.
- **Site Management**: pipeline by stage, upcoming allocations, allocation-notice ageing.
- **Finance**: expenses by status, entry → receipt cycle time, total invoiced.
- **HR**: staff activity, approval turnaround by role, oldest pending approvals (audit function).
- **CEO / company-wide**: monthly sales, verified value, SLA breaches, allocations to date.
- Every user also sees **My activity** — their own last-30-day audit trail.

## Database

- `db/schema.sql` — full v3 schema, idempotent (`CREATE TABLE IF NOT EXISTS`,
  safe to run repeatedly).
- `db/upgrade-v2-to-v3.sql` — **only** if you already deployed the v2 schema
  from the original zip and have live data in it; migrates roles, adds new
  columns, re-maps legacy statuses. Run this once, then run `schema.sql` to
  pick up anything it doesn't cover (new tables/indexes). On a fresh
  database, skip this file and just run `schema.sql`.

### First administrator

A ready-made admin account is seeded by `db/seed-admin.sql`:

- Email: `admin@landblaze.com`
- Password: `EXperts2020!`

Run it in the Neon SQL editor straight after `schema.sql` (see the deployment
steps below). It logs you in directly with no forced password change, precisely
so the very first login after deploy is not blocked on anything — but the file
carries a loud comment reminding you to change that password immediately after
you've confirmed access, since it's now sitting in plain text in your repo.

To create *additional* admins/users later — with a password only you type, never
written to a file — use:

```bash
npm run hash -- 'YourStrongPassword1' someone@landblaze.com "Their Full Name"
```

This prints an `INSERT` statement to run in the Neon SQL editor. That account
*is* forced to change its password on first login (unlike the seeded one above).

## Environment variables

See `.env.example`. `DATABASE_URL` and `AUTH_SECRET` (32+ random characters —
`openssl rand -base64 48`) are required. `APP_URL`, `RESEND_API_KEY` and
`MAIL_FROM` are optional; without them the app still works fully, it just
skips sending e-mails (in-app notifications always work).

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL and AUTH_SECRET
npm run dev
```

## Tests

```bash
npm test        # 30 tests: every row of the process sheet + the rights matrix,
                 # run against a real embedded PostgreSQL (no network needed)
npm run typecheck
```

## Deploy step by step

**1. Create the Neon database.**
At [neon.tech](https://neon.tech), create a project (any region). Open the
**SQL Editor** for it — you'll use this in steps 4–5. Copy the **connection
string** from the dashboard (the pooled one, starting `postgresql://…`) — you'll
need it in step 3.

**2. Push this code to GitHub.**
Unzip this project, `git init`, commit, and push it to a new GitHub repository.
(If you're migrating from an earlier v2 deployment with live data, keep that
repo/history — just replace its contents with this one and commit on top.)

**3. Import the repo into Vercel and set environment variables.**
At [vercel.com](https://vercel.com) → **Add New → Project** → import the GitHub
repo. Before the first deploy (or right after, then redeploy), add these under
**Settings → Environment Variables**:

| Variable | Required | Value |
|---|---|---|
| `DATABASE_URL` | Yes | The Neon connection string from step 1 |
| `AUTH_SECRET` | Yes | 32+ random characters — generate with `openssl rand -base64 48` |
| `APP_URL` | No | Your Vercel URL (e.g. `https://landblaze.vercel.app`), used for links in e-mails |
| `RESEND_API_KEY` | No | Only if you want e-mail notifications, from resend.com |
| `MAIL_FROM` | No | e.g. `Landblaze <notifications@yourdomain.com>` — required if `RESEND_API_KEY` is set |

**4. Create the database schema.**
In the Neon SQL Editor, open `db/schema.sql` from this project, paste its full
contents, and run it. (Migrating from a live v2 database instead? Run
`db/upgrade-v2-to-v3.sql` first, then `schema.sql` — it's safe to run on top,
it only adds what's missing.)

**5. Seed the first administrator.**
Still in the Neon SQL Editor, paste and run `db/seed-admin.sql`. This creates
`admin@landblaze.com` / `EXperts2020!` with the ADMIN role.

**6. Deploy.**
Back in Vercel, trigger the deploy (it will have already tried once when you
imported the repo — if environment variables weren't set yet at that point,
just click **Redeploy** now that they are).

**7. Log in and lock the account down.**
Open your Vercel URL, sign in with `admin@landblaze.com` / `EXperts2020!`,
then immediately click **Change password** at the bottom of the sidebar and
set a real password. From there, use **Users & Roles** in the sidebar to create
accounts for everyone else — each of those goes through the forced
change-password-on-first-login flow, so this seeded account is the only one
that ever needs this manual step.
