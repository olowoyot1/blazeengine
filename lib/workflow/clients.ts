/** CLIENT PROFILE — the extra detail captured once a lead becomes a client. */
import { ForbiddenError, WorkflowError, audit, one, parseFields, run, type Actor, type Field } from './core';

const CLIENT_ROLES = ['MARKETER', 'SALES', 'SALES_MANAGER'];

export const CLIENT_PROFILE_FIELDS: Field[] = [
  { name: 'name', label: 'Full name', type: 'text', required: true },
  { name: 'phone', label: 'Phone', type: 'text' },
  { name: 'alternate_phone', label: 'Alternate phone', type: 'text' },
  { name: 'email', label: 'Email', type: 'text' },
  { name: 'address', label: 'Residential address', type: 'textarea' },
  { name: 'date_of_birth', label: 'Date of birth', type: 'date' },
  { name: 'occupation', label: 'Occupation', type: 'text' },
  { name: 'employer', label: 'Employer', type: 'text' },
  { name: 'id_type', label: 'Means of identification', type: 'select', options: ['NATIONAL_ID', 'INTERNATIONAL_PASSPORT', 'DRIVERS_LICENSE', 'VOTERS_CARD'] },
  { name: 'id_number', label: 'ID number', type: 'text' },
  { name: 'next_of_kin_name', label: 'Next of kin — name', type: 'text' },
  { name: 'next_of_kin_phone', label: 'Next of kin — phone', type: 'text' },
  { name: 'next_of_kin_relationship', label: 'Next of kin — relationship', type: 'text' },
];

export async function updateClientProfile(actor: Actor, clientId: string, input: Record<string, unknown>) {
  if (!CLIENT_ROLES.includes(actor.role)) throw new ForbiddenError('Your role cannot edit client profiles');
  const p = parseFields(CLIENT_PROFILE_FIELDS, input);
  if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(p.email))) throw new WorkflowError('Email address is not valid');
  return run(actor, async ctx => {
    const c = await one(ctx, `select id from clients where id=$1`, [clientId]);
    if (!c) throw new WorkflowError('Client not found');
    await ctx.tx.query(
      `update clients set name=$2, phone=$3, alternate_phone=$4, email=$5, address=$6, date_of_birth=$7,
         occupation=$8, employer=$9, id_type=$10, id_number=$11,
         next_of_kin_name=$12, next_of_kin_phone=$13, next_of_kin_relationship=$14,
         profile_completed_at=coalesce(profile_completed_at, now()), updated_at=now()
       where id=$1`,
      [clientId, p.name, p.phone, p.alternate_phone, p.email, p.address, p.date_of_birth,
        p.occupation, p.employer, p.id_type, p.id_number, p.next_of_kin_name, p.next_of_kin_phone, p.next_of_kin_relationship],
    );
    await audit(ctx, 'CLIENT_PROFILE_UPDATED', 'CLIENT', clientId, {});
  });
}
