import Shell from '@/components/Shell';
import Link from 'next/link';
import { requireCap } from '@/lib/guard';
import { listSales } from '@/lib/queries';
import { Badge } from '@/components/Badge';
import { naira } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function OperationsSalesInfo() {
  const s = await requireCap('ops.workspace');
  const rows = await listSales(s);

  return (
    <Shell
      s={s}
      title="Sales Information"
      kicker="Operations · approved sales, property and client information"
      actions={<Link className="btn" href="/operations">Back to Operations</Link>}
    >
      <div className="card">
        <div className="section-title">
          <h3>Sales information</h3>
          <span className="badge">{rows.length}</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Client</th>
                <th>Property</th>
                <th>Plot</th>
                <th>Transaction</th>
                <th>Amount</th>
                <th>Balance to pay</th>
                <th>Status</th>
                <th>Payment</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id}>
                  <td><b>{r.sale_reference || 'Reference pending'}</b></td>
                  <td>{r.client_name || '—'}</td>
                  <td>{r.property_name || '—'}</td>
                  <td>{r.plot_reference || '—'}</td>
                  <td>{String(r.transaction_type || 'INITIAL_DEPOSIT').replace(/_/g, ' ')}</td>
                  <td>{naira(r.amount ?? r.payment_amount ?? 0)}</td>
                  <td>{naira(r.outstanding_balance ?? 0)}</td>
                  <td><Badge status={r.status || 'PENDING'} /></td>
                  <td><Badge status={r.payment_status || 'PENDING'} label={String(r.payment_status || 'PENDING').replace(/_/g, ' ')} /></td>
                  <td><Link className="btn light" href={`/operations/sales/${r.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <div className="empty">No sales are currently visible to Operations.</div>}
      </div>
    </Shell>
  );
}
