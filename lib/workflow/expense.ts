/**
 * VENDOR NEGOTIATION → EXPENSE → PAYMENT → RECEIPT  (rows 13–18 of the sheet)
 *
 *  Site Manager uploads vendor negotiation ──▶ NEGOTIATION_SUBMITTED
 *      [NEG_REVIEW]  Operations Manager ‖ HR approve  (Accounts informed)
 *  ──▶ NEGOTIATION_APPROVED         Accounts gets e-mail notification
 *  Accountant enters sales expense ──▶ EXPENSE_ENTERED
 *      [EXP_REVIEW]  Operations Manager ‖ HR first, then CEO
 *  ──▶ EXPENSE_APPROVED             Finance Operations notified
 *  Finance Ops uploads to bank + screenshot to portal ──▶ PAYMENT_PROOF_UPLOADED
 *      [PAY_REVIEW]  Operations Manager ‖ HR first, then CEO
 *  ──▶ PAYMENT_APPROVED             internet-banking alert recorded ──▶ PAID (all team notified)
 *  Accountant generates receipt from internet banking, shares with Ops, HR, Site Manager ──▶ RECEIPT_ISSUED
 */
import type { Role } from '../constants';
import { EXPENSE_STATUS_LABEL } from '../constants';
import {
  ForbiddenError, WorkflowError, assertFreshEvidence, assertOwnedUpload, audit, logEvent, money, notifyRoles, notifyUsers, one, parseFields, run,
  type Actor, type Ctx, type Field, type Parsed,
} from './core';
import type { Row } from '../db';
import { openRound, registerRound, type Step } from './approvals';

const OPS_HR_THEN_CEO: Step[] = [
  { step: 'Operations Manager review', role: 'OPERATIONS_MANAGER', seq: 1 },
  { step: 'HR review', role: 'HR', seq: 1 },
  { step: 'CEO approval', role: 'CEO', seq: 2 },
];
const NEG_STEPS: Step[] = [
  { step: 'Operations Manager approval', role: 'OPERATIONS_MANAGER', seq: 1 },
  { step: 'HR approval', role: 'HR', seq: 1 },
];
const TEAM: Role[] = ['CEO', 'HR', 'OPERATIONS_MANAGER', 'OPERATIONS', 'SITE_MANAGER', 'ACCOUNTANT', 'FINANCE_OPERATIONS'];
const label = (e: Row) => `${e.vendor || 'Vendor'} — ${e.category}${e.amount ?? e.negotiated_amount ? ` (${money(e.amount ?? e.negotiated_amount)})` : ''}`;
const link = (e: Row | string) => `/expenses/${typeof e === 'string' ? e : e.id}`;

export type ExpenseAction = {
  key: string; label: string; help: string;
  roles: Role[]; from: string[]; to: string;
  fields: Field[]; danger?: boolean;
  apply: (ctx: Ctx, e: Row, i: Parsed) => Promise<string | void>;
};

