import Shell from '@/components/Shell';
import { requireCap } from '@/lib/guard';
import { listSales, listExpenses } from '@/lib/queries';
import { WorkQueue } from '@/components/WorkQueue';
import { naira } from '@/lib/format';
import { Badge } from '@/components/Badge';
import Link from 'next/link';

export default async function Accounts() {
  const s = await requireCap('accounts.workspace');
  const [proof, invoiced, contracted, negApproved, expEntered] = await Promise.all([
    listSales(s, { status: 'PAYMENT_PROOF_SUBMITTED' }),
    listSales(s, { statuses: ['INVOICE_ENTERED'] }),
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
