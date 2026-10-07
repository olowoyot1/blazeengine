import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

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
      ALTER TABLE sale_documents ADD COLUMN IF NOT EXISTS uploaded_file_id uuid REFERENCES uploaded_files(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_sale_docs_file ON sale_documents(uploaded_file_id);
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