export const EXPENSE_ACTIONS: ExpenseAction[] = [
  {
    key: 'enter_expense', label: 'Enter sales expense',
    help: 'Enter the expense from the approved negotiation. A higher amount than negotiated needs a variance reason. Triggers Ops Manager & HR review, then CEO.',
    roles: ['ACCOUNTANT'], from: ['NEGOTIATION_APPROVED'], to: 'EXPENSE_ENTERED',
    fields: [
      { name: 'amount', label: 'Expense amount (₦)', type: 'number', required: true, min: 1 },
      { name: 'source_document_url', label: 'Expense source document', type: 'file', uploadPurpose: 'expense_source_document' },
      { name: 'variance_reason', label: 'Variance reason (if above negotiated amount)', type: 'textarea' },
    ],
    async apply(ctx, e, i) {
      if (e.negotiated_amount != null) {
        const ceiling = Number(e.negotiated_amount) * 1.5;
        if (Number(i.amount) > ceiling)
          throw new WorkflowError(`Amount is more than 50% above the negotiated ${money(e.negotiated_amount)} — this needs a fresh negotiation, not a variance reason`);
        if (Number(i.amount) > Number(e.negotiated_amount) && !i.variance_reason)
          throw new WorkflowError(`Amount exceeds the negotiated ${money(e.negotiated_amount)} – give a variance reason`);
      }
      const round = Number(e.round_no) + 1;
      if (i.source_document_url) {
        await assertOwnedUpload(ctx, i.source_document_url, 'Expense source document', 'expense_source_document');
        await assertFreshEvidence(ctx, i.source_document_url, 'expense source document');
        const m = String(i.source_document_url).match(/^\/api\/files\/([0-9a-f-]{36})$/i)!;
        await ctx.tx.query(`insert into expense_documents(expense_id,document_type,document_name,uploaded_file_id,uploaded_by) values($1,'SOURCE_DOCUMENT','Expense source document',$2::uuid,$3)`, [e.id, m[1], ctx.actor.id]);
      }
      await ctx.tx.query(`update expenses set amount=$2, round_no=$3 where id=$1`, [e.id, i.amount, round]);
      await openRound(ctx, 'EXPENSE', e.id, 'EXP_REVIEW', round, OPS_HR_THEN_CEO);
      return `${money(i.amount)}${i.variance_reason ? ` · variance: ${i.variance_reason}` : ''}`;
    },
  },
  {
    key: 'disburse_and_upload_proof', label: 'Disburse cash & upload payment advice',
    help: 'This expense has full CEO approval. Finance & Accounts can now disburse the cash and upload the payment advice or bank receipt downloaded from the bank. No further approval is required.',
    roles: ['FINANCE_OPERATIONS', 'ACCOUNTANT'], from: ['FULLY_APPROVED'], to: 'PAID',
    fields: [
      { name: 'payment_advice_url', label: 'Payment advice / bank receipt', type: 'file', required: true, uploadPurpose: 'finance_payment_advice' },
      { name: 'bank_reference', label: 'Bank transfer reference', type: 'text', required: true },
      { name: 'bank_alert_ref', label: 'Bank debit alert reference (optional)', type: 'text' },
    ],
    async apply(ctx, e, i) {
      await assertOwnedUpload(ctx, i.payment_advice_url, 'Payment advice / bank receipt', 'finance_payment_advice');
      await assertFreshEvidence(ctx, i.payment_advice_url, 'payment advice / bank receipt');
      const m = String(i.payment_advice_url).match(/^\/api\/files\/([0-9a-f-]{36})$/i)!;
      await ctx.tx.query(`update expenses set bank_proof_url=$2, bank_reference=$3, bank_alert_ref=$4, paid_at=now() where id=$1`, [e.id, i.payment_advice_url, i.bank_reference, i.bank_alert_ref ?? null]);
      await ctx.tx.query(`insert into expense_payment_documents(expense_id,document_type,document_name,uploaded_file_id,uploaded_by,bank_reference) values($1,'PAYMENT_ADVICE','Payment advice / bank receipt',$2::uuid,$3,$4)`, [e.id, m[1], ctx.actor.id, i.bank_reference]);
      const n = { title: 'Expense disbursed & payment advice uploaded', message: `${label(e)} — bank ref ${i.bank_reference}.`, link: link(e) };
      await notifyRoles(ctx, TEAM, n);
      await notifyUsers(ctx, [e.submitted_by], n);
      await notifyRoles(ctx, ['ACCOUNTANT'], { title: 'Generate receipt', message: `${label(e)} — generate the receipt from internet banking.`, link: link(e) });
      return `Bank ref ${i.bank_reference} · alert ${i.bank_alert_ref}`;
    },
  },
  {
    key: 'record_bank_alert', label: 'Record internet-banking alert',
    help: 'Record the bank debit alert. Marks the expense paid and notifies all team members.',
    roles: ['FINANCE_OPERATIONS', 'ACCOUNTANT'], from: ['PAYMENT_APPROVED'], to: 'PAID',
    fields: [{ name: 'bank_alert_ref', label: 'Bank alert reference', type: 'text', required: true }],
    async apply(ctx, e, i) {
      await ctx.tx.query(`update expenses set bank_alert_ref=$2, paid_at=now() where id=$1`, [e.id, i.bank_alert_ref]);
      await notifyRoles(ctx, TEAM, { title: 'Payment has been made', message: label(e), link: link(e) });
      await notifyUsers(ctx, [e.submitted_by], { title: 'Payment has been made', message: label(e), link: link(e) });
      await notifyRoles(ctx, ['ACCOUNTANT'], { title: 'Generate receipt', message: `${label(e)} — generate the receipt from internet banking.`, link: link(e) });
      return `Alert ${i.bank_alert_ref}`;
    },
  },
  {
    key: 'revise_negotiation', label: 'Revise & resubmit negotiation',
    help: 'This negotiation was rejected. Correct the terms and resubmit — a new Ops Manager & HR review round opens.',
    roles: ['SITE_MANAGER'], from: ['REJECTED'], to: 'NEGOTIATION_SUBMITTED',
    fields: [
      { name: 'category', label: 'Category', type: 'text', required: true },
      { name: 'vendor', label: 'Vendor', type: 'text', required: true },
      { name: 'negotiated_amount', label: 'Negotiated amount (₦)', type: 'number', required: true, min: 1 },
      { name: 'negotiation_notes', label: 'What changed', type: 'textarea', required: true },
      { name: 'negotiation_url', label: 'Supporting document (optional)', type: 'file' },
    ],
    async apply(ctx, e, i) {
      if (e.origin !== 'NEGOTIATION') throw new WorkflowError('Only a negotiated expense can be revised — enter a new direct expense instead');
      const round = Number(e.round_no) + 1;
      await ctx.tx.query(
        `update expenses set category=$2, vendor=$3, negotiated_amount=$4, negotiation_notes=$5, negotiation_url=$6, amount=null, round_no=$7, rejected_reason=null where id=$1`,
        [e.id, i.category, i.vendor, i.negotiated_amount, i.negotiation_notes, i.negotiation_url, round]);
      await openRound(ctx, 'EXPENSE', e.id, 'NEG_REVIEW', round, NEG_STEPS);
      await notifyRoles(ctx, ['ACCOUNTANT'], { title: 'Vendor negotiation resubmitted', message: label(e), link: link(e) });
      return String(i.negotiation_notes);
    },
  },
  {
    key: 'issue_receipt', label: 'Generate receipt & share',
    help: 'Generate the receipt from internet banking and share it with Operations, HR and the Site Manager.',
    roles: ['ACCOUNTANT'], from: ['PAID'], to: 'RECEIPT_ISSUED',
    fields: [
      { name: 'receipt_no', label: 'Receipt number', type: 'text', required: true },
      { name: 'receipt_url', label: 'Receipt document', type: 'file', required: true },
    ],
    async apply(ctx, e, i) {
      await assertFreshEvidence(ctx, i.receipt_url, 'receipt');
      await ctx.tx.query(`update expenses set receipt_no=$2, receipt_url=$3 where id=$1`, [e.id, i.receipt_no, i.receipt_url]);
      const n = { title: 'Receipt issued', message: `${label(e)} — receipt ${i.receipt_no}`, link: link(e) };
      await notifyRoles(ctx, ['OPERATIONS_MANAGER', 'OPERATIONS', 'HR', 'SITE_MANAGER'], n);
      await notifyUsers(ctx, [e.submitted_by], n);
      return `Receipt ${i.receipt_no}`;
    },
  },
];

