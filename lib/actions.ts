'use server';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { requireUser } from './guard';
import { can } from './rbac';
import { sql } from './db';
import { passwordProblem, startSession } from './auth';
import { sendMail } from './email';
import { WorkflowError, ForbiddenError } from './workflow/core';
import { decide } from './workflow/approvals';
import { performSaleAction, createSale } from './workflow/sale';
import { performExpenseAction, createNegotiation, createDirectExpense } from './workflow/expense';
import { createLead, setLeadStatus, convertLead } from './workflow/leads';
import { ROLES, type Role } from './constants';

type Result = { ok: true; id?: string } | { error: string };

function toErr(e: unknown): Result {
  if (e instanceof WorkflowError || e instanceof ForbiddenError) return { error: e.message };
  console.error(e);
  return { error: 'Something went wrong. Please try again.' };
}

export async function actSale(saleId: string, key: string, input: Record<string, unknown>): Promise<Result> {
  const s = await requireUser();
  try { await performSaleAction(s, saleId, key, input); revalidatePath(`/sales/${saleId}`); revalidatePath('/sales'); revalidatePath('/dashboard'); return { ok: true }; }
  catch (e) { return toErr(e); }
}
export async function actExpense(id: string, key: string, input: Record<string, unknown>): Promise<Result> {
  const s = await requireUser();
  try { await performExpenseAction(s, id, key, input); revalidatePath(`/expenses/${id}`); revalidatePath('/expenses'); return { ok: true }; }
  catch (e) { return toErr(e); }
}
export async function actDecide(approvalId: string, decision: 'APPROVED' | 'REJECTED', comment: string): Promise<Result> {
  const s = await requireUser();
  try { await decide(s, approvalId, decision, comment); revalidatePath('/approvals'); revalidatePath('/sales'); revalidatePath('/expenses'); revalidatePath('/dashboard'); return { ok: true }; }
  catch (e) { return toErr(e); }
}
export async function newSale(input: Record<string, unknown>): Promise<Result> {
  const s = await requireUser();
  try { const id = await createSale(s, input); revalidatePath('/sales'); return { ok: true, id }; }
  catch (e) { return toErr(e); }
}
export async function newLead(input: Record<string, unknown>): Promise<Result> {
  const s = await requireUser();
  try { await createLead(s, input); revalidatePath('/leads'); return { ok: true }; }
  catch (e) { return toErr(e); }
}
export async function actLeadStatus(id: string, status: string): Promise<Result> {
  const s = await requireUser();
  try { await setLeadStatus(s, id, status); revalidatePath('/leads'); return { ok: true }; }
  catch (e) { return toErr(e); }
}
export async function actConvertLead(id: string): Promise<Result> {
  const s = await requireUser();
  try { const cid = await convertLead(s, id); revalidatePath('/leads'); return { ok: true, id: cid }; }
  catch (e) { return toErr(e); }
}
export async function newNegotiation(input: Record<string, unknown>): Promise<Result> {
  const s = await requireUser();
  try { const id = await createNegotiation(s, input); revalidatePath('/expenses'); return { ok: true, id }; }
  catch (e) { return toErr(e); }
}
export async function newDirectExpense(input: Record<string, unknown>): Promise<Result> {
  const s = await requireUser();
  try { const id = await createDirectExpense(s, input); revalidatePath('/expenses'); return { ok: true, id }; }
  catch (e) { return toErr(e); }
}
export async function markNotificationsRead(): Promise<Result> {
  const s = await requireUser({ allowPasswordChange: true });
  await sql`update notifications set read_at=now() where user_id=${s.id}::uuid and read_at is null`;
  revalidatePath('/notifications');
  return { ok: true };
}

// ---- Password self-service ----------------------------------------------
export async function changeOwnPassword(current: string, next: string): Promise<Result> {
  const s = await requireUser({ allowPasswordChange: true });
  const rows = await sql`select password_hash, session_version from users where id=${s.id}::uuid`;
  if (!rows[0] || !(await bcrypt.compare(current, rows[0].password_hash))) return { error: 'Current password is incorrect' };
  const problem = passwordProblem(next);
  if (problem) return { error: problem };
  if (await bcrypt.compare(next, rows[0].password_hash)) return { error: 'Choose a different password from your current one' };
  const hash = await bcrypt.hash(next, 12);
  const newVersion = Number(rows[0].session_version ?? 0) + 1;
  // Bumping session_version revokes every other already-issued cookie for this
  // account (e.g. a stolen session on another device) the moment the password changes.
  await sql`update users set password_hash=${hash}, must_change_password=false, session_version=${newVersion}, updated_at=now() where id=${s.id}::uuid`;
  await sql`insert into audit_logs(user_id,action,entity_type,entity_id) values(${s.id}::uuid,'PASSWORD_CHANGED','USER',${s.id}::uuid)`;
  // Re-issue a fresh cookie for THIS session under the new version so the user
  // who just changed their own password stays signed in; only other sessions die.
  await startSession(s.id, newVersion);
  return { ok: true };
}

// ---- User & role administration (ADMIN only) -----------------------------
const APPROVAL_CRITICAL: Role[] = ['CEO', 'HR', 'SALES_MANAGER', 'OPERATIONS_MANAGER', 'FINANCE_OPERATIONS', 'SITE_MANAGER', 'ACCOUNTANT'];

