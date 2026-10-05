import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export type SaleAgreementInput = {
  clientName: string;
  clientEmail?: string | null;
  clientPhone?: string | null;
  clientAddress?: string | null;
  beneficiaryName?: string | null;
  beneficiaryPhone?: string | null;
  beneficiaryEmail?: string | null;
  beneficiaryAddress?: string | null;
  propertyName?: string | null;
  propertyLocation?: string | null;
  propertySize?: string | null;
  plotReference?: string | null;
  saleReference?: string | null;
  transactionType?: string | null;
  paymentPlan?: string | null;
  estateValue: number;
  amountPaid: number;
  paymentReference?: string | null;
  issuedAt: Date;
  issuedBy: string;
};

const A4: [number, number] = [595.28, 841.89];
const BLACK = rgb(0.05, 0.05, 0.05);
const GREY = rgb(0.35, 0.35, 0.35);
const BLUE = rgb(0.02, 0.24, 0.63);
const GOLD = rgb(0.98, 0.62, 0.02);
const M = 66;

const clean = (value: unknown, fallback = '') => String(value ?? '').trim() || fallback;
const upper = (value: unknown, fallback = '') => clean(value, fallback).toUpperCase();
const ONES = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const TENS = ['', '', 'twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];

function numberWords(n: number): string {
  const value = Math.round(Math.abs(n));
  if (value < 20) return ONES[value];
  if (value < 100) return TENS[Math.floor(value / 10)] + (value % 10 ? ` ${ONES[value % 10]}` : '');
  if (value < 1000) return `${ONES[Math.floor(value / 100)]} hundred${value % 100 ? ` ${numberWords(value % 100)}` : ''}`;
  const scales: [number, string][] = [[1_000_000_000_000, 'trillion'], [1_000_000_000, 'billion'], [1_000_000, 'million'], [1000, 'thousand']];
  for (const [scale, label] of scales) {
    if (value >= scale) return `${numberWords(Math.floor(value / scale))} ${label}${value % scale ? ` ${numberWords(value % scale)}` : ''}`;
  }
  return ONES[value];
}

const money = (value: number) => `N${Number(value || 0).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const moneyWords = (value: number) => `${numberWords(value)} naira`;

function ordinal(n: number) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th'}`;
}

function longDate(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(date);
  const day = Number(parts.find(p => p.type === 'day')?.value || 1);
  const month = parts.find(p => p.type === 'month')?.value || '';
  const year = parts.find(p => p.type === 'year')?.value || '';
  return `${ordinal(day)} ${month}, ${year}`;
}

function wrap(textValue: string, font: PDFFont, size: number, width: number) {
  const words = textValue.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function drawWrapped(page: PDFPage, textValue: string, x: number, y: number, width: number, font: PDFFont, size: number, leading = size + 4, color = BLACK) {
  const lines = wrap(textValue, font, size, width);
  for (const line of lines) { page.drawText(line, { x, y, size, font, color }); y -= leading; }
  return y;
}

function centered(page: PDFPage, value: string, y: number, font: PDFFont, size: number, color = BLACK) {
  const width = font.widthOfTextAtSize(value, size);
  page.drawText(value, { x: (A4[0] - width) / 2, y, size, font, color });
}

function centeredAt(page: PDFPage, value: string, centerX: number, y: number, font: PDFFont, size: number) {
  const width = font.widthOfTextAtSize(value, size);
  page.drawText(value, { x: centerX - width / 2, y, size, font, color: BLACK });
}

function drawHeader(page: PDFPage, fonts: { regular: PDFFont; bold: PDFFont }, date: Date) {
  const [w, h] = A4;
  page.drawRectangle({ x: 0, y: h - 6, width: w, height: 6, color: BLUE });
  page.drawRectangle({ x: 48, y: h - 88, width: 30, height: 50, color: GOLD });
  page.drawRectangle({ x: 56, y: h - 80, width: 30, height: 50, color: BLUE });
  page.drawText('LANDBLAZE', { x: 94, y: h - 60, size: 20, font: fonts.bold, color: BLUE });
  page.drawText('LIMITED', { x: 95, y: h - 80, size: 10, font: fonts.bold, color: GOLD });
  page.drawText('RC-8102989', { x: 95, y: h - 96, size: 7, font: fonts.regular, color: GREY });
  page.drawText('www.landblazelimited.com.ng', { x: 315, y: h - 55, size: 8, font: fonts.bold, color: BLACK });
  page.drawText('Landblazelimited@gmail.com', { x: 315, y: h - 68, size: 8, font: fonts.regular, color: BLACK });
  page.drawText('Landblaze Limited', { x: 315, y: h - 81, size: 8, font: fonts.regular, color: BLACK });
  page.drawText('+234 812 954 4014', { x: 315, y: h - 94, size: 8, font: fonts.regular, color: BLACK });
  page.drawText('Head office: Wasiu Adesina Avenue, Opako, Adigbe,', { x: 365, y: h - 120, size: 8.5, font: fonts.regular, color: GREY });
  page.drawText('Abeokuta Ogun State.  +234 812 954 4014', { x: 365, y: h - 133, size: 8.5, font: fonts.regular, color: GREY });
  page.drawText(longDate(date), { x: 365, y: h - 165, size: 10, font: fonts.bold, color: BLACK });
  return h - 188;
}

function drawFooter(page: PDFPage, fonts: { regular: PDFFont }, pageNo: number) {
  const [w] = A4;
  page.drawLine({ start: { x: 48, y: 38 }, end: { x: w - 48, y: 38 }, thickness: 1, color: GOLD });
  for (let x = 0; x < w; x += 44) {
    page.drawRectangle({ x, y: 0, width: 22, height: 18, color: GOLD });
    page.drawRectangle({ x: x + 11, y: 0, width: 22, height: 18, color: BLUE });
  }
  page.drawText(`Landblaze Limited · ${pageNo}`, { x: w - 150, y: 23, size: 7, font: fonts.regular, color: GREY });
}

async function setup(title: string) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title); pdf.setAuthor('Landblaze Limited'); pdf.setSubject('Land sale document'); pdf.setCreator('Landblaze Blaze Engine');
  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  return { pdf, regular, bold };
}

