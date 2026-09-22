import Link from 'next/link';
import { Badge } from './Badge';
import { naira, human } from '@/lib/format';

export function WorkQueue({ title, sales, emptyLabel }: { title: string; sales: any[]; emptyLabel: string }) {
  return (
    <div className="card">
      <div className="section-title"><h3>{title}</h3><span className="badge">{sales.length}</span></div>
      {sales.length === 0 ? <div className="empty">{emptyLabel}</div> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Client</th><th>Plot</th><th>Amount</th><th>Status</th><th></th></tr></thead>
          <tbody>{sales.map((r: any) => (
            <tr key={r.id}><td>{r.client_name}</td><td>{r.plot_reference || r.property_name || '—'}</td><td>{naira(r.amount)}</td>
              <td><Badge status={r.status} /></td><td><Link className="btn light" href={`/sales/${r.id}`}>Open</Link></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
