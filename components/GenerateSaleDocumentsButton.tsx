'use client';

import { useState, useTransition } from 'react';
import { generateSaleDocumentsAction } from '@/lib/saleDocumentActions';

const ALLOWED = new Set(['SALES', 'SALES_MANAGER', 'ACCOUNTANT', 'FINANCE_OPERATIONS', 'SUPER_ADMIN']);

export function GenerateSaleDocumentsButton({ saleId, status, role, compact = false }: { saleId: string; status: string; role: string; compact?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');

  if (!ALLOWED.has(role) || !['SALES_APPROVED', 'CONTRACT_PREPARED'].includes(status)) return null;

  const generate = () => {
    setMessage('');
    startTransition(async () => {
      const result = await generateSaleDocumentsAction(saleId);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setMessage(result.result.alreadyGenerated ? 'Documents already generated.' : 'Contract and acknowledgement generated successfully.');
      window.location.reload();
    });
  };

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button className="btn green" type="button" onClick={generate} disabled={pending}>
        {pending ? 'Generating…' : compact ? 'Generate Documents' : 'Generate Contract + Acknowledgement'}
      </button>
      {message && <span className="muted small">{message}</span>}
    </div>
  );
}
