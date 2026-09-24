'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { actDecide } from '@/lib/actions';
import { naira } from '@/lib/format';

export function ApprovalDecisionPanel({ approval }: { approval: any | null }) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!approval) return null;
  function decide(decision: 'APPROVED' | 'REJECTED') {
    setError('');
    if (decision === 'REJECTED' && comment.trim().length < 3) { setError('A reason is required when rejecting'); return; }
    start(async () => {
      const r = await actDecide(approval.id, decision, comment);
      if ('error' in r) setError(r.error); else router.refresh();
    });
  }
  return <div className="card" style={{ marginTop: 15, borderLeft: '4px solid #16a34a' }}>
    <h3>Approval action required</h3>
    <p className="muted small" style={{ marginTop: 0 }}>{approval.step}{approval.amount ? ` · ${naira(approval.amount)}` : ''}</p>{approval.approval_trail?.length>0&&<div className="notice"><b>Previous approval trail</b>{approval.approval_trail.map((h:any,i:number)=><div key={i} className="small">{h.step}: <b>{h.status}</b>{h.acted_by?` · ${h.acted_by}`:''}{h.comment?` · “${h.comment}”`:''}</div>)}</div>}{approval.supporting_documents?.length>0&&<div className="notice"><b>Supporting documents</b>{approval.supporting_documents.map((d:any)=><div key={d.id} className="small"><a href={d.url} target="_blank" rel="noreferrer">{d.name}</a></div>)}</div>}
    {error && <div className="alert">{error}</div>}
    <textarea className="textarea" placeholder="Comment (required if rejecting)" value={comment} onChange={e => setComment(e.target.value)} />
    <div style={{ display: 'flex', gap: 10 }}>
      <button className="btn green" disabled={pending} onClick={() => decide('APPROVED')}>Approve</button>
      <button className="btn danger" disabled={pending} onClick={() => decide('REJECTED')}>Reject</button>
    </div>
  </div>;
}
