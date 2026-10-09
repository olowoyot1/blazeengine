import { Pool } from 'pg';

const rawConnectionString = process.env.DATABASE_URL;
function normalizeDatabaseUrl(value: string | undefined) {
  if (!value) return value;
  try {
    const url = new URL(value);
    const sslMode = url.searchParams.get('sslmode');
    if (sslMode === 'prefer' || sslMode === 'require' || sslMode === 'verify-ca') {
      url.searchParams.set('sslmode', 'verify-full');
    }
    return url.toString();
  } catch {
    // Keep startup resilient if a test harness supplies a non-URL placeholder.
    return value;
  }
}

const connectionString = normalizeDatabaseUrl(rawConnectionString);

type TestDatabase = {
  query?: (text: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;
  withTx: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
};

function testDatabase() {
  return (globalThis as typeof globalThis & { __LB_DB__?: TestDatabase }).__LB_DB__;
}

export const pool = new Pool({
  connectionString: connectionString || 'postgres://placeholder:placeholder@localhost:5432/placeholder',
  ssl: process.env.NODE_ENV === 'production' && connectionString ? { rejectUnauthorized: true } : false,
});

let schemaReady: Promise<void> | null = null;

async function ensureApprovalSchema() {
  if (!connectionString) return;
  if (!schemaReady) {
    schemaReady = pool.query(`
      ALTER TABLE approvals ADD COLUMN IF NOT EXISTS approver_user_id uuid;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS transaction_type text NOT NULL DEFAULT 'INITIAL_DEPOSIT';
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS parent_sale_id uuid REFERENCES sales(id) ON DELETE SET NULL;
      -- Keep older production databases compatible with the current sale-create workflow.
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id);
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES leads(id);
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_name text;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_email text;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS property_name text;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS plot_reference text;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS amount numeric(14,2) NOT NULL DEFAULT 0;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS estate_value numeric(14,2);
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_amount numeric(14,2);
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS quoted_amount numeric(14,2);
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_plan text;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS description text;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'PENDING_SALES_APPROVAL';
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'UNPAID';
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_reference text;
  ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_bank text;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS sales_order_no text;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS sales_receipt_no text;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS sales_invoice_no text;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS ops_due_date date;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS chain_round int NOT NULL DEFAULT 0;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS gate_approved_by uuid;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS invoice_variance_reason text;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS returned_reason text;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS allocated_at timestamptz;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id);
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS transaction_type text NOT NULL DEFAULT 'INITIAL_DEPOSIT';
      ALTER TABLE expenses ADD COLUMN IF NOT EXISTS transaction_reference text;
      ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS transaction_reference text;
      CREATE SEQUENCE IF NOT EXISTS sale_reference_seq;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_reference text;
      UPDATE sales SET sale_reference = 'SALE-' || to_char(created_at, 'YYYYMM') || '-' || upper(substr(replace(id::text, '-', ''), 1, 8)) WHERE sale_reference IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS sales_sale_reference_unique ON sales(sale_reference);
      CREATE INDEX IF NOT EXISTS idx_sales_parent_sale ON sales(parent_sale_id, created_at);
      DROP INDEX IF EXISTS uq_sales_live_plot;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_live_plot ON sales(lower(property_name), lower(plot_reference)) WHERE status <> 'CANCELLED' AND coalesce(transaction_type, 'INITIAL_DEPOSIT') <> 'TOP_UP' AND property_name IS NOT NULL AND plot_reference IS NOT NULL;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS invoice_number text;
      CREATE SEQUENCE IF NOT EXISTS invoice_number_seq;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS approved_at timestamptz;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS beneficiary_name text;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS beneficiary_phone text;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS beneficiary_email text;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS beneficiary_address text;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS beneficiary_relationship text;
      CREATE TABLE IF NOT EXISTS sale_beneficiary_changes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        sale_id uuid NOT NULL,
        previous jsonb NOT NULL DEFAULT '{}',
        current jsonb NOT NULL DEFAULT '{}',
        reason text NOT NULL,
        changed_by uuid,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS sale_beneficiary_changes_sale_idx ON sale_beneficiary_changes(sale_id, created_at);
      -- Top-ups are separate payment transactions linked to an existing sale.
      -- Rebuild the plot guard so top-ups never conflict with the one-live-sale rule.
      DROP INDEX IF EXISTS uq_sales_live_plot;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_live_plot ON sales(lower(property_name), lower(plot_reference))
        WHERE status <> 'CANCELLED' AND coalesce(transaction_type, 'INITIAL_DEPOSIT') <> 'TOP_UP'
          AND property_name IS NOT NULL AND plot_reference IS NOT NULL;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS allocation_date date;
      ALTER TABLE expenses ADD COLUMN IF NOT EXISTS negotiated_amount numeric;
      ALTER TABLE expenses ADD COLUMN IF NOT EXISTS paid_at timestamptz;
      ALTER TABLE workflow_events ADD COLUMN IF NOT EXISTS to_status text;
      CREATE TABLE IF NOT EXISTS site_records (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        sale_id uuid NOT NULL,
        record_type text NOT NULL,
        details jsonb NOT NULL DEFAULT '{}',
        status text NOT NULL DEFAULT 'DONE',
        created_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'document';
      ALTER TABLE sale_documents ADD COLUMN IF NOT EXISTS uploaded_file_id uuid REFERENCES uploaded_files(id) ON DELETE SET NULL;
      ALTER TABLE sale_documents ADD COLUMN IF NOT EXISTS document_url text;
      CREATE INDEX IF NOT EXISTS idx_sale_docs_file ON sale_documents(uploaded_file_id);
      -- Compatibility migrations for production databases created before the
      -- dedicated evidence-document tables were introduced. These tables are
      -- queried during sale creation when payment evidence is uploaded.
      CREATE TABLE IF NOT EXISTS expense_documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        expense_id uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
        document_type text NOT NULL DEFAULT 'SUPPORTING_DOCUMENT',
        document_name text NOT NULL,
        uploaded_file_id uuid REFERENCES uploaded_files(id) ON DELETE SET NULL,
        uploaded_by uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_expense_docs_expense ON expense_documents(expense_id, created_at);
      CREATE TABLE IF NOT EXISTS expense_payment_documents (
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
      CREATE TABLE IF NOT EXISTS operations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        sale_id uuid NOT NULL,
        task_type text NOT NULL,
        assigned_to uuid,
        status text NOT NULL DEFAULT 'PENDING',
        due_date date,
        notes text,
        completed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE site_records ADD COLUMN IF NOT EXISTS sale_id uuid;
      ALTER TABLE site_records ADD COLUMN IF NOT EXISTS record_type text;
      ALTER TABLE site_records ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}';
      ALTER TABLE site_records ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'DONE';
      ALTER TABLE site_records ADD COLUMN IF NOT EXISTS created_by uuid;
      ALTER TABLE site_records ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE site_records ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE operations ADD COLUMN IF NOT EXISTS sale_id uuid;
      ALTER TABLE operations ADD COLUMN IF NOT EXISTS task_type text;
      ALTER TABLE operations ADD COLUMN IF NOT EXISTS assigned_to uuid;
      ALTER TABLE operations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'PENDING';
      ALTER TABLE operations ADD COLUMN IF NOT EXISTS due_date date;
      ALTER TABLE operations ADD COLUMN IF NOT EXISTS notes text;
      ALTER TABLE operations ADD COLUMN IF NOT EXISTS completed_at timestamptz;
      ALTER TABLE operations ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
      CREATE TABLE IF NOT EXISTS customer_campaigns (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        channel text NOT NULL,
        audience text NOT NULL,
        subject text,
        body text NOT NULL,
        status text NOT NULL DEFAULT 'SENDING',
        recipient_count int NOT NULL DEFAULT 0,
        sent_count int NOT NULL DEFAULT 0,
        failed_count int NOT NULL DEFAULT 0,
        error text,
        created_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz
      );
      -- v4.2 compatibility fix: older production databases may have the
      -- v4.0 refresh_sale_next_action() function with a RECORD variable that
      -- does not select sale_reference, even though the notification branch
      -- reads s.sale_reference. Rebuild that existing function definition in
      -- place without dropping the trigger that depends on it.
      DO $$
      DECLARE
        v_def text;
        v_fixed text;
      BEGIN
        SELECT pg_get_functiondef(p.oid)
          INTO v_def
          FROM pg_proc p
         WHERE p.oid = to_regprocedure('refresh_sale_next_action(uuid)');

        IF v_def IS NOT NULL
           AND position('s.sale_reference' IN v_def) > 0
           AND position('SELECT id, status, created_by, approved_at, allocation_date, sale_reference' IN v_def) = 0 THEN
          v_fixed := replace(
            v_def,
            'SELECT id, status, created_by, approved_at, allocation_date',
            'SELECT id, status, created_by, approved_at, allocation_date, sale_reference'
          );
          IF v_fixed <> v_def THEN
            EXECUTE v_fixed;
          END IF;
        END IF;
      END $$;
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
RETURNS trigger LANGUAGE plpgsql AS $
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
$;

DROP TRIGGER IF EXISTS trg_sync_sale_transaction_document_numbers ON sales;
CREATE TRIGGER trg_sync_sale_transaction_document_numbers
BEFORE INSERT OR UPDATE OF invoice_number, sales_receipt_no, sales_order_no, sales_invoice_no
ON sales FOR EACH ROW EXECUTE FUNCTION sync_sale_transaction_document_numbers();

CREATE OR REPLACE FUNCTION refresh_sale_next_action(p_sale_id uuid)
RETURNS void LANGUAGE plpgsql AS $
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
$;

CREATE OR REPLACE FUNCTION trg_sales_next_action()
RETURNS trigger LANGUAGE plpgsql AS $
BEGIN PERFORM refresh_sale_next_action(NEW.id); RETURN NEW; END;
$;
DROP TRIGGER IF EXISTS trg_sales_next_action ON sales;
CREATE TRIGGER trg_sales_next_action
AFTER INSERT OR UPDATE OF status,approved_at,allocation_date ON sales
FOR EACH ROW EXECUTE FUNCTION trg_sales_next_action();

CREATE OR REPLACE FUNCTION trg_approval_next_action()
RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
  IF NEW.entity_type='SALE' THEN PERFORM refresh_sale_next_action(NEW.entity_id); END IF;
  RETURN NEW;
END;
$;
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

DO $ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM sales LOOP PERFORM refresh_sale_next_action(r.id); END LOOP;
END $;


    `).then(() => undefined).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

export async function query(text: string, params?: unknown[]) {
  if (testDatabase()?.query) return testDatabase()!.query!(text, params);
  if (testDatabase()) {
    const result = await testDatabase()!.sql(Object.assign([text], { raw: [text] }) as unknown as TemplateStringsArray, ...(params ?? []));
    return { rows: result };
  }
  if (!connectionString) return { rows: [] };
  await ensureApprovalSchema();
  return pool.query(text, params);
}

export async function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  if (testDatabase()) return testDatabase()!.sql(strings, ...values);
  let text = strings[0];
  const params: unknown[] = [];
  for (let i = 0; i < values.length; i += 1) {
    params.push(values[i]);
    text += `$${params.length}${strings[i + 1]}`;
  }
  const result = await query(text, params);
  return result.rows;
}

export type Row = Record<string, any>;
export type Tx = { query: (text: string, params?: unknown[]) => Promise<{ rows: Row[] }> };

export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (testDatabase()) return testDatabase()!.withTx(fn);
  if (!connectionString) return fn({ query: async () => ({ rows: [] }) });
  await ensureApprovalSchema();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn({ query: (text, params) => client.query(text, params) });
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
