'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { newSale } from '@/lib/actions';

export function NewSaleForm({ clients }: { clients: { id: string; name: string; phone?: string }[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState(''); const [pending, start] = useTransition();
  const router = useRouter();
  function set(k: string, v: string) { setValues(s => ({ ...s, [k]: v })); }
  function submit(e: React.FormEvent) {
    e.preventDefault(); setError('');
    start(async () => {
      const r = await newSale(values);
      if ('error' in r) setError(r.error);
      else if (r.id) router.push(`/sales/${r.id}`);
    });
  }
  return (
    <form onSubmit={submit}>
      {error && <div className="alert">{error}</div>}
      <div className="formgrid">
        <div><label className="field">Client *</label>
          <select className="select" required value={values.client_id ?? ''} onChange={e => set('client_id', e.target.value)}>
            <option value="" disabled>Select client…</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ''}</option>)}
          </select>
        </div>
        <div><label className="field">Estate / property *</label><input className="input" required value={values.property_name ?? ''} onChange={e => set('property_name', e.target.value)} /></div>
        <div><label className="field">Plot reference *</label><input className="input" required value={values.plot_reference ?? ''} onChange={e => set('plot_reference', e.target.value)} /></div>
        <div><label className="field">Sale amount (₦) *</label><input className="input" type="number" min={1} required value={values.amount ?? ''} onChange={e => set('amount', e.target.value)} /></div>
        <div className="full-row"><label className="field">Description</label><textarea className="textarea" value={values.description ?? ''} onChange={e => set('description', e.target.value)} /></div>
      </div>
      <button className="btn primary" disabled={pending}>{pending ? 'Creating…' : 'Create sale'}</button>
    </form>
  );
}
