import Shell from '@/components/Shell';
import Link from 'next/link';
import { requireCap } from '@/lib/guard';
import { listClients } from '@/lib/queries';
import { Badge } from '@/components/Badge';

export default async function Clients() {
  const s = await requireCap('client.read');
  const clients = await listClients(300);
  return <Shell s={s} title="Customers / Clients" kicker="Sales & Marketing">
    <div className="card">
      <div className="section-title"><div><h3>Client list</h3><p className="muted small">Converted leads and active customers.</p></div><span className="badge">{clients.length}</span></div>
      {clients.length === 0 ? <div className="empty">No clients yet. Convert a qualified lead first.</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Client</th><th>Phone</th><th>Email</th><th>Active sales</th><th>Profile</th><th>Created by</th><th></th></tr></thead><tbody>{clients.map((c:any)=><tr key={c.id}><td>{c.name}</td><td>{c.phone||'—'}</td><td>{c.email||'—'}</td><td>{c.sales_count}</td><td>{c.profile_completed_at?<Badge status="APPROVED" label="Complete"/>:<Badge status="PENDING" label="Incomplete"/>}</td><td>{c.creator||'—'}</td><td><Link className="btn light" href={`/clients/${c.id}`}>Open</Link></td></tr>)}</tbody></table></div>}
    </div>
  </Shell>;
}
