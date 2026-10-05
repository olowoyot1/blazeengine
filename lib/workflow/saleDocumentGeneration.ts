import type { Role } from '../constants';
import { ForbiddenError, WorkflowError, audit, logEvent, notifyRoles, notifyUsers, one, run, type Actor } from './core';
import { buildAcknowledgementLetterPdf, buildContractOfSalePdf, type SaleAgreementInput } from '../pdf/saleAgreementDocuments';
import { openRound, type Step } from './approvals';

type SaleRow = Record<string, any>;

const GENERATORS: Role[] = ['SALES', 'SALES_MANAGER', 'ACCOUNTANT', 'FINANCE_OPERATIONS'];

const saleLabel = (s: SaleRow) => `${s.client_name} — ${s.plot_reference || s.property_name || 'sale'}`;
const saleLink = (id: string) => `/sales/${id}`;

function extractSize(s: SaleRow) {
  const source = `${String(s.property_name || '')} ${String(s.description || '')}`;
  const match = source.match(/(\d[\d,]*(?:\.\d+)?)\s*(square\s*meters?|sqm|sq\.?\s*m(?:eters?)?)/i);
  return match ? `${match[1]} ${match[2].replace(/\s+/g, ' ').toLowerCase()}` : null;
}

async function storePdf(ctx: any, filename: string, bytes: Uint8Array) {
  const buffer = Buffer.from(bytes);
  const row = (await one(ctx, `insert into uploaded_files(filename,mime_type,size_bytes,data,uploaded_by,purpose) values($1,'application/pdf',$2,$3,$4::uuid,'document') returning id`, [filename, buffer.length, buffer, ctx.actor.id]))!;
  return `/api/files/${row.id}`;
}

async function addDoc(ctx: any, saleId: string, type: string, url: string, name: string) {
  await ctx.tx.query(
    `insert into sale_documents(sale_id,document_type,document_name,document_url,uploaded_file_id,uploaded_by) values($1,$2,$3,$4,$5::uuid,$6)`,
    [saleId, type, name, url, String(url).match(/^\/api\/files\/([0-9a-f-]{36})$/i)?.[1] || null, ctx.actor.id],
  );
}

