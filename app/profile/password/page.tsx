'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { changeOwnPassword } from '@/lib/actions';

export default function ChangePassword() {
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(''); const [pending, start] = useTransition();
  const router = useRouter();
  function submit(e: React.FormEvent) {
    e.preventDefault(); setError('');
    if (next !== confirm) { setError('New passwords do not match'); return; }
    start(async () => {
      const r = await changeOwnPassword(cur, next);
      if ('error' in r) setError(r.error);
      else { router.push('/profile/security'); router.refresh(); }
    });
  }
  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">LAND<span>BLAZE</span></div>
        <h1>Change password</h1>
        <p className="muted">Choose a password with at least 10 characters, including letters and numbers.</p>
        {error && <div className="alert">{error}</div>}
        <label>Current password<input className="input" type="password" required value={cur} onChange={e => setCur(e.target.value)} /></label>
        <label>New password<input className="input" type="password" required value={next} onChange={e => setNext(e.target.value)} /></label>
        <label>Confirm new password<input className="input" type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
        <button className="btn primary full" disabled={pending}>{pending ? 'Saving…' : 'Save password'}</button>
      </form>
    </main>
  );
}
