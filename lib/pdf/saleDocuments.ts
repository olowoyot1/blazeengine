import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export type SaleDocInput = {
  invoiceNo: string;
  receiptNo: string;
  issuedAt: Date;
  clientName: string;
  clientEmail?: string | null;
  clientPhone?: string | null;
  clientAddress?: string | null;
  beneficiaryName?: string | null;
  beneficiaryPhone?: string | null;
  beneficiaryEmail?: string | null;
  beneficiaryAddress?: string | null;
  beneficiaryRelationship?: string | null;
  propertyName?: string | null;
  plotReference?: string | null;
  saleReference?: string | null;
  transactionType?: string | null;
  paymentPlan?: string | null;
  paymentReference?: string | null;
  previousPaymentReference?: string | null;
  estateValue: number;
  amountPaid: number;
  totalPaidToDate?: number;
  issuedBy: string;
};

const BRAND = rgb(0.06, 0.32, 0.25);
const INK = rgb(0.12, 0.13, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.86, 0.88, 0.9);
const TINT = rgb(0.93, 0.96, 0.95);

const A4: [number, number] = [595.28, 841.89];
const M = 50;

// Standard PDF fonts only encode WinAnsi, so strip anything outside it (e.g. the naira sign, em dashes).
const clean = (v: unknown) => String(v ?? '')
  .replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
  .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');

