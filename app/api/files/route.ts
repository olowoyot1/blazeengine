import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/guard';
import { sql } from '@/lib/db';

const ALLOWED = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const PROFILE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg']);
const PURPOSES = new Set([
  'document', 'payment_proof', 'bank_payment_proof', 'receipt', 'contract',
  'deed', 'survey', 'supporting_document', 'profile', 'payroll',
  'sales_payment_evidence',
]);
const MAX_BYTES = 4 * 1024 * 1024;

function matchesSignature(bytes: Buffer, mime: string) {
  if (mime === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return false;
}

function safeFilename(name: string) {
  const cleaned = name.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]/g, '_').trim();
  return (cleaned || 'upload').slice(0, 200);
}

/** Accepts a PDF/PNG/JPEG upload (multipart/form-data, field name "file") and stores it privately. */
export async function POST(req: Request) {
  const s = await requireUser({ allowPasswordChange: true });
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Invalid upload' }, { status: 400 }); }
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const purpose = String(form.get('purpose') ?? 'document').trim().toLowerCase();
  if (!PURPOSES.has(purpose)) return NextResponse.json({ error: 'Invalid upload purpose' }, { status: 400 });
  const allowedTypes = purpose === 'profile' ? PROFILE_IMAGE_TYPES : ALLOWED;
  if (!allowedTypes.has(file.type)) return NextResponse.json({ error: purpose === 'profile' ? 'Profile pictures must be PNG or JPEG' : 'Only PDF, PNG or JPEG files are accepted' }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: 'File is empty' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `File is too large — max ${MAX_BYTES / (1024 * 1024)}MB` }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!matchesSignature(bytes, file.type)) return NextResponse.json({ error: 'File contents do not match the declared file type' }, { status: 400 });

  const rows = await sql`insert into uploaded_files(filename, mime_type, size_bytes, data, uploaded_by, purpose)
    values(${safeFilename(file.name)}, ${file.type}, ${bytes.length}, ${bytes}, ${s.id}::uuid, ${purpose}) returning id`;
  return NextResponse.json({ path: `/api/files/${rows[0].id}`, filename: safeFilename(file.name), mimeType: file.type, size: bytes.length });
}
