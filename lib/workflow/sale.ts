/**
 * SALE LIFECYCLE  (rows 1–12 of the process sheet)
 *
 *  PENDING_SALES_APPROVAL ──approve_new_sale──▶ DRAFT
 *  DRAFT ──submit_payment_proof──▶ PAYMENT_PROOF_SUBMITTED        Sales team uploads payment proof
 *  ──enter_invoice──▶ INVOICE_ENTERED                             Accountant generates invoice (auto no., payment amount) → back to Sales
 *  ──approve_sale──▶ SALES_APPROVED                               Sales Manager approves → Operations receives approved sale
  *  ──create_contract──▶ CONTRACT_PREPARED                         Operations: contract + acknowledgement → back to Accounts
  *  ──send_sales_documents──▶ ACCOUNT_DOCS_SENT                    Accountant: transaction-specific account documents sent
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
import { buildInvoicePdf, buildReceiptPdf, buildSalesOrderPdf, type SaleDocInput } from '../pdf/saleDocuments';
import { cancelPending, openRound, registerRound, type Step } from './approvals';

const OPS: Role[] = ['OPERATIONS', 'OPERATIONS_MANAGER'];
const SALE_APPROVERS: Role[] = ['SALES_MANAGER', 'OPERATIONS_MANAGER'];
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
async function storePdf(ctx: Ctx, filename: string, bytes: Uint8Array) {
  const buf = Buffer.from(bytes);
  const row = (await one(ctx, `insert into uploaded_files(filename, mime_type, size_bytes, data, uploaded_by, purpose)
    values($1,'application/pdf',$2,$3,$4::uuid,'document') returning id`, [filename, buf.length, buf, ctx.actor.id]))!;
  return `/api/files/${row.id}`;
}
type DocNature = 'OUTRIGHT' | 'INSTALLMENT' | 'TOP_UP';
type AccountDocNumbers = { nature: DocNature; invoiceNo: string | null; salesOrderNo: string | null; receiptNo: string };

function documentNature(s: Row): DocNature {
  if (String(s.transaction_type ?? '').toUpperCase() === 'TOP_UP') return 'TOP_UP';
  return String(s.payment_plan ?? '').toUpperCase() === 'OUTRIGHT' ? 'OUTRIGHT' : 'INSTALLMENT';
}

function storedDocNumbers(s: Row): AccountDocNumbers | null {
  const nature = documentNature(s);
  const receiptNo = s.sales_receipt_no ? String(s.sales_receipt_no) : null;
  if (!receiptNo) return null;
  if (nature === 'OUTRIGHT' && !s.sales_invoice_no) return null;
  if (nature === 'INSTALLMENT' && !s.sales_order_no) return null;
  return {
    nature, receiptNo,
    invoiceNo: nature === 'OUTRIGHT' ? String(s.sales_invoice_no) : null,
    salesOrderNo: nature === 'INSTALLMENT' ? String(s.sales_order_no) : null,
  };
}

/** Allocates system document numbers for the transaction nature: outright → invoice + receipt, installment → sales order + receipt, top-up → receipt. */
async function allocateDocNumbers(ctx: Ctx, s: Row): Promise<AccountDocNumbers> {
  const nature = documentNature(s);
  const gen = (await one(ctx, `select to_char(now(), 'YYYYMM') || '-' || lpad(nextval('invoice_number_seq')::text, 6, '0') as no`))!;
  const serial = String(gen.no);
  return {
    nature,
    invoiceNo: nature === 'OUTRIGHT' ? `INV-${serial}` : null,
    salesOrderNo: nature === 'INSTALLMENT' ? `SO-${serial}` : null,
    receiptNo: `RCT-${serial}`,
  };
}

async function saveDocNumbers(ctx: Ctx, saleId: string, n: AccountDocNumbers) {
  await ctx.tx.query(`update sales set invoice_number=$2, sales_invoice_no=$3, sales_order_no=$4, sales_receipt_no=$5 where id=$1`,
    [saleId, n.invoiceNo ?? n.salesOrderNo ?? n.receiptNo, n.invoiceNo, n.salesOrderNo, n.receiptNo]);
}

function describeDocs(n: AccountDocNumbers) {
  return [
    n.invoiceNo ? `invoice ${n.invoiceNo}` : null,
    n.salesOrderNo ? `sales order ${n.salesOrderNo}` : null,
    `sales receipt ${n.receiptNo}`,
  ].filter(Boolean).join(' and ');
}

