'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { newSale } from '@/lib/actions';

export function NewSaleForm({ clients }: { clients: { id: string; name: string; phone?: string }[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [paymentProofName, setPaymentProofName] = useState('');
  const [uploadingProof, setUploadingProof] = useState(false);
  const [error, setError] = useState(''); const [pending, start] = useTransition();
  const router = useRouter();
  function set(k: string, v: string) { setValues(s => ({ ...s, [k]: v })); }
  async function uploadPaymentProof(file: File) {
    setError(''); setUploadingProof(true);
    try {
      const body = new FormData(); body.append('file', file); body.append('purpose', 'sales_payment_evidence');
      const res = await fetch('/api/files', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Payment evidence upload failed'); return; }
      set('payment_proof_url', data.path); setPaymentProofName(file.name);
    } catch { setError('Payment evidence upload failed — check your connection'); }
    finally { setUploadingProof(false); }
  }
  function submit(e: React.FormEvent) {
    e.preventDefault(); setError('');
    if (uploadingProof) { setError('Please wait for the payment evidence upload to finish'); return; }
    start(async () => {
      const r = await newSale(values);
      if ('error' in r) setError(r.error);
      else if (r.id) router.push('/sales');
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
        <div><label className="field">Estate value (₦) *</label><input className="input" type="number" min={1} required value={values.estate_value ?? ''} onChange={e => set('estate_value', e.target.value)} /></div>
        <div><label className="field">Payment amount (₦) *</label><input className="input" type="number" min={1} required value={values.payment_amount ?? ''} onChange={e => set('payment_amount', e.target.value)} /></div>
        <div><label className="field">Payment plan *</label><select className="select" required value={values.payment_plan ?? ''} onChange={e => set('payment_plan', e.target.value)}><option value="" disabled>Select payment plan…</option><option value="OUTRIGHT">Outright</option><option value="INSTALLMENT">Installmental</option></select></div>
        <div className="full-row"><label className="field">Description</label><textarea className="textarea" value={values.description ?? ''} onChange={e => set('description', e.target.value)} /></div>
        <div className="full-row notice">
          <strong>Payment evidence</strong>
          <div className="muted small" style={{ margin: '4px 0 8px' }}>If the client has already paid, upload the bank transfer evidence here. It stays attached to this sale and does not mix with expense documents.</div>
          <input className="input" type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={e => { const f = e.target.files?.[0]; if (f) uploadPaymentProof(f); }} />
          <div className="small muted">{uploadingProof ? 'Uploading payment evidence…' : values.payment_proof_url ? `✓ ${paymentProofName}` : 'Optional at sale creation · PDF, PNG or JPEG up to 4MB'}</div>
          {values.payment_proof_url && <div className="formgrid" style={{ marginTop: 8 }}>
            <div><label className="field">Payment reference *</label><input className="input" required value={values.payment_reference ?? ''} onChange={e => set('payment_reference', e.target.value)} /></div>
          </div>}
        </div>
      </div>
      <button className="btn primary" disabled={pending}>{pending ? 'Creating…' : 'Create sale'}</button>
    </form>
  );
}
