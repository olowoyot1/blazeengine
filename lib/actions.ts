'use server';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { requireUser, requireCap } from './guard';
import { can } from './rbac';
import { sql } from './db';
import { passwordProblem, startSession } from './auth';
import { sendMail } from './email';
import { WorkflowError, ForbiddenError } from './workflow/core';
import { decide } from './workflow/approvals';
import { submitPayroll, disbursePayroll } from './workflow/payroll';
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

// ---- First-login username + PIN -----------------------------------------
export async function setupLoginIdentity(username: string, pin: string): Promise<Result> {
  const s = await requireUser({ allowPasswordChange: true });
  const u = username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{4,30}$/.test(u)) return { error: 'Username must be 4–30 characters.' };
  if (!/^\d{6}$/.test(pin)) return { error: 'PIN must be exactly 6 digits.' };
  const dup = await sql`select id from users where lower(username)=${u} and id<>${s.id}::uuid`;
  if (dup.length) return { error: 'That username is already in use.' };
  const hash = await bcrypt.hash(pin, 12);
  await sql`update users set username=${u}, pin_hash=${hash}, updated_at=now() where id=${s.id}::uuid`;
  await sql`insert into audit_logs(user_id,action,entity_type,entity_id,metadata) values(${s.id}::uuid,'LOGIN_IDENTITY_SET','USER',${s.id}::uuid,${JSON.stringify({ username: u })})`;
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

// ---- User & role administration (ADMIN / SUPER_ADMIN) --------------------
const APPROVAL_CRITICAL: Role[] = ['CEO', 'HR', 'SALES_MANAGER', 'OPERATIONS_MANAGER', 'FINANCE_OPERATIONS', 'SITE_MANAGER', 'ACCOUNTANT'];
const ADMIN_TIER: Role[] = ['ADMIN', 'SUPER_ADMIN'];

async function requireAdmin() {
  const s = await requireUser();
  if (!can(s.role, 'users.manage')) throw new ForbiddenError('Only administrators manage users');
  return s;
}
/**
 * Enforces the admin hierarchy: a plain ADMIN may manage any non-admin-tier account,
 * but creating, changing the role of, deactivating or resetting the password of an
 * ADMIN or SUPER_ADMIN account requires SUPER_ADMIN ("admins.manage"). This is what
 * stops one admin from quietly promoting themselves or a colleague, or from taking
 * over another admin's account — that authority now sits only with SUPER_ADMIN.
 */
function requireAuthorityOver(actor: { role: Role }, targetRoleBeforeOrAfter: Role) {
  if (ADMIN_TIER.includes(targetRoleBeforeOrAfter) && !can(actor.role, 'admins.manage'))
    throw new ForbiddenError('Only a Super Administrator can manage admin-tier accounts');
}

