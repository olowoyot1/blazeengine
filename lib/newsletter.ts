/** Customer newsletters via Resend's batch endpoint (max 100 recipients per request, one email per recipient). */
const BATCH_SIZE = 100;

export type NewsletterResult = { sent: number; failed: number; errors: string[] };

export function newsletterFrom(): string | undefined {
  return process.env.NEWSLETTER_FROM || process.env.MAIL_FROM;
}

export function newsletterConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && newsletterFrom());
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderNewsletterHtml(subject: string, body: string, recipientName: string) {
  const paragraphs = escapeHtml(body).split(/\n{2,}/).map(p => `<p style="margin:0 0 16px;line-height:1.6">${p.replace(/\n/g, '<br>')}</p>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px">
<tr><td style="padding:24px 28px;border-bottom:1px solid #e4e7eb"><strong style="font-size:18px">LandBlaze</strong></td></tr>
<tr><td style="padding:28px"><h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(subject)}</h1>
<p style="margin:0 0 16px">Dear ${escapeHtml(recipientName)},</p>${paragraphs}</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e4e7eb;font-size:12px;color:#616e7c">You are receiving this because you are a LandBlaze customer. Reply to this email if you no longer wish to receive updates.</td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendNewsletter(
  campaignId: string,
  recipients: { email: string; name: string }[],
  subject: string,
  body: string,
): Promise<NewsletterResult> {
  const key = process.env.RESEND_API_KEY;
  const from = newsletterFrom();
  if (!key || !from) throw new Error('Newsletter is not configured. Add NEWSLETTER_FROM (e.g. "LandBlaze <news@yourdomain.com>") on a Resend-verified domain.');

  const result: NewsletterResult = { sent: 0, failed: 0, errors: [] };
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const chunk = recipients.slice(i, i + BATCH_SIZE);
    const payload = chunk.map(r => ({
      from, to: [r.email], subject,
      text: `Dear ${r.name},\n\n${body}\n\n— LandBlaze`,
      html: renderNewsletterHtml(subject, body, r.name),
    }));
    try {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `batch-newsletter/${campaignId}-${i / BATCH_SIZE}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) result.sent += chunk.length;
      else {
        result.failed += chunk.length;
        const err = await res.json().catch(() => null) as { message?: string } | null;
        result.errors.push(err?.message || `HTTP ${res.status}`);
      }
    } catch (e) {
      result.failed += chunk.length;
      result.errors.push(e instanceof Error ? e.message : 'Network error');
    }
  }
  return result;
}
