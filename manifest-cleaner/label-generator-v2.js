/**
 * DPD Label Generator v2 — Uses empty template from Adobe
 * Scale: pdf2json units × 16 = PDF points. Page: 297 × 421 pts
 */

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const bwipjs = require('bwip-js');
const fs = require('fs');
const path = require('path');

const S = 16;
const PH = 421;
const yb = (topY, h) => PH - (topY * S) - h;

async function makeBarcode(text, heightMM) {
  return await bwipjs.toBuffer({
    bcid: 'code128', text: String(text), scale: 3,
    height: heightMM || 12, includetext: true,
    textxalign: 'center', textyoffset: 2, paddingwidth: 3,
  }).catch(() => null);
}

async function makeDataMatrix(text) {
  return await bwipjs.toBuffer({
    bcid: 'datamatrix', text: String(text), scale: 2, includetext: false,
  }).catch(() => null);
}

async function generateDpdLabel(parcel) {
  const templateBytes = fs.readFileSync(path.join(__dirname, 'dpd-template-empty.pdf'));
  const pdfDoc = await PDFDocument.load(templateBytes);
  const page = pdfDoc.getPages()[0];
  const B = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const R = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const tracking = String(parcel.tracking || '');

  const T = (text, xu, yu, sz, bold) => page.drawText(String(text||''), {
    x: xu * S, y: yb(yu, sz * 0.75),
    size: sz, font: bold ? B : R, color: rgb(0, 0, 0),
  });

  // Wipe the oversized DataMatrix from template
  // DataMatrix in template is at approximately x=168-297, y=7.5-11.5 (units)
  page.drawRectangle({
    x: 168, y: yb(11.5, 64), width: 129, height: 64,
    color: rgb(1, 1, 1), borderWidth: 0,
  });

  // ── CONSIGNEE ─────────────────────────────────────────────
  T(parcel.name    || '',                           0.65, 2.4,  13, true);
  T(parcel.address || '',                           0.65, 3.2,  13, true);
  T(`${parcel.city||''} ${parcel.zipcode||''}`,     0.65, 3.9,  13, true);
  T(parcel.country || '',                           0.65, 4.6,  13, true);

  // ── REFERENCES ────────────────────────────────────────────
  T(parcel.reference  || '', 0.63, 8.55, 10, true);
  T(parcel.reference2 || '', 0.63, 9.65, 10, true);

  // ── DELIVERY + WEIGHT ────────────────────────────────────
  T('1 / 1',                    8.7, 8.55, 14, true);
  T(`${parcel.weight||'0'} kg`, 8.5, 9.65, 14, true);

  // ── DATAMATRIX (correct size, right column) ───────────────
  const dm = await makeDataMatrix(tracking + 'DE');
  if (dm) {
    const dmImg = await pdfDoc.embedPng(dm);
    // Place in right column, next to barcode area — approx x=170, y=10.5 to 13.0
    page.drawImage(dmImg, {
      x: 172, y: yb(13.0, 40), width: 40, height: 40,
    });
  }

  // ── SMALL BARCODE ─────────────────────────────────────────
  const bar1 = await makeBarcode(tracking, 11);
  if (bar1) {
    const img1 = await pdfDoc.embedPng(bar1);
    page.drawImage(img1, {
      x: 6, y: yb(13.2, 36), width: 160, height: 36,
    });
  }

  // ── LARGE TRACKING NUMBER ─────────────────────────────────
  T(tracking.slice(0, 4),  0.9,  15.2, 25, true);
  T(tracking.slice(4),     4.6,  15.4, 19, true);
  T('DE',                  11.2, 15.5, 14, true);

  // ── LARGE ROUTING BARCODE ────────────────────────────────
  const routingCode = `0077339${tracking}W`;
  const bar2 = await makeBarcode(routingCode, 20);
  if (bar2) {
    const img2 = await pdfDoc.embedPng(bar2);
    page.drawImage(img2, {
      x: 5, y: yb(25.6, 100), width: 287, height: 100,
    });
  }

  // ── ROUTING NUMBER TEXT (centered under barcode) ──────────
  const rd = `0077 339 ${tracking.slice(0,4)} ${tracking.slice(4,8)} ${tracking.slice(8,12)} ${tracking.slice(12)} W`;
  const rdWidth = rd.length * 4.2;
  page.drawText(rd, {
    x: Math.max(5, (297 - rdWidth) / 2),
    y: yb(25.65, 7),
    size: 7, font: R, color: rgb(0, 0, 0),
  });

  return Buffer.from(await pdfDoc.save());
}

async function generateDpdLabels(parcels) {
  const { PDFDocument: PDFLib } = require('pdf-lib');
  const merged = await PDFLib.create();
  for (const p of parcels) {
    const buf = await generateDpdLabel(p);
    const src = await PDFLib.load(buf);
    const [pg] = await merged.copyPages(src, [0]);
    merged.addPage(pg);
  }
  return Buffer.from(await merged.save());
}

module.exports = { generateDpdLabel, generateDpdLabels };
