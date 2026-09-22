import Link from 'next/link';
import { headers } from 'next/headers';
import type { Session } from '@/lib/auth';
import { NAV, canAny } from '@/lib/rbac';
import { unreadCount } from '@/lib/queries';
import { ROLE_META } from '@/lib/constants';

export default async function Shell({ children, title, kicker, s, actions }:
  { children: React.ReactNode; title: string; kicker?: string; s: Session; actions?: React.ReactNode }) {
  const path = (await headers()).get('x-invoke-path') || '';
  const [unread] = await Promise.all([unreadCount(s.id)]);
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">LAND<span>BLAZE</span></div>
        <p className="muted small">Engine v3</p>
        <nav className="nav">
          {NAV.filter(n => n.cap.length === 0 || canAny(s.role, n.cap)).map(n => (
            <Link href={n.href} key={n.href} className={path.startsWith(n.href) ? 'active' : ''}>
              <span>{n.label}</span>
              {n.href === '/notifications' && unread > 0 && <span className="pill">{unread}</span>}
            </Link>
          ))}
        </nav>
        <div style={{ marginTop: 24, fontSize: 12, color: '#9ba6b6' }}>
          <b style={{ color: '#fff' }}>{s.name}</b><br />
          {ROLE_META[s.role].label}<br />
          {ROLE_META[s.role].department}
          <div style={{ marginTop: 10 }}>
            <Link href="/profile/password" style={{ color: '#9ba6b6', textDecoration: 'underline' }}>Change password</Link>
            {' · '}
            <form action="/api/auth/logout" method="post" style={{ display: 'inline' }}>
              <button className="btn" style={{ background: 'transparent', color: '#9ba6b6', padding: 0, textDecoration: 'underline', fontWeight: 400 }}>Sign out</button>
            </form>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="top">
          <div>
            {kicker && <div className="kicker">{kicker}</div>}
            <b style={{ fontSize: 18 }}>{title}</b>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {actions}
            <Link href="/notifications" className="badge">{unread > 0 ? `${unread} new` : 'Notifications'}</Link>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
