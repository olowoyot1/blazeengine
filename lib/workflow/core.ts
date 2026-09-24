import { withTx, type Tx, type Row } from '../db';
import type { Role } from '../constants';
import { sendMail, type Mail } from '../email';

export type Actor = { id: string; name: string; role: Role };
export type Ctx = { tx: Tx; actor: Actor; outbox: Mail[]; sent: Set<string> };

/** Error whose message is safe to show to the user. */
export class WorkflowError extends Error {}
export class ForbiddenError extends WorkflowError {}

/** Runs `fn` atomically; e-mails are sent only after a successful commit. */
export async function run<T>(actor: Actor, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  const outbox: Mail[] = [];
  const out = await withTx(tx => fn({ tx, actor, outbox, sent: new Set() }));
  await sendMail(outbox);
  return out;
}

export async function one(ctx: Ctx, text: string, params: unknown[] = []): Promise<Row | undefined> {
  return (await ctx.tx.query(text, params)).rows[0];
}
export async function many(ctx: Ctx, text: string, params: unknown[] = []): Promise<Row[]> {
  return (await ctx.tx.query(text, params)).rows;
}

export async function logEvent(
  ctx: Ctx, entityType: 'SALE' | 'EXPENSE', entityId: string, stage: string, action: string,
  from: string | null, to: string | null, notes?: string | null,
) {
  await ctx.tx.query(
    `insert into workflow_events(entity_type,entity_id,stage,action,from_status,to_status,actor_id,notes)
     values($1,$2,$3,$4,$5,$6,$7,$8)`,
    [entityType, entityId, stage, action, from, to, ctx.actor.id, notes ?? null],
  );
}

export async function audit(ctx: Ctx, action: string, entityType: string, entityId: string, metadata: object = {}) {
  await ctx.tx.query(
    `insert into audit_logs(user_id,action,entity_type,entity_id,metadata) values($1,$2,$3,$4,$5)`,
    [ctx.actor.id, action, entityType, entityId, JSON.stringify(metadata)],
  );
}

export type Note = { title: string; message: string; link?: string };

export async function notifyUsers(ctx: Ctx, userIds: (string | null | undefined)[], n: Note) {
  // Skip the actor and anyone already sent this exact notification in this transaction.
  const ids = [...new Set(userIds.filter((x): x is string => !!x && x !== ctx.actor.id))]
    .filter(id => !ctx.sent.has(`${id}|${n.title}|${n.message}`));
  ids.forEach(id => ctx.sent.add(`${id}|${n.title}|${n.message}`));
  if (!ids.length) return;
  const users = await many(ctx,
    `select id,email from users where id = any($1::uuid[]) and active`, [ids]);
  if (!users.length) return;
  await ctx.tx.query(
    `insert into notifications(user_id,title,message,link) select unnest($1::uuid[]),$2,$3,$4`,
    [users.map(u => u.id), n.title, n.message, n.link ?? null],
  );
  const base = process.env.APP_URL || '';
  for (const u of users) {
    ctx.outbox.push({
      to: u.email, subject: `[Landblaze] ${n.title}`,
      text: `${n.message}${n.link && base ? `\n\nOpen: ${base}${n.link}` : ''}`,
    });
  }
}

export async function notifyRoles(ctx: Ctx, roles: Role[], n: Note) {
  const users = await many(ctx, `select id from users where active and role = any($1::text[])`, [roles]);
  await notifyUsers(ctx, users.map(u => u.id), n);
}

export function mailClient(ctx: Ctx, to: string | null | undefined, subject: string, text: string) {
  if (to) ctx.outbox.push({ to, subject, text });
}

// ---- Field definitions & validation (drives both the forms and server checks) ----

export type Field = {
  name: string; label: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'url' | 'select' | 'checkbox' | 'file';
  required?: boolean; options?: string[]; placeholder?: string; min?: number;
  /** file only: which MIME types the upload endpoint accepts, for the picker's hint. */
  accept?: string[];
};
export type Parsed = Record<string, string | number | boolean | null>;

export function parseFields(fields: Field[], input: Record<string, unknown>): Parsed {
  const out: Parsed = {};
  for (const f of fields) {
    const raw = input[f.name];
    const s = typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw).trim();
    if (f.type === 'checkbox') {
      const on = s === 'on' || s === 'true';
      if (f.required && !on) throw new WorkflowError(`Please confirm: ${f.label}`);
      out[f.name] = on;
      continue;
    }
    if (!s) {
      if (f.required) throw new WorkflowError(`${f.label} is required`);
      out[f.name] = null;
      continue;
    }
    if (s.length > 4000) throw new WorkflowError(`${f.label} is too long`);
    switch (f.type) {
      case 'number': {
        const n = Number(s.replace(/,/g, ''));
        if (!Number.isFinite(n)) throw new WorkflowError(`${f.label} must be a number`);
        if (n < (f.min ?? 0)) throw new WorkflowError(`${f.label} must be at least ${f.min ?? 0}`);
        out[f.name] = n; break;
      }
      case 'date': {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new WorkflowError(`${f.label} must be a valid date`);
        out[f.name] = s; break;
      }
      case 'url': {
        let u: URL;
        try { u = new URL(s); } catch { throw new WorkflowError(`${f.label} must be a valid link (https://…)`); }
        if (!['http:', 'https:'].includes(u.protocol)) throw new WorkflowError(`${f.label} must be an http(s) link`);
        out[f.name] = s; break;
      }
      case 'file': {
        // Value is never typed by the user — the browser already uploaded the file
        // via /api/files and put the resulting path here. Only accept our own format.
        if (!/^\/api\/files\/[0-9a-f-]{36}$/i.test(s)) throw new WorkflowError(`${f.label}: please upload the file (don't paste a link)`);
        out[f.name] = s; break;
      }
      case 'select': {
        if (f.options && !f.options.includes(s)) throw new WorkflowError(`${f.label} has an invalid value`);
        out[f.name] = s; break;
      }
      default: out[f.name] = s;
    }
  }
  return out;
}

export const money = (v: unknown) => '₦' + Number(v ?? 0).toLocaleString('en-NG');

export { d10 } from '../format';

/**
 * Cheap, partial mitigation for "evidence is just a URL, not a verified file":
 * refuses to accept a financial-evidence link (payment proof, bank proof, receipt)
 * that has already been used as evidence elsewhere in the system, catching the
 * simplest form of reuse/fabrication. It cannot verify the link's actual content.
 */
export async function assertFreshEvidence(ctx: Ctx, url: unknown, label: string) {
  if (!url) return;
  const dup = await one(ctx, `
    select 1 from sale_documents where document_url=$1
    union all select 1 from expenses where bank_proof_url=$1 or receipt_url=$1 or negotiation_url=$1
    limit 1`, [String(url)]);
  if (dup) throw new WorkflowError(`This ${label} link has already been used as evidence elsewhere — each proof must be unique`);
}