export async function createUser(input: { name: string; email: string; role: string; department?: string; password: string }): Promise<Result> {
  try {
    const admin = await requireAdmin();
    const name = input.name?.trim(), email = input.email?.trim().toLowerCase();
    if (!name || !email) return { error: 'Name and email are required' };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Email address is not valid' };
    if (!ROLES.includes(input.role as Role)) return { error: 'Invalid role' };
    requireAuthorityOver(admin, input.role as Role);
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
    const target = await sql`select name, email, role from users where id=${userId}::uuid`;
    if (!target[0]) return { error: 'User not found' };
    requireAuthorityOver(admin, target[0].role as Role);
    requireAuthorityOver(admin, role as Role);
    if ((APPROVAL_CRITICAL.includes(role as Role) || ADMIN_TIER.includes(role as Role)) && reason.trim().length < 5)
      return { error: 'A reason is required when assigning this role' };
    await sql`update users set role=${role}, updated_at=now() where id=${userId}::uuid`;
    await sql`insert into audit_logs(user_id,action,entity_type,entity_id,metadata) values(${admin.id}::uuid,'USER_ROLE_CHANGED','USER',${userId}::uuid,${JSON.stringify({ from: target[0].role, to: role, reason: reason.trim() || null, by: admin.name })})`;
    if (APPROVAL_CRITICAL.includes(role as Role) || ADMIN_TIER.includes(role as Role)) {
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
    const target = await sql`select role from users where id=${userId}::uuid`;
    if (!target[0]) return { error: 'User not found' };
    requireAuthorityOver(admin, target[0].role as Role);
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
    requireAuthorityOver(admin, target[0].role as Role);
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

// ---- Departments (ADMIN / SUPER_ADMIN) ------------------------------------
export async function createDepartment(name: string): Promise<Result> {
  try {
    const admin = await requireUser();
    if (!can(admin.role, 'departments.manage')) throw new ForbiddenError('Only administrators manage departments');
    const clean = name.trim();
    if (clean.length < 2) return { error: 'Department name must be at least 2 characters' };
    const dup = await sql`select 1 from departments where lower(name)=lower(${clean})`;
    if (dup.length) return { error: 'A department with this name already exists' };
    await sql`insert into departments(name, created_by) values(${clean}, ${admin.id}::uuid)`;
    await sql`insert into audit_logs(user_id,action,entity_type,metadata) values(${admin.id}::uuid,'DEPARTMENT_CREATED','DEPARTMENT',${JSON.stringify({ name: clean })})`;
    revalidatePath('/users');
    return { ok: true };
  } catch (e) { return toErr(e); }
}
export async function setDepartmentActive(id: string, active: boolean): Promise<Result> {
  try {
    const admin = await requireUser();
    if (!can(admin.role, 'departments.manage')) throw new ForbiddenError('Only administrators manage departments');
    await sql`update departments set active=${active} where id=${id}::uuid`;
    await sql`insert into audit_logs(user_id,action,entity_type,entity_id,metadata) values(${admin.id}::uuid,${active ? 'DEPARTMENT_ACTIVATED' : 'DEPARTMENT_RETIRED'},'DEPARTMENT',${id}::uuid,'{}')`;
    revalidatePath('/users');
    return { ok: true };
  } catch (e) { return toErr(e); }
}

// ---- Client profile --------------------------------------------------------
export async function saveClientProfile(clientId: string, input: Record<string, unknown>): Promise<Result> {
  const s = await requireUser();
  try {
    const { updateClientProfile } = await import('./workflow/clients');
    await updateClientProfile(s, clientId, input);
    revalidatePath(`/clients/${clientId}`);
    revalidatePath('/leads');
    return { ok: true };
  } catch (e) { return toErr(e); }
}


// ---- HR ------------------------------------------------------------------
export async function createEmployee(input: {firstName:string;lastName:string;employeeNo:string;department?:string;jobTitle?:string;phone?:string}): Promise<Result>{
  const s=await requireCap('hr.workspace');
  try { const row=await sql`insert into employees(employee_no,first_name,last_name,department,job_title,phone,created_by) values(${input.employeeNo.trim()},${input.firstName.trim()},${input.lastName.trim()},${input.department||null},${input.jobTitle||null},${input.phone||null},${s.id}::uuid) returning id`; revalidatePath('/hr'); return {ok:true,id:row[0].id}; } catch(e){return toErr(e);}
}
export async function decideLeave(id:string, decision:'APPROVED'|'REJECTED'):Promise<Result>{const s=await requireCap('hr.workspace');try{await sql`update leave_requests set status=${decision},approved_by=${s.id}::uuid,approved_at=now() where id=${id}::uuid and status='PENDING'`;revalidatePath('/hr');return {ok:true};}catch(e){return toErr(e);}}

export async function attachSaleDocument(saleId:string, documentType:string, documentName:string, documentUrl:string):Promise<Result>{const s=await requireUser();try{if(!/^[0-9a-f-]{36}$/i.test(saleId))return {error:'Invalid sale'};if(!documentUrl.startsWith('/api/files/'))return {error:'Invalid document'};await sql`insert into sale_documents(sale_id,document_type,document_name,document_url,uploaded_by) values(${saleId}::uuid,${documentType.trim()||'SUPPORTING_DOCUMENT'},${documentName.trim()},${documentUrl},${s.id}::uuid)`;revalidatePath(`/sales/${saleId}`);revalidatePath('/approvals');return {ok:true};}catch(e){return toErr(e);}}

export async function createLeaveRequest(input:{employeeId:string;leaveType:string;startDate:string;endDate:string;days:number;reason?:string}):Promise<Result>{const s=await requireCap('hr.workspace');try{await sql`insert into leave_requests(employee_id,leave_type,start_date,end_date,days,reason) values(${input.employeeId}::uuid,${input.leaveType},${input.startDate},${input.endDate},${input.days},${input.reason||null})`;revalidatePath('/hr');return {ok:true};}catch(e){return toErr(e);}}
export async function recordAttendance(input:{employeeId:string;workDate:string;status:string;checkIn?:string;checkOut?:string;notes?:string}):Promise<Result>{const s=await requireCap('hr.workspace');try{await sql`insert into attendance(employee_id,work_date,status,check_in,check_out,notes) values(${input.employeeId}::uuid,${input.workDate},${input.status},${input.checkIn||null},${input.checkOut||null},${input.notes||null}) on conflict(employee_id,work_date) do update set status=excluded.status,check_in=excluded.check_in,check_out=excluded.check_out,notes=excluded.notes`;revalidatePath('/hr');return {ok:true};}catch(e){return toErr(e);}}

// ---- Payroll -------------------------------------------------------------
export async function createPayrollRun(input: { payrollMonth: string; periodStart: string; periodEnd: string; notes?: string }): Promise<Result> {
  const s = await requireCap('hr.payroll');
  if (!['HR','ADMIN','SUPER_ADMIN'].includes(s.role)) return { error: 'Only HR or an administrator can create payroll.' };
  try {
    const existing = await sql`select id from payroll_runs where payroll_month=${input.payrollMonth.trim()}`;
    if (existing.length) return { error: 'A payroll run already exists for this month.' };
    const runRows = await sql`insert into payroll_runs(payroll_month,period_start,period_end,notes,created_by)
      values(${input.payrollMonth.trim()},${input.periodStart},${input.periodEnd},${input.notes||null},${s.id}::uuid) returning id`;
    const runId = runRows[0].id;
    await sql`insert into payroll_items(payroll_run_id,employee_id,base_salary,allowances,deductions,gross_salary,net_salary)
      select ${runId}::uuid,e.id,coalesce(e.base_salary,0),0,0,coalesce(e.base_salary,0),coalesce(e.base_salary,0)
      from employees e where e.employment_status='ACTIVE'`;
    await sql`update payroll_runs p set total_gross=x.gross,total_allowances=x.allowances,total_deductions=x.deductions,total_net=x.net,updated_at=now()
      from (select payroll_run_id,sum(gross_salary) gross,sum(allowances) allowances,sum(deductions) deductions,sum(net_salary) net from payroll_items where payroll_run_id=${runId}::uuid group by payroll_run_id) x
      where p.id=x.payroll_run_id`;
    revalidatePath('/hr/payroll'); return { ok:true, id:runId };
  } catch(e) { return toErr(e); }
}
export async function submitPayrollForApproval(id:string):Promise<Result>{
  const s=await requireCap('hr.payroll'); try { await submitPayroll(s,id); revalidatePath('/hr/payroll'); revalidatePath('/approvals'); return {ok:true}; } catch(e){return toErr(e);}
}
export async function disburseApprovedPayroll(id:string):Promise<Result>{
  const s=await requireCap('hr.payroll'); try { await disbursePayroll(s,id); revalidatePath('/hr/payroll'); revalidatePath('/approvals'); return {ok:true}; } catch(e){return toErr(e);}
}

// ---- Internal staff chat -------------------------------------------------
export async function sendChatMessage(roomId:string, message:string):Promise<Result>{
  const s=await requireUser();
  const text=(message||'').trim(); if(!text) return {error:'Message cannot be empty.'}; if(text.length>4000) return {error:'Message is too long.'};
  try { const room=await sql`select id from chat_rooms where id=${roomId}::uuid and (room_type='GENERAL' or user_a=${s.id}::uuid or user_b=${s.id}::uuid)`; if(!room.length)return {error:'You do not have access to this chat.'}; await sql`insert into chat_messages(room_id,sender_id,message) values(${roomId}::uuid,${s.id}::uuid,${text})`; revalidatePath('/chat'); return {ok:true}; } catch(e){return toErr(e);}
}
export async function openDirectChat(userId:string):Promise<Result>{
  const s=await requireUser(); if(userId===s.id)return {error:'You cannot start a direct chat with yourself.'};
  try { const existing=await sql`select id from chat_rooms where room_type='DIRECT' and ((user_a=${s.id}::uuid and user_b=${userId}::uuid) or (user_a=${userId}::uuid and user_b=${s.id}::uuid)) limit 1`; if(existing.length)return {ok:true,id:existing[0].id}; const rows=await sql`insert into chat_rooms(room_type,user_a,user_b,created_by) values('DIRECT',${s.id}::uuid,${userId}::uuid,${s.id}::uuid) returning id`; revalidatePath('/chat'); return {ok:true,id:rows[0].id}; }catch(e){return toErr(e);}
}
export async function updatePayrollItem(id:string, allowances:number, deductions:number):Promise<Result>{
  const s=await requireCap('hr.payroll'); if(!['HR','ADMIN','SUPER_ADMIN'].includes(s.role))return {error:'Only HR can edit payroll.'};
  try{await sql`update payroll_items i set allowances=${Number(allowances)||0},deductions=${Number(deductions)||0},gross_salary=base_salary+((${Number(allowances)||0})::numeric),net_salary=base_salary+((${Number(allowances)||0})::numeric)-((${Number(deductions)||0})::numeric) from payroll_runs p where i.id=${id}::uuid and p.id=i.payroll_run_id and p.status in ('DRAFT','REJECTED')`;const r=await sql`select payroll_run_id from payroll_items where id=${id}::uuid`;if(r[0])await sql`update payroll_runs p set total_gross=x.gross,total_allowances=x.allowances,total_deductions=x.deductions,total_net=x.net,updated_at=now() from (select payroll_run_id,sum(gross_salary) gross,sum(allowances) allowances,sum(deductions) deductions,sum(net_salary) net from payroll_items where payroll_run_id=${r[0].payroll_run_id} group by payroll_run_id)x where p.id=x.payroll_run_id`;revalidatePath('/hr/payroll');return {ok:true};}catch(e){return toErr(e);}
}
