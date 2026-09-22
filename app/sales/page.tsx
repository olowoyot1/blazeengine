import Shell from '@/components/Shell';
import Link from 'next/link';
import { requireCap } from '@/lib/guard';
import { listSales, listClients } from '@/lib/queries';
import { Badge } from '@/components/Badge';
import { naira } from '@/lib/format';
import { NewSaleForm } from './NewSaleForm';
import { can } from '@/lib/rbac';

export default async function Sales() {
  const s = await requireCap('sale.read', 'sale.read_all');
  const [rows, clients] = await Promise.all([listSales(s), can(s.role, 'sale.create') ? listClients(200) : Promise.resolve([])]);
  return (
    <Shell s={s} title="Sales" kicker="Invoice → payment proof → approval chain → allocation">
      {can(s.role, 'sale.create') && (
        <div className="card" id="new">
          <h3>Create sale</h3>
          {(clients as any[]).length === 0 ? <p className="muted">Convert a lead into a client first, from the Leads page.</p> : <NewSaleForm clients={clients as any} />}
        </div>
      )}
      <div className="card" style={{ marginTop: 15 }}>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Client</th><th>Property</th><th>Plot</th><th>Amount</th><th>Status</th><th>Payment</th><th>Allocation</th><th></th></tr></thead>
          <tbody>{rows.map((r: any) => (
            <tr key={r.id}>
              <td>{r.client_name}</td><td>{r.property_name || '—'}</td><td>{r.plot_reference || '—'}</td>
              <td>{naira(r.amount)}</td><td><Badge status={r.status} /></td>
              <td><Badge status={r.payment_status} label={r.payment_status.replace(/_/g, ' ')} /></td>
              <td>{r.allocation_date || 'Not scheduled'}</td>
              <td><Link className="btn light" href={`/sales/${r.id}`}>Open</Link></td>
            </tr>
          ))}</tbody>
        </table></div>
        {rows.length === 0 && <div className="empty">No sales in your view yet.</div>}
      </div>
    </Shell>
  );
}