export const getExpenseAction = (k: string) => EXPENSE_ACTIONS.find(a => a.key === k);
export const availableExpenseActions = (e: { status: string }, user: { role: Role }) =>
  EXPENSE_ACTIONS.filter(a => (user.role === 'SUPER_ADMIN' || a.roles.includes(user.role)) && a.from.includes(e.status));

export async function performExpenseAction(actor: Actor, id: string, key: string, input: Record<string, unknown>) {
  const a = getExpenseAction(key);
  if (!a) throw new WorkflowError('Unknown action');
  if (actor.role !== 'SUPER_ADMIN' && !a.roles.includes(actor.role)) throw new ForbiddenError('Your role is not permitted to do this');
  return run(actor, async ctx => {
    const e = await one(ctx, `select * from expenses where id=$1 for update`, [id]);
    if (!e) throw new WorkflowError('Expense not found');
    if (!a.from.includes(e.status)) throw new WorkflowError(`Not available while the expense is "${EXPENSE_STATUS_LABEL[e.status] ?? e.status}"`);
    const parsed = parseFields(a.fields, input);
    const notes = (await a.apply(ctx, e, parsed)) || null;
    await ctx.tx.query(`update expenses set status=$2, updated_at=now() where id=$1`, [id, a.to]);
    await logEvent(ctx, 'EXPENSE', id, 'EXPENSE', a.label, e.status, a.to, notes);
    await audit(ctx, `EXPENSE_${a.key.toUpperCase()}`, 'EXPENSE', id, { from: e.status, to: a.to });
    return { status: a.to };
  });
}

