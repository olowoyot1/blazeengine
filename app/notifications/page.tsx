import Shell from '@/components/Shell';
import { requireUser } from '@/lib/guard';
import { notificationsFor } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';
import { MarkReadButton, NotificationReadButton } from './MarkReadButton';
import Link from 'next/link';

export default async function Notifications() {
  const s = await requireUser();
  const rows = await notificationsFor(s.id);
  return (
    <Shell s={s} title="Notifications" kicker="Your alerts" actions={<MarkReadButton />}>
      <div className="card">
        {rows.length === 0 && <div className="empty">No notifications yet.</div>}
        <ul className="timeline">
          {rows.map((n: any) => (
            <li key={n.id} className={n.read_at ? 'notification-read' : 'notification-unread'}>
              <div className="notification-head">
                <div>
                  <b>{n.title}</b>
                  <div className="muted">{n.message}</div>
                </div>
                <NotificationReadButton id={n.id} read={!!n.read_at} />
              </div>
              <div className="small muted" style={{ marginTop: 6 }}>
                {fmtDateTime(n.created_at)}{n.link && <> · <Link href={n.link}>Open</Link></>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Shell>
  );
}
