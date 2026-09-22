import Shell from '@/components/Shell';
import { requireCap } from '@/lib/guard';
import { listLeads, listClients, leadsToday } from '@/lib/queries';
import { DAILY_LEAD_TARGET } from '@/lib/constants';
import { fmtDateTime } from '@/lib/format';
import { NewLeadForm } from './NewLeadForm';
import { LeadRow } from './LeadRow';

export default async function Leads() {
  const s = await requireCap('lead.read', 'lead.read_all');
  const [leads, today, clients] = await Promise.all([listLeads(s), leadsToday(s), listClients(50)]);
  return (
    <Shell s={s} title="Lead Management" kicker="Sales Team / Marketer">
      <div className="grid" style={{ marginBottom: 15 }}>
        {today.slice(0, 4).map((m: any) => (
          <div className="card stat" key={m.id}>
            <div className="label">{m.name}</div>
            <h2>{m.n}/{DAILY_LEAD_TARGET}</h2>
            <div className="muted">leads today {m.n >= DAILY_LEAD_TARGET ? '· target met' : ''}</div>
          </div>
        ))}
        {today.length === 0 && <div className="card stat"><div className="label">Daily target</div><h2>{DAILY_LEAD_TARGET}</h2><div className="muted">leads per marketer</div></div>}
      </div>

      <div className="card" id="new"><h3>Add a lead</h3><NewLeadForm /></div>

      <div className="card" style={{ marginTop: 15 }}>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Lead</th><th>Phone</th><th>Email</th><th>Source</th><th>Owner</th><th>Status</th><th>Created</th><th></th></tr></thead>
          <tbody>{leads.map((r: any) => <LeadRow key={r.id} r={r} canAct={s.id === r.owner_id || s.role === 'SALES_MANAGER'} />)}</tbody>
        </table></div>
        {leads.length === 0 && <div className="empty">No leads yet.</div>}
      </div>

      <div className="card" style={{ marginTop: 15 }}>
        <div className="section-title"><h3>Clients</h3><span className="badge">{clients.length}</span></div>
        <div className="table-wrap"><table className="table"><thead><tr><th>Client</th><th>Phone</th><th>Email</th><th>Active sales</th></tr></thead>
          <tbody>{clients.map((c: any) => <tr key={c.id}><td>{c.name}</td><td>{c.phone || '—'}</td><td>{c.email || '—'}</td><td>{c.sales_count}</td></tr>)}</tbody>
        </table></div>
      </div>
    </Shell>
  );
}
