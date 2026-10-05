import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import { startSession } from '@/lib/auth';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const GENERIC_FAILURE = 'Invalid credentials';

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  const identifier = String(body?.identifier ?? body?.email ?? '').trim();
  const secret = String(body?.secret ?? body?.password ?? '');
  const mode = body?.mode === 'password' ? 'password' : 'pin';
  if (!identifier || !secret) return NextResponse.json({ error: GENERIC_FAILURE }, { status: 401 });

  let rows;
  try {
    rows = mode === 'pin'
      ? await sql`select * from users where lower(username)=lower(${identifier}) and active limit 1`
      : await sql`select * from users where lower(email)=lower(${identifier}) and active limit 1`;
  } catch { return NextResponse.json({ error: 'The database is not reachable. Check DATABASE_URL and try again.' }, { status: 503 }); }

  const u = rows[0];
  const dummyHash = '$2b$12$CwTycUXWue0Thq9StjUM0uJ8kTGXG9m2N9nzL3HrfoWFPd6IUZKQC';
  const locked = !!u?.locked_until && new Date(u.locked_until) > new Date();
  const hash = mode === 'pin' ? (u?.pin_hash ?? dummyHash) : (u?.password_hash ?? dummyHash);

  // Always perform a password-hash comparison before returning an authentication
  // failure. Do not reveal whether the account exists, which login mode it uses,
  // or whether it is currently locked.
  const ok = !locked && await bcrypt.compare(secret, hash);
  if (!u || !ok || (mode === 'pin' && !u.username) || (mode === 'password' && !!u.pin_hash)) {
    if (u && !locked) {
      const attempts = (u.failed_attempts ?? 0) + 1;
      const lock = attempts >= MAX_ATTEMPTS;
      await sql`update users set failed_attempts=${attempts}, locked_until=${lock ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null} where id=${u.id}`;
    }
    return NextResponse.json({ error: GENERIC_FAILURE }, { status: 401 });
  }

  await sql`update users set failed_attempts=0, locked_until=null where id=${u.id}`;
  await startSession(u.id, Number(u.session_version ?? 0));
  await sql`insert into audit_logs(user_id,action,entity_type,entity_id,metadata) values(${u.id},${mode === 'pin' ? 'LOGIN_PIN' : 'LOGIN'},'USER',${u.id},${JSON.stringify({ mode })})`;
  return NextResponse.json({ ok: true, needsPinSetup: !u.username || !u.pin_hash, loginMode: u.username && u.pin_hash ? 'pin' : 'password' });
}
