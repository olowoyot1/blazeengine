import Shell from '@/components/Shell';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCap } from '@/lib/guard';
import { getClient } from '@/lib/queries';
import { getClientSales } from '@/lib/clientSales';
import { getClientSaleDocuments } from '@/lib/clientDocuments';
import { Badge } from '@/components/Badge';
import SalesFlowAutoRefresh from '@/components/SalesFlowAutoRefresh';
import { naira, fmtDateTime, human } from '@/lib/format';
import { SALE_STATUS_LABEL, SALE_STATUS_ORDER } from '@/lib/constants';
import { ClientProfileForm } from './ClientProfileForm';

const LEGAL_TYPES = new Set(['CONTRACT', 'ACKNOWLEDGMENT_LETTER']);
const FINANCE_TYPES = new Set(['INVOICE', 'SALES_ORDER', 'SALES_RECEIPT']);

function documentTitle(type: string) {
  if (type === 'CONTRACT') return 'Contract of Sale';
  if (type === 'ACKNOWLEDGMENT_LETTER') return 'Letter of Acknowledgement';
  if (type === 'INVOICE') return 'Invoice';
  if (type === 'SALES_ORDER') return 'Sales Order';
  if (type === 'SALES_RECEIPT') return 'Sales Receipt';
  return human(type);
}

function downloadUrl(url: string) {
  return `${url}${url.includes('?') ? '&' : '?'}download=1`;
}

function roleLabel(role?: string | null) {
  if (!role) return 'Responsible department';
  return human(role.replace(/_/g, ' '));
}

function nextAction(s: any) {
  if (s.next_action_title) {
    return {
      title: String(s.next_action_title),
      owner: s.next_action_owner_name ? `${s.next_action_owner_name} · ${roleLabel(s.next_action_owner_role)}` : roleLabel(s.next_action_owner_role),
      tone: s.status === 'ALLOCATED' ? 'done' : s.status === 'CANCELLED' ? 'muted' : 'attention',
      due: s.next_action_due_date,
      updated: s.next_action_updated_at,
    };
  }
  if (s.status === 'CANCELLED') return { title: 'Sale closed', owner: 'No further action', tone: 'muted' };
  if (s.status === 'ALLOCATED') return { title: 'Sale completed — allocated', owner: 'Completed', tone: 'done' };

  if (s.pending_approval_step) {
    return {
      title: s.pending_approval_step,
      owner: roleLabel(s.pending_approval_role),
      tone: 'attention',
      due: s.pending_approval_at,
    };
  }

  const map: Record<string, { title: string; owner: string; tone?: string }> = {
    PENDING_SALES_APPROVAL: { title: 'Approve new sale', owner: 'Sales Manager', tone: 'attention' },
    DRAFT: { title: 'Upload payment proof', owner: 'Sales', tone: 'attention' },
    PAYMENT_PROOF_SUBMITTED: { title: 'Verify payment and generate invoice / sales order', owner: 'Accounts', tone: 'attention' },
    INVOICE_ENTERED: { title: 'Verify generated finance document', owner: 'Sales Manager', tone: 'attention' },
    SALES_APPROVED: { title: 'Generate Contract + Letter of Acknowledgement', owner: 'Accounts / Sales', tone: 'attention' },
    CONTRACT_PREPARED: { title: 'Review and approve generated sale documents', owner: 'Sales / Operations', tone: 'attention' },
    ACCOUNT_DOCS_SENT: { title: 'Open Operations portal and start site workflow', owner: 'Operations', tone: 'attention' },
    SITE_NOTIFIED: { title: 'Complete deed of assignment and survey requirements', owner: 'Site / Operations', tone: 'attention' },
    OPS_DEED_UPLOADED: { title: 'Upload survey plan', owner: 'Site Manager', tone: 'attention' },
    OPS_DOCS_UPLOADED: { title: 'Run final audit and start approval chain', owner: 'Site Manager', tone: 'attention' },
    IN_APPROVAL: { title: 'Complete approval chain', owner: 'Approving department', tone: 'attention' },
    RETURNED: { title: 'Correct returned items and resubmit', owner: 'Responsible department', tone: 'attention' },
    FULLY_APPROVED: { title: 'Start pre-allocation', owner: 'Operations', tone: 'attention' },
    PRE_ALLOCATION: { title: 'Set allocation date', owner: 'Operations', tone: 'attention' },
    ALLOCATION_SCHEDULED: { title: 'Confirm allocation', owner: 'Operations / Site', tone: 'attention' },
  };
  const item = map[String(s.status)] ?? { title: 'Review sale and determine next workflow action', owner: 'Sales Operations', tone: 'attention' };
  return { ...item, due: s.pending_task_due_date };
}

