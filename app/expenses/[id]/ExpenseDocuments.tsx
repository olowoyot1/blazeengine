'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { attachExpenseDocument } from '@/lib/actions';

export default function ExpenseDocuments({ expenseId, documents }: { expenseId: string; documents: any[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState('SUPPORTING_DOCUMENT');
  const [busy, start] = useTransition();
  const router = useRouter();
  async function upload(e: React.FormEvent) {
    e.preventDefault(); if (!file) return;
    start(async () => {
      const fd = new FormData(); fd.append('file', file);
      const x = await fetch('/api/files', { method: 'POST', body: fd });
      const z = await x.json();
      if (!x.ok) { alert(z.error || 'Upload failed'); return; }
      const a = await attachExpenseDocument(expenseId, type, file.name, z.path);
      if ('error' in a) alert(a.error); else { setFile(null); router.refresh(); }
    });
  }
  return <div className="card" style={{ marginTop: 15 }}>
    <h3>Expense supporting documents</h3>
    <p className="muted small">Upload quotations, invoices, receipts, approvals or other proof related to this expense here.</p>
    {documents.length > 0 && <ul className="timeline">{documents.map((d:any) => <li key={d.id}><b>{d.document_name}</b><div className="muted small">{String(d.document_type).replace(/_/g,' ')} · {d.uploader || 'Staff'} · {new Date(d.created_at).toLocaleString()}</div><a href={`/api/files/${d.uploaded_file_id}`} target="_blank" rel="noreferrer">Open document</a></li>)}</ul>}
    <form onSubmit={upload} className="notice">
      <div className="grid2"><label>Document type<select className="select" value={type} onChange={e=>setType(e.target.value)}><option>SUPPORTING_DOCUMENT</option><option>QUOTATION</option><option>INVOICE</option><option>RECEIPT</option><option>APPROVAL_PROOF</option><option>OTHER</option></select></label><label>File<input className="input" type="file" accept="application/pdf,image/png,image/jpeg" required onChange={e=>setFile(e.target.files?.[0]||null)}/></label></div>
      <button className="btn primary" disabled={busy||!file}>{busy?'Uploading…':'Upload document'}</button>
    </form>
  </div>;
}
