import Shell from '@/components/Shell';
import { notFound } from 'next/navigation';
import { requireCap } from '@/lib/guard';
import { getSale, listActiveApprovers } from '@/lib/queries';
import { Badge } from '@/components/Badge';
import { ApprovalDecisionPanel } from '@/components/ApprovalDecisionPanel';
import { naira, fmtDateTime, human } from '@/lib/format';
import { availableSaleActions } from '@/lib/workflow/sale';
import { SALE_STATUS_ORDER, SALE_STATUS_LABEL } from '@/lib/constants';
import { SaleActionPanel } from './SaleActionPanel';
import { EditSaleForm } from './EditSaleForm';

const MAIN_LINE = ['PENDING_SALES_APPROVAL', 'DRAFT', 'PAYMENT_PROOF_SUBMITTED', 'INVOICE_ENTERED', 'SALES_APPROVED', 'CONTRACT_PREPARED', 'ACCOUNT_DOCS_SENT', 'SITE_NOTIFIED', 'OPS_DOCS_UPLOADED', 'IN_APPROVAL', 'FULLY_APPROVED', 'PRE_ALLOCATION', 'ALLOCATION_SCHEDULED', 'ALLOCATED'];

export default async function SaleDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireCap('sale.read', 'sale.read_all');
  const [data, approvers] = await Promise.all([getSale(s, id), listActiveApprovers()]);
  if (!data) notFound();
  const { sale, docs, events, approvals, records, tasks, actionableApproval } = data;
  const approverOptions = (role: string) => approvers.filter((u: any) => u.role === role).map((u: any) => `${u.id} — ${u.name}`);
  const actions = availableSaleActions(sale as any, s).map(a => ({
    key: a.key, label: a.label, help: a.help, danger: a.danger,
    fields: a.fields.map((field: any) => {
      const roleByField: Record<string, string> = { sales_manager_id: 'SALES_MANAGER', operations_manager_id: 'OPERATIONS_MANAGER', hr_id: 'HR', ceo_id: 'CEO' };
      const role = roleByField[field.name];
      return role ? { ...field, type: 'select', options: approverOptions(role) } : field;
    }),
  }));
  const curIdx = MAIN_LINE.indexOf(sale.status);
  const documentsApproved = sale.status === 'CONTRACT_PREPARED' && approvals.filter((a: any) => a.round === 'SALE_DOCUMENTS_APPROVAL' && a.status === 'APPROVED').length >= 2;

  return (
    <Shell s={s} title={`${sale.client_name} — ${sale.plot_reference || sale.property_name || ''}`} kicker="Sale">
      <div className="stepper">
        {MAIN_LINE.map((st, i) => (
          <span key={st} className={'step-chip ' + (sale.status === 'RETURNED' && i > curIdx ? '' : i < curIdx ? 'done' : i === curIdx ? 'current' : '')}>{human(st)}</span>
        ))}
        {sale.status === 'RETURNED' && <span className="step-chip rejected">Returned</span>}
        {sale.status === 'CANCELLED' && <span className="step-chip rejected">Cancelled</span>}
      </div>

      <div className="grid2">
        <div className="card">
          <div className="section-title"><h3>Overview</h3><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="badge">{sale.sale_reference || 'Reference pending'}</span><Badge status={sale.status} label={SALE_STATUS_LABEL[sale.status] ?? sale.status} /></div></div>
          <table className="table"><tbody>
            <tr><td className="muted">Client</td><td>{sale.client_name} {sale.client_email ? `(${sale.client_email})` : ''}</td></tr>
            <tr><td className="muted">Property / Plot</td><td>{sale.property_name || '—'} / {sale.plot_reference || '—'}</td></tr>
            <tr><td className="muted">Estate value</td><td>{naira(sale.estate_value ?? sale.quoted_amount ?? sale.amount)}</td></tr>
            <tr><td className="muted">Payment</td><td>{naira(sale.payment_amount ?? sale.amount)} · {sale.payment_plan === 'INSTALLMENT' ? 'Installmental' : sale.payment_plan === 'OUTRIGHT' ? 'Outright' : '—'} · <Badge status={sale.payment_status} label={sale.payment_status.replace(/_/g, ' ')} /> {sale.payment_reference || ''}</td></tr>
            <tr><td className="muted">Invoice / SO / SR / SI</td><td>{[sale.invoice_number, sale.sales_order_no, sale.sales_receipt_no, sale.sales_invoice_no].filter(Boolean).join(' · ') || '—'}</td></tr>
            <tr><td className="muted">Ops documents due</td><td>{sale.ops_due_date || '—'}</td></tr>
            <tr><td className="muted">Allocation date</td><td>{sale.allocation_date || 'Not scheduled'}</td></tr>
            <tr><td className="muted">Created by</td><td>{sale.creator || '—'} · {fmtDateTime(sale.created_at)}</td></tr>
            {sale.returned_reason && <tr><td className="muted">Returned reason</td><td>{sale.returned_reason}</td></tr>}
          </tbody></table>
        </div>

        <div className="card">
          <h3>Your action</h3>
          <SaleActionPanel saleId={sale.id} actions={actions} />
          {documentsApproved && <a className="btn green" href="https://landblaze.oaatz.com" target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 12 }}>Open Landblaze Portal</a>}
        </div>
      </div>

      {sale.status === 'PENDING_SALES_APPROVAL' && (s.role === 'SALES_MANAGER' || s.role === 'SUPER_ADMIN') && (
        <div className="card" style={{ marginTop: 15 }}>
          <h3>Edit sale before approval</h3>
          <p className="muted small">Adjust the commercial details if needed, then review the updated overview and approve the sale.</p>
          <EditSaleForm sale={sale as any} />
        </div>
      )}

      <ApprovalDecisionPanel approval={actionableApproval} />

      <div className="grid2" style={{ marginTop: 15 }}>
        <div className="card">
          <h3>Documents</h3>
          {docs.length === 0 ? <div className="empty">No documents yet.</div> : (
            <ul className="timeline">{docs.map((d: any) => (
              <li key={d.id}><b>{human(d.document_type)}</b><div className="muted small">{d.document_name} · {d.uploader} · {fmtDateTime(d.created_at)}</div>
                <a href={d.document_url} target="_blank" rel="noreferrer">{d.document_url}</a></li>
            ))}</ul>
          )}
          <h3 style={{ marginTop: 18 }}>Operations tasks</h3>
          {tasks.length === 0 ? <div className="muted small">None.</div> : (
            <ul className="timeline">{tasks.map((t: any) => (
              <li key={t.id}><b>{human(t.task_type)}</b> <Badge status={t.status} /> <span className="muted small">{t.due_date ? `due ${t.due_date}` : ''}</span></li>
            ))}</ul>
          )}
        </div>

        <div className="card">
          <h3>Approval chain</h3>
          {approvals.length === 0 ? <div className="empty">Not yet started.</div> : (
            <ul className="timeline">{approvals.map((a: any) => (
              <li key={a.id}>
                <b>{a.step} <span className="muted small">(round {a.round_no})</span></b>
                <div className="muted small">
                  <Badge status={a.status} /> {a.acted_by_name ? `· ${a.acted_by_name}` : ''} {a.acted_at ? `· ${fmtDateTime(a.acted_at)}` : ''}
                  {a.comment ? ` · “${a.comment}”` : ''}
                </div>
              </li>
            ))}</ul>
          )}
          <h3 style={{ marginTop: 18 }}>Site records</h3>
          {records.length === 0 ? <div className="muted small">None.</div> : (
            <ul className="timeline">{records.map((r: any) => (
              <li key={r.id}><b>{human(r.record_type)}</b><div className="muted small">{r.creator} · {fmtDateTime(r.created_at)}</div></li>
            ))}</ul>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 15 }}>
        <h3>Full history</h3>
        <ul className="timeline">{events.map((e: any) => (
          <li key={e.id}><b>{e.action}</b> <span className="muted small">— {e.actor || 'System'} ({e.actor_role ? human(e.actor_role) : ''}) · {fmtDateTime(e.created_at)}</span>
            {e.notes && <div className="muted small">{e.notes}</div>}</li>
        ))}</ul>
      </div>
    </Shell>
  );
}
