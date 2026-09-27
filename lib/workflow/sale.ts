/**
 * SALE LIFECYCLE  (rows 1–12 of the process sheet)
 *
 *  PENDING_SALES_APPROVAL ──approve_new_sale──▶ DRAFT
 *  DRAFT ──submit_payment_proof──▶ PAYMENT_PROOF_SUBMITTED        Sales team uploads payment proof
 *  ──enter_invoice──▶ INVOICE_ENTERED                             Accountant enters invoice → back to Sales Mgr + Sales Exec
 *  ──approve_sale──▶ SALES_APPROVED                               Sales Manager approves → Operations receives approved sale
 *  ──create_contract──▶ CONTRACT_PREPARED                         Operations: contract + acknowledgment + sales bundle → back to Accounts
 *  ──send_sales_documents──▶ ACCOUNT_DOCS_SENT                    Accountant: sales order, receipt, invoice sent
 *  ──open_ops_portal──▶ SITE_NOTIFIED                             Operations opens portal → Site Manager notified, ready for allocation (30-day clock)
 *  ──upload_deed_of_assignment──▶ OPS_DEED_UPLOADED               Operations: deed of assignment
 *  ──upload_survey_plan──────────▶ OPS_DOCS_UPLOADED                Site Manager: survey plan (within 30 days)
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
  ForbiddenError, WorkflowError, assertFreshEvidence, assertOwnedUpload, audit, d10, logEvent, mailClient, many, money, notifyRoles, notifyUsers, one,
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
  const value = String(url);
  const m = value.match(/^\/api\/files\/([0-9a-f-]{36})$/i);
  await ctx.tx.query(
    `insert into sale_documents(sale_id,document_type,document_name,document_url,uploaded_file_id,uploaded_by) values($1,$2,$3,$4,$5::uuid,$6)`,
    [saleId, type, name ?? type.replace(/_/g, ' ').toLowerCase(), value, m ? m[1] : null, ctx.actor.id]);
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
const REQUIRED_DOCS = ['PAYMENT_PROOF', 'CONTRACT', 'ACKNOWLEDGMENT_LETTER', 'SALES_DOCUMENTS', 'DEED_OF_ASSIGNMENT', 'SURVEY_PLAN'];
const ALL_AFTER_APPROVAL = ['SITE_NOTIFIED', 'OPS_DOCS_UPLOADED', 'IN_APPROVAL', 'RETURNED', 'FULLY_APPROVED', 'PRE_ALLOCATION', 'ALLOCATION_SCHEDULED'];

const reason: Field = { name: 'reason', label: 'Reason', type: 'textarea', required: true };

export const SALE_ACTIONS: SaleAction[] = [
  {
    key: 'submit_new_sale', label: 'Send for Sales Manager approval', ownOnly: true,
    help: 'Submit this saved draft to a Sales Manager for review. You can continue editing before sending it for approval.',
    roles: ['SALES', 'SALES_MANAGER'], from: ['DRAFT'], to: 'PENDING_SALES_APPROVAL',
    fields: [],
    async apply(ctx, s) {
      const n = { title: 'New sale awaiting approval', message: `${saleLabel(s)} was submitted to a Sales Manager for approval.`, link: saleLink(s) };
      await notifyRoles(ctx, ['SALES_MANAGER'], n);
      await notifyUsers(ctx, [s.created_by], { ...n, title: 'Sale sent for approval', message: `${saleLabel(s)} is awaiting Sales Manager approval.` });
      return 'Sale submitted for Sales Manager approval';
    },
  },
  {
    key: 'approve_new_sale', label: 'Approve new sale',
    help: 'Sales Manager reviews the submitted sale. Payment processing cannot start until this approval is completed.',
    roles: ['SALES_MANAGER'], from: ['PENDING_SALES_APPROVAL'], to: 'DRAFT',
    fields: [{ name: 'note', label: 'Approval note (optional)', type: 'textarea' }],
    async apply(ctx, s, i) {
      await ctx.tx.query(`update sales set gate_approved_by=$2 where id=$1`, [s.id, ctx.actor.id]);
      const hasProof = s.payment_status === 'PROOF_SUBMITTED';
      const n = hasProof
        ? { title: 'Sale approved – payment proof ready for Accounts', message: `${saleLabel(s)} has been approved by the Sales Manager. Accounts can now verify the uploaded payment evidence and enter the invoice.`, link: saleLink(s) }
        : { title: 'Sale approved – payment can proceed', message: `${saleLabel(s)} has been approved by the Sales Manager. Upload payment proof when the client pays.`, link: saleLink(s) };
      await notifyUsers(ctx, [s.created_by], n);
      if (hasProof) await notifyRoles(ctx, ['ACCOUNTANT'], n);
      return i.note ? String(i.note) : 'New sale approved';
    },
  },
  {
    key: 'submit_payment_proof', label: 'Upload payment proof', ownOnly: true,
    help: 'Client has paid. Attach the payment proof link and reference – Accounts is notified.',
    roles: ['SALES', 'SALES_MANAGER'], from: ['PENDING_SALES_APPROVAL', 'DRAFT'], to: 'PAYMENT_PROOF_SUBMITTED',
    fields: [
      { name: 'proof_url', label: 'Payment proof', type: 'file', required: true, uploadPurpose: 'sales_payment_evidence' },
      { name: 'payment_reference', label: 'Payment reference', type: 'text', required: true },
      ],
    async apply(ctx, s, i) {
      await assertOwnedUpload(ctx, i.proof_url, 'Payment proof', 'sales_payment_evidence');
      await assertFreshEvidence(ctx, i.proof_url, 'payment proof');
      await addDoc(ctx, s.id, 'PAYMENT_PROOF', i.proof_url, 'Payment proof');
      await ctx.tx.query(`update sales set payment_status='PROOF_SUBMITTED', payment_reference=$2 where id=$1`, [s.id, i.payment_reference]);
      await notifyRoles(ctx, ['SALES_MANAGER'], { title: 'Payment proof awaiting approval', message: `${saleLabel(s)} �� reference ${i.payment_reference}. Approve or cancel this sale.`, link: saleLink(s) });
      await notifyRoles(ctx, ['ACCOUNTANT', 'FINANCE_OPERATIONS'], { title: 'Payment proof submitted', message: `${saleLabel(s)} is awaiting Sales Manager approval before Accounts processing.`, link: saleLink(s) });
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
    roles: ['ACCOUNTANT', 'FINANCE_OPERATIONS'], from: ['PAYMENT_PROOF_SUBMITTED', 'DRAFT'], to: 'INVOICE_ENTERED',
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
      await openTask(ctx, s.id, 'SALE_DOCUMENTS');
      const n = { title: 'Approved sale received', message: `${saleLabel(s)}. Create the Contract of Sale, Letter of Acknowledgment and Sales Documents bundle.`, link: saleLink(s) };
      await notifyRoles(ctx, OPS, n);
      await notifyUsers(ctx, [s.created_by], { ...n, title: 'Your sale was approved', message: `${saleLabel(s)} is with Operations.` });
    },
  },
  {
    key: 'skip_topup_documents', label: 'Record top-up — no sale documents',
    help: 'Top-up transactions do not require a Contract of Sale, Letter of Acknowledgment or Sales Documents bundle.',
    roles: OPS, from: ['SALES_APPROVED'], to: 'SITE_NOTIFIED',
    fields: [{ name: 'note', label: 'Note (optional)', type: 'textarea' }],
    async apply(ctx, s, i) {
      if (s.transaction_type !== 'TOP_UP') throw new WorkflowError('This shortcut is only available for top-up transactions');
      await ctx.tx.query(`update sales set ops_due_date = current_date + ${ALLOCATION_WINDOW_DAYS} where id=$1`, [s.id]);
      await openTask(ctx, s.id, 'ALLOCATION_DOCS', ALLOCATION_WINDOW_DAYS, 'Deed of assignment + survey plan');
      await notifyRoles(ctx, ['SITE_MANAGER'], { title: 'Top-up ready for allocation', message: `${saleLabel(s)}. No sale documents are required for this top-up.${i.note ? ` ${i.note}` : ''}`, link: saleLink(s) });
    },
  },
  {
    key: 'create_contract', label: 'Create sale documents',
    help: 'Operations prepares the Contract of Sale, Letter of Acknowledgment and Sales Documents bundle. On submission the sale goes back to Accounts.',
    roles: OPS, from: ['SALES_APPROVED'], to: 'CONTRACT_PREPARED',
    fields: [
      { name: 'contract_url', label: 'Contract of Sale', type: 'file', required: true },
      { name: 'acknowledgment_url', label: 'Letter of Acknowledgment', type: 'file', required: true },
      { name: 'sales_documents_url', label: 'Sales Documents bundle', type: 'file', required: true },
    ],
    async apply(ctx, s, i) {
      if (s.transaction_type === 'TOP_UP') throw new WorkflowError('Top-up transactions do not receive sale documents');
      await addDoc(ctx, s.id, 'CONTRACT', i.contract_url, 'Contract of Sale');
      await addDoc(ctx, s.id, 'ACKNOWLEDGMENT_LETTER', i.acknowledgment_url, 'Letter of Acknowledgment');
      await addDoc(ctx, s.id, 'SALES_DOCUMENTS', i.sales_documents_url, 'Sales Documents bundle');
      await closeTasks(ctx, s.id, 'SALE_DOCUMENTS');
      const originator = await one(ctx, `select id, role from users where id=$1 and active=true`, [s.created_by]);
      if (!originator) throw new WorkflowError('The sales originator is no longer active and cannot approve these documents');
      const originatorRole: Role = originator.role === 'SALES_MANAGER' ? 'SALES_MANAGER' : 'SALES';
      const steps: Step[] = [
        { step: 'Sales originator approval', role: originatorRole, seq: 1, userId: s.created_by },
        { step: 'Sales Manager approval', role: 'SALES_MANAGER', seq: 2, userId: undefined },
      ];
      await openRound(ctx, 'SALE', s.id, 'SALE_DOCUMENTS_APPROVAL', Number(s.chain_round || 0) + 1, steps);
      await notifyUsers(ctx, [s.created_by], { title: 'Operations documents ready for your approval', message: `${saleLabel(s)} — review the Contract of Sale, Letter of Acknowledgment and Sales Documents bundle.`, link: saleLink(s) });
      await notifyRoles(ctx, ['SALES_MANAGER'], { title: 'Operations documents awaiting approval', message: `${saleLabel(s)} — review the three documents submitted by Operations.`, link: saleLink(s) });
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
      const documentApprovals = await one(ctx, `select count(*)::int as n from approvals where entity_type='SALE' and entity_id=$1 and round='SALE_DOCUMENTS_APPROVAL' and status='APPROVED'`, [s.id]);
      if (Number(documentApprovals?.n || 0) < 2) throw new WorkflowError('Sales originator and Sales Manager must approve the Operations documents first');
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
      await notifyRoles(ctx, ['SITE_MANAGER'], { title: 'Sale ready for allocation', message: `${saleLabel(s)}. Site Management should upload the deed of assignment and survey plan.${i.note ? ` ${i.note}` : ''}`, link: saleLink(s) });
    },
  },
  {
    key: 'upload_deed_of_assignment', label: 'Upload deed of assignment',
    help: 'Operations uploads the deed of assignment. Site Management separately uploads the survey plan.',
    roles: ['OPERATIONS', 'OPERATIONS_MANAGER'], from: ['SITE_NOTIFIED', 'OPS_DEED_UPLOADED', 'RETURNED'], to: 'OPS_DEED_UPLOADED',
    fields: [{ name: 'deed_of_assignment_url', label: 'Deed of assignment', type: 'file', required: true }],
    async apply(ctx, s, i) {
      await addDoc(ctx, s.id, 'DEED_OF_ASSIGNMENT', i.deed_of_assignment_url, 'Deed of assignment');
      await notifyRoles(ctx, ['SITE_MANAGER'], { title: 'Deed of assignment ready', message: `${saleLabel(s)}. Upload the survey plan.`, link: saleLink(s) });
    },
  },
  {
    key: 'upload_survey_plan', label: 'Upload survey plan',
    help: 'Site Management uploads the survey plan after Operations has uploaded the deed of assignment.',
    roles: ['SITE_MANAGER'], from: ['SITE_NOTIFIED', 'OPS_DEED_UPLOADED', 'RETURNED'], to: 'OPS_DOCS_UPLOADED',
    fields: [{ name: 'survey_plan_url', label: 'Survey plan', type: 'file', required: true }],
    async apply(ctx, s, i) {
      const deed = await one(ctx, `select id from sale_documents where sale_id=$1 and document_type='DEED_OF_ASSIGNMENT' limit 1`, [s.id]);
      if (!deed) throw new WorkflowError('Operations must upload the deed of assignment before the Site Manager uploads the survey plan');
      await addDoc(ctx, s.id, 'SURVEY_PLAN', i.survey_plan_url, 'Survey plan');
      await closeTasks(ctx, s.id, 'ALLOCATION_DOCS');
      const due = d10(s.ops_due_date);
      const late = !!due && isoDay(new Date()) > due;
      await notifyRoles(ctx, ['SITE_MANAGER'], { title: 'Allocation documents uploaded', message: `${saleLabel(s)}. Perform the final audit.`, link: saleLink(s) });
      return late ? `LATE – documents were due ${due}` : 'On time';
    },
  },
  {
    key: 'final_audit', label: 'Final sale audit → trigger approvals',
    help: 'Audit the whole sale. This starts the approval chain: Sales Manager → Operations Manager → HR internal audit → CEO.',
    roles: ['SITE_MANAGER'], from: ['OPS_DOCS_UPLOADED', 'RETURNED'], to: 'IN_APPROVAL',
    fields: [
      { name: 'audit_findings', label: 'Audit findings', type: 'textarea', required: true },
      { name: 'sales_manager_id', label: 'Sales Manager approver', type: 'text', required: true },
      { name: 'operations_manager_id', label: 'Operations Manager approver', type: 'text', required: true },
      { name: 'hr_id', label: 'HR approver', type: 'text', required: true },
      { name: 'ceo_id', label: 'CEO approver', type: 'text', required: true },
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
      const assignments = { sales_manager_id: 'SALES_MANAGER', operations_manager_id: 'OPERATIONS_MANAGER', hr_id: 'HR', ceo_id: 'CEO' } as const;
      const steps = SALE_CHAIN.map(step => {
        const field = Object.entries(assignments).find(([, role]) => role === step.role)?.[0] as keyof typeof i | undefined;
        return { ...step, userId: field ? String(i[field] || '') : '' };
      });
      const selected = steps.map(step => step.userId).filter(Boolean);
      if (selected.length !== new Set(selected).size) throw new WorkflowError('Each approval step must be assigned to a different user');
      const valid = await many(ctx, `select id, role from users where id = any($1::uuid[]) and active=true`, [selected]);
      if (valid.length !== steps.length || steps.some(step => !valid.some(user => user.id === step.userId && user.role === step.role)))
        throw new WorkflowError('Select an active user with the correct designation for every approval step');
      await openRound(ctx, 'SALE', s.id, 'SALE_CHAIN', round, steps);
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
    from: ['PENDING_SALES_APPROVAL', 'DRAFT', 'PAYMENT_PROOF_SUBMITTED', 'INVOICE_ENTERED', 'SALES_APPROVED', 'CONTRACT_PREPARED', 'ACCOUNT_DOCS_SENT', 'SITE_NOTIFIED', 'OPS_DOCS_UPLOADED', 'IN_APPROVAL', 'RETURNED', 'FULLY_APPROVED'],
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
export function availableSaleActions(sale: { status: string; created_by?: string | null; transaction_type?: string | null }, user: { id: string; role: Role }) {
  return SALE_ACTIONS.filter(a =>
  (user.role === 'SUPER_ADMIN' || a.roles.includes(user.role)) && a.from.includes(sale.status) &&
  (sale.transaction_type !== 'TOP_UP' || a.key === 'skip_topup_documents' || a.key === 'open_ops_portal') &&
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
    if (a.key === 'approve_new_sale' && s.created_by === actor.id) throw new ForbiddenError('A Sales Manager cannot approve their own sale');
    const parsed = parseFields(a.fields, input);
    const notes = (await a.apply(ctx, s, parsed)) || null;
    const nextStatus = a.key === 'approve_new_sale' && s.payment_status === 'PROOF_SUBMITTED' ? 'PAYMENT_PROOF_SUBMITTED' : (a.to ?? s.status);
    if (a.to) await ctx.tx.query(`update sales set status=$2, updated_at=now() where id=$1`, [s.id, nextStatus]);
    else await ctx.tx.query(`update sales set updated_at=now() where id=$1`, [s.id]);
    await logEvent(ctx, 'SALE', s.id, stageOf(a), a.label, s.status, nextStatus, notes);
    await audit(ctx, `SALE_${a.key.toUpperCase()}`, 'SALE', s.id, { from: s.status, to: nextStatus });
    return { status: nextStatus };
  });
}
const stageOf = (a: SaleAction) => a.roles.includes('SITE_MANAGER') ? 'SITE_MANAGEMENT' : a.roles.includes('ACCOUNTANT') ? 'ACCOUNTS' : a.roles.includes('OPERATIONS') ? 'OPERATIONS' : 'SALES';

const SALE_EDIT_FIELDS: Field[] = [
  { name: 'property_name', label: 'Estate / property', type: 'text', required: true },
  { name: 'plot_reference', label: 'Plot reference', type: 'text', required: true },
  { name: 'estate_value', label: 'Estate value (₦)', type: 'number', required: true, min: 1 },
  { name: 'payment_amount', label: 'Payment amount (₦)', type: 'number', required: true, min: 1 },
  { name: 'payment_plan', label: 'Payment plan', type: 'select', required: true, options: ['OUTRIGHT', 'INSTALLMENT'] },
  { name: 'description', label: 'Description', type: 'textarea' },
];

export async function updateSale(actor: Actor, saleId: string, input: Record<string, unknown>) {
  if (actor.role !== 'SUPER_ADMIN' && !['SALES_MANAGER'].includes(actor.role)) throw new ForbiddenError('Only a Sales Manager can edit a submitted sale');
  const p = parseFields(SALE_EDIT_FIELDS, input);
  return run(actor, async ctx => {
    const sale = await one(ctx, `select * from sales where id=$1 for update`, [saleId]);
    if (!sale) throw new WorkflowError('Sale not found');
    if (sale.status !== 'PENDING_SALES_APPROVAL') throw new WorkflowError('Only a sale awaiting Sales Manager approval can be edited');
    const taken = await one(ctx, `select id from sales where lower(property_name)=lower($1) and lower(plot_reference)=lower($2) and id<>$3 and status<>'CANCELLED' limit 1`, [p.property_name, p.plot_reference, saleId]);
    if (taken) throw new WorkflowError('This plot is already attached to another active sale');
    await ctx.tx.query(`update sales set property_name=$2, plot_reference=$3, estate_value=$4, payment_amount=$5, quoted_amount=$4, amount=$5, payment_plan=$6, description=$7, updated_at=now() where id=$1`, [saleId, p.property_name, p.plot_reference, p.estate_value, p.payment_amount, p.payment_plan, p.description]);
    await logEvent(ctx, 'SALE', saleId, 'SALES', 'Sale adjusted by Sales Manager', sale.status, sale.status, `${p.property_name} / ${p.plot_reference}`);
    await notifyUsers(ctx, [sale.created_by], { title: 'Sale adjusted by Sales Manager', message: `${saleLabel(sale)} was adjusted during approval review.`, link: saleLink(saleId) });
    return saleId;
  });
}

export async function createSale(actor: Actor, input: Record<string, unknown>) {
  if (actor.role !== 'SUPER_ADMIN' && !['SALES', 'SALES_MANAGER'].includes(actor.role)) throw new ForbiddenError('Only the sales team can create sales');
  const p = parseFields([
    { name: 'client_id', label: 'Client', type: 'text', required: true },
    { name: 'property_name', label: 'Estate / property', type: 'text', required: true },
    { name: 'plot_reference', label: 'Plot reference', type: 'text', required: true },
{ name: 'estate_value', label: 'Estate value (₦)', type: 'number', required: true, min: 1 },
  { name: 'payment_amount', label: 'Payment amount (₦)', type: 'number', required: true, min: 1 },
  { name: 'payment_plan', label: 'Payment plan', type: 'text', required: true },
  { name: 'transaction_type', label: 'Transaction type', type: 'select', required: true, options: ['INITIAL_DEPOSIT', 'TOP_UP'] },
  { name: 'description', label: 'Description', type: 'textarea' },
    { name: 'payment_proof_url', label: 'Payment evidence', type: 'file', uploadPurpose: 'sales_payment_evidence' },
    { name: 'payment_reference', label: 'Payment reference', type: 'text' },
  ], input);
  if (p.payment_proof_url && !p.payment_reference) throw new WorkflowError('Payment reference is required when payment evidence is uploaded');
  return run(actor, async ctx => {
    const client = await one(ctx, `select * from clients where id=$1`, [p.client_id]);
    if (!client) throw new WorkflowError('Client not found');
    const taken = await one(ctx,
      `select id from sales where lower(property_name)=lower($1) and lower(plot_reference)=lower($2) and status<>'CANCELLED' limit 1`,
      [p.property_name, p.plot_reference]);
    if (taken) throw new WorkflowError('This plot is already attached to another active sale (double-sale prevention)');
    if (p.payment_proof_url) {
      await assertOwnedUpload(ctx, p.payment_proof_url, 'Payment evidence', 'sales_payment_evidence');
      await assertFreshEvidence(ctx, p.payment_proof_url, 'payment evidence');
    }
    const paymentStatus = p.payment_proof_url ? 'PROOF_SUBMITTED' : 'UNPAID';
    const s = (await one(ctx,
`insert into sales(sale_reference,transaction_type,client_id,lead_id,client_name,client_email,property_name,plot_reference,amount,estate_value,payment_amount,quoted_amount,payment_plan,description,status,payment_status,payment_reference,created_by)
  values('SALE-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('sale_reference_seq')::text, 6, '0'), $1, $2,(select id from leads where client_id=$2 limit 1),$3,$4,$5,$6,$7,$8,$9,$7,$10,$11,'DRAFT',$12,$13,$14) returning id, sale_reference`,
  [p.transaction_type, client.id, client.name, client.email, p.property_name, p.plot_reference, p.estate_value, p.estate_value, p.payment_amount, p.payment_plan, p.description, paymentStatus, p.payment_reference ?? null, actor.id]))!;
    if (p.payment_proof_url) {
      const m = String(p.payment_proof_url).match(/^\/api\/files\/([0-9a-f-]{36})$/i)!;
      await ctx.tx.query(`insert into sale_documents(sale_id,document_type,document_name,document_url,uploaded_file_id,uploaded_by) values($1,'PAYMENT_PROOF','Payment evidence',$2,$3::uuid,$4)`, [s.id, p.payment_proof_url, m[1], actor.id]);
    }
  await logEvent(ctx, 'SALE', s.id, 'SALES', 'Sale saved as draft', null, 'DRAFT', `${p.property_name} / ${p.plot_reference} · estate ${money(p.estate_value)} · payment ${money(p.payment_amount)} (${p.payment_plan})${p.payment_proof_url ? ' · payment evidence attached' : ''}`);
  await audit(ctx, 'SALE_CREATED', 'SALE', s.id, { client: client.name, status: 'DRAFT', payment_evidence_attached: !!p.payment_proof_url });
  await notifyUsers(ctx, [actor.id], { title: 'Sale saved as draft', message: `${client.name} — ${p.property_name} / ${p.plot_reference} is saved as a draft. Submit it for Sales Manager approval when ready.`, link: saleLink(s.id) });
    return s.id as string;
  });
}

// ---- Approval-chain outcomes -------------------------------------------------
registerRound('SALE_DOCUMENTS_APPROVAL', {
  entity: 'SALE',
  link: id => `/sales/${id}`,
  async title(ctx, id) { const s = await one(ctx, `select * from sales where id=$1`, [id]); return s ? `${saleLabel(s)} — Operations documents` : ''; },
  async onComplete(ctx, a) {
    const s = (await one(ctx, `select * from sales where id=$1`, [a.entity_id]))!;
    await logEvent(ctx, 'SALE', s.id, 'APPROVAL', 'Operations documents approved by Sales', 'CONTRACT_PREPARED', 'CONTRACT_PREPARED', null);
    const n = { title: 'Operations documents approved', message: `${saleLabel(s)}. Accounts can now prepare the sales documents and the Landblaze portal is available.`, link: saleLink(s) };
    await notifyRoles(ctx, ['ACCOUNTANT'], n);
    await notifyUsers(ctx, [s.created_by], n);
  },
  async onReject(ctx, a, comment) {
    const s = (await one(ctx, `update sales set status='RETURNED', returned_reason=$2, updated_at=now() where id=$1 returning *`, [a.entity_id, `${a.step}: ${comment}`]))!;
    const n = { title: 'Operations documents returned', message: `${saleLabel(s)} — ${a.step}: ${comment}`, link: saleLink(s) };
    await notifyRoles(ctx, ['OPERATIONS', 'OPERATIONS_MANAGER'], n);
    await notifyUsers(ctx, [s.created_by], n);
  },
});

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
