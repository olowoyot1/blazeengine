'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sendCustomerCampaign } from '@/lib/actions';

type Channel = 'EMAIL' | 'SMS';

function smsPages(len: number) {
  if (len === 0) return 0;
  return len <= 160 ? 1 : Math.ceil(len / 153);
}

export function CampaignComposer({ emailReady, smsReady, audiences }: { emailReady: boolean; smsReady: boolean; audiences: Record<string, string> }) {
  const [channel, setChannel] = useState<Channel>('EMAIL');
  const [audience, setAudience] = useState('ALL');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();

  const ready = channel === 'EMAIL' ? emailReady : smsReady;
  const pages = smsPages(body.length);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    const label = channel === 'EMAIL' ? 'newsletter' : 'SMS';
    if (!confirm(`Send this ${label} to "${audiences[audience]}"? This cannot be undone.`)) return;
    start(async () => {
      const r = await sendCustomerCampaign({ channel, audience, subject, body });
      if ('error' in r) { setError(r.error); return; }
      setSuccess(`${channel === 'EMAIL' ? 'Newsletter' : 'SMS'} sent. See delivery results in the history below.`);
      setSubject(''); setBody('');
      router.refresh();
    });
  }

  return <form onSubmit={submit} className="formgrid">
    <div className="full" role="radiogroup" aria-label="Channel" style={{ display: 'flex', gap: 8 }}>
      {(['EMAIL', 'SMS'] as Channel[]).map(c => <button key={c} type="button" role="radio" aria-checked={channel === c}
        className={channel === c ? 'btn' : 'btn light'} onClick={() => { setChannel(c); setError(''); setSuccess(''); }}>
        {c === 'EMAIL' ? 'Email newsletter' : 'SMS'}
      </button>)}
    </div>

    {!ready && <div className="full notice">
      {channel === 'EMAIL'
        ? 'Newsletter sending is not configured. The administrator must add NEWSLETTER_FROM (an address on a Resend-verified domain).'
        : 'SMS sending is not configured. The administrator must add BETASMS_USERNAME, BETASMS_PASSWORD and BETASMS_SENDER_ID.'}
    </div>}

    <label className="full">
      <span className="small muted">Send to</span>
      <select className="input" value={audience} onChange={e => setAudience(e.target.value)}>
        {Object.entries(audiences).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </label>

    {channel === 'EMAIL' && <label className="full">
      <span className="small muted">Subject</span>
      <input className="input" value={subject} onChange={e => setSubject(e.target.value)} maxLength={200} required placeholder="e.g. New estate launch — early-bird prices" />
    </label>}

    <label className="full">
      <span className="small muted">{channel === 'EMAIL' ? 'Newsletter body' : 'SMS message'}</span>
      <textarea className="textarea" value={body} onChange={e => setBody(e.target.value)} required
        rows={channel === 'EMAIL' ? 10 : 4} maxLength={channel === 'SMS' ? 918 : 20000}
        placeholder={channel === 'EMAIL' ? 'Write your update. Leave a blank line between paragraphs. Each customer is greeted by name automatically.' : 'Keep it short. Customers see your sender ID as the sender.'} />
      <span className="small muted">
        {channel === 'SMS' ? `${body.length} characters · ${pages} SMS page${pages === 1 ? '' : 's'} per customer` : `${body.length} characters`}
      </span>
    </label>

    {error && <div className="full alert" role="alert">{error}</div>}
    {success && <div className="full notice" role="status">{success}</div>}

    <div className="full" style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <button className="btn" type="submit" disabled={pending || !ready}>{pending ? 'Sending…' : channel === 'EMAIL' ? 'Send newsletter' : 'Send SMS'}</button>
    </div>
  </form>;
}
