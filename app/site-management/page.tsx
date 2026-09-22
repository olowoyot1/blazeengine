import Shell from '@/components/Shell';
import { requireCap } from '@/lib/guard';
import { listSales, siteRecords, listExpenses } from '@/lib/queries';
import { WorkQueue } from '@/components/WorkQueue';
import { ALLOCATION_WINDOW_DAYS } from '@/lib/constants';
import { fmtDateTime, human, naira } from '@/lib/format';
import { NewNegotiationForm } from './NewNegotiationForm';

export default async function SiteManagement() {
  const s = await requireCap('site.workspace');
  const [needsAudit, inApproval, fullyApproved, preAlloc, scheduled, records, negotiations] = await Promise.all([
    listSales(s, { status: 'OPS_DOCS_UPLOADED' }),
    listSales(s, { status: 'IN_APPROVAL' }),
    listSales(s, { status: 'FULLY_APPROVED' }),
    listSales(s, { status: 'PRE_ALLOCATION' }),
    listSales(s, { status: 'ALLOCATION_SCHEDULED' }),
    siteRecords(60),
    listExpenses(s, ['NEGOTIATION_SUBMITTED']),
  ]);
  return (
    <Shell s={s} title="Site Management" kicker="Site Manager · final audit, negotiations, pre-allocation & allocation">
      <div className="grid">
        <div className="card stat"><div className="label">Awaiting final audit</div><h2>{needsAudit.length}</h2></div>
        <div className="card stat"><div className="label">In approval chain</div><h2>{inApproval.length}</h2></div>
        <div className="card stat"><div className="label">Ready for pre-allocation</div><h2>{fullyApproved.length}</h2></div>
        <div className="card stat"><div className="label">Allocation notice window</div><h2>{ALLOCATION_WINDOW_DAYS}d</h2></div>
      </div>

      <div className="grid2" style={{ marginTop: 15 }}>
        <WorkQueue title="Operations docs uploaded → final audit" sales={needsAudit} emptyLabel="Nothing waiting." />
        <WorkQueue title="Fully approved → send soft copy & start pre-allocation" sales={fullyApproved} emptyLabel="Nothing waiting." />
      </div>
      <div className="grid2" style={{ marginTop: 15 }}>
        <WorkQueue title="Pre-allocation → set allocation date" sales={preAlloc} emptyLabel="Nothing waiting." />
        <WorkQueue title="Allocation date set → confirm allocation" sales={scheduled} emptyLabel="Nothing waiting." />
      </div>

      <div className="card" style={{ marginTop: 15 }}>
        <h3>Upload vendor negotiation</h3>
        <NewNegotiationForm />
      </div>

      {negotiations.length > 0 && (
        <div className="card" style={{ marginTop: 15 }}>
          <div className="section-title"><h3>Negotiations awaiting approval</h3><span className="badge">{negotiations.length}</span></div>
          <div className="table-wrap"><table className="table"><thead><tr><th>Vendor</th><th>Category</th><th>Negotiated</th></tr></thead>
            <tbody>{negotiations.map((e: any) => <tr key={e.id}><td>{e.vendor}</td><td>{e.category}</td><td>{naira(e.negotiated_amount)}</td></tr>)}</tbody>
          </table></div>
        </div>
      )}

      <div className="card" style={{ marginTop: 15 }}>
        <div className="section-title"><h3>Recent site records</h3><span className="badge">{records.length}</span></div>
        <ul className="timeline">{records.map((r: any) => (
          <li key={r.id}><b>{human(r.record_type)}</b> — {r.client_name} ({r.plot_reference || '—'})<div className="muted small">{r.creator} · {fmtDateTime(r.created_at)}</div></li>
        ))}</ul>
        {records.length === 0 && <div className="empty">No records yet.</div>}
      </div>
    </Shell>
  );
}
