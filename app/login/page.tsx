'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const r = await fetch('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const data = await r.json();
      if (!r.ok) { setError(data.error || 'Sign in failed'); setBusy(false); return; }
      router.push(data.mustChangePassword ? '/profile/password' : '/dashboard');
      router.refresh();
    } catch { setError('Could not reach the server'); setBusy(false); }
  }

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">LAND<span>BLAZE</span></div>
        <h1>Engine</h1>
        <p className="muted">Real-estate sales, site allocation, logistics, approvals and reporting.</p>
        {error && <div className="alert">{error}</div>}
        <label>Email<input className="input" type="email" required autoFocus value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Password<input className="input" type="password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
        <button className="btn primary full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