export const ngn = (n: number) => `NGN ${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' });

type Fonts = { reg: PDFFont; bold: PDFFont };

function text(page: PDFPage, s: unknown, x: number, y: number, font: PDFFont, size = 10, color = INK) {
  page.drawText(clean(s), { x, y, size, font, color });
}
function right(page: PDFPage, s: unknown, xRight: number, y: number, font: PDFFont, size = 10, color = INK) {
  const t = clean(s);
  page.drawText(t, { x: xRight - font.widthOfTextAtSize(t, size), y, size, font, color });
}
function wrap(s: string, font: PDFFont, size: number, max: number): string[] {
  const words = clean(s).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > max && line) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function header(page: PDFPage, f: Fonts, title: string, number: string, issuedAt: Date) {
  const [w, h] = A4;
  page.drawRectangle({ x: 0, y: h - 8, width: w, height: 8, color: BRAND });
  text(page, 'LANDBLAZE', M, h - 70, f.bold, 22, BRAND);
  text(page, 'Real Estate & Land Development', M, h - 86, f.reg, 9, MUTED);
  right(page, title, w - M, h - 66, f.bold, 20, INK);
  right(page, number, w - M, h - 84, f.reg, 10, MUTED);
  right(page, `Date: ${day(issuedAt)}`, w - M, h - 98, f.reg, 10, MUTED);
  page.drawLine({ start: { x: M, y: h - 118 }, end: { x: w - M, y: h - 118 }, thickness: 1, color: RULE });
  return h - 148;
}

/** Documents are always issued in favour of the property beneficiary; the paying client is shown underneath. */
function party(page: PDFPage, f: Fonts, label: string, d: SaleDocInput, y: number, payerLabel: string) {
  const beneficiary = d.beneficiaryName?.trim() || d.clientName;
  const lines = d.beneficiaryName?.trim()
    ? [d.beneficiaryAddress, d.beneficiaryEmail, d.beneficiaryPhone]
    : [d.clientAddress, d.clientEmail, d.clientPhone];
  text(page, label, M, y, f.bold, 9, MUTED);
  let yy = y - 16;
  text(page, beneficiary, M, yy, f.bold, 12);
  for (const line of lines.filter(Boolean)) {
    yy -= 14;
    text(page, line, M, yy, f.reg, 10, MUTED);
  }
  if (beneficiary.toLowerCase() !== d.clientName.trim().toLowerCase()) {
    yy -= 20;
    text(page, `${payerLabel}: ${d.clientName}${d.beneficiaryRelationship ? ` (${d.beneficiaryRelationship} of beneficiary)` : ''}`, M, yy, f.reg, 9, MUTED);
  }
  return yy;
}

function details(page: PDFPage, f: Fonts, rows: [string, unknown][], y: number) {
  const x = A4[0] / 2 + 20;
  let yy = y;
  for (const [k, v] of rows) {
    if (v == null || v === '') continue;
    text(page, k, x, yy, f.reg, 9, MUTED);
    right(page, v, A4[0] - M, yy, f.bold, 9);
    yy -= 15;
  }
  return yy;
}

function footer(page: PDFPage, f: Fonts, note: string, issuedBy: string) {
  const [w] = A4;
  page.drawLine({ start: { x: M, y: 110 }, end: { x: w - M, y: 110 }, thickness: 1, color: RULE });
  let y = 92;
  for (const line of wrap(note, f.reg, 9, w - 2 * M)) { text(page, line, M, y, f.reg, 9, MUTED); y -= 12; }
  text(page, `Issued by: ${issuedBy}`, M, 50, f.reg, 9, MUTED);
  right(page, 'This is a system-generated document.', w - M, 50, f.reg, 9, MUTED);
}

function propertyLabel(d: SaleDocInput) {
  return [d.propertyName, d.plotReference && `Plot ${d.plotReference}`].filter(Boolean).join(' - ') || 'Property';
}

async function setup(title: string) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title); pdf.setAuthor('Landblaze'); pdf.setCreator('Landblaze Blaze Engine');
  const fonts = { reg: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  return { pdf, page: pdf.addPage(A4), f: fonts };
}

/** Invoice for the full estate value, showing the payment received and the balance outstanding. */
export async function buildInvoicePdf(d: SaleDocInput): Promise<Uint8Array> {
  const { pdf, page, f } = await setup(`Invoice ${d.invoiceNo}`);
  const [w] = A4;
  let y = header(page, f, 'INVOICE', d.invoiceNo, d.issuedAt);
  const top = y;
  const leftEnd = party(page, f, 'IN FAVOUR OF (PROPERTY BENEFICIARY)', d, y, 'Purchaser');
  const rightEnd = details(page, f, [
    ['Sale reference', d.saleReference], ['Transaction type', d.transactionType],
    ['Payment plan', d.paymentPlan], ['Payment reference', d.paymentReference],
  ], top);
  y = Math.min(leftEnd, rightEnd) - 30;

  page.drawRectangle({ x: M, y: y - 6, width: w - 2 * M, height: 24, color: TINT });
  text(page, 'DESCRIPTION', M + 10, y + 2, f.bold, 9, BRAND);
  right(page, 'AMOUNT', w - M - 10, y + 2, f.bold, 9, BRAND);
  y -= 30;
  const desc = wrap(`Full estate value - ${propertyLabel(d)}`, f.reg, 10, w - 2 * M - 160);
  desc.forEach((line, idx) => text(page, line, M + 10, y - idx * 13, idx ? f.reg : f.bold, 10));
  right(page, ngn(d.estateValue), w - M - 10, y, f.bold, 10);
  y -= desc.length * 13 + 14;
  page.drawLine({ start: { x: M, y }, end: { x: w - M, y }, thickness: 1, color: RULE });

  const balance = Math.max(d.estateValue - d.amountPaid, 0);
  const tx = w / 2 + 20;
  y -= 22;
  text(page, 'Estate value', tx, y, f.reg, 10, MUTED); right(page, ngn(d.estateValue), w - M - 10, y, f.reg, 10);
  y -= 18;
  text(page, 'Less: amount paid', tx, y, f.reg, 10, MUTED); right(page, `(${ngn(d.amountPaid)})`, w - M - 10, y, f.reg, 10);
  y -= 14;
  page.drawRectangle({ x: tx - 10, y: y - 26, width: w - M - tx + 10, height: 28, color: BRAND });
  text(page, 'BALANCE DUE', tx, y - 17, f.bold, 10, rgb(1, 1, 1));
  right(page, ngn(balance), w - M - 10, y - 17, f.bold, 11, rgb(1, 1, 1));

  y -= 60;
  text(page, `Payment received is acknowledged on sales receipt ${d.receiptNo}.`, M, y, f.reg, 10, MUTED);

  footer(page, f, 'Please quote the invoice number on all payments. Title documents are released only after the full estate value has been paid and the sale has been approved.', d.issuedBy);
  return pdf.save();
}

/** Sales order for installment plans, carrying the full estate value and balance schedule. */
export async function buildSalesOrderPdf(d: SaleDocInput): Promise<Uint8Array> {
  const { pdf, page, f } = await setup(`Sales order ${d.invoiceNo}`);
  const [w] = A4;
  let y = header(page, f, 'SALES ORDER', d.invoiceNo, d.issuedAt);
  const top = y;
  const leftEnd = party(page, f, 'IN FAVOUR OF (PROPERTY BENEFICIARY)', d, y, 'Purchaser');
  const rightEnd = details(page, f, [
    ['Sale reference', d.saleReference], ['Transaction type', d.transactionType],
    ['Payment plan', 'INSTALLMENT'], ['Payment reference', d.paymentReference],
  ], top);
  y = Math.min(leftEnd, rightEnd) - 30;
  page.drawRectangle({ x: M, y: y - 6, width: w - 2 * M, height: 24, color: TINT });
  text(page, 'DESCRIPTION', M + 10, y + 2, f.bold, 9, BRAND);
  right(page, 'AMOUNT', w - M - 10, y + 2, f.bold, 9, BRAND);
  y -= 30;
  const desc = wrap(`Full estate value - ${propertyLabel(d)}`, f.reg, 10, w - 2 * M - 160);
  desc.forEach((line, idx) => text(page, line, M + 10, y - idx * 13, idx ? f.reg : f.bold, 10));
  right(page, ngn(d.estateValue), w - M - 10, y, f.bold, 10);
  y -= desc.length * 13 + 14;
  page.drawLine({ start: { x: M, y }, end: { x: w - M, y }, thickness: 1, color: RULE });
  const balance = Math.max(d.estateValue - d.amountPaid, 0);
  const tx = w / 2 + 20;
  y -= 22;
  text(page, 'Full estate value', tx, y, f.reg, 10, MUTED); right(page, ngn(d.estateValue), w - M - 10, y, f.reg, 10);
  y -= 18;
  text(page, 'Amount paid to date', tx, y, f.reg, 10, MUTED); right(page, ngn(d.amountPaid), w - M - 10, y, f.reg, 10);
  y -= 14;
  page.drawRectangle({ x: tx - 10, y: y - 26, width: w - M - tx + 10, height: 28, color: BRAND });
  text(page, 'BALANCE TO PAY', tx, y - 17, f.bold, 10, rgb(1, 1, 1));
  right(page, ngn(balance), w - M - 10, y - 17, f.bold, 11, rgb(1, 1, 1));
  y -= 60;
  text(page, `Payment received is acknowledged on sales receipt ${d.receiptNo}.`, M, y, f.reg, 10, MUTED);
  footer(page, f, 'This sales order records the agreed full estate value for an installment purchase. Title documents are released only after the full estate value has been paid and the sale has been approved.', d.issuedBy);
  return pdf.save();
}

/** Sales receipt for the amount actually paid. */
export async function buildReceiptPdf(d: SaleDocInput): Promise<Uint8Array> {
  const { pdf, page, f } = await setup(`Sales receipt ${d.receiptNo}`);
  const [w] = A4;
  let y = header(page, f, 'SALES RECEIPT', d.receiptNo, d.issuedAt);
  const top = y;
  const leftEnd = party(page, f, 'ISSUED IN FAVOUR OF (PROPERTY BENEFICIARY)', d, y, 'Payment received from');
  const rightEnd = details(page, f, [
    ['Invoice', d.invoiceNo], ['Sale reference', d.saleReference], ['Previous payment reference', d.previousPaymentReference], ['Payment reference', d.paymentReference],
  ], top);
  y = Math.min(leftEnd, rightEnd) - 36;

  page.drawRectangle({ x: M, y: y - 66, width: w - 2 * M, height: 80, color: TINT });
  text(page, 'AMOUNT RECEIVED', M + 20, y - 10, f.bold, 9, BRAND);
  text(page, ngn(d.amountPaid), M + 20, y - 44, f.bold, 26, BRAND);
  y -= 100;

  const totalPaid = d.totalPaidToDate ?? d.amountPaid;
  const balance = Math.max(d.estateValue - totalPaid, 0);
  const rows: [string, string][] = [
    ['Being payment for', propertyLabel(d)],
    ['Estate value', ngn(d.estateValue)],
    ['This payment', ngn(d.amountPaid)],
    ['Total paid to date', ngn(totalPaid)],
    ['Balance outstanding', ngn(balance)],
  ];
  for (const [k, v] of rows) {
    text(page, k, M, y, f.reg, 10, MUTED);
    right(page, v, w - M, y, f.bold, 10);
    y -= 8;
    page.drawLine({ start: { x: M, y }, end: { x: w - M, y }, thickness: 0.5, color: RULE });
    y -= 16;
  }

  footer(page, f, 'Thank you for your payment. Keep this receipt as proof of payment. It acknowledges funds received only and does not by itself transfer title.', d.issuedBy);
  return pdf.save();
}
