import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import { startSession } from '@/lib/auth';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  const identifier = String(body?.identifier ?? body?.email ?? '').trim();
  const secret = String(body?.secret ?? body?.password ?? '');
  const mode = body?.mode === 'password' ? 'password' : 'pin';
  if (!identifier || !secret) return NextResponse.json({ error: mode === 'pin' ? 'Username and PIN are required' : 'Email and password are required' }, { status: 400 });
  let rows;
  try {
    rows = mode === 'pin'
      ? await sql`select * from users where lower(username)=lower(${identifier}) and active limit 1`
      : await sql`select * from users where lower(email)=lower(${identifier}) and active limit 1`;
  } catch { return NextResponse.json({ error: 'The database is not reachable. Check DATABASE_URL and try again.' }, { status: 503 }); }
  const u = rows[0];
  if (mode === 'password' && u?.pin_hash) return NextResponse.json({ error: 'This account already uses username + PIN. Use your PIN to sign in.' }, { status: 400 });
  if (mode === 'pin' && !u?.pin_hash) return NextResponse.json({ error: 'First-time setup is required. Sign in with your email and password.' }, { status: 400 });
  const dummyHash = '$2b$12$CwTycUXWue0Thq9StjUM0uJ8kTGXG9m2N9nzL3HrfoWFPd6IUZKQC';
  if (u?.locked_until && new Date(u.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(u.locked_until).getTime() - Date.now()) / 60000);
    return NextResponse.json({ error: `Account temporarily locked. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` }, { status: 423 });
  }
  const hash = mode === 'pin' ? (u?.pin_hash ?? dummyHash) : (u?.password_hash ?? dummyHash);
  const ok = await bcrypt.compare(secret, hash);
  if (!u || !ok || (mode === 'pin' && !u.username)) {
    if (u) {
      const attempts = (u.failed_attempts ?? 0) + 1; const lock = attempts >= MAX_ATTEMPTS;
      await sql`update users set failed_attempts=${attempts}, locked_until=${lock ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null} where id=${u.id}`;
      if (lock) return NextResponse.json({ error: `Too many failed attempts. Account locked for ${LOCK_MINUTES} minutes.` }, { status: 423 });
    }
    return NextResponse.json({ error: mode === 'pin' ? 'Invalid username or PIN' : 'Invalid email or password' }, { status: 401 });
  }
  await sql`update users set failed_attempts=0, locked_until=null where id=${u.id}`;
  await startSession(u.id, Number(u.session_version ?? 0));
  await sql`insert into audit_logs(user_id,action,entity_type,entity_id,metadata) values(${u.id},${mode === 'pin' ? 'LOGIN_PIN' : 'LOGIN'},'USER',${u.id},${JSON.stringify({ mode })})`;
  return NextResponse.json({ ok: true, needsPinSetup: !u.username || !u.pin_hash, loginMode: u.username && u.pin_hash ? 'pin' : 'password' });
}
