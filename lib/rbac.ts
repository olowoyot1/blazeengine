import type { Role } from './constants';
import { SALE_STATUS_ORDER } from './constants';

/**
 * Capability matrix: what each role may SEE / OPEN.
 * What a role may DO to a sale/expense is defined next to the workflow
 * (lib/workflow/sale.ts, expense.ts) so the rules live in one place per process.
 *
 * Principles: least privilege · separation of duties · ADMIN/SUPER_ADMIN administer
 * users and can read for oversight but cannot act inside the business workflow.
 *
 * Admin hierarchy: ADMIN manages every non-admin account and departments.
 * SUPER_ADMIN additionally has authority over ADMIN and SUPER_ADMIN accounts
 * themselves (creating, changing role, deactivating, resetting password) — a plain
 * ADMIN cannot touch another admin-tier account, so no single admin can silently
 * grant themselves or a colleague higher power. See `admins.manage` below and
 * `requireAuthorityOver` in lib/actions.ts.
 */
export type Cap =
  | 'lead.read' | 'lead.read_all' | 'lead.write'
  | 'client.read' | 'client.write'
  | 'sale.read' | 'sale.read_all' | 'sale.create'
  | 'accounts.workspace' | 'ops.workspace' | 'site.workspace' | 'finance.workspace'
  | 'expense.read' | 'expense.read_all' | 'expense.create_negotiation'
  | 'approvals.read'
  | 'report.sales' | 'report.hr' | 'report.ops' | 'report.site' | 'report.finance' | 'report.company' | 'report.performance'
  | 'users.manage' | 'admins.manage' | 'departments.manage' | 'audit.read';

const ALL_REPORTS: Cap[] = ['report.sales', 'report.hr', 'report.ops', 'report.site', 'report.finance', 'report.company', 'report.performance'];

export const CAPS: Record<Role, Cap[]> = {
  SUPER_ADMIN: ['lead.read_all', 'client.read', 'sale.read_all', 'expense.read_all', 'approvals.read', ...ALL_REPORTS, 'users.manage', 'admins.manage', 'departments.manage', 'audit.read'],
  ADMIN: ['lead.read_all', 'client.read', 'sale.read_all', 'expense.read_all', 'approvals.read', ...ALL_REPORTS, 'users.manage', 'departments.manage', 'audit.read'],
  CEO: ['lead.read_all', 'client.read', 'sale.read_all', 'expense.read_all', 'approvals.read', ...ALL_REPORTS, 'audit.read'],
  HR: ['lead.read_all', 'client.read', 'sale.read_all', 'expense.read_all', 'approvals.read', ...ALL_REPORTS.filter(c => c !== 'report.company'), 'audit.read'],
  SALES_MANAGER: ['lead.read_all', 'lead.write', 'client.read', 'client.write', 'sale.read_all', 'sale.create', 'approvals.read', 'report.sales'],
  SALES: ['lead.read', 'lead.write', 'client.read', 'client.write', 'sale.read', 'sale.create'],
  MARKETER: ['lead.read', 'lead.write', 'client.read', 'client.write'],
  ACCOUNTANT: ['sale.read', 'accounts.workspace', 'expense.read_all', 'report.finance'],
  FINANCE_OPERATIONS: ['finance.workspace', 'expense.read_all', 'report.finance'],
  OPERATIONS_MANAGER: ['sale.read', 'ops.workspace', 'expense.read_all', 'approvals.read', 'report.ops'],
  OPERATIONS: ['sale.read', 'ops.workspace'],
  SITE_MANAGER: ['sale.read', 'site.workspace', 'expense.read', 'expense.create_negotiation', 'report.site'],
};

/** Roles only a SUPER_ADMIN may create, promote into, deactivate or reset. */
export const ADMIN_TIER_ROLES: Role[] = ['ADMIN', 'SUPER_ADMIN'];

export function can(role: Role | string | undefined, cap: Cap): boolean {
  return !!role && (CAPS as Record<string, Cap[]>)[role]?.includes(cap) === true;
}
export function canAny(role: Role | string | undefined, caps: Cap[]): boolean {
  return caps.some(c => can(role, c));
}

// ---- Row-level visibility -------------------------------------------------

/** Visibility of sales: all rows / rows the user created / rows in given statuses. */
export function saleScope(user: { id: string; role: Role }) {
  const r = user.role;
  const all = can(r, 'sale.read_all');
  const own = r === 'SALES';
  let statuses: string[] = [];
  if (r === 'ACCOUNTANT') statuses = SALE_STATUS_ORDER.filter(s => s !== 'DRAFT');
  if (r === 'OPERATIONS' || r === 'OPERATIONS_MANAGER') statuses = statusesFrom('SALES_APPROVED');
  if (r === 'SITE_MANAGER') statuses = statusesFrom('SITE_NOTIFIED');
  return { all, own, uid: user.id, statuses };
}

function statusesFrom(start: string): string[] {
  const i = SALE_STATUS_ORDER.indexOf(start);
  return SALE_STATUS_ORDER.filter((s, idx) => idx >= i && s !== 'CANCELLED' || s === 'RETURNED');
}

/** Visibility of expenses: everyone with expense.read_all, else only own submissions. */
export function expenseScope(user: { id: string; role: Role }) {
  return { all: can(user.role, 'expense.read_all'), uid: user.id };
}

export const NAV: { href: string; label: string; cap: Cap[] }[] = [
  { href: '/dashboard', label: 'Dashboard', cap: [] },
  { href: '/leads', label: 'Leads & Clients', cap: ['lead.read', 'lead.read_all'] },
  { href: '/sales', label: 'Sales', cap: ['sale.read', 'sale.read_all'] },
  { href: '/accounts', label: 'Accounts', cap: ['accounts.workspace'] },
  { href: '/operations', label: 'Operations', cap: ['ops.workspace'] },
  { href: '/site-management', label: 'Site Management', cap: ['site.workspace'] },
  { href: '/expenses', label: 'Expenses & Payments', cap: ['expense.read', 'expense.read_all', 'finance.workspace'] },
  { href: '/approvals', label: 'Approvals', cap: ['approvals.read'] },
  { href: '/reports', label: 'Reports', cap: ['report.sales', 'report.hr', 'report.ops', 'report.site', 'report.finance', 'report.company', 'report.performance'] },
  { href: '/notifications', label: 'Notifications', cap: [] },
  { href: '/users', label: 'Users & Roles', cap: ['users.manage'] },
  { href: '/audit', label: 'Audit Trail', cap: ['audit.read'] },
];
