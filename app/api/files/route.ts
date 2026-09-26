import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/guard';
import { sql } from '@/lib/db';

const ALLOWED = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const PROFILE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg']);
const MAX_BYTES = 4 * 1024 * 1024; // 4MB — kept safely under typical serverless request-body limits

/** Accepts a PDF/PNG/JPEG upload (multipart/form-data, field name "file") and stores
 *  it as bytes in Postgres. Returns a path under /api/files/ that workflow forms use
 *  as the field's value, exactly like a URL field used to — except now it's a real,
 *  privately-held file rather than a link anyone could type or reuse. */
export async function POST(req: Request) {
  const s = await requireUser({ allowPasswordChange: true });
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Invalid upload' }, { status: 400 }); }
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  const purpose = String(form.get('purpose') ?? 'document');
  const allowedTypes = purpose === 'profile' ? PROFILE_IMAGE_TYPES : ALLOWED;
  if (!allowedTypes.has(file.type)) return NextResponse.json({ error: purpose === 'profile' ? 'Profile pictures must be PNG or JPEG' : 'Only PDF, PNG or JPEG files are accepted' }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: 'File is empty' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `File is too large — max ${MAX_BYTES / (1024 * 1024)}MB` }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const rows = await sql`insert into uploaded_files(filename, mime_type, size_bytes, data, uploaded_by)
    values(${file.name.slice(0, 200)}, ${file.type}, ${bytes.length}, ${bytes}, ${s.id}::uuid) returning id`;
  return NextResponse.json({ path: `/api/files/${rows[0].id}`, filename: file.name, mimeType: file.type, size: bytes.length });
}