/** Site Manager uploads negotiation details with a vendor. */
export async function createNegotiation(actor: Actor, input: Record<string, unknown>) {
  if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'SITE_MANAGER') throw new ForbiddenError('Only the Site Manager uploads vendor negotiations');
  const p = parseFields([
    { name: 'sale_id', label: 'Related sale', type: 'text' },
    { name: 'category', label: 'Category', type: 'text', required: true },
    { name: 'vendor', label: 'Vendor', type: 'text', required: true },
    { name: 'negotiated_amount', label: 'Negotiated amount (₦)', type: 'number', required: true, min: 1 },
    { name: 'negotiation_notes', label: 'Negotiation details', type: 'textarea', required: true },
    { name: 'negotiation_url', label: 'Supporting document (optional)', type: 'file' },
  ], input);
  return run(actor, async ctx => {
    if (p.sale_id) {
      const s = await one(ctx, `select id from sales where id=$1`, [p.sale_id]);
      if (!s) throw new WorkflowError('Related sale not found');
    }
    const e = (await one(ctx,
      `insert into expenses(sale_id,origin,category,vendor,negotiated_amount,negotiation_notes,negotiation_url,status,submitted_by)
       values($1,'NEGOTIATION',$2,$3,$4,$5,$6,'NEGOTIATION_SUBMITTED',$7) returning *`,
      [p.sale_id, p.category, p.vendor, p.negotiated_amount, p.negotiation_notes, p.negotiation_url, actor.id]))!;
    await logEvent(ctx, 'EXPENSE', e.id, 'SITE_MANAGEMENT', 'Vendor negotiation uploaded', null, e.status, p.negotiation_notes as string);
    await audit(ctx, 'NEGOTIATION_SUBMITTED', 'EXPENSE', e.id, { vendor: p.vendor });
    await openRound(ctx, 'EXPENSE', e.id, 'NEG_REVIEW', 1, NEG_STEPS);
    await notifyRoles(ctx, ['ACCOUNTANT'], { title: 'Vendor negotiation submitted', message: `${label(e)} — awaiting Ops Manager & HR approval.`, link: link(e) });
    return e.id as string;
  });
}

/** Accountant enters a direct (non-negotiated) expense, e.g. office/marketing costs. Same approval path. */
export async function createDirectExpense(actor: Actor, input: Record<string, unknown>) {
  if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'ACCOUNTANT') throw new ForbiddenError('Only Accounts can enter direct expenses');
  const p = parseFields([
    { name: 'sale_id', label: 'Related sale', type: 'text' },
    { name: 'category', label: 'Category', type: 'text', required: true },
    { name: 'vendor', label: 'Vendor', type: 'text', required: true },
    { name: 'amount', label: 'Amount (₦)', type: 'number', required: true, min: 1 },
    { name: 'description', label: 'Description', type: 'textarea', required: true },
    { name: 'source_document_url', label: 'Expense source document', type: 'file', uploadPurpose: 'expense_source_document' },
  ], input);
  return run(actor, async ctx => {
    if (p.source_document_url) {
      await assertOwnedUpload(ctx, p.source_document_url, 'Expense source document', 'expense_source_document');
      await assertFreshEvidence(ctx, p.source_document_url, 'expense source document');
    }
    const e = (await one(ctx,
      `insert into expenses(sale_id,origin,category,vendor,amount,description,status,round_no,submitted_by)
       values($1,'DIRECT',$2,$3,$4,$5,'EXPENSE_ENTERED',1,$6) returning *`,
      [p.sale_id, p.category, p.vendor, p.amount, p.description, actor.id]))!;
    if (p.source_document_url) {
      const m = String(p.source_document_url).match(/^\/api\/files\/([0-9a-f-]{36})$/i)!;
      await ctx.tx.query(`insert into expense_documents(expense_id,document_type,document_name,uploaded_file_id,uploaded_by) values($1,'SOURCE_DOCUMENT','Expense source document',$2::uuid,$3)`, [e.id, m[1], actor.id]);
    }
    await logEvent(ctx, 'EXPENSE', e.id, 'ACCOUNTS', 'Direct expense entered', null, e.status, `${p.description}${p.source_document_url ? ' · source document attached' : ''}`);
    await audit(ctx, 'EXPENSE_DIRECT_ENTERED', 'EXPENSE', e.id, {});
    await openRound(ctx, 'EXPENSE', e.id, 'EXP_REVIEW', 1, OPS_HR_THEN_CEO);
    return e.id as string;
  });
}

const common = {
  entity: 'EXPENSE' as const,
  link,
  async title(ctx: Ctx, id: string) { const e = await one(ctx, `select * from expenses where id=$1`, [id]); return e ? label(e) : ''; },
};

