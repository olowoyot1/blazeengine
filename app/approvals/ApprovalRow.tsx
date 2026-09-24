'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { actDecide } from '@/lib/actions';
import { naira } from '@/lib/format';

export function ApprovalRow({ a }: { a: any }) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  function decide(decision: 'APPROVED' | 'REJECTED') {
    setError('');
    if (decision === 'REJECTED' && comment.trim().length < 3) { setError('A reason is required when rejecting'); return; }
    start(async () => { const r = await actDecide(a.id, decision, comment); if ('error' in r) setError(r.error); else router.refresh(); });
  }
  return (
    <div className="actioncard">
      <h4>{a.subject} — {a.detail}</h4>
      <p className="muted small" style={{ marginTop: 0 }}>{a.step}{a.amount ? ` · ${naira(a.amount)}` : ''}{a.submitted_by_name ? ` · submitted by ${a.submitted_by_name}` : ''}</p>{a.approval_trail?.length>0&&<div className="notice"><b>Previous approval trail</b>{a.approval_trail.map((h:any,i:number)=><div key={i} className="small">{h.step}: <b>{h.status}</b>{h.acted_by?` · ${h.acted_by}`:''}{h.comment?` · “${h.comment}”`:''}</div>)}</div>}{(a.supporting_documents?.length>0||a.payroll_documents?.length>0)&&<div className="notice"><b>Supporting documents</b>{[...(a.supporting_documents||[]),...(a.payroll_documents||[])].map((d:any)=><div key={d.id} className="small"><a href={d.url} target="_blank" rel="noreferrer">{d.name}</a></div>)}</div>}
      {error && <div className="alert">{error}</div>}
      <textarea className="textarea" placeholder="Comment (required if rejecting)" value={comment} onChange={e => setComment(e.target.value)} />
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn green" disabled={pending} onClick={() => decide('APPROVED')}>Approve</button>
        <button className="btn danger" disabled={pending} onClick={() => decide('REJECTED')}>Reject</button>
      </div>
    </div>
  );
}