function propertyDescription(input: SaleAgreementInput) {
  const size = clean(input.propertySize, 'the size stated in the approved sale record');
  const location = clean(input.propertyLocation, input.propertyName || 'the property stated in the approved sale record');
  return `all that parcel of land, together with all its appurtenances, measuring approximately ${size}, situated at ${location}, Nigeria.`;
}

function purchaserAddress(input: SaleAgreementInput) { return clean(input.beneficiaryAddress, input.clientAddress || 'the address recorded in the approved sale record'); }
function beneficiary(input: SaleAgreementInput) { return clean(input.beneficiaryName, input.clientName); }
function beneficiaryPronoun(input: SaleAgreementInput) { return /\b(Miss|Ms|Mrs|Madam)\b/i.test(beneficiary(input)) ? 'her' : 'their'; }

function contractParties(input: SaleAgreementInput) {
  return {
    vendor: 'Landblaze Limited of C6 and C2 Divine Plaza, Mokola Bus stop, Keke Park, Egbeda, Lagos State.',
    purchaser: `${beneficiary(input)}, Of ${purchaserAddress(input)}.`,
  };
}

export async function buildAcknowledgementLetterPdf(input: SaleAgreementInput): Promise<Uint8Array> {
  const { pdf, regular, bold } = await setup('Acknowledgement Letter');
  const page = pdf.addPage(A4);
  let y = drawHeader(page, { regular, bold }, input.issuedAt);
  const recipient = upper(beneficiary(input));
  const units = clean(input.propertySize, input.plotReference ? `the plot identified as ${input.plotReference}` : 'the property identified in your sale record');
  const property = clean(input.propertyName, 'the property identified in your sale record');
  y -= 8;
  y = drawWrapped(page, purchaserAddress(input), M, y, 285, regular, 11, 15);
  y -= 18;
  page.drawText(`DEAR ${recipient},`, { x: M, y, size: 11, font: bold, color: BLACK });
  y -= 30;
  centered(page, 'ACKNOWLEDGEMENT LETTER', y, bold, 18);
  y -= 26;
  const paragraphs = [
    'Congratulations on this significant milestone toward securing your future!',
    `We are delighted to formally acknowledge the receipt of your payment for ${units} of land at ${property}. This is not just an investment in property; it is an investment in your dreams and aspirations. We are honored to walk this path with you and to provide the support you need to make your vision a reality.`,
    'At Landblaze Limited, we understand that purchasing land is a momentous decision, and we deeply value the trust you have placed in us. Our mission is to ensure that your journey toward land ownership is seamless, transparent, and fulfilling. From start to finish, we are committed to offering you the highest level of service and support to meet your expectations and exceed them.',
    'This investment is a testament to your foresight and determination, and we are inspired by your bold step toward creating a brighter future for yourself and your loved ones. Whether you are planning to build a home, establish a business, or secure land as an asset for the future, we are here to guide you every step of the way.',
    'Thank you once again for choosing Landblaze Limited.',
  ];
  for (const p of paragraphs) { y = drawWrapped(page, p, M, y, A4[0] - 2 * M, regular, 10.5, 15); y -= 10; }
  y -= 8;
  page.drawText('Sincerely,', { x: M, y, size: 10.5, font: bold, color: BLACK });
  y -= 17;
  page.drawText('Landblaze Limited', { x: M, y, size: 10.5, font: regular, color: BLACK });
  page.drawText(`Sale reference: ${clean(input.saleReference, 'Not provided')}`, { x: 365, y: 88, size: 8, font: regular, color: GREY });
  page.drawText(`Payment reference: ${clean(input.paymentReference, 'Not provided')}`, { x: 365, y: 76, size: 8, font: regular, color: GREY });
  drawFooter(page, { regular }, 1);
  return pdf.save();
}