/** Generates the PDFs for the transaction nature and files them on the sale. */
async function attachAccountDocuments(ctx: Ctx, s: Row, numbers: AccountDocNumbers, paid: number, reissued = false) {
  const isTopUp = String(s.transaction_type ?? '').toUpperCase() === 'TOP_UP';
  const parent = isTopUp && s.parent_sale_id
    ? await one(ctx, `select * from sales where id=$1`, [s.parent_sale_id])
    : s;
  if (!parent) throw new WorkflowError('The top-up parent sale could not be found.');
  const estateValue = Number(parent.estate_value ?? parent.quoted_amount ?? parent.amount ?? 0);
  if (!(estateValue > 0)) throw new WorkflowError('No estate value is recorded on the linked sale — ask Sales to set the estate value before generating account documents');
  const paymentTotals = await one(ctx, `
    select coalesce(sum(coalesce(payment_amount, amount, 0)), 0) as total_paid,
      coalesce(sum(case when id <> $1 and payment_status='VERIFIED' then coalesce(payment_amount, amount, 0) else 0 end), 0) as prior_paid
    from sales where (id=$1 or parent_sale_id=$1) and status <> 'CANCELLED' and payment_status='VERIFIED'`, [parent.id]);
  const totalPaid = Number(paymentTotals?.total_paid ?? paid);
  const priorPayment = await one(ctx, `select payment_reference from sales where (id=$1 or parent_sale_id=$1) and id <> $2 and payment_status='VERIFIED' and payment_reference is not null order by created_at desc limit 1`, [parent.id, s.id]);
  const client = parent.client_id ? await one(ctx, `select phone, email, address from clients where id=$1`, [parent.client_id]) : undefined;
  const actor = await one(ctx, `select name from users where id=$1::uuid`, [ctx.actor.id]);
  const { receiptNo } = numbers;
  const primaryNo = numbers.invoiceNo ?? numbers.salesOrderNo ?? receiptNo;
  const input: SaleDocInput = {
    invoiceNo: primaryNo, receiptNo, issuedAt: new Date(),
    clientName: String(parent.client_name ?? 'Client'),
    clientEmail: parent.client_email ?? client?.email, clientPhone: client?.phone, clientAddress: client?.address,
    beneficiaryName: parent.beneficiary_name, beneficiaryPhone: parent.beneficiary_phone, beneficiaryEmail: parent.beneficiary_email,
    beneficiaryAddress: parent.beneficiary_address, beneficiaryRelationship: parent.beneficiary_relationship,
    propertyName: parent.property_name, plotReference: parent.plot_reference, saleReference: parent.sale_reference,
    transactionType: isTopUp ? 'TOP_UP linked to sale' : s.transaction_type, paymentPlan: parent.payment_plan,
    paymentReference: s.payment_reference, previousPaymentReference: priorPayment?.payment_reference ?? null,
    estateValue, amountPaid: paid, totalPaidToDate: totalPaid, issuedBy: String(actor?.name ?? 'Accounts'),
  };
  const suffix = reissued ? ` (reissued to ${s.beneficiary_name})` : '';
  if (numbers.invoiceNo) {
    await addDoc(ctx, s.id, 'INVOICE', await storePdf(ctx, `${numbers.invoiceNo}.pdf`, await buildInvoicePdf(input)), `Invoice ${numbers.invoiceNo}${suffix}`);
  }
  if (numbers.salesOrderNo) {
    await addDoc(ctx, s.id, 'SALES_ORDER', await storePdf(ctx, `${numbers.salesOrderNo}.pdf`, await buildSalesOrderPdf(input)), `Sales order ${numbers.salesOrderNo}${suffix}`);
  }
  await addDoc(ctx, s.id, 'SALES_RECEIPT', await storePdf(ctx, `${receiptNo}.pdf`, await buildReceiptPdf(input)), `Sales receipt ${receiptNo}${suffix}`);
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

async function assertAllocationPaid(ctx: Ctx, s: Row) {
  const root = String(s.transaction_type ?? '').toUpperCase() === 'TOP_UP' && s.parent_sale_id
    ? await one(ctx, `select * from sales where id=$1::uuid`, [s.parent_sale_id])
    : s;
  if (!root) throw new WorkflowError('The original sale for this transaction could not be found.');

  const required = Number(root.estate_value ?? root.quoted_amount ?? root.amount ?? 0);
  if (!(required > 0)) throw new WorkflowError('The original sale has no valid estate value.');

  const paid = await one(ctx, `
    select coalesce(sum(coalesce(payment_amount, amount, 0)),0) as paid
    from sales
    where status <> 'CANCELLED'
      and (id=$1::uuid or parent_sale_id=$1::uuid)
      and payment_status='VERIFIED'
  `, [root.id]);
  const verified = Number(paid?.paid ?? 0);
  const outstanding = Math.max(0, required - verified);
  if (outstanding > 0.005) {
    throw new WorkflowError(`Allocation is blocked until the property is fully paid. Outstanding balance: ${money(outstanding)}`);
  }
}
export const SALE_CHAIN: Step[] = [
  { step: 'Sales Manager approval', role: 'SALES_MANAGER', seq: 1 },
  { step: 'Operations Manager approval', role: 'OPERATIONS_MANAGER', seq: 2 },
  { step: 'HR internal audit', role: 'HR', seq: 3 },
  { step: 'CEO final approval', role: 'CEO', seq: 4 },
];
const REQUIRED_DOCS = ['PAYMENT_PROOF', 'CONTRACT', 'ACKNOWLEDGMENT_LETTER', 'DEED_OF_ASSIGNMENT', 'SURVEY_PLAN'];
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
      await notifyRoles(ctx, SALE_APPROVERS, n);
      await notifyUsers(ctx, [s.created_by], { ...n, title: 'Sale sent for approval', message: `${saleLabel(s)} is awaiting Sales Manager approval.` });
      return 'Sale submitted for Sales Manager approval';
    },
  },
  {
    key: 'approve_new_sale', label: 'Approve new sale',
    help: 'Sales Manager or Operations Manager reviews the submitted sale. Payment processing cannot start until this approval is completed.',
    // Sales organizers can approve submitted sales, but the self-approval guard in
    // performSaleAction prevents them from approving a sale they created.
    roles: ['SALES', ...SALE_APPROVERS], from: ['PENDING_SALES_APPROVAL'], to: 'DRAFT',
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
      await notifyRoles(ctx, ['SALES_MANAGER'], { title: 'Payment proof awaiting approval', message: `${saleLabel(s)} ��� reference ${i.payment_reference}. Approve or cancel this sale.`, link: saleLink(s) });
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
    key: 'enter_invoice', label: 'Generate account documents',
    help: 'Verify the payment, then generate the account documents for this transaction. Outright purchases get an invoice and sales receipt, installment purchases get a sales order and sales receipt, and top-ups get a sales receipt only. Numbers and PDFs are generated automatically. The sale is then sent back to Sales for approval.',
    roles: ['ACCOUNTANT', 'FINANCE_OPERATIONS'], from: ['PAYMENT_PROOF_SUBMITTED', 'DRAFT'], to: 'INVOICE_ENTERED',
    fields: [
      { name: 'note', label: 'Note to Sales (optional)', type: 'textarea' },
    ],
    async apply(ctx, s, i) {
      const paid = Number(s.payment_amount ?? 0);
      if (!(paid > 0)) throw new WorkflowError('No payment amount is recorded on this sale — ask Sales to update the payment amount before generating account documents');
      const existing = storedDocNumbers(s);
      if (existing) throw new WorkflowError(`Account documents (${describeDocs(existing)}) have already been generated for this sale`);
      const numbers = await allocateDocNumbers(ctx, s);
      await saveDocNumbers(ctx, s.id, numbers);
      await ctx.tx.query(`update sales set amount=$2, payment_status='VERIFIED', invoice_variance_reason=null where id=$1`, [s.id, paid]);
      await attachAccountDocuments(ctx, s, numbers, paid);
      const docs = describeDocs(numbers);
      const note = i.note ? ` Note: ${i.note}` : '';
      const n = { title: 'Account documents generated – sale awaiting approval', message: `${saleLabel(s)} — ${docs} for ${money(paid)} (payment made).${note}`, link: saleLink(s) };
      await notifyRoles(ctx, SALE_APPROVERS, n);
      await notifyUsers(ctx, [s.created_by], n);
      return `Generated ${docs} · ${money(paid)}${note}`;
    },
  },
  {
    key: 'reject_sale', label: 'Send back to Accounts', danger: true,
    help: 'Invoice or payment details are wrong – return to the Accountant.',
    roles: SALE_APPROVERS, from: ['INVOICE_ENTERED'], to: 'PAYMENT_PROOF_SUBMITTED', fields: [reason],
    async apply(ctx, s, i) {
      await ctx.tx.query(`update sales set payment_status='PROOF_SUBMITTED' where id=$1`, [s.id]);
      await notifyRoles(ctx, ['ACCOUNTANT'], { title: 'Sale returned to Accounts', message: `${saleLabel(s)}: ${i.reason}`, link: saleLink(s) });
      await notifyUsers(ctx, [s.created_by], { title: 'Sale returned to Accounts', message: `${saleLabel(s)}: ${i.reason}`, link: saleLink(s) });
      return String(i.reason);
    },
  },
  {
    key: 'approve_sale', label: 'Approve sale',
    help: 'Sales Manager or Operations Manager confirms the sale. Operations then receives the approved sale.',
    roles: SALE_APPROVERS, from: ['INVOICE_ENTERED'], to: 'SALES_APPROVED',
    fields: [{ name: 'note', label: 'Note (optional)', type: 'textarea' }],
    async apply(ctx, s) {
      // Recorded so the later "Sales Manager approval" step of the SALE_CHAIN can
      // require a *different* Sales Manager — one person shouldn't bless the same
      // sale twice under two different hats.
      await ctx.tx.query(`update sales set gate_approved_by=$2 where id=$1`, [s.id, ctx.actor.id]);
      if (s.transaction_type === 'TOP_UP') {
        const n = { title: 'Approved top-up received', message: `${saleLabel(s)}. The top-up receipt is ready; continue the top-up to allocation. No contract or acknowledgement is required.`, link: saleLink(s) };
        await notifyRoles(ctx, OPS, n);
        await notifyUsers(ctx, [s.created_by], { ...n, title: 'Your top-up was approved', message: `${saleLabel(s)} top-up is with Operations for the next step.` });
      } else {
        await openTask(ctx, s.id, 'SALE_DOCUMENTS');
        const n = { title: 'Approved sale received', message: `${saleLabel(s)}. Create the Contract of Sale and Letter of Acknowledgment.`, link: saleLink(s) };
        await notifyRoles(ctx, OPS, n);
        await notifyUsers(ctx, [s.created_by], { ...n, title: 'Your sale was approved', message: `${saleLabel(s)} is with Operations.` });
      }
    },
  },
  {
    key: 'skip_topup_documents', label: 'Continue top-up to allocation',
    help: 'Top-ups receive only a sales receipt; no contract, acknowledgement, invoice or sales order is required.',
    roles: OPS, from: ['SALES_APPROVED'], to: 'SITE_NOTIFIED',
    fields: [{ name: 'note', label: 'Note (optional)', type: 'textarea' }],
    async apply(ctx, s, i) {
      if (s.transaction_type !== 'TOP_UP') throw new WorkflowError('This shortcut is only available for top-up transactions');
      await ctx.tx.query(`update sales set ops_due_date = current_date + ${ALLOCATION_WINDOW_DAYS} where id=$1`, [s.id]);
      await openTask(ctx, s.id, 'ALLOCATION_DOCS', ALLOCATION_WINDOW_DAYS, 'Deed of assignment + survey plan');
      await notifyRoles(ctx, ['SITE_MANAGER'], { title: 'Top-up ready for allocation', message: `${saleLabel(s)}. The sales receipt has been issued; no invoice or sales order is required.${i.note ? ` ${i.note}` : ''}`, link: saleLink(s) });
    },
  },
  {
    key: 'create_contract', label: 'Create sale documents',
    help: 'Operations prepares the Contract of Sale and Letter of Acknowledgment. On submission the sale goes back to Accounts.',
    roles: OPS, from: ['SALES_APPROVED'], to: 'CONTRACT_PREPARED',
    fields: [
      { name: 'contract_url', label: 'Contract of Sale', type: 'file', required: true },
      { name: 'acknowledgment_url', label: 'Letter of Acknowledgment', type: 'file', required: true },
    ],
    async apply(ctx, s, i) {
      if (s.transaction_type === 'TOP_UP') throw new WorkflowError('Top-up transactions do not receive sale documents');
      await addDoc(ctx, s.id, 'CONTRACT', i.contract_url, 'Contract of Sale');
      await addDoc(ctx, s.id, 'ACKNOWLEDGMENT_LETTER', i.acknowledgment_url, 'Letter of Acknowledgment');
      await closeTasks(ctx, s.id, 'SALE_DOCUMENTS');
      const originator = await one(ctx, `select id, role from users where id=$1 and active=true`, [s.created_by]);
      if (!originator) throw new WorkflowError('The sales originator is no longer active and cannot approve these documents');
      const originatorRole: Role = originator.role === 'SALES_MANAGER' ? 'SALES_MANAGER' : 'SALES';
      const steps: Step[] = [
        { step: 'Sales originator approval', role: originatorRole, seq: 1, userId: s.created_by },
        { step: 'Sales Manager approval', role: 'SALES_MANAGER', seq: 2, userId: undefined },
      ];
      await openRound(ctx, 'SALE', s.id, 'SALE_DOCUMENTS_APPROVAL', Number(s.chain_round || 0) + 1, steps);
      await notifyUsers(ctx, [s.created_by], { title: 'Operations documents ready for your approval', message: `${saleLabel(s)} — review the Contract of Sale and Letter of Acknowledgment.`, link: saleLink(s) });
      await notifyRoles(ctx, ['SALES_MANAGER'], { title: 'Operations documents awaiting approval', message: `${saleLabel(s)} — review the three documents submitted by Operations.`, link: saleLink(s) });
    },
  },
  {
    key: 'send_sales_documents', label: 'Send account documents',
    help: 'Send the system-generated account documents for this transaction to the client. Any missing document numbers and PDFs are generated automatically. Operations is notified.',
    roles: ['ACCOUNTANT'], from: ['CONTRACT_PREPARED'], to: 'ACCOUNT_DOCS_SENT',
    fields: [],
    async apply(ctx, s) {
      const documentApprovals = await one(ctx, `select count(*)::int as n from approvals where entity_type='SALE' and entity_id=$1 and round='SALE_DOCUMENTS_APPROVAL' and status='APPROVED'`, [s.id]);
      if (Number(documentApprovals?.n || 0) < 2) throw new WorkflowError('Sales originator and Sales Manager must approve the Operations documents first');
      let numbers = storedDocNumbers(s);
      if (!numbers) {
        numbers = await allocateDocNumbers(ctx, s);
        await saveDocNumbers(ctx, s.id, numbers);
        await attachAccountDocuments(ctx, s, numbers, Number(s.payment_amount ?? s.amount ?? 0));
      }
      const docs = describeDocs(numbers);
      await notifyRoles(ctx, OPS, { title: 'Sales documents sent', message: `${saleLabel(s)} — ${docs}. Open the operations portal for allocation.`, link: saleLink(s) });
      await notifyUsers(ctx, [s.created_by], { title: 'Sales documents sent to client', message: `${saleLabel(s)} — ${docs}`, link: saleLink(s) });
      mailClient(ctx, s.client_email, 'Your Landblaze account documents',
        `Dear ${s.client_name},\n\nYour ${docs} have been issued.\n\nLandblaze`);
      return `Sent ${docs}`;
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
    key: 'upload_allocation_docs', label: 'Upload allocation documents',
    help: 'Operations can submit the deed of assignment and survey plan together when both documents are available.',
    roles: ['OPERATIONS', 'OPERATIONS_MANAGER'], from: ['SITE_NOTIFIED', 'OPS_DEED_UPLOADED', 'RETURNED'], to: 'OPS_DOCS_UPLOADED',
    fields: [
      { name: 'deed_of_assignment_url', label: 'Deed of assignment', type: 'file', required: true },
      { name: 'survey_plan_url', label: 'Survey plan', type: 'file', required: true },
    ],
    async apply(ctx, s, i) {
      await addDoc(ctx, s.id, 'DEED_OF_ASSIGNMENT', i.deed_of_assignment_url, 'Deed of assignment');
      await addDoc(ctx, s.id, 'SURVEY_PLAN', i.survey_plan_url, 'Survey plan');
      await closeTasks(ctx, s.id, 'ALLOCATION_DOCS');
      await notifyRoles(ctx, ['SITE_MANAGER'], { title: 'Allocation documents uploaded', message: `${saleLabel(s)}. Perform the final audit.`, link: saleLink(s) });
      return 'Deed of assignment and survey plan uploaded';
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
      const nature = documentNature(s);
      const accountDocTypes = nature === 'OUTRIGHT'
        ? ['INVOICE', 'SALES_RECEIPT']
        : nature === 'INSTALLMENT'
          ? ['SALES_ORDER', 'SALES_RECEIPT']
          : ['SALES_RECEIPT'];
      for (const type of accountDocTypes) {
        if (!have.has(type)) missing.push(type);
      }
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
      await assertAllocationPaid(ctx, s);
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
      await assertAllocationPaid(ctx, s);
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
      await assertAllocationPaid(ctx, s);
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
    if (a.key === 'approve_new_sale' && s.created_by === actor.id) throw new ForbiddenError('You cannot approve your own sale');
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
  const isPrivilegedEditor = actor.role === 'SUPER_ADMIN' || SALE_APPROVERS.includes(actor.role);
  const isSalesExecutive = actor.role === 'SALES';
  if (!isPrivilegedEditor && !isSalesExecutive) throw new ForbiddenError('Only the sale owner or an approver can edit a sale');
  const p = parseFields(SALE_EDIT_FIELDS, input);
  return run(actor, async ctx => {
    const sale = await one(ctx, `select * from sales where id=$1 for update`, [saleId]);
    if (!sale) throw new WorkflowError('Sale not found');
    const canEditDraft = sale.status === 'DRAFT' && isSalesExecutive && sale.created_by === actor.id;
    const canEditSubmitted = sale.status === 'PENDING_SALES_APPROVAL' && isPrivilegedEditor;
    if (!canEditDraft && !canEditSubmitted) {
      throw new WorkflowError(canEditDraft || canEditSubmitted
        ? 'This sale cannot be edited in its current stage'
        : 'Sales executives can only edit their own saved drafts; submitted sales are locked');
    }
    const taken = await one(ctx, `select id from sales where lower(property_name)=lower($1) and lower(plot_reference)=lower($2) and id<>$3 and status<>'CANCELLED' limit 1`, [p.property_name, p.plot_reference, saleId]);
    if (taken) throw new WorkflowError('This plot is already attached to another active sale');
    await ctx.tx.query(`update sales set property_name=$2, plot_reference=$3, estate_value=$4, payment_amount=$5, quoted_amount=$4, amount=$5, payment_plan=$6, description=$7, updated_at=now() where id=$1`, [saleId, p.property_name, p.plot_reference, p.estate_value, p.payment_amount, p.payment_plan, p.description]);
    await logEvent(ctx, 'SALE', saleId, 'SALES', 'Sale adjusted by Sales Manager', sale.status, sale.status, `${p.property_name} / ${p.plot_reference}`);
    await notifyUsers(ctx, [sale.created_by], { title: 'Sale adjusted by Sales Manager', message: `${saleLabel(sale)} was adjusted during approval review.`, link: saleLink(saleId) });
    return saleId;
  });
}

export async function recordSaleTopUp(actor: Actor, saleId: string, input: Record<string, unknown>) {
  if (actor.role !== 'SUPER_ADMIN' && !['SALES', 'SALES_MANAGER'].includes(actor.role)) throw new ForbiddenError('Only the sales team can record top-ups');
  const p = parseFields([
    { name: 'payment_amount', label: 'Top-up amount (₦)', type: 'number', required: true, min: 1 },
    { name: 'payment_reference', label: 'Payment reference', type: 'text', required: true },
    { name: 'payment_bank', label: 'Receiving bank', type: 'select', required: true, options: ['Providus', 'Titan', 'Zenith'] },
  ], input);
  const paymentAmount = Number(p.payment_amount);
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) throw new WorkflowError('Top-up amount must be greater than ₦0.');
  return run(actor, async ctx => {
    const sale = await one(ctx, `select * from sales where id=$1 and status<>'CANCELLED'`, [saleId]);
    if (!sale) throw new WorkflowError('The existing sale could not be found.');
    const topup = await one(ctx, `insert into sales(sale_reference, transaction_type, parent_sale_id, client_id, lead_id, client_name, client_email, property_name, plot_reference, amount, estate_value, payment_amount, quoted_amount, payment_plan, description, status, payment_status, payment_reference, payment_bank, created_by, beneficiary_name, beneficiary_phone, beneficiary_email, beneficiary_address, beneficiary_relationship)
      values('TOPUP-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('sale_reference_seq')::text, 6, '0'), 'TOP_UP', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, 'Top-up for ' || $12, 'DRAFT', 'UNPAID', $12, $13, $14, $15, $16, $17, $18, $19)
      returning id`, [sale.id, sale.client_id, sale.lead_id, sale.client_name, sale.client_email, sale.property_name, sale.plot_reference, paymentAmount, sale.estate_value, sale.payment_plan, sale.sale_reference, p.payment_reference, p.payment_bank, actor.id, sale.beneficiary_name, sale.beneficiary_phone, sale.beneficiary_email, sale.beneficiary_address, sale.beneficiary_relationship]);
    if (!topup) throw new WorkflowError('The top-up could not be linked to the existing sale.');
    await logEvent(ctx, 'SALE', topup.id, 'SALES', 'Top-up linked to existing sale', null, 'DRAFT', `${sale.sale_reference} · ${money(paymentAmount)}`);
    await audit(ctx, 'SALE_TOPUP_CREATED', 'SALE', topup.id, { parent_sale_id: sale.id, sale_reference: sale.sale_reference, amount: paymentAmount, bank: p.payment_bank });
    return topup.id as string;
  });
}

export async function createSale(actor: Actor, input: Record<string, unknown>) {
  if (actor.role !== 'SUPER_ADMIN' && !['SALES', 'SALES_MANAGER'].includes(actor.role)) throw new ForbiddenError('Only the sales team can create sales');
  const normalizedInput = {
    ...input,
    estate_value: input.estate_value ?? input.amount,
    payment_amount: input.payment_amount ?? input.amount,
    payment_plan: input.payment_plan ?? 'OUTRIGHT',
    transaction_type: input.transaction_type ?? 'INITIAL_DEPOSIT',
  };
  const p = parseFields([
    { name: 'client_id', label: 'Client', type: 'text', required: true },
    { name: 'property_name', label: 'Estate / property', type: 'text', required: true },
    { name: 'plot_reference', label: 'Plot reference', type: 'text', required: true },
{ name: 'estate_value', label: 'Estate value (₦)', type: 'number', required: true, min: 1 },
  { name: 'payment_amount', label: 'Payment amount (₦)', type: 'number', required: true, min: 1 },
  { name: 'payment_plan', label: 'Payment plan', type: 'select', required: true, options: ['OUTRIGHT', 'INSTALLMENT'] },
  { name: 'transaction_type', label: 'Transaction type', type: 'select', required: true, options: ['INITIAL_DEPOSIT', 'TOP_UP'] },
  { name: 'description', label: 'Description', type: 'textarea' },
    { name: 'payment_proof_url', label: 'Payment evidence', type: 'file', uploadPurpose: 'sales_payment_evidence' },
    { name: 'payment_reference', label: 'Payment reference', type: 'text' },
  { name: 'payment_bank', label: 'Receiving bank', type: 'select', options: ['Providus', 'Titan', 'Zenith'] },
    ...BENEFICIARY_FIELDS,
  ], normalizedInput);
  if (p.payment_proof_url && !p.payment_reference) throw new WorkflowError('Payment reference is required when payment evidence is uploaded');
  if (!/^[0-9a-f-]{36}$/i.test(String(p.client_id))) throw new WorkflowError('Client has an invalid format. Please select a client from the list.');
  if (!['OUTRIGHT', 'INSTALLMENT'].includes(String(p.payment_plan))) throw new WorkflowError('Payment plan has an invalid value. Please select Outright or Installment.');
  const estateValue = Number(p.estate_value);
  const paymentAmount = Number(p.payment_amount);
  if (!Number.isFinite(estateValue) || estateValue <= 0) throw new WorkflowError('Estate value must be a valid amount greater than ₦0.');
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) throw new WorkflowError('Payment amount must be a valid amount greater than ₦0.');
  if (p.transaction_type === 'INITIAL_DEPOSIT' && paymentAmount > estateValue) throw new WorkflowError('Payment amount cannot be greater than the estate value. Check the amount entered.');
  return run(actor, async ctx => {
    const client = await one(ctx, `select * from clients where id=$1`, [p.client_id]);
    if (!client) throw new WorkflowError('Client not found');
    let parentSale: Row | undefined;
    if (p.transaction_type === 'TOP_UP') {
      if (!p.topup_sale_id || !/^[0-9a-f-]{36}$/i.test(String(p.topup_sale_id))) {
        throw new WorkflowError('A top-up must be linked to the existing sale. Open the existing sale and use the Top up button.');
      }
      parentSale = await one(ctx, 'select * from sales where id=$1::uuid for update', [p.topup_sale_id]);
      if (!parentSale) throw new WorkflowError('The original sale for this top-up could not be found.');
      if (parentSale.status === 'CANCELLED') throw new WorkflowError('A top-up cannot be recorded against a cancelled sale.');
      if (String(parentSale.transaction_type ?? 'INITIAL_DEPOSIT').toUpperCase() === 'TOP_UP') throw new WorkflowError('A top-up must be linked to the original sale, not another top-up transaction.');
      if (actor.role === 'SALES' && parentSale.created_by !== actor.id) throw new ForbiddenError('You can only record a top-up against a sale you created.');
      if (String(parentSale.client_id) !== String(client.id)) throw new WorkflowError('The selected client does not match the original sale.');
      const committed = await one(ctx, 'select coalesce(sum(coalesce(payment_amount, amount, 0)),0) as committed from sales where (id=$1::uuid or parent_sale_id=$1::uuid) and status <> \'CANCELLED\'', [parentSale.id]);
      const estateValue = Number(parentSale.estate_value ?? parentSale.quoted_amount ?? parentSale.amount ?? 0);
      const committedAmount = Number(committed?.committed ?? 0);
      if (!(estateValue > 0)) throw new WorkflowError('The original sale has no valid estate value.');
      if (committedAmount + paymentAmount > estateValue + 0.005) throw new WorkflowError(`This top-up exceeds the remaining balance of ${money(Math.max(0, estateValue - committedAmount))} on the original sale.`);
    } else {
      const taken = await one(ctx, 'select id, sale_reference, transaction_type from sales where lower(property_name)=lower($1) and lower(plot_reference)=lower($2) and status<>\'CANCELLED\' and coalesce(transaction_type,\'INITIAL_DEPOSIT\')<>\'TOP_UP\' limit 1', [p.property_name, p.plot_reference]);
      if (taken) throw new WorkflowError('This plot is already attached to another active sale (double-sale prevention). Check the estate and plot reference entered.');
    }    if (p.payment_proof_url) {
      await assertOwnedUpload(ctx, p.payment_proof_url, 'Payment evidence', 'sales_payment_evidence');
      await assertFreshEvidence(ctx, p.payment_proof_url, 'payment evidence');
    }
  const baseSale = parentSale;
  const propertyName = baseSale?.property_name ?? p.property_name;
  const plotReference = baseSale?.plot_reference ?? p.plot_reference;
  const estateValueForRow = baseSale?.estate_value ?? p.estate_value;
  const paymentPlanForRow = baseSale?.payment_plan ?? p.payment_plan;
  const beneficiaryName = baseSale?.beneficiary_name ?? p.beneficiary_name ?? client.name;
  const beneficiaryPhone = baseSale?.beneficiary_phone ?? p.beneficiary_phone ?? client.phone;
  if (!beneficiaryName || !beneficiaryPhone) throw new WorkflowError('Beneficiary full name and phone are required');
  const paymentStatus = p.payment_proof_url ? 'PROOF_SUBMITTED' : 'UNPAID';
  const salePrefix = p.transaction_type === 'TOP_UP' ? 'TOPUP-' : 'SALE-';
  const s = (await one(ctx,
    'insert into sales(sale_reference,transaction_type,parent_sale_id,client_id,lead_id,client_name,client_email,property_name,plot_reference,amount,estate_value,payment_amount,quoted_amount,payment_plan,description,status,payment_status,payment_reference,payment_bank,created_by,beneficiary_name,beneficiary_phone,beneficiary_email,beneficiary_address,beneficiary_relationship) values($1 || to_char(now(), \'YYYYMM\') || \'-\' || lpad(nextval(\'sale_reference_seq\')::text, 6, \'0\'), $2, $3, $4, (select id from leads where client_id=$4 limit 1), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, \'DRAFT\', $15, $16, $17, $18, $19, $20, $21, $22, $23) returning id, sale_reference',
    [salePrefix, String(p.transaction_type), baseSale?.id ?? null, client.id, client.name, client.email, propertyName, plotReference, paymentAmount, Number(estateValueForRow), paymentAmount, paymentAmount, String(paymentPlanForRow), p.description ?? null, paymentStatus, p.payment_reference ?? null, p.payment_bank ?? null, actor.id, beneficiaryName, beneficiaryPhone, baseSale?.beneficiary_email ?? p.beneficiary_email ?? null, baseSale?.beneficiary_address ?? p.beneficiary_address ?? null, baseSale?.beneficiary_relationship ?? p.beneficiary_relationship ?? 'Self']))!;  if (p.payment_proof_url) {
      const m = String(p.payment_proof_url).match(/^\/api\/files\/([0-9a-f-]{36})$/i)!;
      await ctx.tx.query(`insert into sale_documents(sale_id,document_type,document_name,document_url,uploaded_file_id,uploaded_by) values($1,'PAYMENT_PROOF','Payment evidence',$2,$3::uuid,$4)`, [s.id, p.payment_proof_url, m[1], actor.id]);
    }
  await logEvent(ctx, 'SALE', s.id, 'SALES', 'Sale saved as draft', null, 'DRAFT', `${p.property_name} / ${p.plot_reference} · estate ${money(p.estate_value)} · payment ${money(p.payment_amount)} (${p.payment_plan})${p.payment_proof_url ? ' · payment evidence attached' : ''}`);
  await audit(ctx, 'SALE_CREATED', 'SALE', s.id, { client: client.name, status: 'DRAFT', payment_evidence_attached: !!p.payment_proof_url });
  await notifyUsers(ctx, [actor.id], { title: 'Sale saved as draft', message: `${client.name} — ${p.property_name} / ${p.plot_reference} is saved as a draft. Submit it for Sales Manager approval when ready.`, link: saleLink(s.id) });
    return s.id as string;
  });
}