registerRound('NEG_REVIEW', {
  ...common,
  async onComplete(ctx, a) {
    const e = (await one(ctx, `update expenses set status='NEGOTIATION_APPROVED', updated_at=now() where id=$1 returning *`, [a.entity_id]))!;
    await logEvent(ctx, 'EXPENSE', e.id, 'APPROVAL', 'Negotiation approved', 'NEGOTIATION_SUBMITTED', 'NEGOTIATION_APPROVED', null);
    await notifyRoles(ctx, ['ACCOUNTANT'], { title: 'Negotiation approved – enter sales expense', message: label(e), link: link(e) });
    await notifyUsers(ctx, [e.submitted_by], { title: 'Vendor negotiation approved', message: label(e), link: link(e) });
  },
  async onReject(ctx, a, comment) {
    const e = (await one(ctx, `update expenses set status='REJECTED', rejected_reason=$2, updated_at=now() where id=$1 returning *`, [a.entity_id, `${a.step}: ${comment}`]))!;
    await logEvent(ctx, 'EXPENSE', e.id, 'APPROVAL', 'Negotiation rejected', 'NEGOTIATION_SUBMITTED', 'REJECTED', comment);
    await notifyUsers(ctx, [e.submitted_by], { title: 'Vendor negotiation rejected', message: `${label(e)}: ${comment}`, link: link(e) });
    await notifyRoles(ctx, ['ACCOUNTANT'], { title: 'Vendor negotiation rejected', message: label(e), link: link(e) });
  },
});

registerRound('EXP_REVIEW', {
  ...common,
  async onComplete(ctx, a) {
    const e = (await one(ctx, `update expenses set status='FULLY_APPROVED', updated_at=now() where id=$1 returning *`, [a.entity_id]))!;
    await logEvent(ctx, 'EXPENSE', e.id, 'APPROVAL', 'Expense fully approved', 'EXPENSE_ENTERED', 'FULLY_APPROVED', null);
    const n = { title: 'Expense fully approved – Finance & Accounts action required', message: `${label(e)}. Disburse cash and upload the payment evidence.`, link: link(e) };
    await notifyRoles(ctx, ['FINANCE_OPERATIONS', 'ACCOUNTANT'], n);
    await notifyUsers(ctx, [e.submitted_by], n);
  },
  async onReject(ctx, a, comment) {
    // A negotiated expense recovers to NEGOTIATION_APPROVED so the Accountant can
    // correct and re-enter it, instead of the negotiation work being thrown away.
    // A direct expense (no prior negotiation stage to fall back to) ends here.
    const before = await one(ctx, `select origin from expenses where id=$1`, [a.entity_id]);
    const recoverable = before?.origin === 'NEGOTIATION';
    const to = recoverable ? 'NEGOTIATION_APPROVED' : 'REJECTED';
    const e = (await one(ctx, `update expenses set status=$2, rejected_reason=$3, amount=null, updated_at=now() where id=$1 returning *`, [a.entity_id, to, `${a.step}: ${comment}`]))!;
    await logEvent(ctx, 'EXPENSE', e.id, 'APPROVAL', 'Expense rejected', 'EXPENSE_ENTERED', to, comment);
    await notifyUsers(ctx, [e.submitted_by], { title: 'Expense rejected', message: `${label(e)}: ${comment}`, link: link(e) });
    await notifyRoles(ctx, recoverable ? ['ACCOUNTANT'] : ['ACCOUNTANT', 'SITE_MANAGER'], {
      title: recoverable ? 'Expense rejected – correct and re-enter' : 'Expense rejected', message: `${label(e)}: ${comment}`, link: link(e),
    });
  },
});

registerRound('PAY_REVIEW', {
  ...common,
  async onComplete(ctx, a) {
    const e = (await one(ctx, `update expenses set status='PAYMENT_APPROVED', updated_at=now() where id=$1 returning *`, [a.entity_id]))!;
    await logEvent(ctx, 'EXPENSE', e.id, 'APPROVAL', 'Payment approved', 'PAYMENT_PROOF_UPLOADED', 'PAYMENT_APPROVED', null);
    await notifyRoles(ctx, ['FINANCE_OPERATIONS', 'ACCOUNTANT'], { title: 'Payment approved – record bank alert', message: label(e), link: link(e) });
  },
  async onReject(ctx, a, comment) {
    // Payment evidence rejected: back to Finance Operations to correct and re-upload.
    const e = (await one(ctx, `update expenses set status='EXPENSE_APPROVED', rejected_reason=$2, updated_at=now() where id=$1 returning *`, [a.entity_id, `${a.step}: ${comment}`]))!;
    await logEvent(ctx, 'EXPENSE', e.id, 'APPROVAL', 'Payment proof rejected', 'PAYMENT_PROOF_UPLOADED', 'EXPENSE_APPROVED', comment);
    await notifyRoles(ctx, ['FINANCE_OPERATIONS'], { title: 'Payment proof rejected – re-upload', message: `${label(e)}: ${comment}`, link: link(e) });
  },
});
