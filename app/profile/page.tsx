import Shell from '@/components/Shell'; import { requireUser } from '@/lib/guard'; import ProfileForm from './ProfileForm';
export default async function Profile(){const s=await requireUser({allowPasswordChange:true});return <Shell s={s} title="My Profile" kicker="Personal details · profile picture"><div className="card"><ProfileForm user={s}/></div></Shell>}
