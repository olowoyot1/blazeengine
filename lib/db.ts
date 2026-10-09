import { Pool } from 'pg';

const rawConnectionString = process.env.DATABASE_URL;
// pg-connection-string will change the meaning of legacy SSL modes in its next
// major release. Make the current full-verification behavior explicit now.
const connectionString = rawConnectionString?.replace(
  /([?&]sslmode=)(prefer|require|verify-ca)(?=(&|$))/i,
  '$1verify-full',
);

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
  ssl: process.env.NODE_ENV === 'production' && connectionString ? { rejectUnauthorized: false } : false,
});

let schemaReady: Promise<void> | null = null;

async function ensureApprovalSchema() {
  if (!connectionString) return;
  if (!schemaReady) {
    schemaReady = pool.query(`
      ALTER TABLE approvals ADD COLUMN IF NOT EXISTS approver_user_id uuid;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS transaction_type text NOT NULL DEFAULT 'INITIAL_DEPOSIT';
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
