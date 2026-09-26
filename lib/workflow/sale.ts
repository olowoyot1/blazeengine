/**
 * SALE LIFECYCLE  (rows 1–12 of the process sheet)
 *
 *  DRAFT ──submit_payment_proof──▶ PAYMENT_PROOF_SUBMITTED        Sales team uploads payment proof
 *  ──enter_invoice──▶ INVOICE_ENTERED                             Accountant enters invoice → back to Sales Mgr + Sales Exec
 *  ──approve_sale──▶ SALES_APPROVED                               Sales Manager approves → Operations receives approved sale
 *  ──create_contract──▶ CONTRACT_PREPARED                         Operations: contract + deed → back to Accounts
 *  ──send_sales_documents──▶ ACCOUNT_DOCS_SENT                    Accountant: sales order, receipt, invoice sent
 *  ──open_ops_portal──▶ SITE_NOTIFIED                             Operations opens portal → Site Manager notified, ready for allocation (30-day clock)
 *  ──upload_allocation_docs──▶ OPS_DOCS_UPLOADED                  Operations: deed of assignment + survey (within 30 days)
 *  ──final_audit──▶ IN_APPROVAL                                   Site Manager final audit, triggers all parties
 *      Sales Mgr → Operations Mgr → HR (internal audit) → CEO     approve one by one, then HR, then CEO
 *  ──(chain complete)──▶ FULLY_APPROVED                           (any rejection ⇒ RETURNED)
 *  ──start_pre_allocation──▶ PRE_ALLOCATION                       Soft copy to client, site survey, logistics/feeding
 *  ──set_allocation_date──▶ ALLOCATION_SCHEDULED                  Allocation date communicated (within 30 days of approval)
 *  ──confirm_allocation──▶ ALLOCATED
 */
import type { Role } from '../constants';
import { ALLOCATION_WINDOW_DAYS, SALE_STATUS_LABEL } from '../constants';
import {
  ForbiddenError, WorkflowError, assertFreshEvidence, audit, d10, logEvent, mailClient, many, money, notifyRoles, notifyUsers, one,
  parseFields, run, type Actor, type Ctx, type Field, type Parsed,
} from './core';
import type { Row } from '../db';
import { cancelPending, openRound, registerRound, type Step } from './approvals';

const OPS: Role[] = ['OPERATIONS', 'OPERATIONS_MANAGER'];
const saleLabel = (s: Row) => `${s.client_name} — ${s.plot_reference || s.property_name || 'sale'}`;
const saleLink = (s: Row | string) => `/sales/${typeof s === 'string' ? s : s.id}`;

export type SaleAction = {
  key: string; label: string; help: string;
  roles: Role[]; from: string[]; to?: string;
  fields: Field[];
  /** SALES executives may only act on sales they created. */
  ownOnly?: boolean;
  danger?: boolean;
  apply: (ctx: Ctx, sale: Row, input: Parsed) => Promise<string | void>;
};

