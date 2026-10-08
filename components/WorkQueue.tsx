import { Badge } from './Badge';
import { naira } from '@/lib/format';
import { transactionDocumentLabel } from './TransactionDocumentLabel';

export function WorkQueue({ title, sales, emptyLabel }: { title: string; sales: any[]; emptyLabel: string }) {
  return (
    <div className="card">
      <div className="section-title"><h3>{title}</h3><span className="badge">{sales.length}</span></div>
      {sales.length === 0 ? <div className="empty">{emptyLabel}</div> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Client</th><th>Plot</th><th>Transaction document</th><th>Amount</th><th>Status</th><th></th></tr></thead>
          <tbody>{sales.map((r: any) => (
            <tr key={r.id}>
              <td>{r.client_name || '—'}</td>
              <td>{r.plot_reference || r.property_name || '—'}</td>
              <td><b>{transactionDocumentLabel(r)}</b><div className="muted small">{String(r.transaction_type ?? '').toUpperCase() === 'TOP_UP' ? 'Top-up' : String(r.payment_plan ?? '').toUpperCase() === 'OUTRIGHT' ? 'Outright sale' : 'Installment'}</div></td>
              <td>{naira(r.amount ?? r.payment_amount ?? 0)}</td>
              <td><Badge status={r.status || 'PENDING'} /></td>
              <td><a className="btn light" href={`/sales/${encodeURIComponent(String(r.id))}`} aria-label={`Open sale ${r.sale_reference || r.id}`}>Open</a></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
