import Shell from '@/components/Shell';
import { requireCap } from '@/lib/guard';
import { can } from '@/lib/rbac';
import { marketerReport, salesReport, hrReport, opsReport, siteReport, financeReport, companyStats, myActivity } from '@/lib/queries';
import { naira, human, fmtDate } from '@/lib/format';
import { DAILY_LEAD_TARGET } from '@/lib/constants';

export default async function Reports() {
  const s = await requireCap('report.sales', 'report.hr', 'report.ops', 'report.site', 'report.finance', 'report.company');
  const sections: React.ReactNode[] = [];

  if (can(s.role, 'report.sales')) {
    const [marketers, sales] = await Promise.all([marketerReport(), salesReport()]);
    sections.push(
      <div className="card" key="sales-team">
        <h3>Sales team — leads &amp; targets</h3>
        <div className="table-wrap"><table className="table"><thead><tr><th>Name</th><th>Today</th><th>Last 7d</th><th>Last 30d</th><th>Converted (30d)</th><th>Days hit {DAILY_LEAD_TARGET}/day (14d)</th></tr></thead>
          <tbody>{marketers.map((m: any) => <tr key={m.id}><td>{m.name}</td><td>{m.today}</td><td>{m.last7}</td><td>{m.last30}</td><td>{m.converted30}</td><td>{m.target_days14}/14</td></tr>)}</tbody>
        </table></div>
      </div>,
      <div className="card" key="sales-value">
        <h3>Sales by executive</h3>
        <div className="table-wrap"><table className="table"><thead><tr><th>Executive</th><th>Sales</th><th>Value</th><th>Allocated</th></tr></thead>
          <tbody>{sales.byExec.map((r: any) => <tr key={r.name}><td>{r.name}</td><td>{r.sales}</td><td>{naira(r.value)}</td><td>{r.allocated}</td></tr>)}</tbody>
        </table></div>
      </div>,
      <div className="card" key="sales-month">
        <h3>Sales by month (12 months)</h3>
        <div className="table-wrap"><table className="table"><thead><tr><th>Month</th><th>Sales</th><th>Value</th></tr></thead>
          <tbody>{sales.byMonth.map((r: any) => <tr key={r.month}><td>{r.month}</td><td>{r.sales}</td><td>{naira(r.value)}</td></tr>)}</tbody>
        </table></div>
      </div>,
    );
  }

  if (can(s.role, 'report.ops')) {
    const ops = await opsReport();
    sections.push(
      <div className="card" key="ops">
        <h3>Operations workload</h3>
        <div className="table-wrap"><table className="table"><thead><tr><th>Task</th><th>Open</th><th>Overdue</th><th>Done</th></tr></thead>
          <tbody>{ops.tasks.map((r: any) => <tr key={r.task_type}><td>{human(r.task_type)}</td><td>{r.open}</td><td>{r.overdue}</td><td>{r.done}</td></tr>)}</tbody>
        </table></div>
        <p className="muted small">Average time from portal-open to documents uploaded: {ops.cycle.avg_days ?? '—'} days ({ops.cycle.n ?? 0} sales).</p>
        {ops.late.length > 0 && <><h4>Overdue allocation documents</h4>
          <div className="table-wrap"><table className="table"><thead><tr><th>Client</th><th>Plot</th><th>Due</th></tr></thead>
            <tbody>{ops.late.map((r: any) => <tr key={r.plot_reference + r.client_name}><td>{r.client_name}</td><td>{r.plot_reference}</td><td>{fmtDate(r.ops_due_date)}</td></tr>)}</tbody>
          </table></div></>}
      </div>,
    );
  }

  if (can(s.role, 'report.site')) {
    const site = await siteReport();
    sections.push(
      <div className="card" key="site">
        <h3>Site management</h3>
        <div className="table-wrap"><table className="table"><thead><tr><th>Stage</th><th>Count</th></tr></thead>
          <tbody>{site.stages.map((r: any) => <tr key={r.status}><td>{human(r.status)}</td><td>{r.n}</td></tr>)}</tbody>
        </table></div>
        <h4>Upcoming allocations</h4>
        <div className="table-wrap"><table className="table"><thead><tr><th>Client</th><th>Plot</th><th>Date</th></tr></thead>
          <tbody>{site.upcoming.map((r: any) => <tr key={r.plot_reference}><td>{r.client_name}</td><td>{r.plot_reference}</td><td>{fmtDate(r.allocation_date)}</td></tr>)}</tbody>
        </table></div>
      </div>,
    );
  }

  if (can(s.role, 'report.finance')) {
    const fin = await financeReport();
    sections.push(
      <div className="card" key="finance">
        <h3>Finance</h3>
        <div className="table-wrap"><table className="table"><thead><tr><th>Status</th><th>Count</th><th>Total</th></tr></thead>
          <tbody>{fin.byStatus.map((r: any) => <tr key={r.status}><td>{human(r.status)}</td><td>{r.n}</td><td>{naira(r.total)}</td></tr>)}</tbody>
        </table></div>
        <p className="muted small">Average time from expense entry to receipt issued: {fin.cycle.avg_days ?? '—'} days.</p>
        <p className="muted small">Total invoiced (non-cancelled sales): {naira(fin.invoiced.total)} ({fin.invoiced.n} sales).</p>
      </div>,
    );
  }

  if (can(s.role, 'report.hr')) {
    const hr = await hrReport();
    sections.push(
      <div className="card" key="hr">
        <h3>HR — staff activity &amp; approval turnaround</h3>
        <div className="table-wrap"><table className="table"><thead><tr><th>Staff</th><th>Role</th><th>Actions (30d)</th></tr></thead>
          <tbody>{hr.activity.slice(0, 20).map((r: any) => <tr key={r.name}><td>{r.name}</td><td>{human(r.role)}</td><td>{r.actions}</td></tr>)}</tbody>
        </table></div>
        <h4>Approval turnaround (90d)</h4>
        <div className="table-wrap"><table className="table"><thead><tr><th>Role</th><th>Decided</th><th>Avg hours</th><th>Rejected</th></tr></thead>
          <tbody>{hr.turnaround.map((r: any) => <tr key={r.role}><td>{human(r.role)}</td><td>{r.decided}</td><td>{r.avg_hours}</td><td>{r.rejected}</td></tr>)}</tbody>
        </table></div>
        <h4>Oldest pending by role</h4>
        <div className="table-wrap"><table className="table"><thead><tr><th>Role</th><th>Pending</th><th>Oldest (days)</th></tr></thead>
          <tbody>{hr.aging.map((r: any) => <tr key={r.role}><td>{human(r.role)}</td><td>{r.pending}</td><td>{r.oldest_days}</td></tr>)}</tbody>
        </table></div>
      </div>,
    );
  }

  if (can(s.role, 'report.company')) {
    const stats = await companyStats();
    sections.unshift(
      <div className="card" key="company">
        <h3>CEO — overall dashboard</h3>
        <div className="table-wrap"><table className="table"><thead><tr><th>Metric</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>Sales this month</td><td>{stats.kpi.sales_month} · {naira(stats.kpi.value_month)}</td></tr>
            <tr><td>Verified sales value</td><td>{naira(stats.kpi.verified_value)}</td></tr>
            <tr><td>Active leads</td><td>{stats.kpi.active_leads}</td></tr>
            <tr><td>Allocated plots (all-time)</td><td>{stats.kpi.allocated}</td></tr>
            <tr><td>Operations documents overdue</td><td>{stats.sla.ops_docs_overdue}</td></tr>
            <tr><td>Allocation-notice window overdue</td><td>{stats.sla.allocation_notice_overdue}</td></tr>
          </tbody>
        </table></div>
      </div>,
    );
  }

  const mine = await myActivity(s.id);
  return (
    <Shell s={s} title="Reports" kicker={`Scoped to your role — ${s.role.replace(/_/g, ' ')}`}>
      <div className="grid2">{sections}</div>
      <div className="card" style={{ marginTop: 15 }}>
        <h3>My activity (30 days)</h3>
        <div className="table-wrap"><table className="table"><thead><tr><th>Action</th><th>Count</th></tr></thead>
          <tbody>{mine.map((r: any) => <tr key={r.action}><td>{r.action}</td><td>{r.n}</td></tr>)}</tbody>
        </table></div>
        {mine.length === 0 && <div className="empty">No activity yet.</div>}
      </div>
    </Shell>
  );
}
