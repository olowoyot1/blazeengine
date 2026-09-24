-- Landblaze Engine v3.4: payroll, internal staff chat and export support.
-- Safe/idempotent upgrade for existing v3.3 databases.
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_entity_type_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_entity_type_check CHECK (entity_type IN ('SALE','EXPENSE','PAYROLL'));

CREATE TABLE IF NOT EXISTS payroll_runs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  payroll_month text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_CEO_APPROVAL','APPROVED','REJECTED','DISBURSED')),
  total_gross numeric(14,2) NOT NULL DEFAULT 0,
  total_allowances numeric(14,2) NOT NULL DEFAULT 0,
  total_deductions numeric(14,2) NOT NULL DEFAULT 0,
  total_net numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  created_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  disbursed_by uuid REFERENCES users(id),
  disbursed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(payroll_month)
);
CREATE TABLE IF NOT EXISTS payroll_items(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  base_salary numeric(14,2) NOT NULL DEFAULT 0,
  allowances numeric(14,2) NOT NULL DEFAULT 0,
  deductions numeric(14,2) NOT NULL DEFAULT 0,
  gross_salary numeric(14,2) NOT NULL DEFAULT 0,
  net_salary numeric(14,2) NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING','DISBURSED')),
  disbursed_at timestamptz,
  UNIQUE(payroll_run_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_status ON payroll_runs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_items_run ON payroll_items(payroll_run_id);

CREATE TABLE IF NOT EXISTS chat_rooms(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type text NOT NULL DEFAULT 'GENERAL' CHECK (room_type IN ('GENERAL','DIRECT')),
  name text,
  user_a uuid REFERENCES users(id) ON DELETE CASCADE,
  user_b uuid REFERENCES users(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_a, user_b)
);
CREATE TABLE IF NOT EXISTS chat_messages(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_users ON chat_rooms(user_a, user_b);
INSERT INTO chat_rooms(room_type,name) SELECT 'GENERAL','Staff Chat' WHERE NOT EXISTS (SELECT 1 FROM chat_rooms WHERE room_type='GENERAL');

-- Payroll-specific supporting documents use the same secure uploaded_files store.
CREATE TABLE IF NOT EXISTS payroll_documents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  document_name text NOT NULL,
  uploaded_file_id uuid REFERENCES uploaded_files(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payroll_docs_run ON payroll_documents(payroll_run_id);
