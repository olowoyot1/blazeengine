'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { topUpSale } from '@/lib/actions';

const BANKS = ['Providus', 'Titan', 'Zenith'] as const;

export function TopUpButton({ sale }: { sale: { id: string; client_id?: string; property_name?: string; plot_reference?: string; estate_value?: number; payment_plan?: string; beneficiary_name?: string; beneficiary_phone?: string; transaction_type?: string } }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [bank, setBank] = useState('');
  const [reference, setReference] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    start(async () => {
      try {
        if (!proof) { setError('Payment proof is required before the top-up can be saved.'); return; }
        const form = new FormData();
        form.set('file', proof);
        form.set('purpose', 'sales_payment_evidence');
        const upload = await fetch('/api/files', { method: 'POST', body: form });
        const uploaded = await upload.json();
        if (!upload.ok || !uploaded.path) {
          setError(uploaded.error || 'Payment proof upload failed.');
          return;
        }
        const result = await topUpSale(sale.id, {
          payment_amount: amount,
          payment_bank: bank,
          payment_reference: reference,
          payment_proof_url: uploaded.path,
        });
        if ('error' in result) setError(result.error);
        else {
          setOpen(false); setAmount(''); setBank(''); setReference(''); setProof(null); router.refresh();
        }
      } catch { setError('Payment proof upload failed. Please try again.'); }
    });
  }

  if (String(sale.transaction_type ?? 'INITIAL_DEPOSIT').toUpperCase() === 'TOP_UP') return null;
  if (!open) return <button type="button" className="btn light" onClick={() => setOpen(true)}>Top up</button>;
  return <form onSubmit={submit} className="topup-form" aria-label="Record top-up">
    {error && <div className="alert">{error}</div>}
    <strong>Record top-up</strong>
    <div className="muted small">{sale.property_name || 'Property'} · {sale.plot_reference || 'Plot'}</div>
    <input className="input" type="number" min="1" required placeholder="Top-up amount (₦)" value={amount} onChange={e => setAmount(e.target.value)} />
    <select className="select" required value={bank} onChange={e => setBank(e.target.value)} aria-label="Receiving bank">
      <option value="" disabled>Select receiving bank</option>
      {BANKS.map(item => <option key={item} value={item}>{item}</option>)}
    </select>
    <input className="input" required placeholder="Payment reference" value={reference} onChange={e => setReference(e.target.value)} />
    <label className="small muted">Payment proof <span aria-hidden="true">*</span></label>
    <input className="input" type="file" accept="application/pdf,image/png,image/jpeg" required onChange={e => setProof(e.target.files?.[0] ?? null)} />
    <div className="muted small">Required: PDF, PNG or JPEG, maximum 4MB.</div>
    <div style={{ display: 'flex', gap: 6 }}><button className="btn primary" disabled={pending}>{pending ? 'Saving…' : 'Save top-up'}</button><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button></div>
  </form>;
}
