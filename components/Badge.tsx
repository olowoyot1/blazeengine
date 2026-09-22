import { badgeClass } from '@/lib/constants';
import { human } from '@/lib/format';
export function Badge({ status, label }: { status: string; label?: string }) {
  const cls = badgeClass(status);
  return <span className={'badge' + (cls ? ' ' + cls : '')}>{label ?? human(status)}</span>;
}
