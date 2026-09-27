import Shell from '@/components/Shell';
import { requireCap } from '@/lib/guard';
import { listSales, opsTasks } from '@/lib/queries';
import { WorkQueue } from '@/components/WorkQueue';
import { Badge } from '@/components/Badge';
import { fmtDate, daysUntil } from '@/lib/format';

export default async function Operations() {
  const s = await requireCap('ops.workspace');
  const [approved, docsOpen, tasks] = await Promise.all([
    listSales(s, { status: 'SALES_APPROVED' }),
    listSales(s, { statuses: ['SITE_NOTIFIED', 'OPS_DEED_UPLOADED', 'RETURNED'] }),
    opsTasks(),
  ]);
  return (
    <Shell s={s} title="Operations" kicker="Approved sale → sale documents → allocation handoff (30 days)">
      <div className="grid2">
        <WorkQueue title="Approved sales → create sale documents" sales={approved} emptyLabel="Nothing waiting." />
        <WorkQueue title="Allocation documents → site review" sales={docsOpen} emptyLabel="Nothing waiting." />
      </div>
      <div className="card" style={{ marginTop: 15 }}>
        <div className="section-title"><h3>Open operations tasks</h3><span className="badge">{tasks.length}</span></div>
        <div className="table-wrap"><table className="table"><thead><tr><th>Client</th><th>Task</th><th>Sale status</th><th>Due</th></tr></thead>
          <tbody>{tasks.map((t: any) => {
            const dueDays = t.due_date ? daysUntil(t.due_date) : null;
            const overdue = dueDays !== null && dueDays < 0;
            const taskLabel = String(t.task_type ?? 'Operations task').replace(/_/g, ' ');
            return <tr key={t.id}><td>{t.client_name || '—'}</td><td>{taskLabel}</td><td><Badge status={t.sale_status || 'PENDING'} /></td>
              <td>{t.due_date ? fmtDate(t.due_date) : 'No due date'}{overdue && <span className="tag danger">OVERDUE</span>}</td></tr>;
          })}</tbody>
        </table></div>
        {tasks.length === 0 && <div className="empty">No open tasks.</div>}
      </div>
    </Shell>
  );
}
