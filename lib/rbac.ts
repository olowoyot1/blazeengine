import type { Role } from './constants';
import { SALE_STATUS_ORDER } from './constants';
export type Cap =
  | 'lead.read' | 'lead.read_all' | 'lead.write' | 'client.read' | 'client.write'
  | 'sale.read' | 'sale.read_all' | 'sale.create' | 'accounts.workspace' | 'ops.workspace' | 'site.workspace' | 'finance.workspace'
  | 'expense.read' | 'expense.read_all' | 'expense.create_negotiation' | 'approvals.read'
  | 'report.sales' | 'report.hr' | 'report.ops' | 'report.site' | 'report.finance' | 'report.company' | 'report.performance'
  | 'hr.workspace' | 'hr.payroll' | 'payroll.read' | 'chat.read' | 'users.manage' | 'admins.manage' | 'departments.manage' | 'audit.read';
const ALL_REPORTS: Cap[] = ['report.sales','report.hr','report.ops','report.site','report.finance','report.company','report.performance'];
export const CAPS: Record<Role, Cap[]> = {
  SUPER_ADMIN: ['lead.read','lead.read_all','lead.write','client.read','client.write','sale.read','sale.read_all','sale.create','accounts.workspace','ops.workspace','site.workspace','finance.workspace','expense.read','expense.read_all','expense.create_negotiation','approvals.read',...ALL_REPORTS,'hr.workspace','hr.payroll','payroll.read','chat.read','users.manage','admins.manage','departments.manage','audit.read'],
  ADMIN: ['lead.read_all','payroll.read','chat.read','client.read','sale.read_all','expense.read_all','approvals.read',...ALL_REPORTS,'users.manage','departments.manage','audit.read'],
  CEO: ['lead.read_all','payroll.read','chat.read','client.read','sale.read_all','expense.read_all','approvals.read',...ALL_REPORTS,'audit.read'],
  HR: ['hr.workspace','hr.payroll','payroll.read','chat.read','lead.read_all','client.read','sale.read_all','expense.read_all','approvals.read',...ALL_REPORTS.filter(c=>c!=='report.company'),'audit.read'],
  SALES_MANAGER: ['chat.read','lead.read_all','lead.write','client.read','client.write','sale.read_all','sale.create','approvals.read','report.sales'],
  SALES: ['chat.read','lead.read','lead.write','client.read','client.write','sale.read','sale.create'], MARKETER: ['chat.read','lead.read','lead.write','client.read','client.write'],
  ACCOUNTANT: ['sale.read','accounts.workspace','payroll.read','chat.read','expense.read_all','report.finance'], FINANCE_OPERATIONS: ['finance.workspace','payroll.read','chat.read','expense.read_all','report.finance'],
  OPERATIONS_MANAGER: ['chat.read','sale.read','ops.workspace','expense.read_all','approvals.read','report.ops'], OPERATIONS: ['chat.read','sale.read','ops.workspace'], SITE_MANAGER: ['chat.read','sale.read','site.workspace','expense.read','expense.create_negotiation','report.site'],
};
export const ADMIN_TIER_ROLES: Role[] = ['ADMIN','SUPER_ADMIN'];
export function can(role: Role | string | undefined, cap: Cap): boolean { return !!role && (role === 'SUPER_ADMIN' || ((CAPS as Record<string,Cap[]>)[role]?.includes(cap) === true)); }
export function canAny(role: Role | string | undefined, caps: Cap[]): boolean { return caps.length === 0 || caps.some(c=>can(role,c)); }
export function saleScope(user:{id:string;role:Role}) { const r=user.role; const all=can(r,'sale.read_all'); const own=r==='SALES'; let statuses:string[]=[]; if(r==='ACCOUNTANT') statuses=SALE_STATUS_ORDER.filter(s=>s!=='DRAFT'); if(r==='OPERATIONS'||r==='OPERATIONS_MANAGER') statuses=statusesFrom('SALES_APPROVED'); if(r==='SITE_MANAGER') statuses=statusesFrom('SITE_NOTIFIED'); return {all,own,uid:user.id,statuses}; }
function statusesFrom(start:string){const i=SALE_STATUS_ORDER.indexOf(start);return SALE_STATUS_ORDER.filter((s,idx)=>(idx>=i&&s!=='CANCELLED')||s==='RETURNED');}
export function expenseScope(user:{id:string;role:Role}){return {all:can(user.role,'expense.read_all'),uid:user.id};}
export type NavItem={href:string;label:string;cap:Cap[];mode:'view'|'action'|'both'};
export type NavGroup={label:string;items:NavItem[]};
export const NAV_GROUPS:NavGroup[]=[
 {label:'General',items:[{href:'/dashboard',label:'Dashboard',cap:[],mode:'view'},{href:'/approvals',label:'Approvals',cap:['approvals.read'],mode:'both'},{href:'/reports',label:'Company Reports',cap:ALL_REPORTS,mode:'view'},{href:'/chat',label:'Staff Chat',cap:['chat.read'],mode:'both'},{href:'/notifications',label:'Notifications',cap:[],mode:'view'}]},
 {label:'Sales & Marketing',items:[{href:'/leads',label:'Leads & Clients',cap:['lead.read','lead.read_all'],mode:'both'},{href:'/sales',label:'Sales',cap:['sale.read','sale.read_all'],mode:'both'}]},
 {label:'Accounts & Finance Operations',items:[{href:'/accounts',label:'Accounts',cap:['accounts.workspace'],mode:'both'},{href:'/expenses',label:'Expenses & Payments',cap:['expense.read','expense.read_all','finance.workspace'],mode:'both'}]},
 {label:'Operations',items:[{href:'/operations',label:'Operations',cap:['ops.workspace'],mode:'both'}]},
 {label:'Site Management',items:[{href:'/site-management',label:'Site Management',cap:['site.workspace'],mode:'both'}]},
 {label:'Human Resources',items:[{href:'/hr',label:'HR & Employees',cap:['hr.workspace','report.hr','payroll.read'],mode:'both'},{href:'/hr/payroll',label:'Payroll',cap:['payroll.read','hr.payroll'],mode:'both'}]},
 {label:'Administration',items:[{href:'/users',label:'Users & Roles',cap:['users.manage'],mode:'both'},{href:'/audit',label:'Audit Trail',cap:['audit.read'],mode:'view'}]},
];
