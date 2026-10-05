'use server';

import { requireUser } from '@/lib/guard';
import { generateSaleDocuments } from '@/lib/workflow/saleDocumentGeneration';
import { ForbiddenError, WorkflowError } from '@/lib/workflow/core';

export async function generateSaleDocumentsAction(saleId: string) {
  const actor = await requireUser();
  try {
    return { ok: true as const, result: await generateSaleDocuments(actor, saleId) };
  } catch (error) {
    if (error instanceof WorkflowError || error instanceof ForbiddenError) return { ok: false as const, error: error.message };
    console.error(error);
    return { ok: false as const, error: 'Unable to generate the sale documents. Please try again.' };
  }
}
