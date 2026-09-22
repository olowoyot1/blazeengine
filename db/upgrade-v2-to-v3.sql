-- Run ONCE on an existing v2 database, then run db/schema.sql to add anything missing.
-- 1. Roles: v2 had MANAGER / STAFF. v3 has explicit departmental roles.
--    Review the result: MANAGER is mapped to SALES_MANAGER by default; re-assign
--    Operations / Site managers in the Users screen (or with the UPDATEs below).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role='SALES_MANAGER' WHERE role='MANAGER';
UPDATE users SET role='SALES'         WHERE role='STAFF';
-- UPDATE users SET role='OPERATIONS_MANAGER' WHERE email='ops.manager@example.com';
-- UPDATE users SET role='SITE_MANAGER'       WHERE email='site.manager@example.com';

-- 2. New user columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('ADMIN','CEO','HR','SALES_MANAGER','SALES','MARKETER','ACCOUNTANT','FINANCE_OPERATIONS','OPERATIONS_MANAGER','OPERATIONS','SITE_MANAGER'));

-- 3. Generalise workflow_events (was sale-only)
ALTER TABLE workflow_events ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'SALE';
ALTER TABLE workflow_events ADD COLUMN IF NOT EXISTS entity_id uuid;
UPDATE workflow_events SET entity_id = sale_id WHERE entity_id IS NULL;
ALTER TABLE workflow_events ALTER COLUMN entity_id SET NOT NULL;
ALTER TABLE workflow_events DROP COLUMN IF EXISTS sale_id;

-- 4. Approvals: rounds and ordering
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS round text NOT NULL DEFAULT 'LEGACY';
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS round_no int NOT NULL DEFAULT 1;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS seq int NOT NULL DEFAULT 1;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES users(id);
-- v2 approval rows have no matching v3 workflow; close them so they don't clog queues.
UPDATE approvals SET status='CANCELLED' WHERE round='LEGACY' AND status='PENDING';

-- 5. Sales / expenses / notifications new columns
ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_id uuid;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_reference text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS invoice_number text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS sales_order_no text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS sales_receipt_no text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS sales_invoice_no text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS ops_due_date date;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS chain_round int NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS returned_reason text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS allocated_at timestamptz;
-- v2 statuses (APPROVED, INVOICE_ENTERED...) are re-mapped conservatively:
UPDATE sales SET status='INVOICE_ENTERED' WHERE status NOT IN ('DRAFT','PAYMENT_PROOF_SUBMITTED','INVOICE_ENTERED','SALES_APPROVED','CONTRACT_PREPARED','ACCOUNT_DOCS_SENT','SITE_NOTIFIED','OPS_DOCS_UPLOADED','IN_APPROVAL','RETURNED','FULLY_APPROVED','PRE_ALLOCATION','ALLOCATION_SCHEDULED','ALLOCATED','CANCELLED');
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS client_id uuid;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE site_records ALTER COLUMN status SET DEFAULT 'DONE';

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'DIRECT';
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS negotiated_amount numeric(14,2);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS negotiation_notes text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS negotiation_url text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS round_no int NOT NULL DEFAULT 1;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bank_proof_url text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bank_reference text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bank_alert_ref text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_no text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_url text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS rejected_reason text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE expenses ALTER COLUMN amount DROP NOT NULL;
-- v2 expenses had a free-text status; close them so they don't show as actionable.
UPDATE expenses SET status='LEGACY' WHERE status IN ('PENDING','APPROVED','REJECTED');
