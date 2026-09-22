import { redirect } from 'next/navigation';
import { session } from '@/lib/auth';
export default async function Home() {
  const s = await session();
  redirect(s ? (s.mustChangePassword ? '/profile/password' : '/dashboard') : '/login');
}