async function requireAdmin() {
  const s = await requireUser();
  if (!can(s.role, 'users.manage')) throw new ForbiddenError('Only administrators manage users');
  return s;
}
export async function createUser(input: { name: string; email: string; role: string; department?: string; password: string }): Promise<Result> {
  try {
    const admin = await requireAdmin();
    const name = input.name?.trim(), email = input.email?.trim().toLowerCase();
    if (!name || !email) return { error: 'Name and email are required' };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Email address is not valid' };
    if (!ROLES.includes(input.role as Role)) return { error: 'Invalid role' };
    const problem = passwordProblem(input.password);
    if (problem) return { error: problem };
    const dup = await sql`select 1 from users where lower(email)=${email}`;
    if (dup.length) return { error: 'A user with this email already exists' };
    const hash = await bcrypt.hash(input.password, 12);
    const row = await sql`insert into users(name,email,password_hash,role,department,must_change_password)
      values(${name},${email},${hash},${input.role},${input.department || null},true) returning id`;
    await sql`insert into audit_logs(user_id,action,entity_type,entity_id,metadata) values(${admin.id}::uuid,'USER_CREATED','USER',${row[0].id}::uuid,${JSON.stringify({ role: input.role })})`;
    revalidatePath('/users');
    return { ok: true, id: row[0].id };
  } catch (e) { return toErr(e); }
}

/**
 * Role changes onto an approval-critical role, and any password reset, require a
 * written reason (kept in the audit log — accountability, since an admin cannot be
 * technically stopped from acting, only made to leave a clear, reviewable trail) and
 * — where we have an address — an e-mail to the affected user, so account takeover
 * or role escalation is visible to the person it happened to, not just to the admin
 * who did it.
 */
export async function setUserRole(userId: string, role: string, reason: string): Promise<Result> {
  try {
    const admin = await requireAdmin();
    if (!ROLES.includes(role as Role)) return { error: 'Invalid role' };
    if (userId === admin.id) return { error: 'You cannot change your own role' };
    if (APPROVAL_CRITICAL.includes(role as Role) && reason.trim().length < 5) return { error: 'A reason is required when assigning an approval-critical role' };
    const target = await sql`select name, email, role from users where id=${userId}::uuid`;
    if (!target[0]) return { error: 'User not found' };
    await sql`update users set role=${role}, updated_at=now() where id=${userId}::uuid`;
    await sql`insert into audit_logs(user_id,action,entity_type,entity_id,metadata) values(${admin.id}::uuid,'USER_ROLE_CHANGED','USER',${userId}::uuid,${JSON.stringify({ from: target[0].role, to: role, reason: reason.trim() || null, by: admin.name })})`;
    if (APPROVAL_CRITICAL.includes(role as Role)) {
      await sendMail([{ to: target[0].email, subject: '[Landblaze] Your account role changed', text: `Hello ${target[0].name},\n\nYour Landblaze role was changed from ${target[0].role} to ${role} by administrator ${admin.name}.\nReason given: ${reason.trim()}\n\nIf you did not expect this, contact another administrator immediately.` }]);
    }
    revalidatePath('/users');
    return { ok: true };
  } catch (e) { return toErr(e); }
}
export async function setUserActive(userId: string, active: boolean): Promise<Result> {
  try {
    const admin = await requireAdmin();
    if (userId === admin.id && !active) return { error: 'You cannot deactivate your own account' };
    await sql`update users set active=${active}, updated_at=now() where id=${userId}::uuid`;
    await sql`insert into audit_logs(user_id,action,entity_type,entity_id,metadata) values(${admin.id}::uuid,${active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED'},'USER',${userId}::uuid,'{}')`;
    revalidatePath('/users');
    return { ok: true };
  } catch (e) { return toErr(e); }
}
export async function resetUserPassword(userId: string, reason: string): Promise<Result> {
  try {
    const admin = await requireAdmin();
    if (reason.trim().length < 5) return { error: 'A reason is required to reset a password (kept in the audit log)' };
    const target = await sql`select name, email, role, session_version from users where id=${userId}::uuid`;
    if (!target[0]) return { error: 'User not found' };
    const temp = Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6) + '9Aa';
    const hash = await bcrypt.hash(temp, 12);
    const newVersion = Number(target[0].session_version ?? 0) + 1;
    // Bumping session_version here kills any session the target already has open —
    // including one an attacker may be holding — the instant the reset happens.
    await sql`update users set password_hash=${hash}, must_change_password=true, failed_attempts=0, locked_until=null, session_version=${newVersion}, updated_at=now() where id=${userId}::uuid`;
    await sql`insert into audit_logs(user_id,action,entity_type,entity_id,metadata) values(${admin.id}::uuid,'PASSWORD_RESET','USER',${userId}::uuid,${JSON.stringify({ reason: reason.trim(), by: admin.name })})`;
    await sendMail([{ to: target[0].email, subject: '[Landblaze] Your password was reset', text: `Hello ${target[0].name},\n\nYour Landblaze password was reset by administrator ${admin.name}.\nReason given: ${reason.trim()}\n\nAny device you were already signed in on has been signed out. If you did not expect this, contact another administrator immediately.` }]);
    revalidatePath('/users');
    return { ok: true, id: temp }; // temp password returned once for the admin to relay securely
  } catch (e) { return toErr(e); }
}
