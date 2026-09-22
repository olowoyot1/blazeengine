export const ROLES = [
  'ADMIN', 'CEO', 'HR', 'SALES_MANAGER', 'SALES', 'MARKETER', 'ACCOUNTANT',
  'FINANCE_OPERATIONS', 'OPERATIONS_MANAGER', 'OPERATIONS', 'SITE_MANAGER',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_META: Record<Role, { label: string; department: string }> = {
  ADMIN: { label: 'System Administrator', department: 'Management' },
  CEO: { label: 'CEO', department: 'Management' },
  HR: { label: 'HR (Internal Audit)', department: 'Human Resources' },
  SALES_MANAGER: { label: 'Sales Manager', department: 'Sales & Marketing' },
  SALES: { label: 'Sales Executive', department: 'Sales & Marketing' },
  MARKETER: { label: 'Marketer', department: 'Sales & Marketing' },
  ACCOUNTANT: { label: 'Accountant', department: 'Accounts' },
  FINANCE_OPERATIONS: { label: 'Finance Operations', department: 'Finance Operations' },
  OPERATIONS_MANAGER: { label: 'Operations Manager', department: 'Operations' },
  OPERATIONS: { label: 'Operations Officer', department: 'Operations' },
  SITE_MANAGER: { label: 'Site Manager', department: 'Site Management' },
};

export const DAILY_LEAD_TARGET = 10;      // marketer target (sheet: "10 leads per day")
export const ALLOCATION_WINDOW_DAYS = 30; // allocation date / ops docs "within 30 days"

/** Ordered sale lifecycle. RETURNED/CANCELLED sit outside the happy path. */
export const SALE_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft (awaiting payment proof)',
  PAYMENT_PROOF_SUBMITTED: 'Payment proof submitted',
  INVOICE_ENTERED: 'Invoice entered · awaiting Sales Manager',
  SALES_APPROVED: 'Approved sale · awaiting contract/deed',
  CONTRACT_PREPARED: 'Contract & deed ready · awaiting Accounts',
  ACCOUNT_DOCS_SENT: 'Sales documents sent · awaiting Operations',
  SITE_NOTIFIED: 'Ready for allocation · Operations docs due',
  OPS_DOCS_UPLOADED: 'Operations docs uploaded · awaiting Site audit',
  IN_APPROVAL: 'In approval chain',
  RETURNED: 'Returned for correction',
  FULLY_APPROVED: 'Fully approved · awaiting pre-allocation',
  PRE_ALLOCATION: 'Pre-allocation in progress',
  ALLOCATION_SCHEDULED: 'Allocation date communicated',
  ALLOCATED: 'Allocated',
  CANCELLED: 'Cancelled',
};
export const SALE_STATUS_ORDER = [
  'DRAFT', 'PAYMENT_PROOF_SUBMITTED', 'INVOICE_ENTERED', 'SALES_APPROVED', 'CONTRACT_PREPARED',
  'ACCOUNT_DOCS_SENT', 'SITE_NOTIFIED', 'OPS_DOCS_UPLOADED', 'IN_APPROVAL', 'RETURNED',
  'FULLY_APPROVED', 'PRE_ALLOCATION', 'ALLOCATION_SCHEDULED', 'ALLOCATED', 'CANCELLED',
];

export const EXPENSE_STATUS_LABEL: Record<string, string> = {
  NEGOTIATION_SUBMITTED: 'Negotiation submitted · Ops Manager & HR review',
  NEGOTIATION_APPROVED: 'Negotiation approved · Accounts to enter expense',
  EXPENSE_ENTERED: 'Expense entered · Ops, HR & CEO approval',
  EXPENSE_APPROVED: 'Expense approved · Finance to pay',
  PAYMENT_PROOF_UPLOADED: 'Bank proof uploaded · Ops & HR review, then CEO',
  PAYMENT_APPROVED: 'Payment approved · awaiting bank alert',
  PAID: 'Paid · awaiting receipt',
  RECEIPT_ISSUED: 'Receipt issued & shared',
  REJECTED: 'Rejected',
  LEGACY: 'Legacy (v2)',
};
export const EXPENSE_STATUS_ORDER = Object.keys(EXPENSE_STATUS_LABEL);

export function badgeClass(status: string): string {
  if (['ALLOCATED', 'RECEIPT_ISSUED', 'PAID', 'APPROVED', 'CONVERTED', 'DONE', 'FULLY_APPROVED'].includes(status)) return 'green';
  if (['REJECTED', 'RETURNED', 'CANCELLED', 'LOST', 'OVERDUE'].includes(status)) return 'red';
  if (['DRAFT', 'PENDING', 'NEW', 'IN_APPROVAL', 'LEGACY'].includes(status)) return 'yellow';
  return '';
}
