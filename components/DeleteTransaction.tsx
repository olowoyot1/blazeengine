'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteTransaction } from '@/lib/actions';

export function DeleteTransaction({ kind, id, label }: { kind: 'SALE' | 'EXPENSE'; id: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  function submit() {
    setError('');
    start(async () => {
      const res = await deleteTransaction(kind, id, reason);
      if ('error' in res) { setError(res.error); return; }
      router.push(kind === 'SALE' ? '/sales' : '/expenses');
      router.refresh();
    });
  }

  return (
    <div className="card" style={{ marginTop: 15, borderColor: '#f3c4c4' }}>
      <h3>Delete transaction</h3>
      <p className="muted small">Administrators only. This permanently removes {label} along with its approvals, documents and history. A snapshot is kept in the audit trail.</p>
      {!open ? (
        <button type="button" className="btn danger" onClick={() => setOpen(true)}>Delete transaction</button>
      ) : (
        <div>
          <label className="field" htmlFor={`delete-reason-${id}`}>Reason for deletion *</label>
          <textarea id={`delete-reason-${id}`} className="textarea" rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Duplicate entry created in error" />
          {error && <p role="alert" className="small" style={{ color: '#b73737' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn danger" disabled={pending || reason.trim().length < 5} onClick={submit}>
              {pending ? 'Deleting…' : 'Permanently delete'}
            </button>
            <button type="button" className="btn light" disabled={pending} onClick={() => { setOpen(false); setError(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
