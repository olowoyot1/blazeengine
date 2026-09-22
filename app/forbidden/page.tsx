import Link from 'next/link';
export default function Forbidden() {
  return (
    <main className="login">
      <div className="login-card">
        <div className="brand">LAND<span>BLAZE</span></div>
        <h1>Access restricted</h1>
        <p className="muted">Your role does not have access to this area. If you believe this is a mistake, contact your administrator.</p>
        <Link className="btn primary full" href="/dashboard">Back to dashboard</Link>
      </div>
    </main>
  );
}