export async function generateSaleDocuments(actor: Actor, saleId: string) {
  if (actor.role !== 'SUPER_ADMIN' && !GENERATORS.includes(actor.role)) {
    throw new ForbiddenError('Only Sales and Accounts users can generate the Contract of Sale and Letter of Acknowledgement');
  }

  return run(actor, async ctx => {
    const s = await one(ctx, `select * from sales where id=$1 for update`, [saleId]);
    if (!s) throw new WorkflowError('Sale not found');
    if (s.transaction_type === 'TOP_UP') throw new WorkflowError('Top-up transactions do not receive a Contract of Sale or Letter of Acknowledgement');
    if (!['SALES_APPROVED', 'CONTRACT_PREPARED'].includes(String(s.status))) {
      throw new WorkflowError(`Documents can only be generated after Sales Manager verification. Current status: ${String(s.status)}`);
    }

    const existing = await ctx.tx.query(
      `select document_type, document_url from sale_documents where sale_id=$1 and document_type in ('CONTRACT','ACKNOWLEDGMENT_LETTER') order by created_at`,
      [saleId],
    );
    const existingTypes = new Set(existing.rows.map((r: any) => String(r.document_type)));
    if (existingTypes.has('CONTRACT') && existingTypes.has('ACKNOWLEDGMENT_LETTER')) {
      return { saleId, status: String(s.status), alreadyGenerated: true, documents: existing.rows };
    }
    if (existingTypes.size) {
      throw new WorkflowError('This sale has an incomplete existing contract/acknowledgement document set. Do not generate over it; complete the existing document record first.');
    }

    const client = s.client_id ? await one(ctx, `select phone,email,address from clients where id=$1`, [s.client_id]) : undefined;
    const agreementInput: SaleAgreementInput = {
      clientName: String(s.client_name || 'Client'),
      clientEmail: s.client_email ?? client?.email ?? null,
      clientPhone: client?.phone ?? null,
      clientAddress: client?.address ?? null,
      beneficiaryName: s.beneficiary_name ?? null,
      beneficiaryPhone: s.beneficiary_phone ?? null,
      beneficiaryEmail: s.beneficiary_email ?? null,
      beneficiaryAddress: s.beneficiary_address ?? null,
      propertyName: s.property_name ?? null,
      propertyLocation: s.property_name ?? null,
      propertySize: extractSize(s),
      plotReference: s.plot_reference ?? null,
      saleReference: s.sale_reference ?? null,
      transactionType: s.transaction_type ?? null,
      paymentPlan: s.payment_plan ?? null,
      estateValue: Number(s.estate_value ?? s.quoted_amount ?? 0),
      amountPaid: Number(s.payment_amount ?? s.amount ?? 0),
      paymentReference: s.payment_reference ?? null,
      issuedAt: new Date(),
      issuedBy: actor.name,
    };

    if (!(agreementInput.estateValue > 0)) throw new WorkflowError('Estate value is required before generating sale documents');
    if (!(agreementInput.amountPaid > 0)) throw new WorkflowError('Payment amount is required before generating sale documents');

    const [contractPdf, acknowledgementPdf] = await Promise.all([
      buildContractOfSalePdf(agreementInput),
      buildAcknowledgementLetterPdf(agreementInput),
    ]);
    const contractUrl = await storePdf(ctx, `Contract-of-Sale-${s.sale_reference || s.id}.pdf`, contractPdf);
    const acknowledgementUrl = await storePdf(ctx, `Acknowledgement-Letter-${s.sale_reference || s.id}.pdf`, acknowledgementPdf);
    await addDoc(ctx, s.id, 'CONTRACT', contractUrl, 'Contract of Sale');
    await addDoc(ctx, s.id, 'ACKNOWLEDGMENT_LETTER', acknowledgementUrl, 'Letter of Acknowledgement');

    await ctx.tx.query(`update sales set status='CONTRACT_PREPARED', updated_at=now() where id=$1`, [s.id]);
    await ctx.tx.query(`update operations set status='DONE', completed_at=now() where sale_id=$1 and task_type='SALE_DOCUMENTS' and status='PENDING'`, [s.id]);

    const originator = await one(ctx, `select id,role,name from users where id=$1 and active=true`, [s.created_by]);
    if (!originator) throw new WorkflowError('The sales originator is no longer active and cannot approve these documents');
    const originatorRole = String(originator.role) as Role;
    if (!['SALES', 'SALES_MANAGER'].includes(originatorRole)) throw new WorkflowError('The sale originator must be an active Sales Executive or Sales Manager before documents can enter approval');

    const round = Number(s.chain_round || 0) + 1;
    const steps: Step[] = originatorRole === 'SALES_MANAGER'
      ? [{ step: 'Sales Manager approval', role: 'SALES_MANAGER', seq: 1 }]
      : [
          { step: 'Sales originator approval', role: 'SALES', seq: 1, userId: String(s.created_by) },
          { step: 'Sales Manager approval', role: 'SALES_MANAGER', seq: 2 },
        ];
    await openRound(ctx, 'SALE', s.id, 'SALE_DOCUMENTS_APPROVAL', round, steps);

    await logEvent(ctx, 'SALE', s.id, 'SALE_DOCUMENTS', 'Generate Contract + Acknowledgement', s.status, 'CONTRACT_PREPARED', `Generated automatically by ${actor.name}`);
    await audit(ctx, 'SALE_DOCUMENTS_GENERATED', 'SALE', s.id, { contract: contractUrl, acknowledgement: acknowledgementUrl, source: 'Sales/Accounts Generate Documents' });

    const n = { title: 'Contract and acknowledgement generated', message: `${saleLabel(s)} — the Contract of Sale and Letter of Acknowledgement are ready for Sales document approval.`, link: saleLink(s.id) };
    await notifyUsers(ctx, [s.created_by], n);
    await notifyRoles(ctx, ['SALES_MANAGER', 'ACCOUNTANT', 'FINANCE_OPERATIONS', 'OPERATIONS_MANAGER'], n);

    return { saleId: s.id, status: 'CONTRACT_PREPARED', alreadyGenerated: false, documents: [contractUrl, acknowledgementUrl] };
  });
}
