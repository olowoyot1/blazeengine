import { redirect } from 'next/navigation';
import { session, type Session } from './auth';
import { canAny, type Cap } from './rbac';

/** Any signed-in, active user. Forces first-login password change. */
export async function requireUser(opts: { allowPasswordChange?: boolean } = {}): Promise<Session> {
  const s = await session();
  if (!s) redirect('/login');
  if (s.mustChangePassword && !opts.allowPasswordChange) redirect('/profile/password');
  return s;
}

/** Signed-in user holding at least one of the capabilities, otherwise → /forbidden. */
export async function requireCap(...caps: Cap[]): Promise<Session> {
  const s = await requireUser();
  if (caps.length && !canAny(s.role, caps)) redirect('/forbidden');
  return s;
}
