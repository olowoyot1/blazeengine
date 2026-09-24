'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveClientProfile } from '@/lib/actions';

const ID_TYPES = ['NATIONAL_ID', 'INTERNATIONAL_PASSPORT', 'DRIVERS_LICENSE', 'VOTERS_CARD'];

function d(v: unknown): string { return v ? String(v).slice(0, 10) : ''; }

export function ClientProfileForm({ clientId, client }: { clientId: string; client: any }) {
  const [v, setV] = useState<Record<string, string>>({
    name: client.name ?? '', phone: client.phone ?? '', alternate_phone: client.alternate_phone ?? '',
    email: client.email ?? '', address: client.address ?? '', date_of_birth: d(client.date_of_birth),
    occupation: client.occupation ?? '', employer: client.employer ?? '', id_type: client.id_type ?? '',
    id_number: client.id_number ?? '', next_of_kin_name: client.next_of_kin_name ?? '',
    next_of_kin_phone: client.next_of_kin_phone ?? '', next_of_kin_relationship: client.next_of_kin_relationship ?? '',
  });
  const [error, setError] = useState(''); const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  function set(k: string, x: string) { setV(s => ({ ...s, [k]: x })); setOk(false); }

  function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setOk(false);
    start(async () => {
      const res = await saveClientProfile(clientId, v);
      if ('error' in res) setError(res.error);
      else { setOk(true); router.refresh(); }
    });
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="alert">{error}</div>}
      {ok && <div className="ok">Profile saved.</div>}
      <div className="formgrid">
        <div><label className="field">Full name *</label><input className="input" required value={v.name} onChange={e => set('name', e.target.value)} /></div>
        <div><label className="field">Phone</label><input className="input" value={v.phone} onChange={e => set('phone', e.target.value)} /></div>
        <div><label className="field">Alternate phone</label><input className="input" value={v.alternate_phone} onChange={e => set('alternate_phone', e.target.value)} /></div>
        <div><label className="field">Email</label><input className="input" type="email" value={v.email} onChange={e => set('email', e.target.value)} /></div>
        <div className="full-row"><label className="field">Residential address</label><textarea className="textarea" value={v.address} onChange={e => set('address', e.target.value)} /></div>
        <div><label className="field">Date of birth</label><input className="input" type="date" value={v.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} /></div>
        <div><label className="field">Occupation</label><input className="input" value={v.occupation} onChange={e => set('occupation', e.target.value)} /></div>
        <div><label className="field">Employer</label><input className="input" value={v.employer} onChange={e => set('employer', e.target.value)} /></div>
        <div>
          <label className="field">Means of identification</label>
          <select className="select" value={v.id_type} onChange={e => set('id_type', e.target.value)}>
            <option value="">Select…</option>
            {ID_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div><label className="field">ID number</label><input className="input" value={v.id_number} onChange={e => set('id_number', e.target.value)} /></div>
        <div><label className="field">Next of kin — name</label><input className="input" value={v.next_of_kin_name} onChange={e => set('next_of_kin_name', e.target.value)} /></div>
        <div><label className="field">Next of kin — phone</label><input className="input" value={v.next_of_kin_phone} onChange={e => set('next_of_kin_phone', e.target.value)} /></div>
        <div><label className="field">Next of kin — relationship</label><input className="input" value={v.next_of_kin_relationship} onChange={e => set('next_of_kin_relationship', e.target.value)} /></div>
      </div>
      <button className="btn primary" disabled={pending}>{pending ? 'Saving…' : 'Save profile'}</button>
    </form>
  );
}
