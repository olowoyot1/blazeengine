'use client';

export default function FinancePaymentDocuments({ documents }: { documents: any[] }) {
  return <div className="card" style={{ marginTop: 15 }}>
    <h3>Finance payment advice / bank receipt</h3>
    <p className="muted small">These are the documents Finance & Accounts uploaded when cash was actually disbursed after CEO approval. They are kept separate from the expense source documents.</p>
    {documents.length === 0 ? <div className="empty">No payment advice or bank receipt uploaded yet.</div> : (
      <ul className="timeline">{documents.map((d: any) => (
        <li key={d.id}><b>{d.document_name}</b><div className="muted small">{d.bank_reference ? `Bank ref: ${d.bank_reference} · ` : ''}{d.uploader || 'Finance'} · {new Date(d.created_at).toLocaleString()}</div>
          <a href={`/api/files/${d.uploaded_file_id}`} target="_blank" rel="noreferrer">Open payment advice / bank receipt</a>
        </li>
      ))}</ul>
    )}
  </div>;
}
