/**
 * Beta SMS (betasms.com) HTTP API:
 *   GET https://login.betasms.com/api/?username=&password=&message=&sender=&mobiles=a,b,c
 * A successful call returns a body beginning with "OK" (or status code 1701);
 * anything else is treated as a provider error and surfaced to the sender.
 */
const BETASMS_ENDPOINT = 'https://login.betasms.com/api/';
const MOBILES_PER_REQUEST = 100;

export type SmsResult = { sent: number; failed: number; errors: string[] };

export function smsConfigured(): boolean {
  return !!(process.env.BETASMS_USERNAME && process.env.BETASMS_PASSWORD && process.env.BETASMS_SENDER_ID);
}

/** Normalises Nigerian numbers (080…, +23480…, 23480…, 80…) to 23480… ; returns null if invalid. */
export function normalizeNgPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('234')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  if (!/^[789][01]\d{8}$/.test(d)) return null;
  return `234${d}`;
}

export async function sendBulkSms(mobiles: string[], message: string): Promise<SmsResult> {
  const username = process.env.BETASMS_USERNAME;
  const password = process.env.BETASMS_PASSWORD;
  const sender = process.env.BETASMS_SENDER_ID;
  if (!username || !password || !sender) throw new Error('SMS is not configured. Add BETASMS_USERNAME, BETASMS_PASSWORD and BETASMS_SENDER_ID.');

  const result: SmsResult = { sent: 0, failed: 0, errors: [] };
  for (let i = 0; i < mobiles.length; i += MOBILES_PER_REQUEST) {
    const chunk = mobiles.slice(i, i + MOBILES_PER_REQUEST);
    const params = new URLSearchParams({ username, password, message, sender, mobiles: chunk.join(',') });
    try {
      const res = await fetch(`${BETASMS_ENDPOINT}?${params.toString()}`, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
      const body = (await res.text()).trim();
      if (res.ok && (/^ok\b/i.test(body) || body.startsWith('1701'))) result.sent += chunk.length;
      else { result.failed += chunk.length; result.errors.push(body.slice(0, 160) || `HTTP ${res.status}`); }
    } catch (e) {
      result.failed += chunk.length;
      result.errors.push(e instanceof Error ? e.message : 'Network error');
    }
  }
  return result;
}
