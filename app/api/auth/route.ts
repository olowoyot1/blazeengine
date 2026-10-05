import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import { startSession } from '@/lib/auth';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const IP_WINDOW_MINUTES = 15;
const MAX_IP_FAILURES = 30;
const GENERIC_FAILURE = 'Invalid credentials';

function clientKey(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const real = req.headers.get('x-real-ip')?.trim();
  const ip = forwarded || real || 'unknown';
  return crypto.createHash('sha256').update(ip).digest('hex');
}

async function ipRateLimited(keyHash: string) {
  const rows = await sql`select window_started_at, failures from auth_rate_limits where key_hash=${keyHash} limit 1`;
  if (!rows[0]) return false;
  if (Date.now() - new Date(rows[0].window_started_at).getTime() >= IP_WINDOW_MINUTES * 60000) {
    await sql`update auth_rate_limits set window_started_at=now(), failures=0, updated_at=now() where key_hash=${keyHash}`;
    return false;
  }
  return Number(rows[0].failures) >= MAX_IP_FAILURES;
}

async function recordIpFailure(keyHash: string) {
  await sql`insert into auth_rate_limits(key_hash,window_started_at,failures,updated_at)
    values(${keyHash},now(),1,now())
    on conflict(key_hash) do update set
      failures=case when now()-auth_rate_limits.window_started_at >= (${IP_WINDOW_MINUTES} || ' minutes')::interval then 1 else auth_rate_limits.failures+1 end,
      window_started_at=case when now()-auth_rate_limits.window_started_at >= (${IP_WINDOW_MINUTES} || ' minutes')::interval then now() else auth_rate_limits.window_started_at end,
      updated_at=now()`;
}

export async function POST(req: Request) {
  const keyHash = clientKey(req);
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  const identifier = String(body?.identifier ?? body?.email ?? '').trim();
  const secret = String(body?.secret ?? body?.password ?? '');
  const mode = body?.mode === 'password' ? 'password' : 'pin';
  if (!identifier || !secret) return NextResponse.json({ error: GENERIC_FAILURE }, { status: 401 });

  try {
    if (await ipRateLimited(keyHash)) return NextResponse.json({ error: GENERIC_FAILURE }, { status: 429, headers: { 'Retry-After': String(IP_WINDOW_MINUTES * 60) } });
  } catch { return NextResponse.json({ error: 'Authentication service is temporarily unavailable' }, { status: 503 }); }

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
  const ok = !locked && await bcrypt.compare(secret, hash);

  if (!u || !ok || (mode === 'pin' && !u.username) || (mode === 'password' && !!u.pin_hash)) {
    try { await recordIpFailure(keyHash); } catch { /* account lockout remains the fallback control */ }
    if (u && !locked) {
      const attempts = (u.failed_attempts ?? 0) + 1;
      const lock = attempts >= MAX_ATTEMPTS;
      await sql`update users set failed_attempts=${attempts}, locked_until=${lock ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null} where id=${u.id}`;
    }
    return NextResponse.json({ error: GENERIC_FAILURE }, { status: 401 });
  }

  await sql`update users set failed_attempts=0, locked_until=null where id=${u.id}`;
  await sql`delete from auth_rate_limits where key_hash=${keyHash}`;
  await startSession(u.id, Number(u.session_version ?? 0));
  await sql`insert into audit_logs(user_id,action,entity_type,entity_id,metadata) values(${u.id},${mode === 'pin' ? 'LOGIN_PIN' : 'LOGIN'},'USER',${u.id},${JSON.stringify({ mode })})`;
  return NextResponse.json({ ok: true, needsPinSetup: !u.username || !u.pin_hash, loginMode: u.username && u.pin_hash ? 'pin' : 'password' });
}
