import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { query, withTx } from '@/lib/db';
import { performSaleAction as runSaleAction } from '@/lib/workflow/sale';
import { generateSaleDocuments } from '@/lib/workflow/saleDocumentGeneration';
import type { Actor } from '@/lib/workflow/core';

function unauthorized() { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

async function getActor(email: string): Promise<Actor | null> {
  const rows = await query(`select id, name, role from users where active and lower(email)=lower($1) limit 1`, [email]);
  const u = rows.rows[0] as any;
  if (!u) return null;
  return { id: String(u.id), name: String(u.name), role: u.role } as Actor;
}

function check(req: NextRequest) {
  const expected = process.env.LBL_PORTAL_INTEGRATION_SECRET;
  const supplied = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || !supplied) return false;
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

async function sendDocumentsToClient(sale: any, docs: any[]) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  const to = String(sale.client_email || '').trim();
  if (!apiKey || !from) throw new Error('Email delivery is not configured in Blaze Engine (RESEND_API_KEY / MAIL_FROM)');
  if (!to) throw new Error('This sale has no client email address');
  const attachments: { filename: string; content: string; contentType?: string }[] = [];
  for (const doc of docs) {
    const match = String(doc.document_url || '').match(/^\/api\/files\/([0-9a-f-]{36})$/i);
    if (!match) continue;
    const result = await query(`select filename, mime_type, data from uploaded_files where id=$1::uuid`, [match[1]]);
    const file = result.rows[0] as any;
    if (!file?.data) continue;
    attachments.push({ filename: String(file.filename || doc.document_name || 'Landblaze-document.pdf'), content: Buffer.from(file.data).toString('base64'), contentType: String(file.mime_type || 'application/pdf') });
  }
  if (attachments.length < 4) throw new Error('The generated contract, acknowledgement, invoice/sales order and receipt files could not all be loaded for email delivery');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to: [to],
      subject: `Landblaze sales documents — ${sale.invoice_number || sale.sale_reference}`,
      text: `Dear ${sale.client_name || 'Client'},\n\nPlease find attached your Landblaze Contract of Sale, Letter of Acknowledgement and approved sales/payment documents for ${sale.property_name || 'your property'}${sale.plot_reference ? ` (${sale.plot_reference})` : ''}.\n\nDocument reference: ${sale.invoice_number || sale.sale_reference}\n\nRegards,\nLandblaze Accounts`,
      attachments,
    }),
  });
  if (!response.ok) { let detail = ''; try { detail = JSON.stringify(await response.json()); } catch {} throw new Error(`Client email delivery failed: ${detail || response.statusText}`); }
}

export async function GET(req: NextRequest) {
  if (!check(req)) return unauthorized();
  const status = req.nextUrl.searchParams.get('status') || 'PAYMENT_PROOF_SUBMITTED,INVOICE_ENTERED,SALES_APPROVED,CONTRACT_PREPARED';
  const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
  const result = await query(
    `select id, sale_reference, status, client_name, client_email, property_name, plot_reference,
            estate_value, payment_amount, payment_plan, payment_status, payment_reference,
            invoice_number, sales_order_no, sales_receipt_no, sales_invoice_no, created_at
       from sales where status = any($1::text[]) order by created_at desc limit 100`,
    [statuses],
  );
  return NextResponse.json({ sales: result.rows });
}

