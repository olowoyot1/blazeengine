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

CREATE TABLE IF NOT EXISTS sales(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id),
  lead_id uuid REFERENCES leads(id),
  client_name text NOT NULL,
  client_email text,
  property_name text,
  plot_reference text,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  quoted_amount numeric(14,2),
  description text,
  status text NOT NULL DEFAULT 'DRAFT',
  payment_status text NOT NULL DEFAULT 'UNPAID',
  payment_reference text,
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_live_plot ON sales(lower(property_name), lower(plot_reference)) WHERE status <> 'CANCELLED' AND property_name IS NOT NULL AND plot_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_creator ON sales(created_by);
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period_start date NOT NULL, period_end date NOT NULL,
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