export async function buildContractOfSalePdf(input: SaleAgreementInput): Promise<Uint8Array> {
  const { pdf, regular, bold } = await setup('Contract of Sale');
  const parties = contractParties(input);
  const purchaser = beneficiary(input);
  const property = propertyDescription(input);
  const purchasePrice = money(input.estateValue);
  const paid = money(input.amountPaid);
  const date = longDate(input.issuedAt);

  {
    const page = pdf.addPage(A4);
    centered(page, 'CONTRACT OF SALE', 742, bold, 14);
    centered(page, 'BETWEEN', 694, regular, 8);
    centered(page, 'LANDBLAZE LIMITED', 662, bold, 13);
    centered(page, 'Vendor', 635, regular, 8);
    centered(page, 'AND', 608, regular, 8);
    centered(page, purchaser, 574, bold, 13);
    centered(page, 'Purchaser', 547, regular, 8);
    const cover = `IN RESPECT OF ${property}`.toUpperCase();
    const lines = wrap(cover, bold, 8.5, 430);
    let cy = 480;
    for (const line of lines) { centered(page, line, cy, bold, 8.5); cy -= 13; }
    centered(page, `DATED THIS ${date.toUpperCase()}.`, cy - 38, regular, 8.5);
    page.drawText('1', { x: 546, y: 38, size: 8, font: regular, color: GREY });
  }

  {
    const page = pdf.addPage(A4);
    let y = 758;
    y = drawWrapped(page, `THIS CONTRACT OF SALE is made this ${date},`, 66, y, 463, bold, 8.8, 12);
    y -= 26; centered(page, 'BETWEEN', y, bold, 8.5); y -= 28;
    y = drawWrapped(page, `${parties.vendor} (hereinafter referred to as “the Vendor,” which expression shall, unless inconsistent with the context or meaning, include its heirs, administrators, executors, beneficiaries, legal/personal representatives, and successors-in-title) of the ONE PART,`, 66, y, 463, regular, 8.8, 12);
    y -= 22; centered(page, 'AND', y, bold, 8.5); y -= 28;
    y = drawWrapped(page, `${parties.purchaser} (hereinafter referred to as “the Purchaser,” which expression shall, unless inconsistent with the context or meaning, include ${beneficiaryPronoun(input)} heirs, administrators, executors, beneficiaries, legal/personal representatives, and successors-in-title) of the OTHER PART.`, 66, y, 463, regular, 8.8, 12);
    y -= 22; page.drawText('1.0 PROPERTY DESCRIPTION', { x: 66, y, size: 8.8, font: bold, color: BLACK }); y -= 19;
    y = drawWrapped(page, `The vendor is the rightful owner of ${property}`, 66, y, 463, regular, 8.8, 12);
    y -= 20; page.drawText('2.0 AGREED PURCHASE PRICE', { x: 66, y, size: 8.8, font: bold, color: BLACK }); y -= 19;
    y = drawWrapped(page, `In consideration of the sum of ${purchasePrice} (${moneyWords(input.estateValue)} only), the purchaser agrees to purchase the aforementioned property from the vendor. The Purchaser has made an initial payment of ${paid} (${moneyWords(input.amountPaid)}) to the Vendor, which the Vendor hereby acknowledges and confirms receipt of.`, 66, y, 463, regular, 8.8, 12);
    page.drawText('2', { x: 546, y: 38, size: 8, font: regular, color: GREY });
  }

  {
    const page = pdf.addPage(A4);
    let y = 758;
    page.drawText('3.0 OBLIGATIONS OF THE PARTIES', { x: 66, y, size: 8.8, font: bold, color: BLACK }); y -= 20;
    page.drawText('3.1 Obligations of the Vendor', { x: 66, y, size: 8.8, font: bold, color: BLACK }); y -= 17;
    y = drawWrapped(page, 'The Vendor agrees to:', 66, y, 463, regular, 8.8, 12);
    const vendorObligations = [
      'Deliver all relevant documents pertaining to the property, including a Deed of Assignment and a Survey Plan, upon the full settlement of the purchase price.',
      'Indemnify the Purchaser against any claims or disputes arising in relation to the title or ownership of the property.',
      'Accept and receive payments from the Purchaser, whether made as monthly installments or lump sum payments, provided such payments are not defaulted under any conditions or grounds.',
    ];
    vendorObligations.forEach((item, idx) => { y -= 3; y = drawWrapped(page, `${idx + 1}.  ${item}`, 76, y, 453, regular, 8.8, 12); y -= 5; });
    y -= 8; page.drawText('3.2 Obligations of the Purchaser', { x: 66, y, size: 8.8, font: bold, color: BLACK }); y -= 17;
    y = drawWrapped(page, 'The Purchaser agrees to:', 66, y, 463, regular, 8.8, 12);
    const purchaserObligations = [
      'Comply with all applicable rules and regulations governing the use of the property, including obtaining necessary approvals for construction or development.',
      'Seek prior approval from the Vendor before undertaking any structural changes or developments on the land.',
      'Ensure prompt and timely payment of the agreed installment sums or lump sum payments.',
    ];
    purchaserObligations.forEach((item, idx) => { y -= 3; y = drawWrapped(page, `${idx + 1}.  ${item}`, 76, y, 453, regular, 8.8, 12); y -= 5; });
    y -= 8; page.drawText('4.0 TITLE AND DOCUMENTATION', { x: 66, y, size: 8.8, font: bold, color: BLACK }); y -= 20;
    y = drawWrapped(page, 'Upon the full payment of the agreed purchase price, the Vendor shall provide the Purchaser with the following documents:', 66, y, 463, regular, 8.8, 12);
    ['Deed of Assignment', 'Survey Plan', 'Receipt of Payment', 'Provisional Letter of Allocation (if applicable)'].forEach((item, idx) => { y -= 3; y = drawWrapped(page, `${idx + 1}.  ${item}`, 76, y, 453, regular, 8.8, 12); y -= 4; });
    page.drawText('3', { x: 546, y: 38, size: 8, font: regular, color: GREY });
  }

  {
    const page = pdf.addPage(A4);
    let y = 758;
    page.drawText('5.0 DISPUTE RESOLUTION', { x: 66, y, size: 8.8, font: bold, color: BLACK }); y -= 20;
    y = drawWrapped(page, 'Any disputes arising from or in connection with this contract shall be resolved amicably between the parties. In the event that an amicable resolution cannot be reached, the matter shall be referred to arbitration in accordance with the provisions of the Arbitration and Conciliation Act of Nigeria.', 66, y, 463, regular, 8.8, 12);
    y -= 14; y = drawWrapped(page, 'The decision of the arbitrator(s) shall be final and binding on both parties.', 66, y, 463, regular, 8.8, 12);
    y -= 16; y = drawWrapped(page, 'IN WITNESS WHEREOF, the parties hereto have executed this agreement on the day and year first above written.', 66, y, 463, bold, 8.8, 12);
    y -= 42;
    page.drawLine({ start: { x: 66, y }, end: { x: 250, y }, thickness: 0.8, color: BLACK });
    page.drawLine({ start: { x: 340, y }, end: { x: 524, y }, thickness: 0.8, color: BLACK });
    y -= 18; centeredAt(page, 'SIGNED BY THE VENDOR', 158, y, bold, 8); centeredAt(page, 'SIGNED BY THE PURCHASER', 432, y, bold, 8);
    y -= 18; centeredAt(page, 'Landblaze Limited', 158, y, bold, 8.5); centeredAt(page, purchaser, 432, y, bold, 8.5);
    y -= 48; page.drawLine({ start: { x: 66, y }, end: { x: 524, y }, thickness: 0.8, color: BLACK });
    centered(page, 'WITNESS', y - 28, bold, 8.5); y -= 55;
    ['Name:', 'Address:', 'Occupation:', 'Telephone:'].forEach((label) => {
      page.drawText(label, { x: 106, y, size: 8.5, font: regular, color: BLACK });
      page.drawLine({ start: { x: 155, y: y - 2 }, end: { x: 390, y: y - 2 }, thickness: 0.5, color: GREY });
      if (label === 'Name:') { page.drawText('Signature', { x: 397, y, size: 8.5, font: regular, color: BLACK }); page.drawLine({ start: { x: 445, y: y - 2 }, end: { x: 523, y: y - 2 }, thickness: 0.5, color: GREY }); }
      y -= 17;
    });
    page.drawText('4', { x: 546, y: 38, size: 8, font: regular, color: GREY });
  }

  return pdf.save();
}
