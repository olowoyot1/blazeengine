import { sql, type Row } from './db';
import type { Session } from './auth';
import { expenseScope, saleScope } from './rbac';
import { ACTIVE_APPROVAL_SQL } from './workflow/approvals';
import { EXPENSE_ACTIONS } from './workflow/expense';
import { SALE_ACTIONS } from './workflow/sale';
import { ALLOCATION_WINDOW_DAYS, DAILY_LEAD_TARGET } from './constants';

type U = Pick<Session, 'id' | 'role'>;

// ---------------------------------------------------------------- Sales
export async function listSales(u: U, opts: { status?: string; statuses?: string[]; limit?: number } = {}) {
  const sc = saleScope(u);
  const st = opts.statuses ?? (opts.status ? [opts.status] : null);
  return sql`
    select s.*, c.name creator from sales s left join users c on c.id=s.created_by
    where (${sc.all}::boolean or (${sc.own}::boolean and s.created_by=${sc.uid}::uuid) or s.status = any(${sc.statuses}::text[]))
      and (${st}::text[] is null or s.status = any(${st}::text[]))
    order by s.updated_at desc limit ${opts.limit ?? 200}`;
}

export async function getSale(u: U, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const sc = saleScope(u);
  const rows = await sql`
    select s.*, c.name creator from sales s left join users c on c.id=s.created_by
    where s.id=${id}::uuid and (${sc.all}::boolean or (${sc.own}::boolean and s.created_by=${sc.uid}::uuid) or s.status = any(${sc.statuses}::text[]))`;
  const sale = rows[0];
  if (!sale) return null;
  const [docs, events, approvals, records, tasks, actionableApproval] = await Promise.all([
    sql`select d.*, u.name uploader from sale_documents d left join users u on u.id=d.uploaded_by where d.sale_id=${id}::uuid order by d.created_at`,
    sql`select e.*, u.name actor, u.role actor_role from workflow_events e left join users u on u.id=e.actor_id where e.entity_type='SALE' and e.entity_id=${id}::uuid order by e.created_at desc`,
    sql`select a.*, u.name acted_by_name from approvals a left join users u on u.id=a.acted_by where a.entity_type='SALE' and a.entity_id=${id}::uuid order by a.round_no, a.seq, a.created_at`,
    sql`select r.*, u.name creator from site_records r left join users u on u.id=r.created_by where r.sale_id=${id}::uuid order by r.created_at desc`,
    sql`select * from operations where sale_id=${id}::uuid order by created_at`,
    actionableApprovalForEntity(u, 'SALE', id),
  ]);
  return { sale, docs, events, approvals, records, tasks, actionableApproval };
}

export async function listClients(limit = 200) {
  return sql`select c.*, u.name creator,
    (select count(*) from sales s where s.client_id=c.id and s.status<>'CANCELLED') sales_count
    from clients c left join users u on u.id=c.created_by order by c.created_at desc limit ${limit}`;
}

export async function getClient(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await sql`select c.*, u.name creator from clients c left join users u on u.id=c.created_by where c.id=${id}::uuid`;
  if (!rows[0]) return null;
  const sales = await sql`select id, property_name, plot_reference, amount, status from sales where client_id=${id}::uuid order by created_at desc`;
  return { client: rows[0], sales };
}

// ---------------------------------------------------------------- Leads
export async function listLeads(u: U) {
  const all = u.role !== 'MARKETER' && u.role !== 'SALES';
  return sql`select l.*, o.name owner from leads l left join users o on o.id=l.owner_id
    where ${all}::boolean or l.owner_id=${u.id}::uuid order by l.created_at desc limit 300`;
}
/** Leads captured per marketer for a day (Africa/Lagos calendar day). */
export async function leadsToday(u: U) {
  const all = u.role !== 'MARKETER' && u.role !== 'SALES';
  return sql`select o.id, o.name, o.role, count(l.id)::int n from users o
    left join leads l on l.owner_id=o.id and (l.created_at at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date
    where o.active and o.role in ('MARKETER','SALES') and (${all}::boolean or o.id=${u.id}::uuid)
    group by o.id, o.name, o.role order by n desc, o.name`;
}

