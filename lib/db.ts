import { Pool } from 'pg';

const connectionString =
  process.env.DATABASE_URL_2 ||
  process.env.DATABASE_URL ||
  process.env.DATABASE_URL_3 ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL;

export const pool = new Pool({
  connectionString: connectionString || 'postgres://placeholder:placeholder@localhost:5432/placeholder',
  ssl: process.env.NODE_ENV === 'production' && connectionString ? { rejectUnauthorized: false } : false,
});

export async function query(text: string, params?: unknown[]) {
  if (!connectionString) return { rows: [] };
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
