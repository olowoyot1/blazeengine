'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export type UiField = { name: string; label: string; type: string; required?: boolean; options?: string[]; placeholder?: string; min?: number; accept?: string[] };

const ACCEPT_HINT: Record<string, string> = { 'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg,.jpeg' };

/**
 * Renders a field list defined by the workflow layer (lib/workflow/*) and submits
 * it to a server action. One component powers every sale/expense action so the
 * form always matches the server-side validation exactly.
 *
 * "file" fields upload to /api/files as soon as a file is chosen (not on form
 * submit) and store the resulting /api/files/<id> path as the field's value — the
 * server never sees a raw file, and the workflow layer only ever sees a path it
 * recognizes as its own.
 */
export function DynamicForm({
  fields, submitLabel, danger, onSubmit, confirmText,
}: {
  fields: UiField[]; submitLabel: string; danger?: boolean; confirmText?: string;
  onSubmit: (input: Record<string, unknown>) => Promise<{ error?: string; ok?: boolean; id?: string }>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();

  function set(name: string, v: string) { setValues(s => ({ ...s, [name]: v })); }

  async function uploadFile(field: UiField, file: File) {
    setError('');
    setUploading(u => ({ ...u, [field.name]: true }));
    set(field.name, '');
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/files', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Upload failed'); return; }
      set(field.name, data.path);
      setFileNames(n => ({ ...n, [field.name]: file.name }));
    } catch {
      setError('Upload failed — check your connection and try again');
    } finally {
      setUploading(u => ({ ...u, [field.name]: false }));
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (danger && confirmText && !window.confirm(confirmText)) return;
    if (fields.some(f => f.type === 'file' && uploading[f.name])) { setError('Please wait for the upload to finish'); return; }
    start(async () => {
      const res = await onSubmit(values);
      if (res?.error) setError(res.error);
      else { setValues({}); setFileNames({}); router.refresh(); }
    });
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="alert">{error}</div>}
      <div className="formgrid">
        {fields.map(f => (
          <div key={f.name} className={f.type === 'textarea' || f.type === 'file' ? 'full-row' : ''}>
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
            ) : f.type === 'file' ? (
              <div style={{ margin: '5px 0 12px' }}>
                <input className="input" type="file" style={{ margin: 0 }}
                  accept={(f.accept ?? ['application/pdf', 'image/png', 'image/jpeg']).map(m => ACCEPT_HINT[m] ?? '').join(',')}
                  onChange={e => { const file = e.target.files?.[0]; if (file) uploadFile(f, file); }} />
                <div className="small muted" style={{ marginTop: 4 }}>
                  {uploading[f.name] ? 'Uploading…'
                    : values[f.name] ? `✓ ${fileNames[f.name] ?? 'Uploaded'}`
                    : 'PDF, PNG or JPEG, up to 4MB'}
                </div>
              </div>
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