// ---------------------------------------------------------------- Expenses
export async function listExpenses(u: U, statuses?: string[]) {
  const sc = expenseScope(u);
  return sql`select e.*, s.client_name, s.plot_reference, b.name submitter from expenses e
    left join sales s on s.id=e.sale_id left join users b on b.id=e.submitted_by
    where (${sc.all}::boolean or e.submitted_by=${sc.uid}::uuid) and (${statuses ?? null}::text[] is null or e.status = any(${statuses ?? null}::text[]))
    order by e.updated_at desc limit 200`;
}
export async function getExpense(u: U, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const sc = expenseScope(u);
  const rows = await sql`select e.*, s.client_name, s.plot_reference, b.name submitter from expenses e
    left join sales s on s.id=e.sale_id left join users b on b.id=e.submitted_by
    where e.id=${id}::uuid and (${sc.all}::boolean or e.submitted_by=${sc.uid}::uuid)`;
  if (!rows[0]) return null;
  const [events, approvals, actionableApproval] = await Promise.all([
    sql`select e.*, u.name actor, u.role actor_role from workflow_events e left join users u on u.id=e.actor_id where e.entity_type='EXPENSE' and e.entity_id=${id}::uuid order by e.created_at desc`,
    sql`select a.*, u.name acted_by_name from approvals a left join users u on u.id=a.acted_by where a.entity_type='EXPENSE' and a.entity_id=${id}::uuid order by a.round_no, a.seq, a.created_at`,
    actionableApprovalForEntity(u, 'EXPENSE', id),
  ]);
  return { expense: rows[0], events, approvals, actionableApproval };
}

// ---------------------------------------------------------------- Approvals
/** Return one approval step this user can act on for a specific record. */
export async function actionableApprovalForEntity(u: U, entityType: 'SALE' | 'EXPENSE', entityId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(entityId)) return null;
  const rows = await sql`
    select a.*, coalesce(s.client_name, e.vendor) subject,
           coalesce(s.plot_reference, e.category) detail,
           coalesce(s.amount, e.amount, e.negotiated_amount) amount,
           sub.name submitted_by_name
    from approvals a
    left join sales s on a.entity_type='SALE' and s.id=a.entity_id
    left join expenses e on a.entity_type='EXPENSE' and e.id=a.entity_id
    left join users sub on sub.id=a.submitted_by
    where a.entity_type=${entityType} and a.entity_id=${entityId}::uuid
      and a.status='PENDING' and a.approver_role=${u.role}
      and a.submitted_by is distinct from ${u.id}::uuid
      and not exists (
        select 1 from approvals p where p.entity_type=a.entity_type and p.entity_id=a.entity_id
          and p.round=a.round and p.round_no=a.round_no and p.status='PENDING' and p.seq<a.seq
      )
    order by a.seq, a.created_at limit 1`;
  return rows[0] ?? null;
}

/** Approval steps this user can act on right now: earlier steps done, role matches, not self-submitted. */
export async function actionableApprovals(u: U) {
  return sql`
    select a.*, coalesce(s.client_name, e.vendor) subject, coalesce(s.plot_reference, e.category) detail,
           coalesce(s.amount, e.amount, e.negotiated_amount) amount, sub.name submitted_by_name
    from approvals a
    left join sales s on a.entity_type='SALE' and s.id=a.entity_id
    left join expenses e on a.entity_type='EXPENSE' and e.id=a.entity_id
    left join users sub on sub.id=a.submitted_by
    where a.status='PENDING' and a.approver_role=${u.role}
      and a.submitted_by is distinct from ${u.id}::uuid
      and not exists (select 1 from approvals p where p.entity_type=a.entity_type and p.entity_id=a.entity_id
                      and p.round=a.round and p.round_no=a.round_no and p.status='PENDING' and p.seq<a.seq)
    order by a.created_at`;
}
/** Every open approval step in the company (read-only overview for oversight roles). */
export async function pendingOverview() {
  return sql`
    select a.*, coalesce(s.client_name, e.vendor) subject, coalesce(s.plot_reference, e.category) detail,
      exists (select 1 from approvals p where p.entity_type=a.entity_type and p.entity_id=a.entity_id
              and p.round=a.round and p.round_no=a.round_no and p.status='PENDING' and p.seq<a.seq) waiting
    from approvals a
    left join sales s on a.entity_type='SALE' and s.id=a.entity_id
    left join expenses e on a.entity_type='EXPENSE' and e.id=a.entity_id
    where a.status='PENDING' order by a.created_at limit 200`;
}