async function addDoc(ctx: Ctx, saleId: string, type: string, url: unknown, name?: string) {
  if (!url) return;
  await ctx.tx.query(
    `insert into sale_documents(sale_id,document_type,document_name,document_url,uploaded_by) values($1,$2,$3,$4,$5)`,
    [saleId, type, name ?? type.replace(/_/g, ' ').toLowerCase(), String(url), ctx.actor.id]);
}
async function siteRecord(ctx: Ctx, saleId: string, type: string, details: object) {
  await ctx.tx.query(`insert into site_records(sale_id,record_type,details,created_by) values($1,$2,$3,$4)`,
    [saleId, type, JSON.stringify(details), ctx.actor.id]);
}
async function openTask(ctx: Ctx, saleId: string, type: string, dueDays?: number, notes?: string) {
  await ctx.tx.query(
    `insert into operations(sale_id,task_type,due_date,notes) values($1,$2,${dueDays == null ? 'null' : `current_date + ${Number(dueDays)}`},$3)`,
    [saleId, type, notes ?? null]);
}
async function closeTasks(ctx: Ctx, saleId: string, type: string) {
  await ctx.tx.query(`update operations set status='DONE', completed_at=now() where sale_id=$1 and task_type=$2 and status='PENDING'`, [saleId, type]);
}
const daysFrom = (d: Date | string, n: number) => new Date(new Date(d).getTime() + n * 86400000);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export const SALE_CHAIN: Step[] = [
  { step: 'Sales Manager approval', role: 'SALES_MANAGER', seq: 1 },
  { step: 'Operations Manager approval', role: 'OPERATIONS_MANAGER', seq: 2 },
  { step: 'HR internal audit', role: 'HR', seq: 3 },
  { step: 'CEO final approval', role: 'CEO', seq: 4 },
];
const REQUIRED_DOCS = ['PAYMENT_PROOF', 'CONTRACT', 'DEED', 'DEED_OF_ASSIGNMENT', 'SURVEY_PLAN'];
const ALL_AFTER_APPROVAL = ['SITE_NOTIFIED', 'OPS_DOCS_UPLOADED', 'IN_APPROVAL', 'RETURNED', 'FULLY_APPROVED', 'PRE_ALLOCATION', 'ALLOCATION_SCHEDULED'];

const reason: Field = { name: 'reason', label: 'Reason', type: 'textarea', required: true };