function progressPercent(status: string) {
  const index = SALE_STATUS_ORDER.indexOf(status);
  if (index < 0 || status === 'CANCELLED') return 0;
  return Math.round((index / (SALE_STATUS_ORDER.length - 2)) * 100);
}

function SalesFlowMonitor({ sales }: { sales: any[] }) {
  const active = sales.filter(s => !['ALLOCATED', 'CANCELLED'].includes(String(s.status)));
  const attention = active.filter(s => nextAction(s).tone === 'attention');
  const overdue = active.filter(s => {
    const due = nextAction(s).due;
    return due && new Date(due).getTime() < Date.now();
  });

  return (
    <div className="card" style={{ marginTop: 15 }}>
      <div className="section-title">
        <div>
          <h3 style={{ marginBottom: 4 }}>Sales Flow Monitor</h3>
          <p className="muted small" style={{ margin: 0 }}>
            Proactively tracks every active sale, its current stage, assigned next action and the responsible owner.
          </p>
        </div>
        <div style={{ display: 'grid', gap: 4, justifyItems: 'end' }}>
          <span className="badge">{active.length} active</span>
          <SalesFlowAutoRefresh />
        </div>
      </div>
      <div className="grid3" style={{ marginTop: 12 }}>
        <div className="card" style={{ margin: 0 }}><div className="muted small">Total sales</div><strong style={{ fontSize: 24 }}>{sales.length}</strong></div>
        <div className="card" style={{ margin: 0 }}><div className="muted small">Needs action</div><strong style={{ fontSize: 24 }}>{attention.length}</strong></div>
        <div className="card" style={{ margin: 0 }}><div className="muted small">Overdue next actions</div><strong style={{ fontSize: 24 }}>{overdue.length}</strong></div>
      </div>
    </div>
  );
}

