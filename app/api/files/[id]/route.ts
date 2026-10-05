import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/guard';
import { can, expenseScope, saleScope } from '@/lib/rbac';
import { sql } from '@/lib/db';

/**
 * Streams a private workflow file only when the signed-in user is authorized to see
 * the record that owns/references it. A UUID is not treated as an authorization token.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireUser({ allowPasswordChange: true });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const sc = saleScope(s);
  const ec = expenseScope(s);
  const payrollAccess = ['HR','CEO','ADMIN','SUPER_ADMIN','ACCOUNTANT','FINANCE_OPERATIONS'].includes(s.role);
  const adminAccess = can(s.role, 'users.manage');

  const rows = await sql`
    select f.filename, f.mime_type, f.data
    from uploaded_files f
    where f.id=${id}::uuid
      and (
        f.uploaded_by=${s.id}::uuid
        or ${adminAccess}::boolean
        or (
          f.purpose='profile'
          and exists (select 1 from users pu where pu.id=${s.id}::uuid and pu.avatar_file_id=f.id)
        )
        or exists (
          select 1 from sale_documents sd
          join sales sale on sale.id=sd.sale_id
          where sd.uploaded_file_id=f.id
            and (
              ${sc.all}::boolean
              or (${sc.own}::boolean and sale.created_by=${sc.uid}::uuid)
              or sale.status = any(${sc.statuses}::text[])
            )
        )
        or exists (
          select 1 from expense_documents ed
          join expenses ex on ex.id=ed.expense_id
          where ed.uploaded_file_id=f.id
            and (${ec.all}::boolean or ex.submitted_by=${ec.uid}::uuid)
        )
        or exists (
          select 1 from expense_payment_documents epd
          join expenses ex on ex.id=epd.expense_id
          where epd.uploaded_file_id=f.id
            and (${ec.all}::boolean or ex.submitted_by=${ec.uid}::uuid)
        )
        or (
          ${payrollAccess}::boolean
          and exists (select 1 from payroll_documents pd where pd.uploaded_file_id=f.id)
        )
      )
    limit 1`;

  const f = rows[0];
  if (!f) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const safeName = String(f.filename).replace(/[\r\n"\\]/g, '_').slice(0, 200) || 'document';
  return new NextResponse(f.data, {
    headers: {
      'Content-Type': f.mime_type,
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
