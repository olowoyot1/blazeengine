import Shell from '@/components/Shell';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCap } from '@/lib/guard';
import { getClient } from '@/lib/queries';
import { getClientSaleDocuments } from '@/lib/clientDocuments';
import { Badge } from '@/components/Badge';
import { naira, fmtDateTime, human } from '@/lib/format';
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

function DocumentsSection({ title, description, documents }: { title: string; description: string; documents: any[] }) {
  return (
    <div className="card" style={{ marginTop: 15 }}>
      <div className="section-title">
        <div>
          <h3 style={{ marginBottom: 4 }}>{title}</h3>
          <p className="muted small" style={{ margin: 0 }}>{description}</p>
        </div>
        <span className="badge">{documents.length}</span>
      </div>

      {documents.length === 0 ? (
        <div className="empty">No {title.toLowerCase()} are attached to this customer yet.</div>
      ) : (
        <div style={{ display: 'grid', gap: 18 }}>
          {documents.map((d: any) => {
            const label = documentTitle(String(d.document_type));
            const isPdf = d.document_url && /\/api\/files\/[0-9a-f-]{36}$/i.test(String(d.document_url));
            return (
              <div key={d.id} className="card" style={{ margin: 0, border: '1px solid var(--border)' }}>
                <div className="section-title">
                  <div>
                    <h4 style={{ margin: 0 }}>{label}</h4>
                    <div className="muted small" style={{ marginTop: 4 }}>
                      {d.sale_reference || 'Sale'} · {d.property_name || 'Property'}{d.plot_reference ? ` · ${d.plot_reference}` : ''} · {fmtDateTime(d.created_at)}
                    </div>
                  </div>
                  {d.document_url && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <a className="btn light" href={d.document_url} target="_blank" rel="noreferrer">View PDF</a>
                      <a className="btn light" href={downloadUrl(String(d.document_url))}>Download PDF</a>
                    </div>
                  )}
                </div>

                {isPdf ? (
                  <iframe
                    title={label}
                    src={d.document_url}
                    style={{ width: '100%', height: 620, border: '1px solid var(--border)', borderRadius: 8, marginTop: 12, background: '#fff' }}
                  />
                ) : (
                  <div className="notice" style={{ marginTop: 12 }}>
                    The document record exists, but a private PDF file is not currently attached.
                  </div>
                )}

                <div className="muted small" style={{ marginTop: 8 }}>
                  {d.document_name || human(d.document_type)}
                </div>
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
  const { client: c, sales } = data;
  const documents = await getClientSaleDocuments(c.id);
  const legalDocuments = documents.filter((d: any) => LEGAL_TYPES.has(String(d.document_type)));
  const financeDocuments = documents.filter((d: any) => FINANCE_TYPES.has(String(d.document_type)));

  return (
    <Shell s={s} title={c.name} kicker={c.profile_completed_at ? 'Client' : 'Client — profile incomplete'}>
      {!c.profile_completed_at && (
        <div className="notice">This client was just converted from a lead. Complete their profile below.</div>
      )}
      <div className="grid2">
        <div className="card">
          <h3>Customer Information</h3>
          <ClientProfileForm clientId={c.id} client={c} />
        </div>
        <div className="card">
          <h3>Sales history</h3>
          {sales.length === 0 ? <div className="empty">No sales yet for this client.</div> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>Property</th><th>Plot</th><th>Amount</th><th>Status</th><th></th></tr></thead>
              <tbody>{sales.map((r: any) => (
                <tr key={r.id}><td>{r.property_name || '—'}</td><td>{r.plot_reference || '—'}</td><td>{naira(r.amount)}</td>
                  <td><Badge status={r.status} /></td><td><Link className="btn light" href={`/sales/${r.id}`}>Open</Link></td></tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="muted small" style={{ marginTop: 14 }}>
            Added {fmtDateTime(c.created_at)}{c.creator ? ` by ${c.creator}` : ''}.
            {c.profile_completed_at && ` Profile completed ${fmtDateTime(c.profile_completed_at)}.`}
          </p>
        </div>
      </div>

      <DocumentsSection
        title="Customer Legal Documents"
        description="Contract of Sale and Letter of Acknowledgement generated for this customer's sales."
        documents={legalDocuments}
      />

      <DocumentsSection
        title="Customer Finance Documents"
        description="Invoices, Sales Orders and Sales Receipts generated by Accounts are available here for viewing and secure download."
        documents={financeDocuments}
      />
    </Shell>
  );
}
