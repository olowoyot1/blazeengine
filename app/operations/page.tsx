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
    listSales(s, { statuses: ['SITE_NOTIFIED', 'RETURNED'] }),
    opsTasks(),
  ]);
  return (
    <Shell s={s} title="Operations" kicker="Approved sale → contract & deed → allocation docs (30 days)">
      <div className="grid2">
        <WorkQueue title="Approved sales → create contract & deed" sales={approved} emptyLabel="Nothing waiting." />
        <WorkQueue title="Portal open → upload deed of assignment & survey" sales={docsOpen} emptyLabel="Nothing waiting." />
      </div>
      <div className="card" style={{ marginTop: 15 }}>
        <div className="section-title"><h3>Open operations tasks</h3><span className="badge">{tasks.length}</span></div>
        <div className="table-wrap"><table className="table"><thead><tr><th>Client</th><th>Task</th><th>Sale status</th><th>Due</th></tr></thead>
          <tbody>{tasks.map((t: any) => {
            const overdue = t.due_date && daysUntil(t.due_date)! < 0;
            return <tr key={t.id}><td>{t.client_name}</td><td>{t.task_type.replace(/_/g, ' ')}</td><td><Badge status={t.sale_status} /></td>
              <td>{fmtDate(t.due_date)}{overdue && <span className="tag danger">OVERDUE</span>}</td></tr>;
          })}</tbody>
        </table></div>
        {tasks.length === 0 && <div className="empty">No open tasks.</div>}
      </div>
    </Shell>
  );
}
