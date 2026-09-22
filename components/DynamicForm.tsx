'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export type UiField = { name: string; label: string; type: string; required?: boolean; options?: string[]; placeholder?: string; min?: number };

/**
 * Renders a field list defined by the workflow layer (lib/workflow/*) and submits
 * it to a server action. One component powers every sale/expense action so the
 * form always matches the server-side validation exactly.
 */
export function DynamicForm({
  fields, submitLabel, danger, onSubmit, confirmText,
}: {
  fields: UiField[]; submitLabel: string; danger?: boolean; confirmText?: string;
  onSubmit: (input: Record<string, unknown>) => Promise<{ error?: string; ok?: boolean; id?: string }>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();

  function set(name: string, v: string) { setValues(s => ({ ...s, [name]: v })); }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (danger && confirmText && !window.confirm(confirmText)) return;
    start(async () => {
      const res = await onSubmit(values);
      if (res?.error) setError(res.error);
      else { setValues({}); router.refresh(); }
    });
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="alert">{error}</div>}
      <div className="formgrid">
        {fields.map(f => (
          <div key={f.name} className={f.type === 'textarea' ? 'full-row' : ''}>
            <label className="field">{f.label}{f.required && ' *'}</label>
            {f.type === 'textarea' ? (
              <textarea className="textarea" placeholder={f.placeholder} required={f.required}
                value={values[f.name] ?? ''} onChange={e => set(f.name, e.target.value)} />
            ) : f.type === 'select' ? (
              <select className="select" required={f.required} value={values[f.name] ?? ''} onChange={e => set(f.name, e.target.value)}>
                <option value="" disabled>Select…</option>
                {f.options?.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
              </select>
            ) : f.type === 'checkbox' ? (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0 12px', fontWeight: 400, fontSize: 14 }}>
                <input type="checkbox" checked={values[f.name] === 'on'} onChange={e => set(f.name, e.target.checked ? 'on' : '')} />
                {f.label}
              </label>
            ) : (
              <input className="input" type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'url' ? 'url' : 'text'}
                placeholder={f.placeholder} required={f.required} min={f.min}
                value={values[f.name] ?? ''} onChange={e => set(f.name, e.target.value)} />
            )}
          </div>
        ))}
      </div>
      <button className={'btn ' + (danger ? 'danger' : 'green')} disabled={pending}>{pending ? 'Submitting…' : submitLabel}</button>
    </form>
  );
}
