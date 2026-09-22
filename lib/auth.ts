import { cookies } from 'next/headers';
import { cache } from 'react';
import { SignJWT, jwtVerify } from 'jose';
import { sql } from './db';
import type { Role } from './constants';

export const COOKIE = 'lb_session';
export type Session = { id: string; name: string; email: string; role: Role; department: string | null; mustChangePassword: boolean };

export function authSecret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET must be set to a random string of at least 32 characters');
    return new TextEncoder().encode('dev-only-secret-change-me-dev-only-secret');
  }
  return new TextEncoder().encode(s);
}

/**
 * The cookie only proves identity (user id). Role, department and active state are
 * ALWAYS re-read from the database, so role changes and deactivation take effect
 * immediately instead of after the 7-day token expiry.
 */
export const session = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  let id: string;
  try { id = String((await jwtVerify(token, authSecret())).payload.sub); } catch { return null; }
  const rows = await sql`select id,name,email,role,department,active,must_change_password from users where id=${id}::uuid`;
  const u = rows[0];
  if (!u || !u.active) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role, department: u.department, mustChangePassword: u.must_change_password };
});

export async function startSession(userId: string) {
  const token = await new SignJWT({}).setSubject(userId).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('12h').sign(authSecret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 12 * 3600,
  });
}
export async function endSession() { (await cookies()).delete(COOKIE); }

export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return 'Password must be at least 10 characters';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain letters and numbers';
  return null;
}
