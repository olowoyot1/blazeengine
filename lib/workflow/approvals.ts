import type { Role } from '../constants';
import { ForbiddenError, WorkflowError, audit, logEvent, many, notifyRoles, one, run, type Actor, type Ctx } from './core';
import type { Row } from '../db';

export type Step = { step: string; role: Role; seq: number };
type Entity = 'SALE' | 'EXPENSE';

/** Each approval round registers what happens when it completes or is rejected. */
export type RoundHandler = {
  entity: Entity;
  onComplete: (ctx: Ctx, approval: Row) => Promise<void>;
  onReject: (ctx: Ctx, approval: Row, comment: string) => Promise<void>;
  link: (entityId: string) => string;
  title: (ctx: Ctx, entityId: string) => Promise<string>;
  /**
   * Optional extra separation-of-duties check beyond "not the literal submitter of
   * this round" (that check always applies, below). Return a message to block the
   * decision, e.g. because this approver already signed off on the same entity at an
   * earlier, different stage of the process.
   */
  conflict?: (ctx: Ctx, approval: Row, actor: Actor) => Promise<string | null>;
};
const handlers = new Map<string, RoundHandler>();
export const registerRound = (round: string, h: RoundHandler) => handlers.set(round, h);

/** Creates the steps of a round and notifies the approvers who can act first. */
export async function openRound(
  ctx: Ctx, entity: Entity, entityId: string, round: string, roundNo: number, steps: Step[],
) {
  for (const s of steps) {
    await ctx.tx.query(
      `insert into approvals(entity_type,entity_id,round,round_no,seq,step,approver_role,submitted_by)
       values($1,$2,$3,$4,$5,$6,$7,$8)`,
      [entity, entityId, round, roundNo, s.seq, s.step, s.role, ctx.actor.id],
    );
  }
  const first = Math.min(...steps.map(s => s.seq));
  const h = handlers.get(round)!;
  await notifyRoles(ctx, steps.filter(s => s.seq === first).map(s => s.role), {
    title: `Approval needed: ${steps.find(s => s.seq === first)!.step}`,
    message: await h.title(ctx, entityId),
    link: '/approvals',
  });
}

/** An approval is actionable when no earlier step of the same round is still pending. */
export const ACTIVE_APPROVAL_SQL = `a.status='PENDING' and not exists (
  select 1 from approvals p where p.entity_type=a.entity_type and p.entity_id=a.entity_id
    and p.round=a.round and p.round_no=a.round_no and p.status='PENDING' and p.seq<a.seq)`;

export async function cancelPending(ctx: Ctx, entity: Entity, entityId: string, round?: string) {
  await ctx.tx.query(
    `update approvals set status='CANCELLED' where entity_type=$1 and entity_id=$2 and status='PENDING'
       and ($3::text is null or round=$3)`,
    [entity, entityId, round ?? null],
  );
}

export async function decide(actor: Actor, approvalId: string, decision: 'APPROVED' | 'REJECTED', comment?: string | null) {
  return run(actor, async ctx => {
    const first = await one(ctx, `select * from approvals where id=$1`, [approvalId]);
    if (!first) throw new WorkflowError('Approval step not found');
    const h = handlers.get(first.round);
    if (!h) throw new WorkflowError('This approval belongs to a retired workflow and cannot be actioned');

    // Serialise all decisions on the same entity so parallel approvers cannot race.
    await one(ctx, h.entity === 'SALE' ? `select id from sales where id=$1 for update` : `select id from expenses where id=$1 for update`, [first.entity_id]);
    const a = (await one(ctx, `select * from approvals where id=$1`, [approvalId]))!;

    if (a.status !== 'PENDING') throw new WorkflowError('This step has already been actioned');
    if (a.approver_role !== actor.role) throw new ForbiddenError(`Only ${a.approver_role.replace(/_/g, ' ')} can action this step`);
    if (a.submitted_by && a.submitted_by === actor.id) throw new ForbiddenError('You cannot approve an item you submitted (separation of duties)');
    if (h.conflict) {
      const problem = await h.conflict(ctx, a, actor);
      if (problem) throw new ForbiddenError(problem);
    }
    const blocked = await one(ctx,
      `select 1 from approvals where entity_type=$1 and entity_id=$2 and round=$3 and round_no=$4 and status='PENDING' and seq<$5 limit 1`,
      [a.entity_type, a.entity_id, a.round, a.round_no, a.seq]);
    if (blocked) throw new WorkflowError('An earlier approval step must be completed first');
    const note = (comment ?? '').trim();
    if (decision === 'REJECTED' && note.length < 3) throw new WorkflowError('A reason is required when rejecting');

    await ctx.tx.query(
      `update approvals set status=$2, comment=$3, acted_by=$4, acted_at=now() where id=$1`,
      [approvalId, decision, note || null, actor.id]);
    await audit(ctx, decision === 'APPROVED' ? 'APPROVAL_APPROVED' : 'APPROVAL_REJECTED', a.entity_type, a.entity_id, { step: a.step, round: a.round, comment: note || null });
    await logEvent(ctx, a.entity_type, a.entity_id, 'APPROVAL', `${decision === 'APPROVED' ? 'Approved' : 'Rejected'}: ${a.step}`, null, null, note || null);

    if (decision === 'REJECTED') {
      await cancelPending(ctx, a.entity_type, a.entity_id, a.round);
      await h.onReject(ctx, a, note);
      return { done: true, outcome: 'REJECTED' as const };
    }
    const remaining = await many(ctx,
      `select seq, approver_role, step from approvals where entity_type=$1 and entity_id=$2 and round=$3 and round_no=$4 and status='PENDING'`,
      [a.entity_type, a.entity_id, a.round, a.round_no]);
    if (remaining.length === 0) {
      await h.onComplete(ctx, a);
      return { done: true, outcome: 'COMPLETED' as const };
    }
    const nextSeq = Math.min(...remaining.map(r => r.seq));
    if (nextSeq > a.seq) {
      const next = remaining.filter(r => r.seq === nextSeq);
      await notifyRoles(ctx, next.map(r => r.approver_role), {
        title: `Approval needed: ${next[0].step}`, message: await h.title(ctx, a.entity_id), link: '/approvals',
      });
    }
    return { done: false, outcome: 'APPROVED' as const };
  });
}
