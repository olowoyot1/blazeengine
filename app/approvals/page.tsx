import Shell from '@/components/Shell';
import { requireCap } from '@/lib/guard';
import { actionableApprovals, pendingOverview } from '@/lib/queries';
import { naira, fmtDateTime } from '@/lib/format';
import { can } from '@/lib/rbac';
import { ApprovalRow } from './ApprovalRow';

export default async function Approvals() {
  const s = await requireCap('approvals.read');
  const [mine, overview] = await Promise.all([actionableApprovals(s), can(s.role, 'audit.read') ? pendingOverview() : Promise.resolve([])]);
  return (
    <Shell s={s} title="Approval Centre" kicker="Sales Manager → Operations Manager → HR (internal audit) → CEO"><div style={{display:"flex",gap:6}}><a className="btn" href="/api/export?type=approvals&format=xls">Excel</a><a className="btn" href="/api/export?type=approvals&format=pdf">PDF</a></div>
      <div className="card">
        <div className="section-title"><h3>Waiting for your decision</h3><span className="badge">{mine.length}</span></div>
        {mine.length === 0 ? <div className="empty">Nothing is waiting on you right now.</div> : (
          <div>{mine.map((a: any) => <ApprovalRow key={a.id} a={a} />)}</div>
        )}
      </div>

      {overview.length > 0 && (
        <div className="card" style={{ marginTop: 15 }}>
          <div className="section-title"><h3>Company-wide pending approvals</h3><span className="badge">{overview.length}</span></div>
          <div className="table-wrap"><table className="table"><thead><tr><th>Subject</th><th>Detail</th><th>Step</th><th>Approver role</th><th>Amount</th><th>Waiting on earlier step?</th><th>Opened</th></tr></thead>
            <tbody>{overview.map((a: any) => (
              <tr key={a.id}><td>{a.subject}</td><td>{a.detail}</td><td>{a.step}</td><td>{a.approver_role.replace(/_/g, ' ')}</td>
                <td>{a.amount ? naira(a.amount) : '—'}</td><td>{a.waiting ? 'Yes' : 'No — actionable'}</td><td>{fmtDateTime(a.created_at)}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
    </Shell>
  );
}