export const SALE_ACTIONS: SaleAction[] = [
  {
    key: 'submit_payment_proof', label: 'Upload payment proof', ownOnly: true,
    help: 'Client has paid. Attach the payment proof link and reference – Accounts is notified.',
    roles: ['SALES', 'SALES_MANAGER'], from: ['DRAFT'], to: 'PAYMENT_PROOF_SUBMITTED',
    fields: [
      { name: 'proof_url', label: 'Payment proof', type: 'file', required: true },
      { name: 'payment_reference', label: 'Payment reference', type: 'text', required: true },
      { name: 'amount_paid', label: 'Amount paid (₦)', type: 'number', min: 1 },
    ],
    async apply(ctx, s, i) {
      await assertFreshEvidence(ctx, i.proof_url, 'payment proof');
      await addDoc(ctx, s.id, 'PAYMENT_PROOF', i.proof_url, 'Payment proof');
      await ctx.tx.query(`update sales set payment_status='PROOF_SUBMITTED', payment_reference=$2 where id=$1`, [s.id, i.payment_reference]);
      await notifyRoles(ctx, ['ACCOUNTANT'], { title: 'Payment proof uploaded', message: `${saleLabel(s)} — reference ${i.payment_reference}. Enter the invoice.`, link: saleLink(s) });
      return `Payment ref ${i.payment_reference}${i.amount_paid ? ` (${money(i.amount_paid)})` : ''}`;
    },
  },
  {
    key: 'return_to_sales', label: 'Reject payment proof', danger: true,
    help: 'Payment proof cannot be verified – send back to Sales.',
    roles: ['ACCOUNTANT'], from: ['PAYMENT_PROOF_SUBMITTED'], to: 'DRAFT', fields: [reason],
    async apply(ctx, s, i) {
      await ctx.tx.query(`update sales set payment_status='UNPAID' where id=$1`, [s.id]);
      await notifyUsers(ctx, [s.created_by], { title: 'Payment proof rejected', message: `${saleLabel(s)}: ${i.reason}`, link: saleLink(s) });
      await notifyRoles(ctx, ['SALES_MANAGER'], { title: 'Payment proof rejected', message: `${saleLabel(s)}: ${i.reason}`, link: saleLink(s) });
      return String(i.reason);
    },
  },
  {
    key: 'enter_invoice', label: 'Enter invoice',
    help: 'Verify the payment and enter the invoice. If the amount differs from the original quote by more than 2%, a reason is required. On submission the sale goes back to the Sales Manager and Sales Executive.',
    roles: ['ACCOUNTANT'], from: ['PAYMENT_PROOF_SUBMITTED'], to: 'INVOICE_ENTERED',
    fields: [
      { name: 'invoice_number', label: 'Invoice number', type: 'text', required: true },
      { name: 'invoice_amount', label: 'Invoice amount (₦)', type: 'number', required: true, min: 1 },
      { name: 'invoice_url', label: 'Invoice document (optional)', type: 'file' },
      { name: 'variance_reason', label: 'Reason for amount differing from the original quote (if applicable)', type: 'textarea' },
    ],
    async apply(ctx, s, i) {
      const dup = await one(ctx, `select 1 from sales where invoice_number=$1 and id<>$2 and status<>'CANCELLED' limit 1`, [i.invoice_number, s.id]);
      if (dup) throw new WorkflowError(`Invoice number ${i.invoice_number} is already used on another active sale`);
      const quoted = Number(s.quoted_amount ?? s.amount);
      const varianceRatio = quoted > 0 ? Math.abs(Number(i.invoice_amount) - quoted) / quoted : 0;
      if (varianceRatio > 0.02 && !i.variance_reason)
        throw new WorkflowError(`Invoice amount differs from the original quote (${money(quoted)}) by ${(varianceRatio * 100).toFixed(1)}% — a reason is required`);
      await ctx.tx.query(`update sales set invoice_number=$2, amount=$3, payment_status='VERIFIED', invoice_variance_reason=$4 where id=$1`,
        [s.id, i.invoice_number, i.invoice_amount, i.variance_reason ?? null]);
      await addDoc(ctx, s.id, 'INVOICE', i.invoice_url, `Invoice ${i.invoice_number}`);
      const flag = varianceRatio > 0.02 ? ` ⚠ differs from the original quote of ${money(quoted)} (${i.variance_reason})` : '';
      const n = { title: 'Invoice entered – sale awaiting approval', message: `${saleLabel(s)} — ${money(i.invoice_amount)} (invoice ${i.invoice_number}).${flag}`, link: saleLink(s) };
      await notifyRoles(ctx, ['SALES_MANAGER'], n);
      await notifyUsers(ctx, [s.created_by], n);
      return `Invoice ${i.invoice_number} · ${money(i.invoice_amount)}${flag}`;
    },
  },
  {
    key: 'reject_sale', label: 'Send back to Accounts', danger: true,
    help: 'Invoice or payment details are wrong – return to the Accountant.',
    roles: ['SALES_MANAGER'], from: ['INVOICE_ENTERED'], to: 'PAYMENT_PROOF_SUBMITTED', fields: [reason],
    async apply(ctx, s, i) {
      await ctx.tx.query(`update sales set payment_status='PROOF_SUBMITTED' where id=$1`, [s.id]);
      await notifyRoles(ctx, ['ACCOUNTANT'], { title: 'Sale returned to Accounts', message: `${saleLabel(s)}: ${i.reason}`, link: saleLink(s) });
      await notifyUsers(ctx, [s.created_by], { title: 'Sale returned to Accounts', message: `${saleLabel(s)}: ${i.reason}`, link: saleLink(s) });
      return String(i.reason);
    },
  },
  {
    key: 'approve_sale', label: 'Approve sale',
    help: 'Sales Manager confirms the sale. Operations then receives the approved sale.',
    roles: ['SALES_MANAGER'], from: ['INVOICE_ENTERED'], to: 'SALES_APPROVED',
    fields: [{ name: 'note', label: 'Note (optional)', type: 'textarea' }],
    async apply(ctx, s) {
      // Recorded so the later "Sales Manager approval" step of the SALE_CHAIN can
      // require a *different* Sales Manager — one person shouldn't bless the same
      // sale twice under two different hats.
      await ctx.tx.query(`update sales set gate_approved_by=$2 where id=$1`, [s.id, ctx.actor.id]);
      await openTask(ctx, s.id, 'CONTRACT_DEED');
      const n = { title: 'Approved sale received', message: `${saleLabel(s)}. Create the contract and deed.`, link: saleLink(s) };
      await notifyRoles(ctx, OPS, n);
      await notifyUsers(ctx, [s.created_by], { ...n, title: 'Your sale was approved', message: `${saleLabel(s)} is with Operations.` });
    },
  },
  {
    key: 'create_contract', label: 'Create contract & deed',
    help: 'Operations prepares the contract and deed. On submission the sale goes back to Accounts.',
    roles: OPS, from: ['SALES_APPROVED'], to: 'CONTRACT_PREPARED',
    fields: [
      { name: 'contract_url', label: 'Contract document', type: 'file', required: true },
      { name: 'deed_url', label: 'Deed document', type: 'file', required: true },
    ],
    async apply(ctx, s, i) {
      await addDoc(ctx, s.id, 'CONTRACT', i.contract_url, 'Contract');
      await addDoc(ctx, s.id, 'DEED', i.deed_url, 'Deed');
      await closeTasks(ctx, s.id, 'CONTRACT_DEED');
      await notifyRoles(ctx, ['ACCOUNTANT'], { title: 'Contract & deed ready', message: `${saleLabel(s)}. Prepare and send the sales order, receipt and invoice.`, link: saleLink(s) });
    },
  },
  {
    key: 'send_sales_documents', label: 'Prepare & send sales documents',
    help: 'Prepare the sales order, sales receipt and sales invoice and send them. Operations is notified.',
    roles: ['ACCOUNTANT'], from: ['CONTRACT_PREPARED'], to: 'ACCOUNT_DOCS_SENT',
    fields: [
      { name: 'sales_order_no', label: 'Sales order no.', type: 'text', required: true },
      { name: 'sales_receipt_no', label: 'Sales receipt no.', type: 'text', required: true },
      { name: 'sales_invoice_no', label: 'Sales invoice no.', type: 'text', required: true },
      { name: 'documents_url', label: 'Documents bundle (optional)', type: 'file' },
    ],
    async apply(ctx, s, i) {
      await ctx.tx.query(`update sales set sales_order_no=$2, sales_receipt_no=$3, sales_invoice_no=$4 where id=$1`,
        [s.id, i.sales_order_no, i.sales_receipt_no, i.sales_invoice_no]);
      await addDoc(ctx, s.id, 'SALES_DOCUMENTS', i.documents_url, 'Sales order, receipt & invoice');
      await notifyRoles(ctx, OPS, { title: 'Sales documents sent', message: `${saleLabel(s)}. Open the operations portal for allocation.`, link: saleLink(s) });
      await notifyUsers(ctx, [s.created_by], { title: 'Sales documents sent to client', message: saleLabel(s), link: saleLink(s) });
      mailClient(ctx, s.client_email, 'Your Landblaze sales documents',
        `Dear ${s.client_name},\n\nYour sales order (${i.sales_order_no}), sales receipt (${i.sales_receipt_no}) and sales invoice (${i.sales_invoice_no}) have been issued.${i.documents_url ? `\n\nView: ${i.documents_url}` : ''}\n\nLandblaze`);
    },
  },
  {
    key: 'open_ops_portal', label: 'Open portal → notify Site Manager',
    help: `Marks the sale ready for allocation and notifies the Site Manager. Deed of assignment and survey are due within ${ALLOCATION_WINDOW_DAYS} days.`,
    roles: OPS, from: ['ACCOUNT_DOCS_SENT'], to: 'SITE_NOTIFIED',
    fields: [{ name: 'note', label: 'Note to Site Manager (optional)', type: 'textarea' }],
    async apply(ctx, s, i) {
      await ctx.tx.query(`update sales set ops_due_date = current_date + ${ALLOCATION_WINDOW_DAYS} where id=$1`, [s.id]);
      await openTask(ctx, s.id, 'ALLOCATION_DOCS', ALLOCATION_WINDOW_DAYS, 'Deed of assignment + survey plan');
      await notifyRoles(ctx, ['SITE_MANAGER'], { title: 'Sale ready for allocation', message: `${saleLabel(s)}.${i.note ? ` ${i.note}` : ''}`, link: saleLink(s) });
    },
  },
  {
    key: 'upload_allocation_docs', label: 'Upload deed of assignment & survey',
    help: `Upload both documents to the portal (due ${ALLOCATION_WINDOW_DAYS} days after the portal was opened). The Site Manager is notified.`,
    roles: OPS, from: ['SITE_NOTIFIED', 'RETURNED'], to: 'OPS_DOCS_UPLOADED',
    fields: [
      { name: 'deed_of_assignment_url', label: 'Deed of assignment', type: 'file', required: true },
      { name: 'survey_plan_url', label: 'Survey plan', type: 'file', required: true },
    ],
    async apply(ctx, s, i) {
      await addDoc(ctx, s.id, 'DEED_OF_ASSIGNMENT', i.deed_of_assignment_url, 'Deed of assignment');
      await addDoc(ctx, s.id, 'SURVEY_PLAN', i.survey_plan_url, 'Survey plan');
      await closeTasks(ctx, s.id, 'ALLOCATION_DOCS');
      const due = d10(s.ops_due_date);
      const late = !!due && isoDay(new Date()) > due;
      await notifyRoles(ctx, ['SITE_MANAGER'], { title: 'Operations documents uploaded', message: `${saleLabel(s)}. Perform the final audit.`, link: saleLink(s) });
      return late ? `LATE – documents were due ${due}` : 'On time';
    },
  },
  {
    key: 'final_audit', label: 'Final sale audit → trigger approvals',
    help: 'Audit the whole sale. This starts the approval chain: Sales Manager → Operations Manager → HR internal audit → CEO.',
    roles: ['SITE_MANAGER'], from: ['OPS_DOCS_UPLOADED', 'RETURNED'], to: 'IN_APPROVAL',
    fields: [
      { name: 'audit_findings', label: 'Audit findings', type: 'textarea', required: true },
      { name: 'confirmed', label: 'I confirm all documents were reviewed', type: 'checkbox', required: true },
    ],
    async apply(ctx, s, i) {
      const docs = await many(ctx, `select distinct document_type from sale_documents where sale_id=$1`, [s.id]);
      const have = new Set(docs.map(d => d.document_type));
      const missing = REQUIRED_DOCS.filter(d => !have.has(d));
      if (!s.sales_invoice_no) missing.push('SALES_INVOICE');
      if (missing.length) throw new WorkflowError(`Cannot audit – missing: ${missing.map(m => m.replace(/_/g, ' ').toLowerCase()).join(', ')}`);
      await siteRecord(ctx, s.id, 'FINAL_SALE_AUDIT', { findings: i.audit_findings });
      const round = Number(s.chain_round) + 1;
      await ctx.tx.query(`update sales set chain_round=$2, returned_reason=null where id=$1`, [s.id, round]);
      await openRound(ctx, 'SALE', s.id, 'SALE_CHAIN', round, SALE_CHAIN);
      await notifyRoles(ctx, ['OPERATIONS_MANAGER', 'HR', 'CEO', 'ACCOUNTANT'], { title: 'Final audit completed', message: `${saleLabel(s)} entered the approval chain.`, link: saleLink(s) });
      await notifyUsers(ctx, [s.created_by], { title: 'Sale in approval chain', message: saleLabel(s), link: saleLink(s) });
      return String(i.audit_findings);
    },
  },
  {
    key: 'start_pre_allocation', label: 'Send soft copy & start pre-allocation',
    help: 'Send the soft copy to the client and commence pre-allocation: site survey, logistics and feeding.',
    roles: ['SITE_MANAGER'], from: ['FULLY_APPROVED'], to: 'PRE_ALLOCATION',
    fields: [
      { name: 'soft_copy_url', label: 'Soft copy (sent to client)', type: 'file', required: true },
      { name: 'site_survey_plan', label: 'Site survey plan / schedule', type: 'textarea', required: true },
      { name: 'logistics_notes', label: 'Logistics & feeding arrangements', type: 'textarea', required: true },
    ],
    async apply(ctx, s, i) {
      await addDoc(ctx, s.id, 'SOFT_COPY', i.soft_copy_url, 'Soft copy sent to client');
      await siteRecord(ctx, s.id, 'SOFT_COPY_SENT', { url: i.soft_copy_url });
      await siteRecord(ctx, s.id, 'SITE_SURVEY', { plan: i.site_survey_plan });
      await siteRecord(ctx, s.id, 'ALLOCATION_LOGISTICS', { notes: i.logistics_notes });
      await notifyRoles(ctx, ['SALES_MANAGER', ...OPS], { title: 'Pre-allocation commenced', message: saleLabel(s), link: saleLink(s) });
      await notifyUsers(ctx, [s.created_by], { title: 'Soft copy sent – pre-allocation commenced', message: saleLabel(s), link: saleLink(s) });
      mailClient(ctx, s.client_email, 'Your Landblaze allocation documents',
        `Dear ${s.client_name},\n\nYour soft copy is available: ${i.soft_copy_url}\nPre-allocation activities (site survey and logistics) have started. You will be told your allocation date shortly.\n\nLandblaze`);
    },
  },
  {
    key: 'set_allocation_date', label: 'Communicate allocation date',
    help: `The allocation date must be communicated within ${ALLOCATION_WINDOW_DAYS} days of final approval (late communication is flagged in reports).`,
    roles: ['SITE_MANAGER'], from: ['PRE_ALLOCATION'], to: 'ALLOCATION_SCHEDULED',
    fields: [{ name: 'allocation_date', label: 'Allocation date', type: 'date', required: true }],
    async apply(ctx, s, i) {
      const today = isoDay(new Date());
      if (String(i.allocation_date) < today) throw new WorkflowError('Allocation date cannot be in the past');
      await ctx.tx.query(`update sales set allocation_date=$2 where id=$1`, [s.id, i.allocation_date]);
      const noticeDue = s.approved_at ? isoDay(daysFrom(s.approved_at, ALLOCATION_WINDOW_DAYS)) : null;
      const late = noticeDue && today > noticeDue;
      const n = { title: 'Allocation date communicated', message: `${saleLabel(s)} — ${i.allocation_date}. Please inform the client.`, link: saleLink(s) };
      await notifyRoles(ctx, ['SALES_MANAGER', 'ACCOUNTANT', ...OPS], n);
      await notifyUsers(ctx, [s.created_by], n);
      mailClient(ctx, s.client_email, 'Your Landblaze allocation date',
        `Dear ${s.client_name},\n\nYour allocation date for ${s.plot_reference || s.property_name} is ${i.allocation_date}.\n\nLandblaze`);
      return `Allocation ${i.allocation_date}${late ? ` · LATE (notice was due ${noticeDue})` : ''}`;
    },
  },
  {
    key: 'confirm_allocation', label: 'Confirm allocation completed',
    help: 'The client has been physically allocated the plot.',
    roles: ['SITE_MANAGER'], from: ['ALLOCATION_SCHEDULED'], to: 'ALLOCATED',
    fields: [{ name: 'completion_note', label: 'Completion note', type: 'textarea' }],
    async apply(ctx, s, i) {
      await ctx.tx.query(`update sales set allocated_at=now() where id=$1`, [s.id]);
      await siteRecord(ctx, s.id, 'ALLOCATION_COMPLETED', { note: i.completion_note });
      const n = { title: 'Plot allocated', message: saleLabel(s), link: saleLink(s) };
      await notifyRoles(ctx, ['SALES_MANAGER', 'ACCOUNTANT', 'CEO', 'HR', ...OPS], n);
      await notifyUsers(ctx, [s.created_by], n);
    },
  },
  {
    key: 'log_site_activity', label: 'Log site activity',
    help: 'Record site survey, logistics or general site notes at any point after the sale reaches the site.',
    roles: ['SITE_MANAGER'], from: ALL_AFTER_APPROVAL,
    fields: [
      { name: 'record_type', label: 'Type', type: 'select', required: true, options: ['SITE_SURVEY', 'ALLOCATION_LOGISTICS', 'GENERAL_NOTE'] },
      { name: 'details', label: 'Details', type: 'textarea', required: true },
    ],
    async apply(ctx, s, i) {
      await siteRecord(ctx, s.id, String(i.record_type), { details: i.details });
      return String(i.details);
    },
  },
  {
    key: 'cancel_sale', label: 'Cancel sale', danger: true,
    help: 'Cancels the sale and closes open approvals. Not possible once pre-allocation has started.',
    roles: ['SALES_MANAGER', 'CEO'],
    from: ['DRAFT', 'PAYMENT_PROOF_SUBMITTED', 'INVOICE_ENTERED', 'SALES_APPROVED', 'CONTRACT_PREPARED', 'ACCOUNT_DOCS_SENT', 'SITE_NOTIFIED', 'OPS_DOCS_UPLOADED', 'IN_APPROVAL', 'RETURNED', 'FULLY_APPROVED'],
    to: 'CANCELLED', fields: [reason],
    async apply(ctx, s, i) {
      await cancelPending(ctx, 'SALE', s.id);
      await ctx.tx.query(`update operations set status='CANCELLED' where sale_id=$1 and status='PENDING'`, [s.id]);
      const n = { title: 'Sale cancelled', message: `${saleLabel(s)}: ${i.reason}`, link: saleLink(s) };
      await notifyRoles(ctx, ['ACCOUNTANT', 'SITE_MANAGER', ...OPS], n);
      await notifyUsers(ctx, [s.created_by], n);
      return String(i.reason);
    },
  },
];

