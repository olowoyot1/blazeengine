/**
 * End-to-end workflow + rights tests against a real in-process PostgreSQL (PGlite).
 * Run: npm test
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const pg = new PGlite();
(globalThis as any).__LB_DB__ = {
  sql: async (strings: TemplateStringsArray, ...values: unknown[]) =>
    (await pg.query(strings.reduce((a, s, i) => a + (i ? `$${i}` : '') + s, ''), values as any[])).rows,
  withTx: (fn: any) => pg.transaction(async t => fn({ query: (text: string, params?: unknown[]) => t.query(text, params as any[]) })),
};

let pass = 0, fail = 0;
const failures: string[] = [];
async function t(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log('  ✓', name); }
  catch (e: any) { fail++; failures.push(name); console.log('  ✗', name, '\n     ', e.message); }
}
async function denied(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e: any) { assert.match(e.message, re, `wrong error: ${e.message}`); return; }
  assert.fail(`expected failure matching ${re}`);
}

import * as wf from '../lib/workflow';

async function main() {
  const { can, saleScope, expenseScope } = await import('../lib/rbac');
  await pg.exec(readFileSync('db/schema.sql', 'utf8'));

  const roles = ['ADMIN', 'CEO', 'HR', 'SALES_MANAGER', 'SALES', 'MARKETER', 'ACCOUNTANT', 'FINANCE_OPERATIONS', 'OPERATIONS_MANAGER', 'OPERATIONS', 'SITE_MANAGER'] as const;
  const U: Record<string, wf.Actor> = {};
  for (const r of roles) {
    const row = (await pg.query(`insert into users(name,email,password_hash,role) values($1,$2,'x',$3) returning id`, [r, `${r.toLowerCase()}@t.io`, r])).rows[0] as any;
    U[r] = { id: row.id, name: r, role: r };
  }
  const other = (await pg.query(`insert into users(name,email,password_hash,role) values('SALES2','s2@t.io','x','SALES') returning id`)).rows[0] as any;
  const SALES2: wf.Actor = { id: other.id, name: 'SALES2', role: 'SALES' };
  // Separation of duties: a second Sales Manager represents the independent audit-step
  // approver, distinct from whoever performed the earlier "approve sale" gate.
  const sm2 = (await pg.query(`insert into users(name,email,password_hash,role) values('SALES_MANAGER2','sm2@t.io','x','SALES_MANAGER') returning id`)).rows[0] as any;
  const SALES_MANAGER2: wf.Actor = { id: sm2.id, name: 'SALES_MANAGER2', role: 'SALES_MANAGER' };
  const status = async (id: string) => ((await pg.query(`select status from sales where id=$1`, [id])).rows[0] as any).status;
  const estatus = async (id: string) => ((await pg.query(`select status from expenses where id=$1`, [id])).rows[0] as any).status;
  const unread = async (userId: string) => Number(((await pg.query(`select count(*) n from notifications where user_id=$1`, [userId])).rows[0] as any).n);
  const pendingFor = async (id: string, role: string) => (await pg.query(`select * from approvals where entity_id=$1 and approver_role=$2 and status='PENDING' order by created_at`, [id, role])).rows as any[];
  const act = (a: wf.Actor, id: string, key: string, input: any = {}) => wf.performSaleAction(a, id, key, input);
  const url = (n: string) => `https://files.example.com/${n}.pdf`;

  console.log('\nRights matrix');
  await t('ADMIN manages users but cannot act in workflow', async () => {
    assert.ok(can('ADMIN', 'users.manage'));
    assert.ok(!can('ADMIN', 'sale.create'));
    await denied(wf.createLead(U.ADMIN, { name: 'x', phone: '1' }), /cannot create leads/);
  });
  await t('only site manager sees site workspace; finance ops sees no sales', async () => {
    assert.ok(can('SITE_MANAGER', 'site.workspace') && !can('OPERATIONS', 'site.workspace'));
    const s = saleScope({ id: 'x', role: 'FINANCE_OPERATIONS' });
    assert.ok(!s.all && !s.own && s.statuses.length === 0);
    assert.ok(!saleScope({ id: 'x', role: 'OPERATIONS' }).statuses.includes('DRAFT'));
    assert.ok(!expenseScope({ id: 'x', role: 'SALES' }).all);
  });

  console.log('\nLeads → clients (marketer, 10/day target, dedupe)');
  let leadId = '', clientId = '';
  await t('marketer creates lead; duplicate phone blocked', async () => {
    leadId = await wf.createLead(U.MARKETER, { name: 'Ada Obi', phone: '0803', email: 'ada@x.com', source: 'IG' });
    await denied(wf.createLead(U.SALES, { name: 'Ada again', phone: '0803' }), /already exists/);
    await denied(wf.createLead(U.MARKETER, { name: 'No contact' }), /phone number or an email/);
  });
  await t('only owner/manager can convert; conversion creates client', async () => {
    await denied(wf.convertLead(U.ACCOUNTANT, leadId), /cannot|only convert/i);
    await denied(wf.convertLead(SALES2, leadId), /only convert your own/);
    clientId = await wf.convertLead(U.MARKETER, leadId);
    assert.equal(((await pg.query(`select status from leads where id=$1`, [leadId])).rows[0] as any).status, 'CONVERTED');
    await denied(wf.convertLead(U.MARKETER, leadId), /already converted/);
  });

  console.log('\nSale lifecycle (sheet rows 1–12)');
  let sale = '';
  await t('marketer cannot create a sale; sales exec can; plot double-sale blocked', async () => {
    const f = { client_id: clientId, property_name: 'Blaze Estate', plot_reference: 'A-12', amount: '5000000' };
    await denied(wf.createSale(U.MARKETER, f), /Only the sales team/);
    sale = await wf.createSale(U.SALES, f);
    await denied(wf.createSale(U.SALES_MANAGER, { ...f, plot_reference: 'a-12' }), /already attached/);
    assert.equal(await status(sale), 'DRAFT');
  });
  await t('wrong role / wrong owner / wrong stage are rejected', async () => {
    await denied(act(U.ACCOUNTANT, sale, 'submit_payment_proof', { proof_url: url('p'), payment_reference: 'R1' }), /not permitted/);
    await denied(act(SALES2, sale, 'submit_payment_proof', { proof_url: url('p'), payment_reference: 'R1' }), /only act on sales you created/);
    await denied(act(U.ACCOUNTANT, sale, 'enter_invoice', { invoice_number: 'I1', invoice_amount: '5000000' }), /Not available while/);
    await denied(act(U.SALES, sale, 'submit_payment_proof', { proof_url: 'javascript:alert(1)', payment_reference: 'R1' }), /valid link|http/);
  });
  await t('row1: sales uploads payment proof → accountant notified', async () => {
    await act(U.SALES, sale, 'submit_payment_proof', { proof_url: url('proof'), payment_reference: 'R1', amount_paid: '5000000' });
    assert.equal(await status(sale), 'PAYMENT_PROOF_SUBMITTED');
    assert.equal(await unread(U.ACCOUNTANT.id), 1);
  });
  await t('row2: accountant enters invoice → sales manager + sales exec notified', async () => {
    const sm0 = await unread(U.SALES_MANAGER.id), s0 = await unread(U.SALES.id);
    await act(U.ACCOUNTANT, sale, 'enter_invoice', { invoice_number: 'INV-1', invoice_amount: '5000000' });
    assert.equal(await status(sale), 'INVOICE_ENTERED');
    assert.equal(await unread(U.SALES_MANAGER.id), sm0 + 1);
    assert.equal(await unread(U.SALES.id), s0 + 1);
  });
  await t('sales manager can send back, then approve', async () => {
    await act(U.SALES_MANAGER, sale, 'reject_sale', { reason: 'Amount mismatch' });
    assert.equal(await status(sale), 'PAYMENT_PROOF_SUBMITTED');
  });
  await t('re-enter invoice (same sale may reuse its own number) and approve', async () => {
    await act(U.ACCOUNTANT, sale, 'enter_invoice', { invoice_number: 'INV-1', invoice_amount: '5000000' });
    await denied(act(U.OPERATIONS_MANAGER, sale, 'approve_sale'), /not permitted/);
    await act(U.SALES_MANAGER, sale, 'approve_sale', {});
    assert.equal(await status(sale), 'SALES_APPROVED');
    assert.ok(await unread(U.OPERATIONS.id) >= 1);
  });
  await t('row3: operations creates contract & deed → accounts notified', async () => {
    await denied(act(U.OPERATIONS, sale, 'create_contract', { contract_url: url('c') }), /Deed link is required/);
    await act(U.OPERATIONS, sale, 'create_contract', { contract_url: url('c'), deed_url: url('d') });
    assert.equal(await status(sale), 'CONTRACT_PREPARED');
  });
  await t('row4: accountant sends sales order/receipt/invoice', async () => {
    await act(U.ACCOUNTANT, sale, 'send_sales_documents', { sales_order_no: 'SO1', sales_receipt_no: 'SR1', sales_invoice_no: 'SI1' });
    assert.equal(await status(sale), 'ACCOUNT_DOCS_SENT');
  });
  await t('rows5-6: operations opens portal → site manager notified, 30-day clock set', async () => {
    await act(U.OPERATIONS_MANAGER, sale, 'open_ops_portal', {});
    assert.equal(await status(sale), 'SITE_NOTIFIED');
    assert.equal(await unread(U.SITE_MANAGER.id), 1);
    const r = (await pg.query(`select (ops_due_date - current_date) d from sales where id=$1`, [sale])).rows[0] as any;
    assert.equal(Number(r.d), 30);
    const task = (await pg.query(`select 1 from operations where sale_id=$1 and task_type='ALLOCATION_DOCS' and status='PENDING'`, [sale])).rows;
    assert.equal(task.length, 1);
  });
  await t('site manager cannot audit before ops docs; ops must upload both docs', async () => {
    await denied(act(U.SITE_MANAGER, sale, 'final_audit', { audit_findings: 'ok', confirmed: 'on' }), /Not available/);
    await denied(act(U.OPERATIONS, sale, 'upload_allocation_docs', { deed_of_assignment_url: url('doa') }), /Survey plan link is required/);
  });
  await t('row7: operations uploads deed of assignment + survey', async () => {
    await act(U.OPERATIONS, sale, 'upload_allocation_docs', { deed_of_assignment_url: url('doa'), survey_plan_url: url('sv') });
    assert.equal(await status(sale), 'OPS_DOCS_UPLOADED');
    const task = (await pg.query(`select status from operations where sale_id=$1 and task_type='ALLOCATION_DOCS'`, [sale])).rows[0] as any;
    assert.equal(task.status, 'DONE');
  });
  await t('row8: final audit requires confirmation and starts the chain', async () => {
    await denied(act(U.SITE_MANAGER, sale, 'final_audit', { audit_findings: 'ok' }), /Please confirm/);
    await denied(act(U.OPERATIONS, sale, 'final_audit', { audit_findings: 'ok', confirmed: 'on' }), /not permitted/);
    await act(U.SITE_MANAGER, sale, 'final_audit', { audit_findings: 'All good', confirmed: 'on' });
    assert.equal(await status(sale), 'IN_APPROVAL');
    const steps = (await pg.query(`select approver_role,seq from approvals where entity_id=$1 order by seq`, [sale])).rows as any[];
    assert.deepEqual(steps.map(s => s.approver_role), ['SALES_MANAGER', 'OPERATIONS_MANAGER', 'HR', 'CEO']);
  });
  await t('row9-11: approvals run strictly one by one; wrong role / skipping / self blocked', async () => {
    const [smA] = await pendingFor(sale, 'SALES_MANAGER'), [opA] = await pendingFor(sale, 'OPERATIONS_MANAGER'), [hrA] = await pendingFor(sale, 'HR'), [ceoA] = await pendingFor(sale, 'CEO');
    await denied(wf.decide(U.CEO, ceoA.id, 'APPROVED'), /earlier approval step/);
    await denied(wf.decide(U.HR, hrA.id, 'APPROVED'), /earlier approval step/);
    await denied(wf.decide(U.HR, smA.id, 'APPROVED'), /Only SALES MANAGER/);
    await denied(wf.decide(U.SITE_MANAGER, smA.id, 'APPROVED'), /Only SALES MANAGER/);
    await denied(wf.decide(U.ADMIN, smA.id, 'APPROVED'), /Only SALES MANAGER/);
    // the Sales Manager who approved this sale earlier cannot also clear this step (separation of duties)
    await denied(wf.decide(U.SALES_MANAGER, smA.id, 'APPROVED'), /already approved this sale earlier/);
    await wf.decide(SALES_MANAGER2, smA.id, 'APPROVED');
    await denied(wf.decide(SALES_MANAGER2, smA.id, 'APPROVED'), /already been actioned/);
    // Ops manager rejects → sale returned, remaining steps closed
    await denied(wf.decide(U.OPERATIONS_MANAGER, opA.id, 'REJECTED', ''), /reason is required/);
    await wf.decide(U.OPERATIONS_MANAGER, opA.id, 'REJECTED', 'Survey plan unsigned');
    assert.equal(await status(sale), 'RETURNED');
    assert.equal((await pendingFor(sale, 'HR')).length, 0);
    void hrA; void ceoA;
  });
  await t('returned sale: ops re-uploads, site manager re-audits, new round completes', async () => {
    await act(U.OPERATIONS, sale, 'upload_allocation_docs', { deed_of_assignment_url: url('doa2'), survey_plan_url: url('sv2') });
    await act(U.SITE_MANAGER, sale, 'final_audit', { audit_findings: 'Re-checked', confirmed: 'on' });
    for (const role of ['SALES_MANAGER', 'OPERATIONS_MANAGER', 'HR', 'CEO'] as const) {
      const [a] = await pendingFor(sale, role);
      assert.ok(a, `${role} step missing`);
      await wf.decide(role === 'SALES_MANAGER' ? SALES_MANAGER2 : U[role], a.id, 'APPROVED');
    }
    assert.equal(await status(sale), 'FULLY_APPROVED');
    const r = (await pg.query(`select approved_at from sales where id=$1`, [sale])).rows[0] as any;
    assert.ok(r.approved_at);
  });
  await t('row12: pre-allocation, allocation date, completion — site manager only', async () => {
    await denied(act(U.OPERATIONS, sale, 'start_pre_allocation', {}), /not permitted/);
    await act(U.SITE_MANAGER, sale, 'start_pre_allocation', { soft_copy_url: url('soft'), site_survey_plan: 'Survey Mon', logistics_notes: 'Bus + lunch for 20' });
    assert.equal(await status(sale), 'PRE_ALLOCATION');
    await denied(act(U.SITE_MANAGER, sale, 'set_allocation_date', { allocation_date: '2020-01-01' }), /past/);
    await act(U.SITE_MANAGER, sale, 'log_site_activity', { record_type: 'SITE_SURVEY', details: 'Beacons checked' });
    await act(U.SITE_MANAGER, sale, 'set_allocation_date', { allocation_date: '2099-01-01' });
    assert.equal(await status(sale), 'ALLOCATION_SCHEDULED');
    await act(U.SITE_MANAGER, sale, 'confirm_allocation', {});
    assert.equal(await status(sale), 'ALLOCATED');
    const recs = (await pg.query(`select record_type from site_records where sale_id=$1`, [sale])).rows as any[];
    for (const need of ['FINAL_SALE_AUDIT', 'SOFT_COPY_SENT', 'SITE_SURVEY', 'ALLOCATION_LOGISTICS', 'ALLOCATION_COMPLETED']) assert.ok(recs.some(r => r.record_type === need), need);
  });
  await t('audit trail captured every stage', async () => {
    const ev = (await pg.query(`select count(*) n from workflow_events where entity_id=$1`, [sale])).rows[0] as any;
    assert.ok(Number(ev.n) >= 18, `events: ${ev.n}`);
    const au = (await pg.query(`select count(*) n from audit_logs`)).rows[0] as any;
    assert.ok(Number(au.n) >= 15);
  });
  await t('cancel: allowed for sales manager/CEO only, blocked after pre-allocation', async () => {
    const c2 = await wf.convertLead(U.SALES_MANAGER, await wf.createLead(U.SALES_MANAGER, { name: 'Bayo', phone: '0900' }));
    const s2 = await wf.createSale(U.SALES, { client_id: c2, property_name: 'Blaze Estate', plot_reference: 'B-1', amount: '100' });
    await denied(act(U.SALES, s2, 'cancel_sale', { reason: 'x' }), /not permitted/);
    await act(U.CEO, s2, 'cancel_sale', { reason: 'Client withdrew' });
    assert.equal(await status(s2), 'CANCELLED');
    // freed plot can be resold
    await wf.createSale(U.SALES, { client_id: c2, property_name: 'Blaze Estate', plot_reference: 'B-1', amount: '100' });
    await denied(act(U.CEO, sale, 'cancel_sale', { reason: 'x' }), /Not available/);
  });

  console.log('\nVendor negotiation → expense → payment → receipt (sheet rows 13–18)');
  let ex = '';
  await t('row13: only site manager uploads negotiation → ops mgr & HR parallel, accounts informed', async () => {
    const f = { sale_id: sale, category: 'Survey logistics', vendor: 'GreenTrucks Ltd', negotiated_amount: '250000', negotiation_notes: 'Agreed 250k for 2 buses' };
    await denied(wf.createNegotiation(U.OPERATIONS_MANAGER, f), /Only the Site Manager/);
    ex = await wf.createNegotiation(U.SITE_MANAGER, f);
    assert.equal(await estatus(ex), 'NEGOTIATION_SUBMITTED');
    assert.equal((await pendingFor(ex, 'OPERATIONS_MANAGER')).length, 1);
    assert.equal((await pendingFor(ex, 'HR')).length, 1);
    assert.equal((await pendingFor(ex, 'CEO')).length, 0);
  });
  await t('parallel approvals complete the round exactly once (no race)', async () => {
    const [o] = await pendingFor(ex, 'OPERATIONS_MANAGER'), [h] = await pendingFor(ex, 'HR');
    await Promise.all([wf.decide(U.OPERATIONS_MANAGER, o.id, 'APPROVED'), wf.decide(U.HR, h.id, 'APPROVED')]);
    assert.equal(await estatus(ex), 'NEGOTIATION_APPROVED');
    const n = (await pg.query(`select count(*) n from notifications where title like 'Negotiation approved%'`)).rows[0] as any;
    assert.equal(Number(n.n), 1);
  });
  await t('row14: accountant enters expense (variance rule) → ops & HR first, then CEO', async () => {
    await denied(wf.performExpenseAction(U.FINANCE_OPERATIONS, ex, 'enter_expense', { amount: '250000' }), /not permitted/);
    await denied(wf.performExpenseAction(U.ACCOUNTANT, ex, 'enter_expense', { amount: '300000' }), /variance reason/);
    await wf.performExpenseAction(U.ACCOUNTANT, ex, 'enter_expense', { amount: '250000' });
    assert.equal(await estatus(ex), 'EXPENSE_ENTERED');
    const [c] = await pendingFor(ex, 'CEO');
    await denied(wf.decide(U.CEO, c.id, 'APPROVED'), /earlier approval step/);
  });
  await t('row15: CEO approves after ops & HR → finance ops notified', async () => {
    for (const r of ['OPERATIONS_MANAGER', 'HR', 'CEO'] as const) { const [a] = await pendingFor(ex, r); await wf.decide(U[r], a.id, 'APPROVED'); }
    assert.equal(await estatus(ex), 'EXPENSE_APPROVED');
    assert.ok(await unread(U.FINANCE_OPERATIONS.id) >= 1);
  });
  await t('row16: finance ops uploads bank proof; rejected proof loops back, re-upload works', async () => {
    await denied(wf.performExpenseAction(U.ACCOUNTANT, ex, 'upload_bank_proof', { bank_proof_url: url('b'), bank_reference: 'B1' }), /not permitted/);
    await wf.performExpenseAction(U.FINANCE_OPERATIONS, ex, 'upload_bank_proof', { bank_proof_url: url('b'), bank_reference: 'B1' });
    assert.equal(await estatus(ex), 'PAYMENT_PROOF_UPLOADED');
    const [h] = await pendingFor(ex, 'HR');
    await wf.decide(U.HR, h.id, 'REJECTED', 'Screenshot unreadable');
    assert.equal(await estatus(ex), 'EXPENSE_APPROVED');
    await wf.performExpenseAction(U.FINANCE_OPERATIONS, ex, 'upload_bank_proof', { bank_proof_url: url('b2'), bank_reference: 'B1' });
    for (const r of ['OPERATIONS_MANAGER', 'HR', 'CEO'] as const) { const [a] = await pendingFor(ex, r); await wf.decide(U[r], a.id, 'APPROVED'); }
    assert.equal(await estatus(ex), 'PAYMENT_APPROVED');
  });
  await t('row17: bank alert → PAID, all team members notified', async () => {
    await denied(wf.performExpenseAction(U.SITE_MANAGER, ex, 'record_bank_alert', { bank_alert_ref: 'A1' }), /not permitted/);
    const before = await unread(U.SITE_MANAGER.id);
    await wf.performExpenseAction(U.FINANCE_OPERATIONS, ex, 'record_bank_alert', { bank_alert_ref: 'ALERT-1' });
    assert.equal(await estatus(ex), 'PAID');
    assert.equal(await unread(U.SITE_MANAGER.id), before + 1);
  });
  await t('row18: accountant issues receipt, shared with Ops, HR, Site Manager', async () => {
    const hr0 = await unread(U.HR.id);
    await wf.performExpenseAction(U.ACCOUNTANT, ex, 'issue_receipt', { receipt_no: 'RCT-1', receipt_url: url('r') });
    assert.equal(await estatus(ex), 'RECEIPT_ISSUED');
    assert.equal(await unread(U.HR.id), hr0 + 1);
  });
  await t('negotiation rejection ends the flow; direct expense uses same approvals', async () => {
    const e2 = await wf.createNegotiation(U.SITE_MANAGER, { category: 'Fencing', vendor: 'V', negotiated_amount: '10', negotiation_notes: 'n' });
    const [o] = await pendingFor(e2, 'OPERATIONS_MANAGER');
    await wf.decide(U.OPERATIONS_MANAGER, o.id, 'REJECTED', 'Too costly');
    assert.equal(await estatus(e2), 'REJECTED');
    assert.equal((await pendingFor(e2, 'HR')).length, 0);
    const e3 = await wf.createDirectExpense(U.ACCOUNTANT, { category: 'Office', vendor: 'Shop', amount: '5000', description: 'Stationery' });
    assert.equal(await estatus(e3), 'EXPENSE_ENTERED');
    assert.equal((await pendingFor(e3, 'CEO')).length, 1);
    await denied(wf.createDirectExpense(U.SITE_MANAGER, { category: 'a', vendor: 'b', amount: '1', description: 'd' }), /Only Accounts/);
  });
  await t('atomicity: a failing action leaves no partial writes', async () => {
    const c3 = await wf.convertLead(U.SALES_MANAGER, await wf.createLead(U.SALES_MANAGER, { name: 'Chi', phone: '0777' }));
    const s3 = await wf.createSale(U.SALES, { client_id: c3, property_name: 'Blaze Estate', plot_reference: 'C-1', amount: '100' });
    const docsBefore = Number(((await pg.query(`select count(*) n from sale_documents`)).rows[0] as any).n);
    await denied(act(U.SALES, s3, 'submit_payment_proof', { proof_url: url('p'), payment_reference: '' }), /required/);
    assert.equal(Number(((await pg.query(`select count(*) n from sale_documents`)).rows[0] as any).n), docsBefore);
    assert.equal(await status(s3), 'DRAFT');
  });


  console.log('\nHardening fixes');
  await t('invoice amount >2% off the original quote requires a reason', async () => {
    const c4 = await wf.convertLead(U.SALES_MANAGER, await wf.createLead(U.SALES_MANAGER, { name: 'Hard1', phone: '0711' }));
    const sH = await wf.createSale(U.SALES, { client_id: c4, property_name: 'Blaze Estate', plot_reference: 'H-1', amount: '1000000' });
    await act(U.SALES, sH, 'submit_payment_proof', { proof_url: url('h1proof'), payment_reference: 'RH1' });
    await denied(act(U.ACCOUNTANT, sH, 'enter_invoice', { invoice_number: 'INV-H1', invoice_amount: '1200000' }), /differs from the original quote/);
    await act(U.ACCOUNTANT, sH, 'enter_invoice', { invoice_number: 'INV-H1', invoice_amount: '1200000', variance_reason: 'Client added extra plot fee' });
    assert.equal(await status(sH), 'INVOICE_ENTERED');
    // within 2% needs no reason
    const c5 = await wf.convertLead(U.SALES_MANAGER, await wf.createLead(U.SALES_MANAGER, { name: 'Hard2', phone: '0712' }));
    const sH2 = await wf.createSale(U.SALES, { client_id: c5, property_name: 'Blaze Estate', plot_reference: 'H-2', amount: '1000000' });
    await act(U.SALES, sH2, 'submit_payment_proof', { proof_url: url('h2proof'), payment_reference: 'RH2' });
    await act(U.ACCOUNTANT, sH2, 'enter_invoice', { invoice_number: 'INV-H2', invoice_amount: '1010000' });
    assert.equal(await status(sH2), 'INVOICE_ENTERED');
  });

  await t('the Sales Manager who approved the sale cannot also be the chain\'s Sales Manager approver', async () => {
    const c6 = await wf.convertLead(U.SALES_MANAGER, await wf.createLead(U.SALES_MANAGER, { name: 'Hard3', phone: '0713' }));
    const sH3 = await wf.createSale(U.SALES, { client_id: c6, property_name: 'Blaze Estate', plot_reference: 'H-3', amount: '500000' });
    await act(U.SALES, sH3, 'submit_payment_proof', { proof_url: url('h3proof'), payment_reference: 'RH3' });
    await act(U.ACCOUNTANT, sH3, 'enter_invoice', { invoice_number: 'INV-H3', invoice_amount: '500000' });
    await act(U.SALES_MANAGER, sH3, 'approve_sale', {});
    await act(U.OPERATIONS, sH3, 'create_contract', { contract_url: url('h3c'), deed_url: url('h3d') });
    await act(U.ACCOUNTANT, sH3, 'send_sales_documents', { sales_order_no: 'SOH3', sales_receipt_no: 'SRH3', sales_invoice_no: 'SIH3' });
    await act(U.OPERATIONS_MANAGER, sH3, 'open_ops_portal', {});
    await act(U.OPERATIONS, sH3, 'upload_allocation_docs', { deed_of_assignment_url: url('h3doa'), survey_plan_url: url('h3sv') });
    await act(U.SITE_MANAGER, sH3, 'final_audit', { audit_findings: 'ok', confirmed: 'on' });
    const [smStep] = await pendingFor(sH3, 'SALES_MANAGER');
    await denied(wf.decide(U.SALES_MANAGER, smStep.id, 'APPROVED'), /already approved this sale earlier/);
  });

  await t('expense amount more than 50% above negotiated is blocked outright', async () => {
    const eH = await wf.createNegotiation(U.SITE_MANAGER, { category: 'Fencing', vendor: 'CapVendor', negotiated_amount: '100000', negotiation_notes: 'n' });
    for (const r of ['OPERATIONS_MANAGER', 'HR'] as const) { const [a] = await pendingFor(eH, r); await wf.decide(U[r], a.id, 'APPROVED'); }
    assert.equal(await estatus(eH), 'NEGOTIATION_APPROVED');
    await denied(wf.performExpenseAction(U.ACCOUNTANT, eH, 'enter_expense', { amount: '160000' }), /needs a fresh negotiation/);
    await wf.performExpenseAction(U.ACCOUNTANT, eH, 'enter_expense', { amount: '140000', variance_reason: 'Extra materials needed' });
    assert.equal(await estatus(eH), 'EXPENSE_ENTERED');
  });

  await t('rejected negotiated expense recovers to NEGOTIATION_APPROVED (no dead end) and can be re-entered', async () => {
    const eR = await wf.createNegotiation(U.SITE_MANAGER, { category: 'Signage', vendor: 'SignCo', negotiated_amount: '50000', negotiation_notes: 'n' });
    for (const r of ['OPERATIONS_MANAGER', 'HR'] as const) { const [a] = await pendingFor(eR, r); await wf.decide(U[r], a.id, 'APPROVED'); }
    await wf.performExpenseAction(U.ACCOUNTANT, eR, 'enter_expense', { amount: '50000' });
    const [om] = await pendingFor(eR, 'OPERATIONS_MANAGER');
    await wf.decide(U.OPERATIONS_MANAGER, om.id, 'REJECTED', 'Wrong cost code');
    assert.equal(await estatus(eR), 'NEGOTIATION_APPROVED');
    await wf.performExpenseAction(U.ACCOUNTANT, eR, 'enter_expense', { amount: '50000' });
    for (const r of ['OPERATIONS_MANAGER', 'HR', 'CEO'] as const) { const [a] = await pendingFor(eR, r); await wf.decide(U[r], a.id, 'APPROVED'); }
    assert.equal(await estatus(eR), 'EXPENSE_APPROVED');
  });

  await t('a fully rejected negotiation can be revised and resubmitted', async () => {
    const eN = await wf.createNegotiation(U.SITE_MANAGER, { category: 'Catering', vendor: 'FeedCo', negotiated_amount: '80000', negotiation_notes: 'first pass' });
    const [om] = await pendingFor(eN, 'OPERATIONS_MANAGER');
    await wf.decide(U.OPERATIONS_MANAGER, om.id, 'REJECTED', 'Too expensive');
    assert.equal(await estatus(eN), 'REJECTED');
    await denied(wf.performExpenseAction(U.OPERATIONS_MANAGER, eN, 'revise_negotiation', { category: 'Catering', vendor: 'FeedCo', negotiated_amount: '60000', negotiation_notes: 'renegotiated' }), /not permitted/);
    await wf.performExpenseAction(U.SITE_MANAGER, eN, 'revise_negotiation', { category: 'Catering', vendor: 'FeedCo', negotiated_amount: '60000', negotiation_notes: 'renegotiated lower price' });
    assert.equal(await estatus(eN), 'NEGOTIATION_SUBMITTED');
    for (const r of ['OPERATIONS_MANAGER', 'HR'] as const) { const [a] = await pendingFor(eN, r); await wf.decide(U[r], a.id, 'APPROVED'); }
    assert.equal(await estatus(eN), 'NEGOTIATION_APPROVED');
  });

  await t('reused evidence links are rejected', async () => {
    const c7 = await wf.convertLead(U.SALES_MANAGER, await wf.createLead(U.SALES_MANAGER, { name: 'Hard4', phone: '0714' }));
    const sA = await wf.createSale(U.SALES, { client_id: c7, property_name: 'Blaze Estate', plot_reference: 'H-4a', amount: '100' });
    const sB = await wf.createSale(U.SALES, { client_id: c7, property_name: 'Blaze Estate', plot_reference: 'H-4b', amount: '100' });
    const sameUrl = url('reused-proof');
    await act(U.SALES, sA, 'submit_payment_proof', { proof_url: sameUrl, payment_reference: 'RA' });
    await denied(act(U.SALES, sB, 'submit_payment_proof', { proof_url: sameUrl, payment_reference: 'RB' }), /already been used as evidence/);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log(failures.join('\n')); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
