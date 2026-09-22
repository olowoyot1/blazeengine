/** yyyy-mm-dd for a DATE column value (Date parsed at local midnight, or already a string). */
export function d10(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0');
    return `${v.getFullYear()}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}
export const fmtDate = (v: unknown) => d10(v) ?? '—';
export const fmtDateTime = (v: unknown) =>
  v ? new Date(v as any).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' }) : '—';
export const naira = (v: unknown) => '₦' + Number(v ?? 0).toLocaleString('en-NG');
export const human = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
/** Days from today (positive = in the future) for a DATE value. */
export function daysUntil(v: unknown): number | null {
  const d = d10(v); if (!d) return null;
  const t = new Date(); const today = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  const [y, m, dd] = d.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, dd) - today) / 86400000);
}