const BY_KEY = new Map(SALE_ACTIONS.map(a => [a.key, a]));
export const getSaleAction = (k: string) => BY_KEY.get(k);

/** Actions this user may perform right now on this sale (drives the UI and the queue). */
export function availableSaleActions(sale: { status: string; created_by?: string | null }, user: { id: string; role: Role }) {
  return SALE_ACTIONS.filter(a =>
    (user.role === 'SUPER_ADMIN' || a.roles.includes(user.role)) && a.from.includes(sale.status) &&
    !(a.ownOnly && user.role === 'SALES' && sale.created_by !== user.id));
}

export async function performSaleAction(actor: Actor, saleId: string, key: string, input: Record<string, unknown>) {
  const a = BY_KEY.get(key);
  if (!a) throw new WorkflowError('Unknown action');
  if (actor.role !== 'SUPER_ADMIN' && !a.roles.includes(actor.role)) throw new ForbiddenError('Your role is not permitted to do this');
  return run(actor, async ctx => {
    const s = await one(ctx, `select * from sales where id=$1 for update`, [saleId]);
    if (!s) throw new WorkflowError('Sale not found');
    if (!a.from.includes(s.status)) throw new WorkflowError(`Not available while the sale is "${SALE_STATUS_LABEL[s.status] ?? s.status}"`);
    if (a.ownOnly && actor.role === 'SALES' && s.created_by !== actor.id) throw new ForbiddenError('You can only act on sales you created');
    const parsed = parseFields(a.fields, input);
    const notes = (await a.apply(ctx, s, parsed)) || null;
    if (a.to) await ctx.tx.query(`update sales set status=$2, updated_at=now() where id=$1`, [s.id, a.to]);
    else await ctx.tx.query(`update sales set updated_at=now() where id=$1`, [s.id]);
    await logEvent(ctx, 'SALE', s.id, stageOf(a), a.label, s.status, a.to ?? s.status, notes);
    await audit(ctx, `SALE_${a.key.toUpperCase()}`, 'SALE', s.id, { from: s.status, to: a.to ?? s.status });
    return { status: a.to ?? s.status };
  });
}
const stageOf = (a: SaleAction) => a.roles.includes('SITE_MANAGER') ? 'SITE_MANAGEMENT' : a.roles.includes('ACCOUNTANT') ? 'ACCOUNTS' : a.roles.includes('OPERATIONS') ? 'OPERATIONS' : 'SALES';

