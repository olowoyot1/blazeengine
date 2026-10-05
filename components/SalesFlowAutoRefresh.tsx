'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function SalesFlowAutoRefresh({ intervalMs = 15000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') router.refresh(); };
    const timer = setInterval(refresh, intervalMs);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [router, intervalMs]);
  return <span className="muted small" aria-live="polite">Live workflow monitoring · refreshes automatically</span>;
}
