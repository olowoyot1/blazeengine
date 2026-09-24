import Shell from '@/components/Shell';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCap } from '@/lib/guard';
import { getClient } from '@/lib/queries';
import { Badge } from '@/components/Badge';
import { naira, fmtDateTime } from '@/lib/format';
import { ClientProfileForm } from './ClientProfileForm';

export default async function ClientDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireCap('client.read');
  const data = await getClient(id);
  if (!data) notFound();
  const { client: c, sales } = data;

  return (
    <Shell s={s} title={c.name} kicker={c.profile_completed_at ? 'Client' : 'Client — profile incomplete'}>
      {!c.profile_completed_at && (
        <div className="notice">This client was just converted from a lead. Complete their profile below.</div>
      )}
      <div className="grid2">
        <div className="card">
          <h3>Profile</h3>
          <ClientProfileForm clientId={c.id} client={c} />
        </div>
        <div className="card">
          <h3>Sales history</h3>
          {sales.length === 0 ? <div className="empty">No sales yet for this client.</div> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>Property</th><th>Plot</th><th>Amount</th><th>Status</th><th></th></tr></thead>
              <tbody>{sales.map((r: any) => (
                <tr key={r.id}><td>{r.property_name || '—'}</td><td>{r.plot_reference || '—'}</td><td>{naira(r.amount)}</td>
                  <td><Badge status={r.status} /></td><td><Link className="btn light" href={`/sales/${r.id}`}>Open</Link></td></tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="muted small" style={{ marginTop: 14 }}>
            Added {fmtDateTime(c.created_at)}{c.creator ? ` by ${c.creator}` : ''}.
            {c.profile_completed_at && ` Profile completed ${fmtDateTime(c.profile_completed_at)}.`}
          </p>
        </div>
      </div>
    </Shell>
  );
}
