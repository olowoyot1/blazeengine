import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

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
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS invoice_number text;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS approved_at timestamptz;
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
    `).then(() => undefined).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

export async function query(text: string, params?: unknown[]) {
  if (!connectionString) return { rows: [] };
  await ensureApprovalSchema();
  return pool.query(text, params);
}

export async function sql(strings: TemplateStringsArray, ...values: unknown[]) {
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
