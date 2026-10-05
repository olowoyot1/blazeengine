import { sql } from './db';

/**
 * Documents generated from a sale and attached to that sale's customer profile.
 * Keep this query scoped through the sale's client_id so a customer only sees
 * documents belonging to their own sales record.
 */
export async function getClientSaleDocuments(clientId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return [];

  return sql`
    select
      d.id,
      d.document_type,
      d.document_name,
      d.document_url,
      d.created_at,
      s.id sale_id,
      s.sale_reference,
      s.property_name,
      s.plot_reference,
      s.status sale_status
    from sale_documents d
    join sales s on s.id=d.sale_id
    where s.client_id=${clientId}::uuid
      and d.document_type in ('CONTRACT','ACKNOWLEDGMENT_LETTER')
    order by d.created_at desc
  `;
}
