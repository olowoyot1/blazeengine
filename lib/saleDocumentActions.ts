'use server';

import { requireUser } from '@/lib/guard';
import { query } from '@/lib/db';
import { generateSaleDocuments } from '@/lib/workflow/saleDocumentGeneration';
import { ForbiddenError, WorkflowError } from '@/lib/workflow/core';

const PREVIEW_ROLES = new Set(['SUPER_ADMIN', 'SALES', 'SALES_MANAGER', 'ACCOUNTANT', 'FINANCE_OPERATIONS']);

export async function generateSaleDocumentsAction(saleId: string) {
  const actor = await requireUser();
  try {
    return { ok: true as const, result: await generateSaleDocuments(actor, saleId) };
  } catch (error) {
    if (error instanceof WorkflowError || error instanceof ForbiddenError) return { ok: false as const, error: error.message };
    console.error('generateSaleDocumentsAction failed', error);
    return { ok: false as const, error: 'Unable to generate the sale documents. Please check that the sale has a valid estate value, payment amount and Sales originator, then try again.' };
  }
}

export async function getSaleDocumentPreviewAction(saleId: string) {
  const actor = await requireUser();
  if (!PREVIEW_ROLES.has(actor.role)) return { ok: false as const, error: 'You are not authorised to preview sale documents.' };
  try {
    const sale = await query(`select id,status from sales where id=$1`, [saleId]);
    if (!sale.rows.length) return { ok: false as const, error: 'Sale not found.' };
    const docs = await query(
      `select document_type, document_name, document_url, created_at
         from sale_documents
        where sale_id=$1 and document_type in ('CONTRACT','ACKNOWLEDGMENT_LETTER')
        order by created_at`,
      [saleId],
    );
    return { ok: true as const, status: String((sale.rows[0] as any).status), documents: docs.rows as any[] };
  } catch (error) {
    console.error('getSaleDocumentPreviewAction failed', error);
    return { ok: false as const, error: 'Unable to load the sale document preview.' };
  }
}