export const BENEFICIARY_FIELDS: Field[] = [
  { name: 'beneficiary_name', label: 'Beneficiary full name', type: 'text', required: true },
  { name: 'beneficiary_phone', label: 'Beneficiary phone', type: 'text', required: true },
  { name: 'beneficiary_email', label: 'Beneficiary email', type: 'text' },
  { name: 'beneficiary_address', label: 'Beneficiary address', type: 'textarea' },
  { name: 'beneficiary_relationship', label: 'Relationship to client', type: 'text' },
];
const BENEFICIARY_EDITORS: Role[] = ['SALES', 'SALES_MANAGER', 'OPERATIONS_MANAGER'];

export function canChangeBeneficiary(sale: Row, actor: Actor) {
  if (sale.status === 'CANCELLED' || sale.status === 'ALLOCATED') return false;
  if (actor.role === 'SUPER_ADMIN') return true;
  if (!BENEFICIARY_EDITORS.includes(actor.role)) return false;
  return actor.role !== 'SALES' || sale.created_by === actor.id;
}

/** Replaces the property beneficiary, keeps an audit trail and reissues any invoice/receipt in the new beneficiary's favour. */
export async function changeBeneficiary(actor: Actor, saleId: string, input: Record<string, unknown>) {
  const p = parseFields([...BENEFICIARY_FIELDS, reason], input);
  return run(actor, async ctx => {
    const s = await one(ctx, `select * from sales where id=$1 for update`, [saleId]);
    if (!s) throw new WorkflowError('Sale not found');
    if (!canChangeBeneficiary(s, actor)) throw new ForbiddenError(s.status === 'CANCELLED' || s.status === 'ALLOCATED'
      ? `The beneficiary cannot be changed while the sale is "${SALE_STATUS_LABEL[s.status] ?? s.status}"`
      : 'Your role is not permitted to change the beneficiary on this sale');
    const pick = (r: Row) => ({ name: r.beneficiary_name ?? null, phone: r.beneficiary_phone ?? null, email: r.beneficiary_email ?? null, address: r.beneficiary_address ?? null, relationship: r.beneficiary_relationship ?? null });
    const previous = pick(s);
    const updated = (await one(ctx,
      `update sales set beneficiary_name=$2, beneficiary_phone=$3, beneficiary_email=$4, beneficiary_address=$5, beneficiary_relationship=$6, updated_at=now() where id=$1 returning *`,
      [saleId, p.beneficiary_name, p.beneficiary_phone, p.beneficiary_email ?? null, p.beneficiary_address ?? null, p.beneficiary_relationship ?? null]))!;
    await ctx.tx.query(`insert into sale_beneficiary_changes(sale_id, previous, current, reason, changed_by) values($1,$2,$3,$4,$5)`,
      [saleId, JSON.stringify(previous), JSON.stringify(pick(updated)), p.reason, actor.id]);
    const reissue = !!updated.invoice_number;
    const reissueNumbers = reissue ? storedDocNumbers(updated) : null;
  if (reissueNumbers) await attachAccountDocuments(ctx, updated, reissueNumbers, Number(updated.payment_amount ?? updated.amount ?? 0), true);
    const notes = `${previous.name || 'No beneficiary'} → ${p.beneficiary_name}. Reason: ${p.reason}${reissue ? ' · invoice and receipt reissued' : ''}`;
    await logEvent(ctx, 'SALE', saleId, 'SALES', 'Property beneficiary changed', s.status, s.status, notes);
    await audit(ctx, 'SALE_BENEFICIARY_CHANGED', 'SALE', saleId, { previous, current: pick(updated), reason: p.reason });
    const n = { title: 'Property beneficiary changed', message: `${saleLabel(s)} — ${notes}`, link: saleLink(saleId) };
    await notifyRoles(ctx, ['SALES_MANAGER', 'OPERATIONS_MANAGER', 'ACCOUNTANT'], n);
    if (s.created_by && s.created_by !== actor.id) await notifyUsers(ctx, [s.created_by], n);
    return saleId;
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
    if (approval.step !== 'Sales Manager approval' && approval.step !== 'Operations Manager approval') return null;
    const s = await one(ctx, `select gate_approved_by from sales where id=$1`, [approval.entity_id]);
    if (s?.gate_approved_by && s.gate_approved_by === actor.id)
      return 'You already approved this sale earlier in the process — a different approver must complete this audit step';
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
