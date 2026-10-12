'use client';

import { useState, useTransition } from 'react';
import { createPersonalHRRequest } from '@/lib/actions';

export function HRRequestForm() {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');

  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    start(async () => {
      const result = await createPersonalHRRequest({
        requestType: String(data.get('requestType') || ''),
        subject: String(data.get('subject') || ''),
        details: String(data.get('details') || ''),
      });
      if ('error' in result) setMessage(result.error);
      else { setMessage('Your HR request has been submitted.'); form.reset(); setOpen(false); }
    });
  }

  return <div style={{ marginTop: 10 }}>
    <button className="btn light" type="button" onClick={() => setOpen(value => !value)}>Make an HR request</button>
    {open && <form onSubmit={event => { event.preventDefault(); submit(event.currentTarget); }} style={{ marginTop: 10, display: 'grid', gap: 8, maxWidth: 520 }}>
      <select className="select" name="requestType" required defaultValue="">
        <option value="" disabled>Select request type</option>
        <option value="LEAVE">Leave or time off</option>
        <option value="PAYROLL">Payroll or salary</option>
        <option value="DOCUMENT">Employment document</option>
        <option value="WORKPLACE">Workplace concern</option>
        <option value="OTHER">Other HR request</option>
      </select>
      <input className="input" name="subject" required maxLength={160} placeholder="Short subject" />
      <textarea className="textarea" name="details" maxLength={4000} placeholder="Describe what you need help with" />
      <div style={{ display: 'flex', gap: 8 }}><button className="btn primary" disabled={pending}>{pending ? 'Submitting…' : 'Submit HR request'}</button><button className="btn light" type="button" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>}
    {message && <div className="small muted" style={{ marginTop: 6 }}>{message}</div>}
  </div>;
}
