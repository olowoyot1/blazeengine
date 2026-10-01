'use client';

import { useState, useTransition } from 'react';
import { changeSaleBeneficiary } from '@/lib/actions';

type Beneficiary = { beneficiary_name?: string | null; beneficiary_phone?: string | null; beneficiary_email?: string | null; beneficiary_address?: string | null; beneficiary_relationship?: string | null };

export function ChangeBeneficiaryForm({ saleId, current, hasInvoice }: { saleId: string; current: Beneficiary; hasInvoice: boolean }) {
  const blank = () => ({ beneficiary_name: '', beneficiary_phone: '', beneficiary_email: '', beneficiary_address: '', beneficiary_relationship: '', reason: '' });
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(blank);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [pending, start] = useTransition();
  const set = (k: keyof ReturnType<typeof blank>, v: string) => setValues(s => ({ ...s, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setSaved('');
    if (values.beneficiary_name.trim().toLowerCase() === (current.beneficiary_name ?? '').trim().toLowerCase()
      && values.beneficiary_phone.trim() === (current.beneficiary_phone ?? '').trim()) {
      setError('The new beneficiary details are the same as the current beneficiary'); return;
    }
    start(async () => {
      const r = await changeSaleBeneficiary(saleId, values);
      if ('error' in r) setError(r.error);
      else { setSaved(`Beneficiary changed to ${values.beneficiary_name}.${hasInvoice ? ' The invoice and receipt have been reissued in their favour.' : ''}`); setValues(blank()); setOpen(false); }
    });
  }

  if (!open) return (
    <div>
      {saved && <div className="notice" style={{ marginBottom: 8 }}>{saved}</div>}
      <button type="button" className="btn" onClick={() => setOpen(true)}>Change beneficiary</button>
    </div>
  );

  return (
    <form onSubmit={submit} className="formgrid">
      {error && <div className="alert full-row">{error}</div>}
      {hasInvoice && <div className="notice full-row small">An invoice has already been generated. Saving will reissue the invoice and sales receipt in favour of the new beneficiary (same numbers); the earlier copies stay on file for audit.</div>}
      <div><label className="field" htmlFor="cb-name">New beneficiary full name *</label><input id="cb-name" className="input" required value={values.beneficiary_name} onChange={e => set('beneficiary_name', e.target.value)} /></div>
      <div><label className="field" htmlFor="cb-phone">Phone *</label><input id="cb-phone" className="input" type="tel" required value={values.beneficiary_phone} onChange={e => set('beneficiary_phone', e.target.value)} /></div>
      <div><label className="field" htmlFor="cb-email">Email</label><input id="cb-email" className="input" type="email" value={values.beneficiary_email} onChange={e => set('beneficiary_email', e.target.value)} /></div>
      <div><label className="field" htmlFor="cb-rel">Relationship to client</label><input id="cb-rel" className="input" placeholder="e.g. Self, Spouse, Child" value={values.beneficiary_relationship} onChange={e => set('beneficiary_relationship', e.target.value)} /></div>
      <div className="full-row"><label className="field" htmlFor="cb-address">Address</label><textarea id="cb-address" className="textarea" value={values.beneficiary_address} onChange={e => set('beneficiary_address', e.target.value)} /></div>
      <div className="full-row"><label className="field" htmlFor="cb-reason">Reason for change *</label><textarea id="cb-reason" className="textarea" required value={values.reason} onChange={e => set('reason', e.target.value)} /></div>
      <div className="full-row" style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary" disabled={pending}>{pending ? 'Saving…' : 'Save new beneficiary'}</button>
        <button type="button" className="btn" disabled={pending} onClick={() => { setOpen(false); setError(''); }}>Cancel</button>
      </div>
    </form>
  );
}