export async function createSale(actor: Actor, input: Record<string, unknown>) {
  if (actor.role !== 'SUPER_ADMIN' && !['SALES', 'SALES_MANAGER'].includes(actor.role)) throw new ForbiddenError('Only the sales team can create sales');
  const p = parseFields([
    { name: 'client_id', label: 'Client', type: 'text', required: true },
    { name: 'property_name', label: 'Estate / property', type: 'text', required: true },
    { name: 'plot_reference', label: 'Plot reference', type: 'text', required: true },
    { name: 'amount', label: 'Sale amount (₦)', type: 'number', required: true, min: 1 },
    { name: 'description', label: 'Description', type: 'textarea' },
  ], input);
  return run(actor, async ctx => {
    const client = await one(ctx, `select * from clients where id=$1`, [p.client_id]);
    if (!client) throw new WorkflowError('Client not found');
    const taken = await one(ctx,
      `select id from sales where lower(property_name)=lower($1) and lower(plot_reference)=lower($2) and status<>'CANCELLED' limit 1`,
      [p.property_name, p.plot_reference]);
    if (taken) throw new WorkflowError('This plot is already attached to another active sale (double-sale prevention)');
    const s = (await one(ctx,
      `insert into sales(client_id,lead_id,client_name,client_email,property_name,plot_reference,amount,quoted_amount,description,created_by)
       values($1,(select id from leads where client_id=$1 limit 1),$2,$3,$4,$5,$6,$6,$7,$8) returning id`,
      [client.id, client.name, client.email, p.property_name, p.plot_reference, p.amount, p.description, actor.id]))!;
    await logEvent(ctx, 'SALE', s.id, 'SALES', 'Sale created', null, 'DRAFT', `${p.property_name} / ${p.plot_reference} · ${money(p.amount)}`);
    await audit(ctx, 'SALE_CREATED', 'SALE', s.id, { client: client.name });
    return s.id as string;
  });
}

