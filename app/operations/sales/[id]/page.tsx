import Link from 'next/link';
import Shell from '@/components/Shell';
import { notFound } from 'next/navigation';
import { requireCap } from '@/lib/guard';
import { getSale, listActiveApprovers } from '@/lib/queries';
import { Badge } from '@/components/Badge';
import { SaleActionPanel } from '@/app/sales/[id]/SaleActionPanel';
import { availableSaleActions } from '@/lib/workflow/sale';
import { naira, fmtDate, fmtDateTime, human } from '@/lib/format';
import { SALE_STATUS_LABEL } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export default async function OperationsSaleDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireCap('ops.workspace');
  const [dataResult, approversResult] = await Promise.allSettled([getSale(s, id), listActiveApprovers()]);
  const data = dataResult.status === 'fulfilled' ? dataResult.value : null;
  const approvers = approversResult.status === 'fulfilled' ? approversResult.value : [];
  if (!data) {
    console.error('[operations-sale-detail] sale not found', { id, role: s.role, userId: s.id });
    notFound();
  }

  const { sale, docs, events, approvals, records, tasks } = data;
  const approverOptions = (role: string) => approvers
    .filter((u: any) => u.role === role)
    .map((u: any) => `${u.id} — ${u.name}`);
  const actions = availableSaleActions(sale as any, s).map(a => ({
    key: a.key,
    label: a.label,
    help: a.help,
    danger: a.danger,
    fields: a.fields.map((field: any) => {
      const roleByField: Record<string, string> = {
        sales_manager_id: 'SALES_MANAGER',
        operations_manager_id: 'OPERATIONS_MANAGER',
        hr_id: 'HR',
        ceo_id: 'CEO',
      };
      const role = roleByField[field.name];
      return role ? { ...field, type: 'select', options: approverOptions(role) } : field;
    }),
  }));

  return (
    <Shell
      s={s}
      title={`${sale.client_name} — ${sale.plot_reference || sale.property_name || ''}`}
      kicker="Operations · Sale Detail"
      actions={<Link className="btn" href="/operations">Back to Operations</Link>}
    >
      <div className="card">
        <div className="section-title">
          <h3>Sale information</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="badge">{sale.sale_reference || 'Reference pending'}</span>
            <Badge status={sale.status} label={SALE_STATUS_LABEL[sale.status] ?? sale.status} />
          </div>
        </div>
        <table className="table"><tbody>
          <tr><td className="muted">Client</td><td>{sale.client_name || '—'}{sale.client_email ? ` (${sale.client_email})` : ''}</td></tr>
          <tr><td className="muted">Property / Plot</td><td>{sale.property_name || '—'} / {sale.plot_reference || '—'}</td></tr>
          <tr><td className="muted">Estate value</td><td>{naira(sale.estate_value ?? sale.quoted_amount ?? sale.amount)}</td></tr>
          <tr><td className="muted">Payment</td><td>{naira(sale.payment_amount ?? sale.amount)} · {String(sale.payment_plan || '').replace(/_/g, ' ') || '—'} · {String(sale.payment_status || 'PENDING').replace(/_/g, ' ')}</td></tr>
          <tr><td className="muted">Transaction</td><td>{sale.transaction_type === 'TOP_UP' ? 'Top-up' : 'Initial deposit'}</td></tr>
          <tr><td className="muted">Invoice / SO / SR / SI</td><td>{[sale.invoice_number, sale.sales_order_no, sale.sales_receipt_no, sale.sales_invoice_no].filter(Boolean).join(' · ') || '—'}</td></tr>
          <tr><td className="muted">Beneficiary</td><td>{sale.beneficiary_name || sale.client_name || '—'}{sale.beneficiary_phone ? ` · ${sale.beneficiary_phone}` : ''}</td></tr>
          <tr><td className="muted">Allocation date</td><td>{sale.allocation_date ? fmtDate(sale.allocation_date) : 'Not scheduled'}</td></tr>
        </tbody></table>
      </div>

      <div className="grid2" style={{ marginTop: 15 }}>
        <div className="card">
          <h3>Operations action</h3>
          <SaleActionPanel saleId={sale.id} actions={actions} />
        </div>
        <div className="card">
          <h3>Operations tasks</h3>
          {tasks.length === 0 ? <div className="empty">No operations tasks.</div> : (
            <ul className="timeline">{tasks.map((t: any) => (
              <li key={t.id}><b>{human(t.task_type)}</b> <Badge status={t.status} /> <span className="muted small">{t.due_date ? `due ${fmtDate(t.due_date)}` : ''}</span></li>
            ))}</ul>
          )}
        </div>
      </div>

      <div className="grid2" style={{ marginTop: 15 }}>
        <div className="card">
          <h3>Documents</h3>
          {docs.length === 0 ? <div className="empty">No documents yet.</div> : (
            <ul className="timeline">{docs.map((d: any) => (
              <li key={d.id}><b>{human(d.document_type)}</b><div className="muted small">{d.document_name} · {d.uploader} · {fmtDateTime(d.created_at)}</div>{d.document_url && <a href={d.document_url} target="_blank" rel="noreferrer">Open document</a>}</li>
            ))}</ul>
          )}
        </div>
        <div className="card">
          <h3>Approval history</h3>
          {approvals.length === 0 ? <div className="empty">No approvals yet.</div> : (
            <ul className="timeline">{approvals.map((a: any) => (
              <li key={a.id}><b>{a.step}</b> <Badge status={a.status} /><div className="muted small">{a.acted_by_name || 'Pending'}{a.acted_at ? ` · ${fmtDateTime(a.acted_at)}` : ''}{a.comment ? ` · ${a.comment}` : ''}</div></li>
            ))}</ul>
          )}
        </div>
      </div>

      <div className="grid2" style={{ marginTop: 15 }}>
        <div className="card">
          <h3>Site records</h3>
          {records.length === 0 ? <div className="empty">No site records.</div> : (
            <ul className="timeline">{records.map((r: any) => <li key={r.id}><b>{human(r.record_type)}</b><div className="muted small">{r.creator} · {fmtDateTime(r.created_at)}</div></li>)}</ul>
          )}
        </div>
        <div className="card">
          <h3>History</h3>
          {events.length === 0 ? <div className="empty">No history.</div> : (
            <ul className="timeline">{events.map((e: any) => <li key={e.id}><b>{e.action}</b><div className="muted small">{e.actor || 'System'} · {fmtDateTime(e.created_at)}</div>{e.notes && <div className="muted small">{e.notes}</div>}</li>)}</ul>
          )}
        </div>
      </div>
    </Shell>
  );
}
