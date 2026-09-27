export function approvalExpectation(approval: { entity_type?: string; round?: string; step?: string }) {
  const step = String(approval.step ?? '').toLowerCase();
  const round = String(approval.round ?? '').toLowerCase();
  if (approval.entity_type === 'SALE') {
    if (step.includes('sales') || round.includes('sales')) return 'Review the client, property, estate value, payment amount, payment plan, and payment proof. Confirm the sale is accurate before approving it.';
    if (step.includes('operation') || round.includes('operation')) return 'Review the operational documents and confirm the transaction is ready for operations.';
    if (step.includes('hr') || round.includes('hr')) return 'Review the internal control and compliance evidence for this transaction.';
    if (step.includes('ceo') || round.includes('ceo')) return 'Review the complete approval trail and give final executive approval.';
    return 'Review the sale details, supporting documents, and previous approval decisions before approving.';
  }
  if (approval.entity_type === 'EXPENSE') return 'Review the expense purpose, amount, vendor details, and supporting documents before approving.';
  if (approval.entity_type === 'PAYROLL') return 'Review the payroll totals, employee records, and supporting documents before approving.';
  return 'Review all information and supporting documents attached to this approval before deciding.';
}

export function approvalEntityLabel(entityType?: string) {
  return entityType === 'SALE' ? 'Sale' : entityType === 'EXPENSE' ? 'Expense' : entityType === 'PAYROLL' ? 'Payroll' : String(entityType ?? 'Approval');
}

export function approvalDecisionLabel(decision: 'APPROVED' | 'REJECTED') {
  return decision === 'APPROVED' ? 'Approve and move to the next workflow stage' : 'Reject and return/cancel the workflow';
}

export function approvalStatusLabel(status?: string) {
  return String(status ?? '').replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, char => char.toUpperCase());
}
