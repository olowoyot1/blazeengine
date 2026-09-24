import { ForbiddenError, WorkflowError, audit, notifyRoles, one, run, type Actor, type Ctx } from './core';
import { openRound, registerRound } from './approvals';

type PEntity = 'PAYROLL';
const CEO_STEP = [{ step: 'CEO Payroll Approval', role: 'CEO' as const, seq: 1 }];

registerRound('PAYROLL_CEO_APPROVAL', {
  entity: 'PAYROLL' as any,
  onComplete: async (ctx, approval) => {
    await ctx.tx.query(`update payroll_runs set status='APPROVED', approved_by=$2, approved_at=now(), updated_at=now() where id=$1`, [approval.entity_id, approval.acted_by]);
  },
  onReject: async (ctx, approval, comment) => {
    await ctx.tx.query(`update payroll_runs set status='REJECTED', notes=coalesce(notes,'') || $2, updated_at=now() where id=$1`, [approval.entity_id, `\nCEO rejection: ${comment}`]);
  },
  link: () => '/hr/payroll',
  title: async (ctx, entityId) => {
    const r = await one(ctx, `select payroll_month,total_net from payroll_runs where id=$1`, [entityId]);
    return `Payroll ${r?.payroll_month ?? ''} — net ${Number(r?.total_net ?? 0).toLocaleString()}`;
  },
} as any);

export async function submitPayroll(actor: Actor, payrollId: string) {
  if (!['HR','ADMIN','SUPER_ADMIN'].includes(actor.role)) throw new ForbiddenError('Only HR or an administrator can submit payroll');
  return run(actor, async ctx => {
    const p = await one(ctx, `select * from payroll_runs where id=$1 for update`, [payrollId]);
    if (!p) throw new WorkflowError('Payroll run not found');
    if (p.status !== 'DRAFT' && p.status !== 'REJECTED') throw new WorkflowError('Only draft or rejected payroll can be submitted');
    const items = await one(ctx, `select count(*)::int n from payroll_items where payroll_run_id=$1`, [payrollId]);
    if (!items || items.n < 1) throw new WorkflowError('Payroll must contain at least one employee');
    await ctx.tx.query(`update payroll_runs set status='PENDING_CEO_APPROVAL',updated_at=now() where id=$1`, [payrollId]);
    await ctx.tx.query(`delete from approvals where entity_type='PAYROLL' and entity_id=$1 and status in ('PENDING','CANCELLED')`, [payrollId]);
    await openRound(ctx, 'PAYROLL' as any, payrollId, 'PAYROLL_CEO_APPROVAL', 1, CEO_STEP);
    await audit(ctx, 'PAYROLL_SUBMITTED', 'PAYROLL', payrollId, { total_net: p.total_net });
    return { ok: true };
  });
}

export async function disbursePayroll(actor: Actor, payrollId: string) {
  if (!['HR','ACCOUNTANT','FINANCE_OPERATIONS','ADMIN','SUPER_ADMIN'].includes(actor.role)) throw new ForbiddenError('You do not have payroll disbursement permission');
  return run(actor, async ctx => {
    const p = await one(ctx, `select * from payroll_runs where id=$1 for update`, [payrollId]);
    if (!p) throw new WorkflowError('Payroll run not found');
    if (p.status !== 'APPROVED') throw new WorkflowError('Payroll must be approved by the CEO before disbursement');
    const pending = await one(ctx, `select count(*)::int n from approvals where entity_type='PAYROLL' and entity_id=$1 and status='PENDING'`, [payrollId]);
    if (pending?.n) throw new WorkflowError('Payroll still has a pending approval');
    await ctx.tx.query(`update payroll_items set payment_status='DISBURSED',disbursed_at=now() where payroll_run_id=$1`, [payrollId]);
    await ctx.tx.query(`update payroll_runs set status='DISBURSED',disbursed_by=$2,disbursed_at=now(),updated_at=now() where id=$1`, [payrollId, actor.id]);
    await audit(ctx, 'PAYROLL_DISBURSED', 'PAYROLL', payrollId, {});
    return { ok: true };
  });
}
