export function transactionDocumentLabel(sale: {
  transaction_type?: string | null;
  payment_plan?: string | null;
}) {
  if (String(sale.transaction_type ?? '').toUpperCase() === 'TOP_UP') return 'Sales Receipt';
  if (String(sale.payment_plan ?? '').toUpperCase() === 'OUTRIGHT') return 'Invoice + Sales Receipt';
  return 'Sales Order + Sales Receipt';
}
