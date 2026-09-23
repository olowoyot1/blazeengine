'use client';
import { Fragment, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setUserRole, setUserActive, resetUserPassword } from '@/lib/actions';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/Badge';

const CRITICAL = new Set(['CEO', 'HR', 'SALES_MANAGER', 'OPERATIONS_MANAGER', 'FINANCE_OPERATIONS', 'SITE_MANAGER', 'ACCOUNTANT']);

export function UserRow({ r, isSelf }: { r: any; isSelf: boolean }) {
  const [pending, start] = useTransition();
  const [temp, setTemp] = useState('');
  const [error, setError] = useState('');
  const [pendingRole, setPendingRole] = useState('');
  const [reason, setReason] = useState('');
  const [askReason, setAskReason] = useState<'role' | 'reset' | null>(null);
  const router = useRouter();

  function pickRole(v: string) {
    setError('');
    if (CRITICAL.has(v)) { setPendingRole(v); setAskReason('role'); return; }
    start(async () => { const res = await setUserRole(r.id, v, ''); if ('error' in res) setError(res.error); router.refresh(); });
  }
  function confirmRole() {
    if (reason.trim().length < 5) { setError('A reason of at least 5 characters is required'); return; }
    start(async () => { const res = await setUserRole(r.id, pendingRole, reason); if ('error' in res) setError(res.error); else { setAskReason(null); setReason(''); } router.refresh(); });
  }
  function active(v: boolean) { start(async () => { const res = await setUserActive(r.id, v); if ('error' in res) setError(res.error); router.refresh(); }); }
  function confirmReset() {
    if (reason.trim().length < 5) { setError('A reason of at least 5 characters is required'); return; }
    start(async () => { const res = await resetUserPassword(r.id, reason); if ('error' in res) setError(res.error); else if (res.id) { setTemp(res.id); setAskReason(null); setReason(''); } router.refresh(); });
  }

  return (
    <Fragment>
    <tr>
      <td>{r.name}</td><td>{r.email}</td>
      <td>
        <select className="select" style={{ margin: 0, padding: '4px 8px', width: 'auto' }} value={r.role} disabled={isSelf || pending} onChange={e => pickRole(e.target.value)}>
          {ROLES.map(x => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}
        </select>
      </td>
      <td>{r.department || '—'}</td>
      <td>{r.active ? <Badge status="APPROVED" label="Active" /> : <Badge status="REJECTED" label="Inactive" />}{r.must_change_password && <span className="tag">Must change PW</span>}</td>
      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {!isSelf && (r.active
          ? <button className="btn light" disabled={pending} onClick={() => active(false)}>Deactivate</button>
          : <button className="btn light" disabled={pending} onClick={() => active(true)}>Activate</button>)}
        <button className="btn light" disabled={pending} onClick={() => setAskReason('reset')}>Reset password</button>
        {error && <div className="small" style={{ color: '#9e2d2d' }}>{error}</div>}
        {temp && <div className="small">Temp password: <code>{temp}</code> (share securely, shown once)</div>}
      </td>
    </tr>
    {askReason && (
      <tr>
        <td colSpan={6} style={{ background: 'var(--bg)' }}>
          <div style={{ padding: '8px 0' }}>
            <label className="field">
              {askReason === 'role' ? `Reason for assigning ${pendingRole.replace(/_/g, ' ')} (this role can approve — the user is notified by e-mail)` : 'Reason for resetting this password (the user is notified by e-mail and any existing session is signed out)'}
            </label>
            <textarea className="textarea" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. covering for HR during leave" />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary" disabled={pending} onClick={askReason === 'role' ? confirmRole : confirmReset}>Confirm</button>
              <button className="btn light" disabled={pending} onClick={() => { setAskReason(null); setReason(''); setError(''); }}>Cancel</button>
            </div>
          </div>
        </td>
      </tr>
    )}
    </Fragment>
  );
}
