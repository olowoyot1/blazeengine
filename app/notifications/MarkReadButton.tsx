'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markNotificationsRead, markNotificationRead } from '@/lib/actions';

export function MarkReadButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return <button className="btn light" disabled={pending} onClick={() => start(async () => { await markNotificationsRead(); router.refresh(); })}>Mark all read</button>;
}

export function NotificationReadButton({ id, read }: { id: string; read: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  if (read) return <span className="badge green">Read</span>;
  return <button className="btn light small-btn" disabled={pending} onClick={() => start(async () => { await markNotificationRead(id); router.refresh(); })}>{pending ? 'Saving…' : 'Mark as read'}</button>;
}