// ---------------------------------------------------------------- "Needs my action" queue
export type QueueItem = { kind: string; title: string; sub: string; action: string; href: string; at: unknown; flag?: string };

export async function myQueue(u: U): Promise<QueueItem[]> {
  const sActs = SALE_ACTIONS.filter(a => a.roles.includes(u.role) && a.to && !a.danger);
  const eActs = EXPENSE_ACTIONS.filter(a => a.roles.includes(u.role));
  const sStatuses = [...new Set(sActs.flatMap(a => a.from))];
  const eStatuses = [...new Set(eActs.flatMap(a => a.from))];
  const sc = saleScope(u);
  const [sales, exps, apps] = await Promise.all([
    sStatuses.length ? sql`select s.* from sales s
      where s.status = any(${sStatuses}::text[])
        and (${sc.all}::boolean or (${sc.own}::boolean and s.created_by=${sc.uid}::uuid) or s.status = any(${sc.statuses}::text[]))
      order by s.updated_at limit 100` : Promise.resolve([] as Row[]),
    eStatuses.length ? sql`select e.* from expenses e where e.status = any(${eStatuses}::text[]) order by e.updated_at limit 100` : Promise.resolve([] as Row[]),
    actionableApprovals(u),
  ]);
  const items: QueueItem[] = [];
  for (const s of sales) {
    const a = sActs.find(x => x.from.includes(s.status) && !(x.ownOnly && u.role === 'SALES' && s.created_by !== u.id));
    if (!a) continue;
    const overdue = s.status === 'SITE_NOTIFIED' && s.ops_due_date && new Date(s.ops_due_date) < new Date(Date.now() - 86400000);
    items.push({ kind: 'Sale', title: `${s.client_name} — ${s.plot_reference || s.property_name || ''}`, sub: `₦${Number(s.amount).toLocaleString()}`, action: a.label, href: `/sales/${s.id}`, at: s.updated_at, flag: overdue ? 'OVERDUE' : undefined });
  }
  for (const e of exps) {
    const a = eActs.find(x => x.from.includes(e.status));
    if (a) items.push({ kind: 'Expense', title: `${e.vendor} — ${e.category}`, sub: `₦${Number(e.amount ?? e.negotiated_amount ?? 0).toLocaleString()}`, action: a.label, href: `/expenses/${e.id}`, at: e.updated_at });
  }
  for (const a of apps) items.push({ kind: 'Approval', title: `${a.subject} — ${a.detail ?? ''}`, sub: a.step, action: 'Approve / reject', href: '/approvals', at: a.created_at });
  return items.sort((x, y) => +new Date(x.at as any) - +new Date(y.at as any));
}

// ---------------------------------------------------------------- Department workspaces
export async function opsTasks() {
  return sql`select o.*, s.client_name, s.property_name, s.plot_reference, s.status sale_status
    from operations o join sales s on s.id=o.sale_id where o.status='PENDING' order by o.due_date nulls first, o.created_at limit 200`;
}
export async function siteRecords(limit = 100) {
  return sql`select r.*, s.client_name, s.plot_reference, u.name creator from site_records r join sales s on s.id=r.sale_id left join users u on u.id=r.created_by order by r.created_at desc limit ${limit}`;
}