export async function POST(req: NextRequest) {
  if (!check(req)) return unauthorized();
  try {
    const body = await req.json();
    const action = String(body?.action || '');
    const saleId = String(body?.saleId || '');
    const email = String(body?.email || '').trim();
    if (!saleId || !email) return NextResponse.json({ error: 'saleId and email are required' }, { status: 400 });
    const actor = await getActor(email);
    if (!actor) return NextResponse.json({ error: 'No active Blaze Engine user matches this LBL Portal account' }, { status: 403 });

    if (action === 'generate') {
      if (!['ACCOUNTANT', 'FINANCE_OPERATIONS', 'SUPER_ADMIN'].includes(actor.role)) return NextResponse.json({ error: 'Only Accounts users can generate the invoice/sales order and receipt' }, { status: 403 });
      const result = await runSaleAction(actor, saleId, 'enter_invoice', { note: 'Generated from LBL Portal' });
      return NextResponse.json({ ok: true, action, result });
    }

    if (action === 'sales_verify') {
      if (!['SALES_MANAGER', 'SUPER_ADMIN'].includes(actor.role)) return NextResponse.json({ error: 'Only Sales Managers can perform second-level sales verification' }, { status: 403 });
      const result = await runSaleAction(actor, saleId, 'approve_sale', { note: 'Second-level verification completed from LBL Portal' });
      return NextResponse.json({ ok: true, action, result });
    }

    if (action === 'generate_sale_documents') {
      if (!['SALES', 'SALES_MANAGER', 'ACCOUNTANT', 'FINANCE_OPERATIONS', 'SUPER_ADMIN'].includes(actor.role)) return NextResponse.json({ error: 'Only Sales and Accounts users can generate the Contract of Sale and Letter of Acknowledgement' }, { status: 403 });
      const result = await generateSaleDocuments(actor, saleId);
      return NextResponse.json({ ok: true, action, result });
    }

    if (action === 'send_to_client') {
      if (!['ACCOUNTANT', 'FINANCE_OPERATIONS', 'SUPER_ADMIN'].includes(actor.role)) return NextResponse.json({ error: 'Only Accounts users can send approved documents' }, { status: 403 });
      const result = await withTx(async tx => {
        const sale = (await tx.query(`select * from sales where id=$1 for update`, [saleId])).rows[0] as any;
        if (!sale) throw new Error('Sale not found');
        if (sale.status !== 'CONTRACT_PREPARED') throw new Error(`Sale is ${sale.status}; it must be Contract Prepared before sending`);
        if (!sale.invoice_number && !sale.sales_order_no) throw new Error('No generated invoice or sales order exists for this sale');
        const docs = (await tx.query(`select document_type, document_url, document_name from sale_documents where sale_id=$1 order by created_at`, [saleId])).rows as any[];
        const hasReceipt = docs.some(d => d.document_type === 'SALES_RECEIPT');
        const hasPrimary = docs.some(d => d.document_type === 'INVOICE' || d.document_type === 'SALES_ORDER');
        const hasContract = docs.some(d => d.document_type === 'CONTRACT');
        const hasAcknowledgement = docs.some(d => d.document_type === 'ACKNOWLEDGMENT_LETTER');
        if (!hasReceipt || !hasPrimary || !hasContract || !hasAcknowledgement) throw new Error('Generated sale document set is incomplete');
        const approvals = (await tx.query(`select status from approvals where entity_type='SALE' and entity_id=$1 and round='SALE_DOCUMENTS_APPROVAL' and round_no=(select max(round_no) from approvals where entity_type='SALE' and entity_id=$1 and round='SALE_DOCUMENTS_APPROVAL')`, [saleId])).rows as any[];
        if (!approvals.length || approvals.some(a => a.status !== 'APPROVED')) throw new Error('Sales document approval must be completed before sending documents to the client');
        await sendDocumentsToClient(sale, docs);
        await tx.query(`update sales set status='ACCOUNT_DOCS_SENT', updated_at=now() where id=$1`, [saleId]);
        await tx.query(`insert into workflow_events(entity_type,entity_id,stage,action,from_status,to_status,actor_id,notes) values('SALE',$1,'SALES_DOCUMENTS','send_from_lbl_portal','CONTRACT_PREPARED','ACCOUNT_DOCS_SENT',$2,$3)`, [saleId, actor.id, 'Approved contract, acknowledgement and transaction-specific account documents emailed to client from LBL Portal']);
        await tx.query(`insert into audit_logs(user_id,action,entity_type,entity_id,metadata) values($1,'LBL_PORTAL_SEND','SALE',$2,$3)`, [actor.id, saleId, JSON.stringify({ source: 'LBLPortal', document_number: sale.invoice_number || sale.sales_order_no, client_email: sale.client_email })]);
        const recipients = await tx.query(`select id from users where active and role = any($1::text[])`, [['OPERATIONS','OPERATIONS_MANAGER']]);
        if (recipients.rows.length) await tx.query(`insert into notifications(user_id,title,message,link) select unnest($1::uuid[]),$2,$3,$4`, [recipients.rows.map((r:any)=>r.id), 'Sales documents sent', `${sale.client_name} — ${sale.invoice_number || sale.sales_order_no} passed document approval and was emailed to the client from LBL Portal.`, `/sales/${saleId}`]);
        return { saleId, status: 'ACCOUNT_DOCS_SENT', documentNumber: sale.invoice_number || sale.sales_order_no, clientEmail: sale.client_email || null };
      });
      return NextResponse.json({ ok: true, action, result });
    }

    return NextResponse.json({ error: 'Unknown integration action' }, { status: 400 });
  } catch (error: any) {
    console.error('LBL integration error', error);
    return NextResponse.json({ error: error?.message || 'Integration failed' }, { status: 400 });
  }
}
