/** LEAD MANAGEMENT (sheet: Sales team / Marketer – 10 leads per day, converts them to clients) */
import { ForbiddenError, WorkflowError, audit, notifyRoles, one, parseFields, run, type Actor } from './core';

const LEAD_ROLES = ['MARKETER', 'SALES', 'SALES_MANAGER'];

export async function createLead(actor: Actor, input: Record<string, unknown>) {
  if (!LEAD_ROLES.includes(actor.role)) throw new ForbiddenError('Your role cannot create leads');
  const p = parseFields([
    { name: 'name', label: 'Prospect name', type: 'text', required: true },
    { name: 'phone', label: 'Phone', type: 'text' },
    { name: 'email', label: 'Email', type: 'text' },
    { name: 'source', label: 'Source / campaign', type: 'text' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ], input);
  if (!p.phone && !p.email) throw new WorkflowError('Provide a phone number or an email address');
  if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(p.email))) throw new WorkflowError('Email address is not valid');
  return run(actor, async ctx => {
    // Duplicate guard – protects the daily target from double counting the same prospect.
    const dup = await one(ctx,
      `select l.name, u.name owner from leads l left join users u on u.id=l.owner_id
       where l.status<>'LOST' and ((l.phone is not null and l.phone=$1) or (l.email is not null and lower(l.email)=lower($2))) limit 1`,
      [p.phone, p.email]);
    if (dup) throw new WorkflowError(`This prospect already exists (${dup.name}, owned by ${dup.owner ?? 'unassigned'})`);
    const l = (await one(ctx,
      `insert into leads(name,phone,email,source,notes,owner_id) values($1,$2,$3,$4,$5,$6) returning id`,
      [p.name, p.phone, p.email, p.source, p.notes, actor.id]))!;
    await audit(ctx, 'LEAD_CREATED', 'LEAD', l.id, { name: p.name });
    return l.id as string;
  });
}

export async function setLeadStatus(actor: Actor, leadId: string, status: string) {
  if (!['NEW', 'CONTACTED', 'QUALIFIED', 'LOST'].includes(status)) throw new WorkflowError('Invalid status (use Convert to create a client)');
  return run(actor, async ctx => {
    const l = await one(ctx, `select * from leads where id=$1 for update`, [leadId]);
    if (!l) throw new WorkflowError('Lead not found');
    if (!LEAD_ROLES.includes(actor.role) || (actor.role !== 'SALES_MANAGER' && l.owner_id !== actor.id)) throw new ForbiddenError('You can only update your own leads');
    if (l.status === 'CONVERTED') throw new WorkflowError('Lead is already converted');
    await ctx.tx.query(`update leads set status=$2, updated_at=now() where id=$1`, [leadId, status]);
    await audit(ctx, 'LEAD_STATUS', 'LEAD', leadId, { from: l.status, to: status });
  });
}

/** "Converts them to clients": creates the client record from a lead. */
export async function convertLead(actor: Actor, leadId: string) {
  return run(actor, async ctx => {
    const l = await one(ctx, `select * from leads where id=$1 for update`, [leadId]);
    if (!l) throw new WorkflowError('Lead not found');
    if (!LEAD_ROLES.includes(actor.role) || (actor.role !== 'SALES_MANAGER' && l.owner_id !== actor.id)) throw new ForbiddenError('You can only convert your own leads');
    if (l.status === 'CONVERTED') throw new WorkflowError('Lead is already converted');
    if (l.status === 'LOST') throw new WorkflowError('A lost lead cannot be converted');
    const c = (await one(ctx,
      `insert into clients(lead_id,name,phone,email,created_by) values($1,$2,$3,$4,$5) returning id`,
      [l.id, l.name, l.phone, l.email, actor.id]))!;
    await ctx.tx.query(`update leads set status='CONVERTED', client_id=$2, updated_at=now() where id=$1`, [l.id, c.id]);
    await audit(ctx, 'LEAD_CONVERTED', 'LEAD', l.id, { client_id: c.id });
    await notifyRoles(ctx, ['SALES_MANAGER', 'SALES'], { title: 'Lead converted to client', message: `${l.name} is now a client – create the sale.`, link: '/sales' });
    return c.id as string;
  });
}