// ---------------------------------------------------------------- Dashboard
export async function companyStats() {
  const [funnel, kpi, appr, exp, sla] = await Promise.all([
    sql`select status, count(*)::int n from sales group by status`,
    sql`select
      (select count(*)::int from sales where created_at >= date_trunc('month', now()) and status<>'CANCELLED') sales_month,
      (select coalesce(sum(amount),0) from sales where created_at >= date_trunc('month', now()) and status<>'CANCELLED') value_month,
      (select coalesce(sum(amount),0) from sales where status not in ('DRAFT','PAYMENT_PROOF_SUBMITTED','CANCELLED') and payment_status='VERIFIED') verified_value,
      (select count(*)::int from leads where status not in ('CONVERTED','LOST')) active_leads,
      (select count(*)::int from leads where (created_at at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date) leads_today,
      (select count(*)::int from sales where status='ALLOCATED') allocated`,
    sql`select approver_role role, count(*)::int n from approvals where status='PENDING' group by 1 order by n desc`,
    sql`select status, count(*)::int n, coalesce(sum(coalesce(amount,negotiated_amount)),0) total from expenses group by status`,
    sql`select
      (select count(*)::int from sales where status='SITE_NOTIFIED' and ops_due_date < current_date) ops_docs_overdue,
      (select count(*)::int from sales where status in ('FULLY_APPROVED','PRE_ALLOCATION') and approved_at + make_interval(days => ${ALLOCATION_WINDOW_DAYS}) < now()) allocation_notice_overdue`,
  ]);
  return { funnel, kpi: kpi[0], approvals: appr, expenses: exp, sla: sla[0] };
}

