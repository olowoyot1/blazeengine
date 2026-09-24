import { requireUser } from '@/lib/guard';
import SecuritySetupForm from './SecuritySetupForm';
export default async function SecurityPage(){const s=await requireUser({allowPasswordChange:true});return <main className="login"><div className="login-card"><div className="brand">LAND<span>BLAZE</span></div><h1>Set up your login</h1><p className="muted">Create your unique username and 6-digit PIN. After this, use username + PIN for normal sign-in.</p><SecuritySetupForm currentUsername={s.username}/></div></main>}
