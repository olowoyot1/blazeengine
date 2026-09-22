'use client';
import { useTransition } from 'react';
import { markNotificationsRead } from '@/lib/actions';
export function MarkReadButton() {
  const [pending, start] = useTransition();
  return <button className="btn light" disabled={pending} onClick={() => start(async () => { await markNotificationsRead(); })}>Mark all read</button>;
}
