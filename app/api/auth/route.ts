import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { authSql } from '@/lib/db';
import { startSession } from '@/lib/auth';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const IP_WINDOW_MINUTES = 15;
const MAX_IP_FAILURES = 30;
const GENERIC_FAILURE = 'Invalid credentials';
const DUMMY_HASH = '$2b$12$CwTycUXWue0Thq9StjUM0uJ8kTGXG9m2N9nzL3HrfoWFPd6IUZKQC';

function clientKey(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const real = req.headers.get('x-real-ip')?.trim();
  const ip = forwarded || real || 'unknown';
  return crypto.createHash('sha256').update(ip).digest('hex');
}

/**
 * Atomically counts this attempt against the IP window BEFORE any password check and
 * returns the new count. Checking first and recording later let a parallel burst of
 * requests all pass the check before any failure was written.
 */
async function chargeIpAttempt(keyHash: string): Promise<number> {
  const rows = await authSql`insert into auth_rate_limits(key_hash,window_started_at,failures,updated_at)
    values(${keyHash},now(),1,now())
    on conflict(key_hash) do update set
      failures=case when now()-auth_rate_limits.window_started_at >= (${IP_WINDOW_MINUTES} || ' minutes')::interval then 1 else auth_rate_limits.failures+1 end,
      window_started_at=case when now()-auth_rate_limits.window_started_at >= (${IP_WINDOW_MINUTES} || ' minutes')::interval then now() else auth_rate_limits.window_started_at end,
      updated_at=now()
    returning failures`;
  return Number(rows[0]?.failures ?? 0);
}

/**
 * Reserves one attempt on the account in a single row-locked UPDATE before bcrypt runs.
 * Concurrent requests serialize on the row, so once the limit is reached every further
 * request (including ones already in flight) sees the lock. Returns false when locked.
 * A successful login resets the counter afterwards.
 */
async function chargeAccountAttempt(userId: string): Promise<boolean> {
  const rows = await authSql`update users set
      failed_attempts = case when locked_until is not null and locked_until <= now() then 1 else failed_attempts + 1 end,
      locked_until = case
        when (case when locked_until is not null and locked_until <= now() then 1 else failed_attempts + 1 end) >= ${MAX_ATTEMPTS}
          then now() + (${LOCK_MINUTES} || ' minutes')::interval
        else null end
    where id=${userId} and (locked_until is null or locked_until <= now())
    returning id`;
  return rows.length > 0;
}

export async function POST(req: Request) {
  // Requiring a JSON content type blocks cross-site HTML form posts (login CSRF).
  if (!req.headers.get('content-type')?.toLowerCase().includes('application/json'))
    return NextResponse.json({ error: 'Invalid request' }, { status: 415 });

  const keyHash = clientKey(req);
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  const identifier = String(body?.identifier ?? body?.email ?? '').trim();
  const secret = String(body?.secret ?? body?.password ?? '');
  const mode = body?.mode === 'password' ? 'password' : 'pin';
  if (!identifier || !secret) return NextResponse.json({ error: GENERIC_FAILURE }, { status: 401 });

  try {
    // Keep authentication usable on production databases that have not yet received
    // the rate-limit migration. This DDL is idempotent and preserves existing counters.
    await authSql`create table if not exists auth_rate_limits (
      key_hash text primary key,
      window_started_at timestamptz not null default now(),
      failures integer not null default 0,
      updated_at timestamptz not null default now()
    )`;
    if (await chargeIpAttempt(keyHash) > MAX_IP_FAILURES)
      return NextResponse.json({ error: GENERIC_FAILURE }, { status: 429, headers: { 'Retry-After': String(IP_WINDOW_MINUTES * 60) } });
  } catch (error) {
    console.error('[auth] rate-limit/database initialization failed:', error instanceof Error ? { name: error.name, message: error.message, code: (error as Error & { code?: string }).code } : String(error));
    return NextResponse.json({ error: 'Authentication service is temporarily unavailable' }, { status: 503 });
  }

  let u: any;
  let accountOpen = false;
  try {
    const rows = mode === 'pin'
      ? await authSql`select * from users where lower(username)=lower(${identifier}) and active limit 1`
      : await authSql`select * from users where lower(email)=lower(${identifier}) and active limit 1`;
    u = rows[0];
    if (u) accountOpen = await chargeAccountAttempt(u.id);
  } catch (error) {
    console.error('[auth] user lookup/account lock failed:', error instanceof Error ? { name: error.name, message: error.message, code: (error as Error & { code?: string }).code } : String(error));
    return NextResponse.json({ error: 'The database is not reachable. Check DATABASE_URL and try again.' }, { status: 503 });
  }

  // Always run bcrypt so unknown, locked and valid accounts take the same time to answer.
  const hash = mode === 'pin' ? (u?.pin_hash ?? DUMMY_HASH) : (u?.password_hash ?? DUMMY_HASH);
  const secretOk = await bcrypt.compare(secret, hash);
  const modeOk = !!u && (mode === 'pin' ? !!u.username : !u.pin_hash);

  if (!u || !accountOpen || !secretOk || !modeOk) return NextResponse.json({ error: GENERIC_FAILURE }, { status: 401 });

  await authSql`update users set failed_attempts=0, locked_until=null where id=${u.id}`;
  await authSql`delete from auth_rate_limits where key_hash=${keyHash}`;
  await startSession(u.id, Number(u.session_version ?? 0));
  await authSql`insert into audit_logs(user_id,action,entity_type,entity_id,metadata) values(${u.id},${mode === 'pin' ? 'LOGIN_PIN' : 'LOGIN'},'USER',${u.id},${JSON.stringify({ mode })})`;
  return NextResponse.json({ ok: true, needsPinSetup: !u.username || !u.pin_hash, loginMode: u.username && u.pin_hash ? 'pin' : 'password' });
}
