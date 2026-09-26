import Link from 'next/link';
import { headers } from 'next/headers';
import type { Session } from '@/lib/auth';
import { NAV_GROUPS, canAny } from '@/lib/rbac';
import { unreadCount } from '@/lib/queries';
import { ROLE_META } from '@/lib/constants';

export default async function Shell({children,title,kicker,s,actions}:{children:React.ReactNode;title:string;kicker?:string;s:Session;actions?:React.ReactNode}){
  const path=(await headers()).get('x-invoke-path')||'';
  const unread=await unreadCount(s.id);
  const general=NAV_GROUPS.find(g=>g.label==='General');
  const departments=NAV_GROUPS.filter(g=>g.label!=='General');

  return <div className="shell">
    <aside className="side">
      <div className="brand">LAND<span>BLAZE</span></div>
      <p className="muted small">Engine v3</p>
      <nav className="nav">
        {general?.items.filter(n=>canAny(s.role,n.cap)).map(n=><Link href={n.href} key={n.href} className={path.startsWith(n.href)?'active':''}>
          <span>{n.label}</span>{n.href==='/notifications'&&unread>0&&<span className="pill">{unread}</span>}
        </Link>)}

        {departments.map(g=>{
          const items=g.items.filter(n=>canAny(s.role,n.cap));
          if(!items.length)return null;
          const current=items.some(n=>path.startsWith(n.href));
          return <details className={'nav-department'+(current?' current':'')} key={g.label} open={current}>
            <summary><span>{g.label}</span><span className="nav-chevron">›</span></summary>
            <div className="nav-subnav">
              {items.map(n=><Link href={n.href} key={n.href} className={path.startsWith(n.href)?'active':''}>
                <span>{n.label}</span>{n.href==='/notifications'&&unread>0&&<span className="pill">{unread}</span>}
              </Link>)}
            </div>
          </details>
        })}
      </nav>
      <div className="side-user">
        <div className="avatar">{s.avatarFileId?<img src={'/api/files/'+s.avatarFileId} alt=""/>:<span>{s.name.slice(0,1).toUpperCase()}</span>}</div>
        <b>{s.name}</b><span>{ROLE_META[s.role].label}</span><span>{ROLE_META[s.role].department}</span>
        <Link href="/profile">My profile</Link><Link href="/profile/password">Change password</Link>
        <form action="/api/auth/logout" method="post"><button className="signout">Sign out</button></form>
      </div>
    </aside>
    <div className="main">
      <header className="top"><div>{kicker&&<div className="kicker">{kicker}</div>}<b style={{fontSize:18}}>{title}</b></div><div style={{display:'flex',gap:10,alignItems:'center'}}>{actions}<Link href="/notifications" className="badge">{unread>0?`${unread} new`:'Notifications'}</Link></div></header>
      <main className="content">{children}</main>
    </div>
  </div>
}
