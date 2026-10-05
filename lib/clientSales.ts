import { sql } from './db';

export type ClientSaleRow = Record<string, any>;

/**
 * Full customer sales history with the latest workflow activity, pending approval,
 * pending operations task and the durable next action assigned to the sale.
 */
export async function getClientSales(clientId: string): Promise<ClientSaleRow[]> {
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return [];

  return sql`
    select
      s.*,
      u.name creator,
      le.created_at last_activity_at,
      le.action last_activity_action,
      le.message last_activity_message,
      pa.step pending_approval_step,
      pa.approver_role pending_approval_role,
      pa.created_at pending_approval_at,
      ot.task_type pending_task_type,
      ot.due_date pending_task_due_date,
      ot.notes pending_task_notes,
      na.action_key next_action_key,
      na.title next_action_title,
      na.owner_role next_action_owner_role,
      na.owner_user_id next_action_owner_user_id,
      nu.name next_action_owner_name,
      na.due_date next_action_due_date,
      na.updated_at next_action_updated_at
    from sales s
    left join users u on u.id=s.created_by
    left join sale_next_actions na on na.sale_id=s.id
    left join users nu on nu.id=na.owner_user_id
    left join lateral (
      select e.created_at, e.action, e.message
      from workflow_events e
      where e.entity_type='SALE' and e.entity_id=s.id
      order by e.created_at desc
      limit 1
    ) le on true
    left join lateral (
      select a.step, a.approver_role, a.created_at
      from approvals a
      where a.entity_type='SALE' and a.entity_id=s.id and a.status='PENDING'
      order by a.round_no, a.seq, a.created_at
      limit 1
    ) pa on true
    left join lateral (
      select o.task_type, o.due_date, o.notes
      from operations o
      where o.sale_id=s.id and o.status='PENDING'
      order by o.due_date nulls last, o.created_at
      limit 1
    ) ot on true
    where s.client_id=${clientId}::uuid
    order by s.created_at desc
  `;
}