// ---------------------------------------------------------------- Reports
export async function marketerReport() {
  return sql`
    with days as (
      select l.owner_id, (l.created_at at time zone 'Africa/Lagos')::date d, count(*) n from leads l
      where l.created_at >= now() - interval '14 days' group by 1,2)
    select u.id, u.name, u.role,
      coalesce((select n from days where owner_id=u.id and d=(now() at time zone 'Africa/Lagos')::date),0)::int today,
      (select count(*)::int from leads where owner_id=u.id and created_at >= now() - interval '7 days') last7,
      (select count(*)::int from leads where owner_id=u.id and created_at >= now() - interval '30 days') last30,
      (select count(*)::int from leads where owner_id=u.id and status='CONVERTED' and updated_at >= now() - interval '30 days') converted30,
      (select count(*)::int from days where owner_id=u.id and n >= ${DAILY_LEAD_TARGET}) target_days14
    from users u where u.active and u.role in ('MARKETER','SALES') order by last30 desc, u.name`;
}
export async function salesReport() {
  const [byExec, byMonth] = await Promise.all([
    sql`select coalesce(u.name,'—') name, count(s.id)::int sales, coalesce(sum(s.amount),0) value,
        count(*) filter (where s.status='ALLOCATED')::int allocated
        from sales s left join users u on u.id=s.created_by where s.status<>'CANCELLED' group by 1 order by value desc`,
    sql`select to_char(date_trunc('month',created_at),'Mon YYYY') month, count(*)::int sales, coalesce(sum(amount),0) value
        from sales where created_at >= now() - interval '12 months' and status<>'CANCELLED' group by date_trunc('month',created_at) order by date_trunc('month',created_at)`,
  ]);
  return { byExec, byMonth };
}
export async function hrReport() {
  const [activity, turnaround, aging, headcount] = await Promise.all([
    sql`select u.name, u.role, count(a.id)::int actions, max(a.created_at) last_action from users u
        left join audit_logs a on a.user_id=u.id and a.created_at >= now() - interval '30 days'
        where u.active group by u.id, u.name, u.role order by actions desc, u.name`,
    sql`select approver_role role, count(*)::int decided,
        round((avg(extract(epoch from (acted_at - created_at)))/3600)::numeric,1) avg_hours,
        count(*) filter (where status='REJECTED')::int rejected
        from approvals where status in ('APPROVED','REJECTED') and acted_at >= now() - interval '90 days' group by 1 order by avg_hours desc`,
    sql`select approver_role role, count(*)::int pending, round((max(extract(epoch from (now() - created_at)))/86400)::numeric,1) oldest_days
        from approvals where status='PENDING' group by 1 order by oldest_days desc`,
    sql`select coalesce(department,'Unassigned') department, count(*)::int staff from users where active group by 1 order by staff desc`,
  ]);
  return { activity, turnaround, aging, headcount };
}
export async function opsReport() {
  const [tasks, cycle, late] = await Promise.all([
    sql`select task_type, count(*) filter (where status='PENDING')::int open,
        count(*) filter (where status='PENDING' and due_date < current_date)::int overdue,
        count(*) filter (where status='DONE')::int done from operations group by 1`,
    sql`select round(avg(extract(epoch from (u.t - n.t))/86400)::numeric,1) avg_days, count(*)::int n from
        (select entity_id, min(created_at) t from workflow_events where to_status='SITE_NOTIFIED' group by 1) n
        join (select entity_id, min(created_at) t from workflow_events where to_status='OPS_DOCS_UPLOADED' group by 1) u using(entity_id)`,
    sql`select s.client_name, s.plot_reference, s.ops_due_date, s.status from sales s
        where s.status in ('SITE_NOTIFIED','RETURNED') and s.ops_due_date < current_date order by s.ops_due_date limit 50`,
  ]);
  return { tasks, cycle: cycle[0], late };
}
export async function siteReport() {
  const [stages, upcoming, notice, records] = await Promise.all([
    sql`select status, count(*)::int n from sales where status in ('SITE_NOTIFIED','OPS_DOCS_UPLOADED','IN_APPROVAL','RETURNED','FULLY_APPROVED','PRE_ALLOCATION','ALLOCATION_SCHEDULED','ALLOCATED') group by 1`,
    sql`select client_name, plot_reference, property_name, allocation_date from sales where status='ALLOCATION_SCHEDULED' order by allocation_date limit 50`,
    sql`select client_name, plot_reference, status, approved_at, (approved_at::date + ${ALLOCATION_WINDOW_DAYS}) notice_due from sales
        where status in ('FULLY_APPROVED','PRE_ALLOCATION') order by approved_at limit 50`,
    sql`select record_type, count(*)::int n from site_records where created_at >= now() - interval '30 days' group by 1 order by n desc`,
  ]);
  return { stages, upcoming, notice, records };
}
export async function financeReport() {
  const [byStatus, monthly, cycle, invoiced] = await Promise.all([
    sql`select status, count(*)::int n, coalesce(sum(coalesce(amount,negotiated_amount)),0) total from expenses group by 1 order by n desc`,
    sql`select to_char(date_trunc('month',paid_at),'Mon YYYY') month, count(*)::int n, coalesce(sum(amount),0) total
        from expenses where paid_at is not null group by date_trunc('month',paid_at) order by date_trunc('month',paid_at) desc limit 12`,
    sql`select round(avg(extract(epoch from (r.t - c.created_at))/86400)::numeric,1) avg_days from expenses c
        join (select entity_id, min(created_at) t from workflow_events where to_status='RECEIPT_ISSUED' group by 1) r on r.entity_id=c.id`,
    sql`select count(*)::int n, coalesce(sum(amount),0) total from sales where invoice_number is not null and status<>'CANCELLED'`,
  ]);
  return { byStatus, monthly, cycle: cycle[0], invoiced: invoiced[0] };
}
export async function myActivity(userId: string) {
  return sql`select action, count(*)::int n from audit_logs where user_id=${userId}::uuid and created_at >= now() - interval '30 days' group by 1 order by n desc limit 15`;
}

// ---------------------------------------------------------------- Notifications, users, audit
export async function unreadCount(userId: string): Promise<number> {
  const r = await sql`select count(*)::int n from notifications where user_id=${userId}::uuid and read_at is null`;
  return r[0]?.n ?? 0;
}
export async function notificationsFor(userId: string) {
  return sql`select * from notifications where user_id=${userId}::uuid order by created_at desc limit 100`;
}
export async function listUsers() {
  return sql`select id,name,email,role,department,active,must_change_password,locked_until,created_at from users order by active desc, name`;
}
export async function auditLog(limit = 200) {
  return sql`select a.*, u.name actor, u.role actor_role from audit_logs a left join users u on u.id=a.user_id order by a.created_at desc limit ${limit}`;
}

