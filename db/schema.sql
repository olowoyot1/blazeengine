-- Landblaze Engine v3 schema (idempotent: safe to run repeatedly on Neon).
-- gen_random_uuid() is built into PostgreSQL 13+, so no extension is required.

CREATE TABLE IF NOT EXISTS users(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('ADMIN','CEO','HR','SALES_MANAGER','SALES','MARKETER','ACCOUNTANT','FINANCE_OPERATIONS','OPERATIONS_MANAGER','OPERATIONS','SITE_MANAGER')),
  department text,
  active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clients(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid,
  name text NOT NULL,
  phone text,
  email text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
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
