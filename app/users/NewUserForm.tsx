'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createUser } from '@/lib/actions';
import { ROLES } from '@/lib/constants';

export function NewUserForm() {
  const [v, setV] = useState<Record<string, string>>({});
  const [error, setError] = useState(''); const [ok, setOk] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  function set(k: string, x: string) { setV(s => ({ ...s, [k]: x })); }
  function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setOk('');
    start(async () => {
      const r = await createUser({ name: v.name || '', email: v.email || '', role: v.role || '', department: v.department, password: v.password || '' });
      if ('error' in r) setError(r.error);
      else { setOk('User created.'); setV({}); router.refresh(); }
    });
  }
  return (
    <form onSubmit={submit}>
      {error && <div className="alert">{error}</div>}
      {ok && <div className="ok">{ok}</div>}
      <div className="formgrid">
        <div><label className="field">Full name *</label><input className="input" required value={v.name ?? ''} onChange={e => set('name', e.target.value)} /></div>
        <div><label className="field">Email *</label><input className="input" type="email" required value={v.email ?? ''} onChange={e => set('email', e.target.value)} /></div>
        <div><label className="field">Role *</label>
          <select className="select" required value={v.role ?? ''} onChange={e => set('role', e.target.value)}>
            <option value="" disabled>Select role…</option>
            {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div><label className="field">Department</label><input className="input" value={v.department ?? ''} onChange={e => set('department', e.target.value)} /></div>
        <div className="full-row"><label className="field">Temporary password *</label><input className="input" type="text" required minLength={10} value={v.password ?? ''} onChange={e => set('password', e.target.value)} placeholder="At least 10 characters, letters and numbers" /></div>
      </div>
      <button className="btn primary" disabled={pending}>{pending ? 'Creating…' : 'Create user'}</button>
    </form>
  );
}