// ---- Approval-chain outcomes -------------------------------------------------
registerRound('SALE_CHAIN', {
  entity: 'SALE',
  link: id => `/sales/${id}`,
  async title(ctx, id) { const s = await one(ctx, `select * from sales where id=$1`, [id]); return s ? `${saleLabel(s)} — ${money(s.amount)}` : ''; },
  async conflict(ctx, approval, actor) {
    if (approval.step !== 'Sales Manager approval') return null;
    const s = await one(ctx, `select gate_approved_by from sales where id=$1`, [approval.entity_id]);
    if (s?.gate_approved_by && s.gate_approved_by === actor.id)
      return 'You already approved this sale earlier in the process — a different Sales Manager must complete this audit step';
    return null;
  },
  async onComplete(ctx, a) {
    const s = (await one(ctx, `update sales set status='FULLY_APPROVED', approved_at=now(), updated_at=now(), returned_reason=null where id=$1 returning *`, [a.entity_id]))!;
    await logEvent(ctx, 'SALE', s.id, 'APPROVAL', 'Approval chain complete', 'IN_APPROVAL', 'FULLY_APPROVED', null);
    const n = { title: 'Sale fully approved', message: `${saleLabel(s)}. Commence pre-allocation.`, link: saleLink(s) };
    await notifyRoles(ctx, ['SITE_MANAGER', 'ACCOUNTANT', ...OPS], n);
    await notifyUsers(ctx, [s.created_by], n);
  },
  async onReject(ctx, a, comment) {
    const s = (await one(ctx, `update sales set status='RETURNED', returned_reason=$2, updated_at=now() where id=$1 returning *`, [a.entity_id, `${a.step}: ${comment}`]))!;
    await logEvent(ctx, 'SALE', s.id, 'APPROVAL', 'Returned by approver', 'IN_APPROVAL', 'RETURNED', `${a.step}: ${comment}`);
    const n = { title: 'Sale returned by approver', message: `${saleLabel(s)} — ${a.step}: ${comment}`, link: saleLink(s) };
    await notifyRoles(ctx, ['SITE_MANAGER', ...OPS], n);
    await notifyUsers(ctx, [s.created_by], n);
  },
});
