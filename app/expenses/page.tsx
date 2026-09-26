import Shell from '@/components/Shell';
import Link from 'next/link';
import { requireCap } from '@/lib/guard';
import { listExpenses } from '@/lib/queries';
import { Badge } from '@/components/Badge';
import { naira, human } from '@/lib/format';
import { EXPENSE_STATUS_LABEL } from '@/lib/constants';
import { can } from '@/lib/rbac';
import { NewDirectExpenseForm } from './NewDirectExpenseForm';

export default async function Expenses() {
  const s = await requireCap('expense.read', 'expense.read_all', 'finance.workspace');
  const rows = await listExpenses(s);
  return (
    <Shell s={s} title="Expenses & Payments" kicker="Vendor negotiation → expense → bank payment → receipt"><div style={{display:"flex",gap:6}}><a className="btn" href="/api/export?type=expenses&format=xls">Excel</a><a className="btn" href="/api/export?type=expenses&format=pdf">PDF</a></div>
      {(s.role === 'ACCOUNTANT' || s.role === 'SUPER_ADMIN') && (
        <div className="card" id="new"><h3>Enter a direct expense</h3><p className="muted small">For costs not tied to a Site Manager negotiation (e.g. office supplies). Goes through the same Ops Manager/HR/CEO approval.</p><NewDirectExpenseForm /></div>
      )}
      <div className="card" style={{ marginTop: 15 }}>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Vendor</th><th>Category</th><th>Sale</th><th>Amount</th><th>Status</th><th>Submitted by</th><th></th></tr></thead>
          <tbody>{rows.map((e: any) => (
            <tr key={e.id}>
              <td>{e.vendor || '—'}</td><td>{e.category}</td><td>{e.client_name || '—'}</td>
              <td>{naira(e.amount ?? e.negotiated_amount)}</td>
              <td><Badge status={e.status} label={EXPENSE_STATUS_LABEL[e.status] ?? human(e.status)} /></td>
              <td>{e.submitter || '—'}</td>
              <td><Link className="btn light" href={`/expenses/${e.id}`}>Open</Link></td>
            </tr>
          ))}</tbody>
        </table></div>
        {rows.length === 0 && <div className="empty">No expenses in your view yet.</div>}
      </div>
    </Shell>
  );
}
