import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/guard';
import { sql } from '@/lib/db';

/** Streams back a previously uploaded file. Requires a signed-in session — these are
 *  internal workflow documents (payment proofs, receipts, contracts, ID scans…), not
 *  public assets. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser({ allowPasswordChange: true });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const rows = await sql`select filename, mime_type, data from uploaded_files where id=${id}::uuid`;
  const f = rows[0];
  if (!f) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return new NextResponse(f.data, {
    headers: {
      'Content-Type': f.mime_type,
      'Content-Disposition': `inline; filename="${String(f.filename).replace(/"/g, '')}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
