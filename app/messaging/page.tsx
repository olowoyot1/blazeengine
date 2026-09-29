import Shell from '@/components/Shell';
import { requireCap } from '@/lib/guard';
import { sql, type Row } from '@/lib/db';
import { smsConfigured } from '@/lib/sms';
import { newsletterConfigured } from '@/lib/newsletter';
import { CampaignComposer } from './CampaignComposer';

const AUDIENCE_LABEL: Record<string, string> = { ALL: 'All customers', ACTIVE_SALES: 'Customers with sales in progress', OWNED_PLOTS: 'Customers with allocated plots' };
const STATUS_CLASS: Record<string, string> = { SENT: 'badge green', PARTIAL: 'badge yellow', FAILED: 'badge red', SENDING: 'badge' };

export default async function Messaging() {
  const s = await requireCap('campaign.send');
  const [reach, history] = await Promise.allSettled([
    sql`select count(*) filter (where email ~* '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$')::int emails,
               count(*) filter (where coalesce(phone,'') <> '')::int phones,
               count(*)::int total from clients`,
    sql`select c.*, u.name sender from customer_campaigns c left join users u on u.id=c.created_by order by c.created_at desc limit 50`,
  ]);
  const r: Row = reach.status === 'fulfilled' ? reach.value[0] ?? {} : {};
  const campaigns: Row[] = history.status === 'fulfilled' ? history.value : [];

  return <Shell s={s} title="Newsletters & SMS" kicker="Sales & Marketing">
    <div className="grid grid3" style={{ marginBottom: 16 }}>
      <div className="card stat"><span className="muted small">Customers</span><b>{r.total ?? 0}</b></div>
      <div className="card stat"><span className="muted small">Reachable by email</span><b>{r.emails ?? 0}</b></div>
      <div className="card stat"><span className="muted small">Reachable by SMS</span><b>{r.phones ?? 0}</b></div>
    </div>

    <div className="card" style={{ marginBottom: 16 }}>
      <div className="section-title"><div><h3>New message</h3><p className="muted small">Send a newsletter by email or a bulk SMS to customers on the client list.</p></div></div>
      <CampaignComposer emailReady={newsletterConfigured()} smsReady={smsConfigured()} audiences={AUDIENCE_LABEL} />
    </div>

    <div className="card">
      <div className="section-title"><div><h3>Sent history</h3><p className="muted small">Last 50 newsletters and SMS broadcasts.</p></div><span className="badge">{campaigns.length}</span></div>
      {campaigns.length === 0 ? <div className="empty">Nothing has been sent yet.</div> :
        <div className="table-wrap"><table className="table"><thead><tr><th>Date</th><th>Channel</th><th>Audience</th><th>Message</th><th>Delivered</th><th>Status</th><th>Sent by</th></tr></thead>
          <tbody>{campaigns.map(c => <tr key={c.id}>
            <td>{new Date(c.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</td>
            <td>{c.channel === 'EMAIL' ? 'Newsletter' : 'SMS'}</td>
            <td>{AUDIENCE_LABEL[c.audience] ?? c.audience}</td>
            <td style={{ maxWidth: 320 }}>{c.subject && <b>{c.subject}<br /></b>}<span className="muted small">{String(c.body).slice(0, 120)}{String(c.body).length > 120 ? '…' : ''}</span></td>
            <td>{c.sent_count} / {c.recipient_count}{c.failed_count > 0 && <div className="muted small">{c.failed_count} failed</div>}</td>
            <td><span className={STATUS_CLASS[c.status] ?? 'badge'} title={c.error ?? undefined}>{c.status}</span></td>
            <td>{c.sender ?? '—'}</td>
          </tr>)}</tbody></table></div>}
    </div>
  </Shell>;
}
