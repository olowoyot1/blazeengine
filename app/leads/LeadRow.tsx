'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { actLeadStatus, actConvertLead } from '@/lib/actions';
import { Badge } from '@/components/Badge';

export function LeadRow({ r, canAct }: { r: any; canAct: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  function status(v: string) { start(async () => { await actLeadStatus(r.id, v); router.refresh(); }); }
  function convert() { start(async () => { const res = await actConvertLead(r.id); if ('id' in res && res.id) router.push(`/clients/${res.id}`); else router.refresh(); }); }
  return (
    <tr>
      <td>{r.name}</td><td>{r.phone || '—'}</td><td>{r.email || '—'}</td><td>{r.source || '—'}</td><td>{r.owner || '—'}</td>
      <td><Badge status={r.status} /></td>
      <td>{new Date(r.created_at).toLocaleDateString()}</td>
      <td>
        {canAct && r.status !== 'CONVERTED' && r.status !== 'LOST' && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn light" disabled={pending} onClick={() => status('CONTACTED')}>Contacted</button>
            <button className="btn green" disabled={pending} onClick={convert}>Convert</button>
            <button className="btn danger" disabled={pending} onClick={() => status('LOST')}>Lost</button>
          </div>
        )}
      </td>
    </tr>
  );
}
