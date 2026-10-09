export const dynamic = 'force-dynamic';

import Shell from '@/components/Shell';
import Link from 'next/link';
import { requireCap } from '@/lib/guard';
import { listSales, listClients } from '@/lib/queries';
import { Badge } from '@/components/Badge';
import { naira, fmtDate } from '@/lib/format';
import { NewSaleForm } from './NewSaleForm';
import { can } from '@/lib/rbac';

export default async function Sales({ searchParams }: { searchParams: Promise<{ client_id?: string }> }) {
  const s = await requireCap('sale.read', 'sale.read_all');
  const { client_id: initialClientId } = await searchParams;
  const [rowsResult, clientsResult] = await Promise.allSettled([
    listSales(s),
    can(s.role, 'sale.create') ? listClients(200) : Promise.resolve([]),
  ]);
  const rows = rowsResult.status === 'fulfilled' ? rowsResult.value : [];
  const clients = clientsResult.status === 'fulfilled' ? clientsResult.value : [];
  if (rowsResult.status === 'rejected') console.error('[sales-page] failed to load sales:', rowsResult.reason);
  if (clientsResult.status === 'rejected') console.error('[sales-page] failed to load clients:', clientsResult.reason);
  return (
    <Shell s={s} title="Sales" kicker="Invoice → payment proof → approval chain → allocation"><div style={{display:"flex",gap:6}}><a className="btn" href="/api/export?type=sales&format=xls">Excel</a><a className="btn" href="/api/export?type=sales&format=pdf">PDF</a></div>
      {can(s.role, 'sale.create') && (
        <div className="card" id="new">
          <h3>Create sale</h3>
          {(clients as any[]).length === 0 ? <p className="muted">Convert a lead into a client first, from the Leads page.</p> : <NewSaleForm clients={clients as any} initialClientId={initialClientId} />}
        </div>
      )}
      <div className="card" style={{ marginTop: 15 }}>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Reference</th><th>Client</th><th>Property</th><th>Plot</th><th>Amount</th><th>Balance to pay</th><th>Status</th><th>Payment</th><th>Allocation</th><th></th></tr></thead>
          <tbody>{rows.map((r: any) => (
            <tr key={r.id}>
              <td><b>{r.sale_reference || 'Reference pending'}</b></td><td>{r.client_name}</td><td>{r.property_name || '—'}</td><td>{r.plot_reference || '—'}</td>
              <td>{naira(r.amount)}</td><td>{naira(r.outstanding_balance ?? 0)}</td><td><Badge status={r.status} /></td>
              <td><Badge status={r.payment_status} label={(r.payment_status || 'PENDING').replace(/_/g, ' ')} /></td>
              <td>{r.allocation_date ? fmtDate(r.allocation_date) : 'Not scheduled'}</td>
              <td><Link className="btn light" href={`/sales/${r.id}`}>Open</Link></td>
            </tr>
          ))}</tbody>
        </table></div>
        {rows.length === 0 && <div className="empty">No sales in your view yet.</div>}
      </div>
    </Shell>
  );
}
