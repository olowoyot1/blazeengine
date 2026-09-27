import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

export const pool = new Pool({
  connectionString: connectionString || 'postgres://placeholder:placeholder@localhost:5432/placeholder',
  ssl: process.env.NODE_ENV === 'production' && connectionString ? { rejectUnauthorized: false } : false,
});

export async function query(text: string, params?: any[]) {
  if (!process.env.DATABASE_URL) {
    return { rows: [] };
  }
  return pool.query(text, params);
}
