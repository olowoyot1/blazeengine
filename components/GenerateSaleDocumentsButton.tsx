'use client';

import { useEffect, useState, useTransition } from 'react';
import { generateSaleDocumentsAction, getSaleDocumentPreviewAction } from '@/lib/saleDocumentActions';

const ALLOWED = new Set(['SALES', 'SALES_MANAGER', 'ACCOUNTANT', 'FINANCE_OPERATIONS', 'SUPER_ADMIN']);
type Doc = { document_type: string; document_name?: string | null; document_url: string };

export function GenerateSaleDocumentsButton({ saleId, status, role, compact = false }: { saleId: string; status: string; role: string; compact?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [documents, setDocuments] = useState<Doc[]>([]);

  const loadPreview = () => {
    startTransition(async () => {
      const result = await getSaleDocumentPreviewAction(saleId);
      if (!result.ok) { setMessage(result.error); return; }
      setDocuments(result.documents as Doc[]);
      if (!result.documents.length) setMessage('No generated sale documents were found.');
    });
  };

  useEffect(() => {
    if (status === 'CONTRACT_PREPARED' && ALLOWED.has(role)) loadPreview();
  }, [status, role, saleId]);

  if (!ALLOWED.has(role)) return null;

  const generate = () => {
    setMessage('');
    startTransition(async () => {
      const result = await generateSaleDocumentsAction(saleId);
      if (!result.ok) { setMessage(result.error); return; }
      setDocuments((result.result.documents || []) as Doc[]);
      setMessage(result.result.alreadyGenerated ? 'Documents already generated.' : 'Contract and acknowledgement generated successfully.');
    });
  };

  const previewButtons = documents.map((doc) => {
    const label = doc.document_type === 'CONTRACT' ? 'Preview Contract' : 'Preview Acknowledgement';
    return (
      <a key={doc.document_type} className="btn light" href={doc.document_url} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    );
  });

  if (status === 'CONTRACT_PREPARED') {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {previewButtons}
        <button className="btn light" type="button" onClick={loadPreview} disabled={pending}>{pending ? 'Loading…' : 'Refresh Preview'}</button>
        {message && <span className="muted small">{message}</span>}
      </div>
    );
  }

  if (status !== 'SALES_APPROVED') return null;

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button className="btn green" type="button" onClick={generate} disabled={pending}>
        {pending ? 'Generating…' : compact ? 'Generate Documents' : 'Generate Contract + Acknowledgement'}
      </button>
      {message && <span className="muted small">{message}</span>}
      {previewButtons}
    </div>
  );
}
