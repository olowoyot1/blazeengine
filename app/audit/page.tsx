import Shell from '@/components/Shell';
import { requireCap } from '@/lib/guard';
import { auditLog } from '@/lib/queries';
import { fmtDateTime, human } from '@/lib/format';

export default async function Audit() {
  const s = await requireCap('audit.read');
  const rows = await auditLog(300);
  return (
    <Shell s={s} title="Audit Trail" kicker="Every workflow action, in order">
      <div className="card">
        <div className="table-wrap"><table className="table">
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th></tr></thead>
          <tbody>{rows.map((r: any) => (
            <tr key={r.id}><td>{fmtDateTime(r.created_at)}</td><td>{r.actor || 'System'} {r.actor_role ? `(${human(r.actor_role)})` : ''}</td>
              <td>{human(r.action)}</td><td>{r.entity_type} {r.entity_id ? String(r.entity_id).slice(0, 8) : ''}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
    </Shell>
  );
}
