'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setUserRole, setUserActive, resetUserPassword } from '@/lib/actions';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/Badge';

export function UserRow({ r, isSelf }: { r: any; isSelf: boolean }) {
  const [pending, start] = useTransition();
  const [temp, setTemp] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();
  function role(v: string) { start(async () => { const res = await setUserRole(r.id, v); if ('error' in res) setError(res.error); router.refresh(); }); }
  function active(v: boolean) { start(async () => { const res = await setUserActive(r.id, v); if ('error' in res) setError(res.error); router.refresh(); }); }
  function reset() { start(async () => { const res = await resetUserPassword(r.id); if ('error' in res) setError(res.error); else if (res.id) setTemp(res.id); router.refresh(); }); }
  return (
    <tr>
      <td>{r.name}</td><td>{r.email}</td>
      <td>
        <select className="select" style={{ margin: 0, padding: '4px 8px', width: 'auto' }} value={r.role} disabled={isSelf || pending} onChange={e => role(e.target.value)}>
          {ROLES.map(x => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}
        </select>
      </td>
      <td>{r.department || '—'}</td>
      <td>{r.active ? <Badge status="APPROVED" label="Active" /> : <Badge status="REJECTED" label="Inactive" />}{r.must_change_password && <span className="tag">Must change PW</span>}</td>
      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {!isSelf && (r.active
          ? <button className="btn light" disabled={pending} onClick={() => active(false)}>Deactivate</button>
          : <button className="btn light" disabled={pending} onClick={() => active(true)}>Activate</button>)}
        <button className="btn light" disabled={pending} onClick={reset}>Reset password</button>
        {error && <div className="small" style={{ color: '#9e2d2d' }}>{error}</div>}
        {temp && <div className="small">Temp password: <code>{temp}</code> (share securely, shown once)</div>}
      </td>
    </tr>
  );
}
