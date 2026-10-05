'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Keeps server-rendered customer sales workflow state fresh while the page is open. */
export default function SalesFlowAutoRefresh({ intervalMs = 15000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const refresh = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    timer = setInterval(refresh, intervalMs);
    const onVisible = () => { if (document.visibilityState === 'visible') router.refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router, intervalMs]);

  return <span className="muted small" aria-live="polite">Live workflow monitoring · refreshes automatically</span>;
}
