import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import { startSession } from '@/lib/auth';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  const email = String(body?.email ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');
  if (!email || !password) return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });

  let rows;
  try { rows = await sql`select * from users where lower(email)=${email} and active limit 1`; }
  catch { return NextResponse.json({ error: 'The database is not reachable. Check DATABASE_URL and try again.' }, { status: 503 }); }

  const u = rows[0];
  // Constant-shape response whether or not the account exists, to avoid user enumeration.
  const dummyHash = '$2b$12$CwTycUXWue0Thq9StjUM0uJ8kTGXG9m2N9nzL3HrfoWFPd6IUZKQC';
  if (u?.locked_until && new Date(u.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(u.locked_until).getTime() - Date.now()) / 60000);
    return NextResponse.json({ error: `Account temporarily locked. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` }, { status: 423 });
  }
  const ok = await bcrypt.compare(password, u?.password_hash ?? dummyHash);
  if (!u || !ok) {
    if (u) {
      const attempts = (u.failed_attempts ?? 0) + 1;
      const lock = attempts >= MAX_ATTEMPTS;
      await sql`update users set failed_attempts=${attempts}, locked_until=${lock ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null} where id=${u.id}`;
      if (lock) return NextResponse.json({ error: `Too many failed attempts. Account locked for ${LOCK_MINUTES} minutes.` }, { status: 423 });
    }
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }
  await sql`update users set failed_attempts=0, locked_until=null where id=${u.id}`;
  await startSession(u.id);
  await sql`insert into audit_logs(user_id,action,entity_type,entity_id) values(${u.id},'LOGIN','USER',${u.id})`;
  return NextResponse.json({ ok: true, mustChangePassword: !!u.must_change_password });
}