function SalesHistory({ sales }: { sales: any[] }) {
  if (sales.length === 0) return <div className="empty">No sales yet for this client.</div>;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {sales.map((r: any) => {
        const action = nextAction(r);
        const overdue = action.due && new Date(action.due).getTime() < Date.now() && action.tone === 'attention';
        return (
          <div key={r.id} className="card" style={{ margin: 0, border: '1px solid var(--border)' }}>
            <div className="section-title">
              <div>
                <h4 style={{ margin: 0 }}>{r.property_name || 'Property'} {r.plot_reference ? `· ${r.plot_reference}` : ''}</h4>
                <div className="muted small" style={{ marginTop: 4 }}>
                  {r.sale_reference || 'Sale'} · Created {fmtDateTime(r.created_at)} · Last activity {r.last_activity_at ? fmtDateTime(r.last_activity_at) : 'Not recorded'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge status={r.status} />
                <Link className="btn light" href={`/sales/${r.id}`}>Open sale</Link>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span className="muted small">{SALE_STATUS_LABEL[String(r.status)] || human(String(r.status))}</span>
                <strong>{naira(r.amount ?? r.quoted_amount ?? 0)}</strong>
              </div>
              <div style={{ height: 7, background: 'var(--border)', borderRadius: 99, marginTop: 7, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, progressPercent(String(r.status)))}%`, height: '100%', background: 'var(--accent, currentColor)' }} />
              </div>
            </div>

            <div className="grid2" style={{ marginTop: 12 }}>
              <div className="notice" style={{ margin: 0 }}>
                <div className="muted small">NEXT ACTION</div>
                <strong>{action.title}</strong>
                <div className="muted small" style={{ marginTop: 4 }}>Owner: {action.owner}</div>
                {action.due && <div className={overdue ? 'small' : 'muted small'} style={{ marginTop: 4 }}>{overdue ? 'OVERDUE · ' : 'Due · '}{fmtDateTime(action.due)}</div>}
                {action.updated && <div className="muted small" style={{ marginTop: 4 }}>Assignment updated {fmtDateTime(action.updated)}</div>}
              </div>
              <div className="card" style={{ margin: 0 }}>
                <div className="muted small">LAST ACTIVITY</div>
                <strong>{r.last_activity_action ? human(String(r.last_activity_action).replace(/_/g, ' ')) : 'No workflow event recorded'}</strong>
                {r.last_activity_message && <div className="muted small" style={{ marginTop: 4 }}>{String(r.last_activity_message).slice(0, 180)}</div>}
                {r.pending_task_type && <div className="muted small" style={{ marginTop: 6 }}>Open task: {human(String(r.pending_task_type).replace(/_/g, ' '))}</div>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DocumentsSection({ title, description, documents }: { title: string; description: string; documents: any[] }) {
  return (
    <div className="card" style={{ marginTop: 15 }}>
      <div className="section-title">
        <div><h3 style={{ marginBottom: 4 }}>{title}</h3><p className="muted small" style={{ margin: 0 }}>{description}</p></div>
        <span className="badge">{documents.length}</span>
      </div>
      {documents.length === 0 ? <div className="empty">No {title.toLowerCase()} are attached to this customer yet.</div> : (
        <div style={{ display: 'grid', gap: 18 }}>
          {documents.map((d: any) => {
            const label = documentTitle(String(d.document_type));
            const isPdf = d.document_url && /\/api\/files\/[0-9a-f-]{36}$/i.test(String(d.document_url));
            return (
              <div key={d.id} className="card" style={{ margin: 0, border: '1px solid var(--border)' }}>
                <div className="section-title">
                  <div><h4 style={{ margin: 0 }}>{label}</h4><div className="muted small" style={{ marginTop: 4 }}>{d.sale_reference || 'Sale'} · {d.property_name || 'Property'}{d.plot_reference ? ` · ${d.plot_reference}` : ''} · {fmtDateTime(d.created_at)}</div></div>
                  {d.document_url && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><a className="btn light" href={d.document_url} target="_blank" rel="noreferrer">View PDF</a><a className="btn light" href={downloadUrl(String(d.document_url))}>Download PDF</a></div>}
                </div>
                {isPdf ? <iframe title={label} src={d.document_url} style={{ width: '100%', height: 620, border: '1px solid var(--border)', borderRadius: 8, marginTop: 12, background: '#fff' }} /> : <div className="notice" style={{ marginTop: 12 }}>The document record exists, but a private PDF file is not currently attached.</div>}
                <div className="muted small" style={{ marginTop: 8 }}>{d.document_name || human(d.document_type)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default async function ClientDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireCap('client.read');
  const data = await getClient(id);
  if (!data) notFound();
  const { client: c } = data;
  const sales = await getClientSales(c.id);
  const documents = await getClientSaleDocuments(c.id);
  const legalDocuments = documents.filter((d: any) => LEGAL_TYPES.has(String(d.document_type)));
  const financeDocuments = documents.filter((d: any) => FINANCE_TYPES.has(String(d.document_type)));

  return (
    <Shell s={s} title={c.name} kicker={c.profile_completed_at ? 'Client' : 'Client — profile incomplete'}>
      {!c.profile_completed_at && <div className="notice">This client was just converted from a lead. Complete their profile below.</div>}
      <div className="grid2">
        <div className="card"><h3>Customer Information</h3><ClientProfileForm clientId={c.id} client={c} /></div>
        <div className="card">
          <h3>Sales history</h3>
          <p className="muted small">Complete history across this customer, with workflow stage, activity and the next required action.</p>
          <SalesHistory sales={sales} />
          <p className="muted small" style={{ marginTop: 14 }}>Added {fmtDateTime(c.created_at)}{c.creator ? ` by ${c.creator}` : ''}.{c.profile_completed_at && ` Profile completed ${fmtDateTime(c.profile_completed_at)}.`}</p>
        </div>
      </div>

      <SalesFlowMonitor sales={sales} />
      <DocumentsSection title="Customer Legal Documents" description="Contract of Sale and Letter of Acknowledgement generated for this customer's sales." documents={legalDocuments} />
      <DocumentsSection title="Customer Finance Documents" description="Invoices, Sales Orders and Sales Receipts generated by Accounts are available here for viewing and secure download." documents={financeDocuments} />
    </Shell>
  );
}
