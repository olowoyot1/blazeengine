import Shell from '@/components/Shell';
import { notFound } from 'next/navigation';
import { requireCap } from '@/lib/guard';
import { getExpense } from '@/lib/queries';
import { Badge } from '@/components/Badge';
import { ApprovalDecisionPanel } from '@/components/ApprovalDecisionPanel';
import { naira, fmtDateTime, human } from '@/lib/format';
import { availableExpenseActions } from '@/lib/workflow/expense';
import { EXPENSE_STATUS_LABEL } from '@/lib/constants';
import { ExpenseActionPanel } from './ExpenseActionPanel';

export default async function ExpenseDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireCap('expense.read', 'expense.read_all', 'finance.workspace');
  const data = await getExpense(s, id);
  if (!data) notFound();
  const { expense: e, events, approvals, actionableApproval } = data;
  const actions = availableExpenseActions(e as any, s).map(a => ({ key: a.key, label: a.label, help: a.help, danger: a.danger, fields: a.fields }));

  return (
    <Shell s={s} title={`${e.vendor || 'Expense'} — ${e.category}`} kicker="Expense">
      <div className="grid2">
        <div className="card">
          <div className="section-title"><h3>Overview</h3><Badge status={e.status} label={EXPENSE_STATUS_LABEL[e.status] ?? human(e.status)} /></div>
          <table className="table"><tbody>
            <tr><td className="muted">Origin</td><td>{human(e.origin)}</td></tr>
            <tr><td className="muted">Vendor / Category</td><td>{e.vendor || '—'} / {e.category}</td></tr>
            <tr><td className="muted">Related sale</td><td>{e.client_name ? `${e.client_name} (${e.plot_reference || ''})` : '—'}</td></tr>
            <tr><td className="muted">Negotiated amount</td><td>{e.negotiated_amount ? naira(e.negotiated_amount) : '—'}</td></tr>
            <tr><td className="muted">Expense amount</td><td>{e.amount ? naira(e.amount) : '—'}</td></tr>
            <tr><td className="muted">Bank reference</td><td>{e.bank_reference || '—'}</td></tr>
            <tr><td className="muted">Bank alert</td><td>{e.bank_alert_ref || '—'}</td></tr>
            <tr><td className="muted">Receipt</td><td>{e.receipt_no || '—'}</td></tr>
            <tr><td className="muted">Submitted by</td><td>{e.submitter || '—'}</td></tr>
            {e.negotiation_notes && <tr><td className="muted">Negotiation notes</td><td>{e.negotiation_notes}</td></tr>}
            {e.rejected_reason && <tr><td className="muted">Last rejection</td><td>{e.rejected_reason}</td></tr>}
          </tbody></table>
        </div>
        <div className="card"><h3>Your action</h3><ExpenseActionPanel expenseId={e.id} actions={actions} /></div>
      </div>

      <ApprovalDecisionPanel approval={actionableApproval} />

      <div className="card" style={{ marginTop: 15 }}>
        <h3>Approval chain</h3>
        {approvals.length === 0 ? <div className="empty">Not yet started.</div> : (
          <ul className="timeline">{approvals.map((a: any) => (
            <li key={a.id}><b>{a.step} <span className="muted small">(round {a.round_no})</span></b>
              <div className="muted small"><Badge status={a.status} /> {a.acted_by_name ? `· ${a.acted_by_name}` : ''} {a.acted_at ? `· ${fmtDateTime(a.acted_at)}` : ''}{a.comment ? ` · “${a.comment}”` : ''}</div></li>
          ))}</ul>
        )}
      </div>

      <div className="card" style={{ marginTop: 15 }}>
        <h3>History</h3>
        <ul className="timeline">{events.map((ev: any) => (
          <li key={ev.id}><b>{ev.action}</b> <span className="muted small">— {ev.actor || 'System'} · {fmtDateTime(ev.created_at)}</span>{ev.notes && <div className="muted small">{ev.notes}</div>}</li>
        ))}</ul>
      </div>
    </Shell>
  );
}
