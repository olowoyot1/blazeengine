/**
 * Optional e-mail delivery via Resend's HTTP API (no SDK, no background worker).
 * The sheet says "get email notification": in-app notifications are always written;
 * e-mail is sent additionally when RESEND_API_KEY and MAIL_FROM are configured.
 * Failures never block a workflow transition.
 */
export type Mail = { to: string; subject: string; text: string };

export async function sendMail(items: Mail[]): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from || items.length === 0) return;
  await Promise.all(items.slice(0, 25).map(async m => {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text }),
        signal: ctl.signal,
      });
      clearTimeout(t);
    } catch { /* best effort */ }
  }));
}
