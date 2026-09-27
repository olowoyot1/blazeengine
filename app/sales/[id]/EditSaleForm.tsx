'use client';

import { useState, useTransition } from 'react';
import { editSale } from '@/lib/actions';

export function EditSaleForm({ sale }: { sale: { id: string; property_name?: string | null; plot_reference?: string | null; estate_value?: number | string | null; payment_amount?: number | string | null; payment_plan?: string | null; description?: string | null } }) {
  const [values, setValues] = useState({
    property_name: sale.property_name ?? '',
    plot_reference: sale.plot_reference ?? '',
    estate_value: String(sale.estate_value ?? ''),
    payment_amount: String(sale.payment_amount ?? ''),
    payment_plan: sale.payment_plan ?? '',
    description: sale.description ?? '',
  });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = (name: string, value: string) => setValues(current => ({ ...current, [name]: value }));
  function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setSaved(false);
    start(async () => {
      const result = await editSale(sale.id, values);
      if ('error' in result) setError(result.error); else setSaved(true);
    });
  }
  return (
    <form onSubmit={submit} className="formgrid">
      {error && <div className="alert full-row">{error}</div>}
      {saved && <div className="notice full-row">Sale changes saved. Review the updated details before approving.</div>}
      <div><label className="field" htmlFor="edit-property">Estate / property *</label><input id="edit-property" className="input" required value={values.property_name} onChange={e => set('property_name', e.target.value)} /></div>
      <div><label className="field" htmlFor="edit-plot">Plot reference *</label><input id="edit-plot" className="input" required value={values.plot_reference} onChange={e => set('plot_reference', e.target.value)} /></div>
      <div><label className="field" htmlFor="edit-estate-value">Estate value (₦) *</label><input id="edit-estate-value" className="input" type="number" min="1" required value={values.estate_value} onChange={e => set('estate_value', e.target.value)} /></div>
      <div><label className="field" htmlFor="edit-payment">Payment amount (₦) *</label><input id="edit-payment" className="input" type="number" min="1" required value={values.payment_amount} onChange={e => set('payment_amount', e.target.value)} /></div>
      <div><label className="field" htmlFor="edit-plan">Payment plan *</label><select id="edit-plan" className="select" required value={values.payment_plan} onChange={e => set('payment_plan', e.target.value)}><option value="">Select payment plan…</option><option value="OUTRIGHT">Outright</option><option value="INSTALLMENT">Installmental</option></select></div>
      <div className="full-row"><label className="field" htmlFor="edit-description">Description</label><textarea id="edit-description" className="textarea" value={values.description} onChange={e => set('description', e.target.value)} /></div>
      <div className="full-row"><button className="btn primary" disabled={pending}>{pending ? 'Saving changes…' : 'Save changes'}</button></div>
    </form>
  );
}
