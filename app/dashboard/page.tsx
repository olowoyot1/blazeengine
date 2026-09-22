import Shell from '@/components/Shell';
import { requireUser } from '@/lib/guard';
import { companyStats, myQueue } from '@/lib/queries';
import { naira, human } from '@/lib/format';
import { DAILY_LEAD_TARGET, ALLOCATION_WINDOW_DAYS } from '@/lib/constants';
import Link from 'next/link';

const FUNNEL_ORDER = ['DRAFT', 'PAYMENT_PROOF_SUBMITTED', 'INVOICE_ENTERED', 'SALES_APPROVED', 'CONTRACT_PREPARED', 'ACCOUNT_DOCS_SENT', 'SITE_NOTIFIED', 'OPS_DOCS_UPLOADED', 'IN_APPROVAL', 'FULLY_APPROVED', 'PRE_ALLOCATION', 'ALLOCATION_SCHEDULED', 'ALLOCATED'];

export default async function Dashboard() {
  const s = await requireUser();
  const [{ funnel, kpi, approvals, sla }, queue] = await Promise.all([companyStats(), myQueue(s)]);
  const byStatus = Object.fromEntries(funnel.map((f: any) => [f.status, f.n]));

  return (
    <Shell s={s} title="Overall Dashboard" kicker={`${s.name} · ${s.role.replace(/_/g, ' ')}`}>
      <div className="grid">
        <div className="card stat"><div className="label">Sales this month</div><h2>{kpi.sales_month}</h2><div className="muted">{naira(kpi.value_month)}</div></div>
        <div className="card stat"><div className="label">Active leads</div><h2>{kpi.active_leads}</h2><div className="muted">{kpi.leads_today} captured today</div></div>
        <div className="card stat"><div className="label">Pending approvals</div><h2>{approvals.reduce((a: number, r: any) => a + r.n, 0)}</h2><div className="muted">across all roles</div></div>
        <div className="card stat"><div className="label">Plots allocated</div><h2>{kpi.allocated}</h2><div className="muted">all-time to date</div></div>
      </div>

      {(sla.ops_docs_overdue > 0 || sla.allocation_notice_overdue > 0) && (
        <div className="notice" style={{ marginTop: 15 }}>
          {sla.ops_docs_overdue > 0 && <div>{sla.ops_docs_overdue} sale(s) have Operations documents overdue (30-day rule).</div>}
          {sla.allocation_notice_overdue > 0 && <div>{sla.allocation_notice_overdue} sale(s) are past the {ALLOCATION_WINDOW_DAYS}-day allocation-notice window.</div>}
        </div>
      )}

      <div className="card" style={{ marginTop: 15 }}>
        <div className="section-title"><h3>Needs your action</h3><span className="badge">{queue.length}</span></div>
        {queue.length === 0 ? <div className="empty">Nothing waiting on you right now.</div> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Type</th><th>Item</th><th>Detail</th><th>Next action</th><th></th></tr></thead>
            <tbody>{queue.slice(0, 12).map((q, i) => (
              <tr key={i}><td><span className="badge">{q.kind}</span></td><td>{q.title}</td><td>{q.sub}{q.flag && <span className="tag danger">{q.flag}</span>}</td><td>{q.action}</td>
                <td><Link className="btn light" href={q.href}>Open</Link></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="card" style={{ marginTop: 15 }}>
        <div className="section-title"><h3>Sales pipeline</h3><span className="badge">Every stage is auditable</span></div>
        <div className="workflow">
          {FUNNEL_ORDER.map(st => <div className="stage" key={st}><b>{human(st)}</b><div>{byStatus[st] ?? 0}</div></div>)}
        </div>
      </div>

      <div className="grid2" style={{ marginTop: 15 }}>
        <div className="card">
          <h3>Process implemented (department by department)</h3>
          <ol className="muted" style={{ lineHeight: 1.9, paddingLeft: 18 }}>
            <li><b>Sales team / Marketer</b> — leads (target {DAILY_LEAD_TARGET}/day), converts to clients, uploads payment proof.</li>
            <li><b>Accountant</b> — enters invoice; prepares sales order, receipt, invoice; enters expenses; issues receipts.</li>
            <li><b>Sales Manager</b> — approves the sale (1st approval step).</li>
            <li><b>Operations</b> — approved sale → contract/deed → opens portal → deed of assignment & survey (30 days).</li>
            <li><b>Site Manager</b> — final sale audit (triggers approval chain), vendor negotiation, pre-allocation, survey, logistics, allocation date, allocation.</li>
            <li><b>Operations Manager → HR → CEO</b> — approve one by one; HR acts as internal audit.</li>
            <li><b>Finance Operations</b> — pays approved expenses, uploads bank screenshot (Ops &amp; HR review, then CEO), records the bank alert.</li>
          </ol>
        </div>
        <div className="card">
          <h3>Pending approvals by role</h3>
          <div className="table-wrap"><table className="table"><thead><tr><th>Role</th><th>Pending</th></tr></thead>
            <tbody>{approvals.map((a: any) => <tr key={a.role}><td>{human(a.role)}</td><td>{a.n}</td></tr>)}
              {approvals.length === 0 && <tr><td colSpan={2} className="muted">Nothing pending.</td></tr>}
            </tbody></table></div>
        </div>
      </div>
    </Shell>
  );
}
