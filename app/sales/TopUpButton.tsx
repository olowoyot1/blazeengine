'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { newSale } from '@/lib/actions';

const BANKS = ['Providus', 'Titan', 'Zenith'] as const;

export function TopUpButton({ sale }: { sale: { id: string; client_id?: string; property_name?: string; plot_reference?: string; estate_value?: number; payment_plan?: string; beneficiary_name?: string; beneficiary_phone?: string } }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [bank, setBank] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    start(async () => {
      const result = await newSale({
        topup_sale_id: sale.id,
        client_id: sale.client_id,
        property_name: sale.property_name,
        plot_reference: sale.plot_reference,
        estate_value: sale.estate_value,
        payment_plan: sale.payment_plan,
        beneficiary_name: sale.beneficiary_name,
        beneficiary_phone: sale.beneficiary_phone,
        payment_amount: amount,
        amount,
        payment_bank: bank,
        payment_reference: reference,
        transaction_type: 'TOP_UP',
      });
      if ('error' in result) setError(result.error);
      else { setOpen(false); setAmount(''); setBank(''); setReference(''); router.refresh(); }
    });
  }

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
    <div style={{ display: 'flex', gap: 6 }}><button className="btn primary" disabled={pending}>{pending ? 'Saving…' : 'Save top-up'}</button><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button></div>
  </form>;
}
