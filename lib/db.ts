import { neon, neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';

export type Row = Record<string, any>;
export type Tx = { query: (text: string, params?: unknown[]) => Promise<{ rows: Row[] }> };
type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

/**
 * Test seam: automated tests inject an in-process Postgres (PGlite) here.
 * Never set in production.
 */
type Seam = { sql: SqlFn; withTx: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T> };
const seam = (): Seam | undefined => (globalThis as any).__LB_DB__;

function url(): string {
  const u = process.env.DATABASE_URL;
  if (!u) throw new Error('DATABASE_URL is not configured');
  return u;
}

let http: ReturnType<typeof neon> | undefined;

/** Read queries: stateless HTTP, one round trip. Use as a tagged template. */
export const sql: SqlFn = (strings, ...values) => {
  const s = seam();
  if (s) return s.sql(strings, ...values);
  http ??= neon(url());
  return (http as any)(strings, ...values) as Promise<Row[]>;
};

/**
 * Writes that must be atomic (status change + events + approvals + notifications):
 * an interactive transaction over a short-lived WebSocket pool. Stateless per request,
 * so it fits Vercel serverless + Neon.
 */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const s = seam();
  if (s) return s.withTx(fn);
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: url(), max: 1 });
  const client = await pool.connect();
  try {
    await client.query('begin');
    const out = await fn(client as unknown as Tx);
    await client.query('commit');
    return out;
  } catch (e) {
    try { await client.query('rollback'); } catch {}
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}
