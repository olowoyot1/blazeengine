-- Landblaze Engine v3 schema (idempotent: safe to run repeatedly on Neon).
-- gen_random_uuid() is built into PostgreSQL 13+, so no extension is required.

CREATE TABLE IF NOT EXISTS users(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('SUPER_ADMIN','ADMIN','CEO','HR','SALES_MANAGER','SALES','MARKETER','ACCOUNTANT','FINANCE_OPERATIONS','OPERATIONS_MANAGER','OPERATIONS','SITE_MANAGER')),
  department text,
  active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  session_version int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departments(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO departments(name) VALUES
  ('Sales'), ('Marketing'), ('Finance & Accounts'), ('Operations'), ('Human Resources'), ('Site Management'), ('Executive')
ON CONFLICT (name) DO NOTHING;

-- Uploaded evidence files (receipts, payment proofs, contracts, deeds, ID scans…)
-- stored as bytes in Postgres rather than as external links, so "proof" is an
-- actual file the system holds, not a URL anyone could type or reuse. Served back
-- through /api/files/[id], which requires a signed-in session.
CREATE TABLE IF NOT EXISTS uploaded_files(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','image/png','image/jpeg')),
  size_bytes int NOT NULL,
  data bytea NOT NULL,
  uploaded_by uuid REFERENCES users(id),
  purpose text NOT NULL DEFAULT 'document',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clients(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid,
  name text NOT NULL,
  phone text,
  email text,
  address text,
  date_of_birth date,
  occupation text,
  employer text,
  id_type text,
  id_number text,
  alternate_phone text,
  next_of_kin_name text,
  next_of_kin_phone text,
  next_of_kin_relationship text,
  profile_completed_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  phone text,
  source text,
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CONTACTED','QUALIFIED','CONVERTED','LOST')),
  owner_id uuid REFERENCES users(id),
  client_id uuid REFERENCES clients(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS sale_reference_seq;
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq;
CREATE SEQUENCE IF NOT EXISTS transaction_reference_seq;

CREATE TABLE IF NOT EXISTS sales(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_reference text,
  transaction_type text NOT NULL DEFAULT 'INITIAL_DEPOSIT',
  parent_sale_id uuid REFERENCES sales(id),
  client_id uuid REFERENCES clients(id),
  lead_id uuid REFERENCES leads(id),
  client_name text NOT NULL,
  client_email text,
  property_name text,
  plot_reference text,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  estate_value numeric(14,2),
  payment_amount numeric(14,2),
  quoted_amount numeric(14,2),
  payment_plan text CHECK (payment_plan IN ('OUTRIGHT','INSTALLMENT')),
  description text,
  status text NOT NULL DEFAULT 'PENDING_SALES_APPROVAL',
  payment_status text NOT NULL DEFAULT 'UNPAID',
	payment_reference text,
	payment_bank text,
	invoice_number text,
  sales_order_no text,
  sales_receipt_no text,
  sales_invoice_no text,
  ops_due_date date,
  chain_round int NOT NULL DEFAULT 0,
  gate_approved_by uuid REFERENCES users(id),
  invoice_variance_reason text,
  returned_reason text,
  approved_at timestamptz,
  allocation_date date,
  allocated_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_reference text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS transaction_type text NOT NULL DEFAULT 'INITIAL_DEPOSIT';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS parent_sale_id uuid REFERENCES sales(id) ON DELETE SET NULL;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS beneficiary_name text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS beneficiary_phone text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS beneficiary_email text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS beneficiary_address text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS beneficiary_relationship text;
UPDATE sales SET sale_reference = 'SALE-' || to_char(created_at, 'YYYYMM') || '-' || upper(substr(replace(id::text, '-', ''), 1, 8)) WHERE sale_reference IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sales_sale_reference_unique ON sales(sale_reference);

CREATE TABLE IF NOT EXISTS sale_documents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  document_name text,
  document_url text,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS site_records(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  record_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'DONE',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  task_type text NOT NULL,
  assigned_to uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DONE','CANCELLED')),
  due_date date,
  notes text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per vendor negotiation -> expense -> bank payment -> receipt lifecycle.
CREATE TABLE IF NOT EXISTS expenses(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_reference text,
  sale_id uuid REFERENCES sales(id),
  origin text NOT NULL DEFAULT 'NEGOTIATION' CHECK (origin IN ('NEGOTIATION','DIRECT')),
  category text NOT NULL,
  vendor text,
  description text,
  negotiated_amount numeric(14,2),
  negotiation_notes text,
  negotiation_url text,
  amount numeric(14,2),
  status text NOT NULL,
  round_no int NOT NULL DEFAULT 1,
  bank_proof_url text,
  bank_reference text,
  bank_alert_ref text,
  paid_at timestamptz,
  receipt_no text,
  receipt_url text,
  rejected_reason text,
  submitted_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Generic approval steps. Steps in the same (entity, round, round_no) run in
-- ascending `seq`; equal `seq` values run in parallel.
CREATE TABLE IF NOT EXISTS approvals(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('SALE','EXPENSE')),
  entity_id uuid NOT NULL,
  round text NOT NULL,
  round_no int NOT NULL DEFAULT 1,
  seq int NOT NULL DEFAULT 1,
  step text NOT NULL,
  approver_role text NOT NULL,
  approver_user_id uuid,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  comment text,
  submitted_by uuid REFERENCES users(id),
  acted_by uuid REFERENCES users(id),
  acted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL DEFAULT 'SALE',
  entity_id uuid NOT NULL,
  stage text NOT NULL,
  action text NOT NULL,
  from_status text,
  to_status text,
  actor_id uuid REFERENCES users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  message text NOT NULL,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
-- A plot can be attached to only one live sale (double-sale prevention).
DROP INDEX IF EXISTS uq_sales_live_plot;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_live_plot ON sales(lower(property_name), lower(plot_reference)) WHERE status <> 'CANCELLED' AND coalesce(transaction_type, 'INITIAL_DEPOSIT') <> 'TOP_UP' AND property_name IS NOT NULL AND plot_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_creator ON sales(created_by);
CREATE INDEX IF NOT EXISTS idx_sales_parent_sale ON sales(parent_sale_id, created_at);
CREATE INDEX IF NOT EXISTS idx_docs_sale ON sale_documents(sale_id);
CREATE INDEX IF NOT EXISTS idx_ops_sale ON operations(sale_id, status);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);
CREATE INDEX IF NOT EXISTS idx_approvals_entity ON approvals(entity_type, entity_id, round, round_no);
CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals(status, approver_role);
CREATE INDEX IF NOT EXISTS idx_events_entity ON workflow_events(entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_clients_lead ON clients(lead_id);

-- Default departments (admin can add/retire more from Users & Roles).
INSERT INTO departments(name) VALUES
  ('Management'), ('Human Resources'), ('Sales & Marketing'), ('Accounts & Finance Operations'),
  ('Operations'), ('Site Management')
ON CONFLICT (name) DO NOTHING;

-- v3.1 hardening additions: safe to run again on a database that already has v3.0's
-- schema.sql applied (all columns/index below are IF NOT EXISTS / idempotent).
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version int NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS quoted_amount numeric(14,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS gate_approved_by uuid REFERENCES users(id);
  ALTER TABLE sales ADD COLUMN IF NOT EXISTS invoice_variance_reason text;
  ALTER TABLE approvals ADD COLUMN IF NOT EXISTS approver_user_id uuid;
UPDATE sales SET quoted_amount = amount WHERE quoted_amount IS NULL;

-- v3.2 additions: SUPER_ADMIN role, managed departments, real file uploads, client
-- profiles. Safe to run again on a database that already has v3.0/v3.1 applied.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('SUPER_ADMIN','ADMIN','CEO','HR','SALES_MANAGER','SALES','MARKETER','ACCOUNTANT','FINANCE_OPERATIONS','OPERATIONS_MANAGER','OPERATIONS','SITE_MANAGER'));
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS occupation text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS employer text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS id_type text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS id_number text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS alternate_phone text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS next_of_kin_name text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS next_of_kin_phone text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS next_of_kin_relationship text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS profile_completed_at timestamptz;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();


-- v3.3: approval evidence, first-login username/PIN, and HR module
ALTER TABLE users ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_file_id uuid REFERENCES uploaded_files(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_lower ON users(lower(username)) WHERE username IS NOT NULL;

ALTER TABLE sale_documents ADD COLUMN IF NOT EXISTS uploaded_file_id uuid REFERENCES uploaded_files(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sale_docs_file ON sale_documents(uploaded_file_id);

CREATE TABLE IF NOT EXISTS employees(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  employee_no text UNIQUE NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  department text,
  job_title text,
  employment_type text NOT NULL DEFAULT 'FULL_TIME' CHECK (employment_type IN ('FULL_TIME','PART_TIME','CONTRACT','INTERN')),
  employment_status text NOT NULL DEFAULT 'ACTIVE' CHECK (employment_status IN ('ACTIVE','ON_LEAVE','SUSPENDED','EXITED')),
  hire_date date,
  manager_id uuid REFERENCES employees(id),
  base_salary numeric(14,2),
  bank_name text,
  bank_account text,
  emergency_contact_name text,
  emergency_contact_phone text,
  address text,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS leave_requests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type text NOT NULL, start_date date NOT NULL, end_date date NOT NULL, days numeric(6,2) NOT NULL,
  reason text, status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  approved_by uuid REFERENCES users(id), approved_at timestamptz, comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS attendance(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date date NOT NULL, check_in timestamptz, check_out timestamptz, status text NOT NULL DEFAULT 'PRESENT',
  notes text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(employee_id, work_date)
);
CREATE TABLE IF NOT EXISTS employee_documents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  document_type text NOT NULL, document_name text NOT NULL, uploaded_file_id uuid REFERENCES uploaded_files(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hr_requests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  request_type text NOT NULL, subject text NOT NULL, details text, status text NOT NULL DEFAULT 'OPEN',
  assigned_to uuid REFERENCES users(id), resolved_by uuid REFERENCES users(id), resolved_at timestamptz,
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employees_dept ON employees(department, employment_status);
CREATE INDEX IF NOT EXISTS idx_leave_employee ON leave_requests(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(work_date);
CREATE INDEX IF NOT EXISTS idx_employee_docs ON employee_documents(employee_id);

-- v3.4: payroll, internal staff chat and payroll evidence.
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_entity_type_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_entity_type_check CHECK (entity_type IN ('SALE','EXPENSE','PAYROLL'));

CREATE TABLE IF NOT EXISTS payroll_runs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transaction_reference text, period_start date NOT NULL, period_end date NOT NULL,
  payroll_month text NOT NULL, status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_CEO_APPROVAL','APPROVED','REJECTED','DISBURSED')),
  total_gross numeric(14,2) NOT NULL DEFAULT 0, total_allowances numeric(14,2) NOT NULL DEFAULT 0, total_deductions numeric(14,2) NOT NULL DEFAULT 0, total_net numeric(14,2) NOT NULL DEFAULT 0,
  notes text, created_by uuid REFERENCES users(id), approved_by uuid REFERENCES users(id), approved_at timestamptz,
  disbursed_by uuid REFERENCES users(id), disbursed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(payroll_month));
CREATE TABLE IF NOT EXISTS payroll_items(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payroll_run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT, base_salary numeric(14,2) NOT NULL DEFAULT 0,
  allowances numeric(14,2) NOT NULL DEFAULT 0, deductions numeric(14,2) NOT NULL DEFAULT 0, gross_salary numeric(14,2) NOT NULL DEFAULT 0,
  net_salary numeric(14,2) NOT NULL DEFAULT 0, payment_status text NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING','DISBURSED')), disbursed_at timestamptz,
  UNIQUE(payroll_run_id, employee_id));
CREATE INDEX IF NOT EXISTS idx_payroll_runs_status ON payroll_runs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_items_run ON payroll_items(payroll_run_id);

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS transaction_reference text;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS transaction_reference text;
UPDATE expenses SET transaction_reference = 'TXN-EXP-' || upper(substr(replace(id::text, '-', ''), 1, 12)) WHERE transaction_reference IS NULL;
UPDATE payroll_runs SET transaction_reference = 'TXN-PAY-' || upper(substr(replace(id::text, '-', ''), 1, 12)) WHERE transaction_reference IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_transaction_reference_unique ON expenses(transaction_reference);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_transaction_reference_unique ON payroll_runs(transaction_reference);

CREATE TABLE IF NOT EXISTS chat_rooms(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_type text NOT NULL DEFAULT 'GENERAL' CHECK (room_type IN ('GENERAL','DIRECT')), name text,
  user_a uuid REFERENCES users(id) ON DELETE CASCADE, user_b uuid REFERENCES users(id) ON DELETE CASCADE, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_a,user_b));
CREATE TABLE IF NOT EXISTS chat_messages(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), edited_at timestamptz, deleted_at timestamptz);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id,created_at);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_users ON chat_rooms(user_a,user_b);
INSERT INTO chat_rooms(room_type,name) SELECT 'GENERAL','Staff Chat' WHERE NOT EXISTS (SELECT 1 FROM chat_rooms WHERE room_type='GENERAL');
CREATE TABLE IF NOT EXISTS payroll_documents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payroll_run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE, document_type text NOT NULL,
  document_name text NOT NULL, uploaded_file_id uuid REFERENCES uploaded_files(id) ON DELETE SET NULL, uploaded_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_payroll_docs_run ON payroll_documents(payroll_run_id);


-- v3.8: keep Finance payment advice/bank receipts separate from expense source documents.
CREATE TABLE IF NOT EXISTS expense_payment_documents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  document_type text NOT NULL DEFAULT 'PAYMENT_ADVICE',
  document_name text NOT NULL,
  uploaded_file_id uuid REFERENCES uploaded_files(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES users(id),
  bank_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expense_payment_docs_expense ON expense_payment_documents(expense_id, created_at);
ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'document';

-- v3.7: expense supporting documents. Evidence belongs to expense operations,
-- not to the Sales supporting-documents panel.
CREATE TABLE IF NOT EXISTS expense_documents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  document_type text NOT NULL DEFAULT 'SUPPORTING_DOCUMENT',
  document_name text NOT NULL,
  uploaded_file_id uuid REFERENCES uploaded_files(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expense_docs_expense ON expense_documents(expense_id, created_at);

-- v3.4: customer newsletters (Resend) and SMS broadcasts (Beta SMS)
CREATE TABLE IF NOT EXISTS customer_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('EMAIL','SMS')),
  audience text NOT NULL,
  subject text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'SENDING',
  recipient_count int NOT NULL DEFAULT 0,
  sent_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  error text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);


-- v4.3: database convergence for durable next-action state and transaction-specific
-- finance document numbering. This is intentionally idempotent so the application
-- can repair older production databases automatically.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS transaction_document_type text;
CREATE INDEX IF NOT EXISTS idx_sales_transaction_document_type ON sales(transaction_document_type);

CREATE TABLE IF NOT EXISTS sale_next_actions(
  sale_id uuid PRIMARY KEY REFERENCES sales(id) ON DELETE CASCADE,
  action_key text NOT NULL,
  title text NOT NULL,
  owner_role text,
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  due_date date,
  source_status text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sale_next_actions_owner ON sale_next_actions(owner_role, owner_user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_sale_next_actions_due ON sale_next_actions(due_date, source_status);

CREATE OR REPLACE FUNCTION sync_sale_transaction_document_numbers()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_type text;
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    RETURN NEW;
  END IF;
  IF NEW.invoice_number LIKE 'RCT-%' THEN
    v_type := 'SALES_RECEIPT';
    NEW.sales_receipt_no := NEW.invoice_number;
    NEW.sales_invoice_no := NULL;
    NEW.sales_order_no := NULL;
  ELSIF NEW.invoice_number LIKE 'INV-%' THEN
    v_type := 'INVOICE';
    NEW.sales_invoice_no := NEW.invoice_number;
    NEW.sales_receipt_no := COALESCE(NEW.sales_receipt_no, 'RCT-' || substring(NEW.invoice_number from 5));
    NEW.sales_order_no := NULL;
  ELSIF NEW.invoice_number LIKE 'SO-%' THEN
    v_type := 'SALES_ORDER';
    NEW.sales_order_no := NEW.invoice_number;
    NEW.sales_receipt_no := COALESCE(NEW.sales_receipt_no, 'RCT-' || substring(NEW.invoice_number from 4));
    NEW.sales_invoice_no := NULL;
  ELSE
    v_type := COALESCE(NEW.transaction_document_type, 'FINANCE_DOCUMENT');
  END IF;
  NEW.transaction_document_type := v_type;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_sale_transaction_document_numbers ON sales;
CREATE TRIGGER trg_sync_sale_transaction_document_numbers
BEFORE INSERT OR UPDATE OF invoice_number, sales_receipt_no, sales_order_no, sales_invoice_no
ON sales FOR EACH ROW EXECUTE FUNCTION sync_sale_transaction_document_numbers();

CREATE OR REPLACE FUNCTION refresh_sale_next_action(p_sale_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  s record; a record;
  v_key text; v_title text; v_role text; v_due date;
  v_old_key text; v_old_role text; v_old_user uuid; v_owner uuid;
BEGIN
  SELECT id, status, created_by, approved_at, allocation_date, sale_reference
    INTO s FROM sales WHERE id=p_sale_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT action_key, owner_role, owner_user_id
    INTO v_old_key, v_old_role, v_old_user
    FROM sale_next_actions WHERE sale_id=p_sale_id;

  IF s.status IN ('CANCELLED','ALLOCATED') THEN
    v_key := CASE s.status WHEN 'CANCELLED' THEN 'CLOSED' ELSE 'COMPLETED' END;
    v_title := CASE s.status WHEN 'CANCELLED' THEN 'Sale closed' ELSE 'Sale completed — allocated' END;
    v_role := NULL; v_due := NULL;
  ELSE
    SELECT step, approver_role, approver_user_id, created_at::date
      INTO a
      FROM approvals
     WHERE entity_type='SALE' AND entity_id=p_sale_id AND status='PENDING'
     ORDER BY round_no, seq, created_at LIMIT 1;

    IF a.step IS NOT NULL THEN
      v_key := 'APPROVAL_' || regexp_replace(upper(a.approver_role), '[^A-Z0-9]+', '_', 'g');
      v_title := a.step; v_role := a.approver_role; v_owner := a.approver_user_id; v_due := NULL;
    ELSE
      v_owner := NULL;
      CASE s.status
        WHEN 'PENDING_SALES_APPROVAL' THEN v_key := 'APPROVE_NEW_SALE'; v_title := 'Approve new sale'; v_role := 'SALES_MANAGER';
        WHEN 'DRAFT' THEN v_key := 'UPLOAD_PAYMENT_PROOF'; v_title := 'Upload payment proof'; v_role := 'SALES';
        WHEN 'PAYMENT_PROOF_SUBMITTED' THEN v_key := 'VERIFY_PAYMENT_GENERATE_DOCUMENT'; v_title := 'Verify payment and generate invoice / sales order'; v_role := 'ACCOUNTANT';
        WHEN 'INVOICE_ENTERED' THEN v_key := 'VERIFY_FINANCE_DOCUMENT'; v_title := 'Verify generated finance document'; v_role := 'SALES_MANAGER';
        WHEN 'SALES_APPROVED' THEN v_key := 'GENERATE_SALE_DOCUMENTS'; v_title := 'Generate Contract + Letter of Acknowledgement'; v_role := 'ACCOUNTANT';
        WHEN 'CONTRACT_PREPARED' THEN v_key := 'APPROVE_SALE_DOCUMENTS'; v_title := 'Review and approve generated sale documents'; v_role := 'SALES_MANAGER';
        WHEN 'ACCOUNT_DOCS_SENT' THEN v_key := 'OPEN_OPERATIONS_PORTAL'; v_title := 'Open Operations portal and start site workflow'; v_role := 'OPERATIONS_MANAGER';
        WHEN 'SITE_NOTIFIED' THEN v_key := 'COMPLETE_SITE_DOCUMENTS'; v_title := 'Complete deed of assignment and survey requirements'; v_role := 'OPERATIONS';
        WHEN 'OPS_DEED_UPLOADED' THEN v_key := 'UPLOAD_SURVEY_PLAN'; v_title := 'Upload survey plan'; v_role := 'SITE_MANAGER';
        WHEN 'OPS_DOCS_UPLOADED' THEN v_key := 'RUN_FINAL_AUDIT'; v_title := 'Run final audit and start approval chain'; v_role := 'SITE_MANAGER';
        WHEN 'IN_APPROVAL' THEN v_key := 'COMPLETE_APPROVAL_CHAIN'; v_title := 'Complete approval chain'; v_role := 'SALES_MANAGER';
        WHEN 'RETURNED' THEN v_key := 'CORRECT_AND_RESUBMIT'; v_title := 'Correct returned items and resubmit'; v_role := 'SALES_MANAGER';
        WHEN 'FULLY_APPROVED' THEN v_key := 'START_PRE_ALLOCATION'; v_title := 'Start pre-allocation'; v_role := 'SITE_MANAGER';
        WHEN 'PRE_ALLOCATION' THEN v_key := 'SET_ALLOCATION_DATE'; v_title := 'Set allocation date'; v_role := 'SITE_MANAGER';
        WHEN 'ALLOCATION_SCHEDULED' THEN v_key := 'CONFIRM_ALLOCATION'; v_title := 'Confirm allocation'; v_role := 'SITE_MANAGER';
        ELSE v_key := 'REVIEW_SALE'; v_title := 'Review sale and determine next workflow action'; v_role := 'SALES_MANAGER';
      END CASE;
    END IF;
    IF s.status='FULLY_APPROVED' AND s.approved_at IS NOT NULL THEN v_due := s.approved_at::date + 30;
    ELSIF s.status='ALLOCATION_SCHEDULED' AND s.allocation_date IS NOT NULL THEN v_due := s.allocation_date;
    END IF;
  END IF;

  IF v_role IS NOT NULL AND v_owner IS NULL THEN
    SELECT id INTO v_owner FROM users WHERE active AND role=v_role ORDER BY created_at LIMIT 1;
  END IF;

  INSERT INTO sale_next_actions(sale_id,action_key,title,owner_role,owner_user_id,due_date,source_status,updated_at)
  VALUES(p_sale_id,v_key,v_title,v_role,v_owner,v_due,s.status,now())
  ON CONFLICT (sale_id) DO UPDATE SET
    action_key=excluded.action_key,title=excluded.title,owner_role=excluded.owner_role,
    owner_user_id=excluded.owner_user_id,due_date=excluded.due_date,source_status=excluded.source_status,updated_at=now();

  IF v_key IS DISTINCT FROM v_old_key OR v_role IS DISTINCT FROM v_old_role OR v_owner IS DISTINCT FROM v_old_user THEN
    IF v_owner IS NOT NULL AND v_owner <> COALESCE(s.created_by, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      INSERT INTO notifications(user_id,title,message,link)
      VALUES(v_owner,'Next action assigned',v_title || ' — ' || COALESCE(s.sale_reference,'Sale'),'/sales/' || p_sale_id::text);
    ELSIF v_role IS NOT NULL THEN
      INSERT INTO notifications(user_id,title,message,link)
      SELECT id,'Next action assigned',v_title || ' — ' || COALESCE(s.sale_reference,'Sale'),'/sales/' || p_sale_id::text
      FROM users WHERE active AND role=v_role
        AND id <> COALESCE(s.created_by, '00000000-0000-0000-0000-000000000000'::uuid);
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION trg_sales_next_action()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM refresh_sale_next_action(NEW.id); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_sales_next_action ON sales;
CREATE TRIGGER trg_sales_next_action
AFTER INSERT OR UPDATE OF status,approved_at,allocation_date ON sales
FOR EACH ROW EXECUTE FUNCTION trg_sales_next_action();

CREATE OR REPLACE FUNCTION trg_approval_next_action()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entity_type='SALE' THEN PERFORM refresh_sale_next_action(NEW.entity_id); END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_approval_next_action ON approvals;
CREATE TRIGGER trg_approval_next_action
AFTER INSERT OR UPDATE OF status,approver_user_id,acted_at ON approvals
FOR EACH ROW EXECUTE FUNCTION trg_approval_next_action();

UPDATE sales SET transaction_document_type = CASE
  WHEN invoice_number LIKE 'RCT-%' THEN 'SALES_RECEIPT'
  WHEN invoice_number LIKE 'INV-%' THEN 'INVOICE'
  WHEN invoice_number LIKE 'SO-%' THEN 'SALES_ORDER'
  ELSE transaction_document_type END
WHERE invoice_number IS NOT NULL;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM sales LOOP PERFORM refresh_sale_next_action(r.id); END LOOP;
END $$;

