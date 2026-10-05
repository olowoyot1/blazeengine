import Shell from '@/components/Shell';
import { requireCap } from '@/lib/guard';
import { listSales, listExpenses } from '@/lib/queries';
import { WorkQueue } from '@/components/WorkQueue';
import { GenerateSaleDocumentsButton } from '@/components/GenerateSaleDocumentsButton';
import { naira } from '@/lib/format';
import { Badge } from '@/components/Badge';
import Link from 'next/link';

export default async function Accounts() {
  const s = await requireCap('accounts.workspace');
  const [proof, invoiced, approvedForDocuments, contracted, negApproved, expEntered] = await Promise.all([
    listSales(s, { status: 'PAYMENT_PROOF_SUBMITTED' }),
    listSales(s, { statuses: ['INVOICE_ENTERED'] }),
    listSales(s, { status: 'SALES_APPROVED' }),
    listSales(s, { status: 'CONTRACT_PREPARED' }),
    listExpenses(s, ['NEGOTIATION_APPROVED']),
    listExpenses(s, ['PAID']),
  ]);
  return (
    <Shell s={s} title="Accounts" kicker="Accountant · verify payment, enter invoice, issue documents & receipts">
      <div className="grid2">
        <WorkQueue title="Payment proof to verify → enter invoice" sales={proof} emptyLabel="Nothing waiting." />
        <WorkQueue title="Awaiting Sales Manager approval" sales={invoiced} emptyLabel="Nothing waiting." />
      </div>

      <div className="card" style={{ marginTop: 15 }}>
        <div className="section-title"><h3>Sales approved → Generate Contract + Acknowledgement</h3><span className="badge">{approvedForDocuments.length}</span></div>
        {approvedForDocuments.length === 0 ? <div className="empty">Nothing waiting.</div> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Client</th><th>Property</th><th>Payment</th><th>Reference</th><th></th></tr></thead>
            <tbody>{approvedForDocuments.map((sale: any) => (
              <tr key={sale.id}>
                <td>{sale.client_name}</td>
                <td>{sale.property_name || '—'} {sale.plot_reference ? `· ${sale.plot_reference}` : ''}</td>
                <td>{naira(sale.payment_amount ?? sale.amount)}</td>
                <td>{sale.sale_reference || '—'}</td>
                <td style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <GenerateSaleDocumentsButton saleId={sale.id} status={sale.status} role={s.role} compact />
                  <Link className="btn light" href={`/sales/${sale.id}`}>Open</Link>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="card" style={{ marginTop: 15 }}>
        <div className="section-title"><h3>Zoho Books</h3><a className="btn" href="https://landblaze.oaatz.com" target="_blank" rel="noreferrer">Post</a></div>
        <p className="muted small">Post approved accounting records to Zoho Books through the Landblaze portal.</p>
      </div>
      <div className="grid2" style={{ marginTop: 15 }}>
        <WorkQueue title="Contract ready → send sales documents" sales={contracted} emptyLabel="Nothing waiting." />
        <div className="card">
          <div className="section-title"><h3>Negotiations approved → enter expense</h3><span className="badge">{negApproved.length}</span></div>
          {negApproved.length === 0 ? <div className="empty">Nothing waiting.</div> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>Vendor</th><th>Category</th><th>Negotiated</th><th></th></tr></thead>
              <tbody>{negApproved.map((e: any) => <tr key={e.id}><td>{e.vendor}</td><td>{e.category}</td><td>{naira(e.negotiated_amount)}</td><td><Link className="btn light" href={`/expenses/${e.id}`}>Open</Link></td></tr>)}</tbody>
            </table></div>
          )}
        </div>
      </div>
      <div className="card" style={{ marginTop: 15 }}>
        <div className="section-title"><h3>Paid → generate & share receipt</h3><span className="badge">{expEntered.length}</span></div>
        {expEntered.length === 0 ? <div className="empty">Nothing waiting.</div> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Vendor</th><th>Category</th><th>Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>{expEntered.map((e: any) => <tr key={e.id}><td>{e.vendor}</td><td>{e.category}</td><td>{naira(e.amount)}</td><td><Badge status={e.status} /></td><td><Link className="btn light" href={`/expenses/${e.id}`}>Open</Link></td></tr>)}</tbody>
          </table></div>
        )}
      </div>
    </Shell>
  );
}