// ---------------------------------------------------------------- Departments
export async function listDepartments(activeOnly = false) {
  return sql`select d.*, (select count(*)::int from users u where u.department=d.name and u.active) staff_count
    from departments d where ${activeOnly}::boolean is false or d.active order by d.name`;
}

// ---------------------------------------------------------------- Performance
/**
 * One row per active staff member, blending whichever metrics are relevant to
 * their role: sales closed/value for the sales team, approval throughput for
 * approvers, tasks completed for operations, leads captured/converted for the
 * front line, and overall audit-log activity for everyone as a general signal.
 */
export async function staffPerformance() {
  return sql`
    select
      u.id, u.name, u.role, u.department,
      (select count(*)::int from sales s where s.created_by=u.id and s.status<>'CANCELLED') sales_count,
      (select coalesce(sum(s.amount),0) from sales s where s.created_by=u.id and s.status='ALLOCATED') sales_value,
      (select count(*)::int from sales s where s.created_by=u.id and s.status='ALLOCATED') sales_allocated,
      (select count(*)::int from leads l where l.owner_id=u.id and l.created_at >= now() - interval '30 days') leads_30d,
      (select count(*)::int from leads l where l.owner_id=u.id and l.status='CONVERTED' and l.updated_at >= now() - interval '30 days') leads_converted_30d,
      (select count(*)::int from approvals a where a.acted_by=u.id and a.status in ('APPROVED','REJECTED') and a.acted_at >= now() - interval '30 days') approvals_30d,
      (select round((avg(extract(epoch from (a.acted_at - a.created_at)))/3600)::numeric,1) from approvals a where a.acted_by=u.id and a.status in ('APPROVED','REJECTED') and a.acted_at >= now() - interval '30 days') avg_approval_hours,
      (select count(*)::int from approvals a where a.acted_by=u.id and a.status='REJECTED' and a.acted_at >= now() - interval '30 days') rejections_30d,
      (select count(*)::int from workflow_events w where w.actor_id=u.id and w.stage='OPERATIONS' and w.created_at >= now() - interval '30 days') ops_actions_30d,
      (select count(*)::int from audit_logs al where al.user_id=u.id and al.created_at >= now() - interval '30 days') actions_30d
    from users u
    where u.active
    order by sales_value desc, actions_30d desc, u.name`;
}

/** Company-wide performance beyond the raw pipeline counts in companyStats(): revenue,
 *  conversion rate, average full sale-cycle time, and approval SLA compliance. */
export async function companyPerformance() {
  const [revenue, funnel, cycle, sla] = await Promise.all([
    sql`select
        (select coalesce(sum(amount),0) from sales where status='ALLOCATED') total_revenue,
        (select coalesce(sum(amount),0) from sales where status='ALLOCATED' and allocated_at >= date_trunc('month', now())) revenue_month,
        (select coalesce(sum(amount),0) from sales where status='ALLOCATED' and allocated_at >= now() - interval '12 months') revenue_12mo`,
    sql`select
        (select count(*)::int from leads) leads_total,
        (select count(*)::int from leads where status='CONVERTED') leads_converted,
        (select count(*)::int from sales where status<>'CANCELLED') sales_total,
        (select count(*)::int from sales where status='ALLOCATED') sales_allocated`,
    sql`select round(avg(extract(epoch from (allocated_at - created_at))/86400)::numeric,1) avg_cycle_days, count(*)::int n
        from sales where status='ALLOCATED' and allocated_at is not null`,
    sql`select
        count(*) filter (where status in ('APPROVED','REJECTED'))::int decided,
        count(*) filter (where status in ('APPROVED','REJECTED') and acted_at - created_at <= interval '48 hours')::int within_sla
        from approvals where created_at >= now() - interval '90 days'`,
  ]);
  return { revenue: revenue[0], funnel: funnel[0], cycle: cycle[0], sla: sla[0] };
}

