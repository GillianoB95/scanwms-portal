import * as XLSX from 'xlsx';
import { htmlToPdfBase64 } from './html-to-pdf';

export interface CmrData {
  // Warehouse (sender)
  warehouseName: string;
  warehouseStreet: string;
  warehousePostalCity: string;
  warehouseCountry: string;
  warehouseCity: string;
  // Hub address (receiver)
  hubName: string;
  hubStreet: string;
  hubHouseNumber: string;
  hubPostalCode: string;
  hubCity: string;
  hubCountry: string;
  // Outbound
  truckReference: string;
  outboundNumber: string;
  sealNumber: string;
  // Cargo lines: one per MAWB
  lines: { mawb: string; colli: number; weightKg: number }[];
}

function cellRef(col: string, row: number): string {
  return `${col}${row}`;
}

export function generateCmrWorkbook(data: CmrData): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const ws: XLSX.WorkSheet = {};

  // Helper to set cell with formatting — font: Calibri 11, optional bold, optional right-align
  const set = (ref: string, val: string | number, opts?: { bold?: boolean; alignRight?: boolean }) => {
    const cell: XLSX.CellObject = {
      t: typeof val === 'number' ? 'n' : 's',
      v: val,
    };
    const s: any = { font: { name: 'Calibri', sz: 11 } };
    if (opts?.bold) s.font.bold = true;
    if (opts?.alignRight) s.alignment = { horizontal: 'right' };
    cell.s = s;
    ws[ref] = cell;
  };

  // Sender (warehouse) — bold
  set('B1', data.warehouseName, { bold: true });
  set('B2', data.warehouseStreet, { bold: true });
  set('B3', data.warehousePostalCity, { bold: true });
  set('B4', data.warehouseCountry, { bold: true });

  // Receiver (hub address)
  set('B7', data.hubName);
  set('B8', `${data.hubStreet} ${data.hubHouseNumber}`.trim());
  set('B9', `${data.hubPostalCode} ${data.hubCity}`.trim());
  set('B10', data.hubCountry);

  // Place of delivery — bold
  set('B13', data.hubCity, { bold: true });
  set('D13', data.hubCountry, { bold: true });

  // Place/date of loading — bold
  const loadingPlace = [data.warehouseCity, data.warehouseCountry].filter(Boolean).join(', ');
  set('B18', loadingPlace, { bold: true });
  set('H18', `  Loading ref: ${data.truckReference}`, { bold: true });

  // Cargo lines (MAWB rows starting at row 26, max row 39)
  let totalColli = 0;
  let totalWeight = 0;
  const maxRow = 39;
  data.lines.forEach((line, i) => {
    const row = 26 + i;
    if (row > maxRow) return;
    set(cellRef('B', row), line.mawb);
    set(cellRef('D', row), `${line.colli} colli`, { alignRight: true });
    set(cellRef('G', row), line.weightKg, { alignRight: true });
    set(cellRef('H', row), 'KG');
    totalColli += line.colli;
    totalWeight += line.weightKg;
  });

  // Totals
  set('B41', 'Totaal\t', { bold: true });
  set('D41', `${totalColli} colli`, { bold: true, alignRight: true });
  set('G41', totalWeight, { alignRight: true });
  set('H41', 'KG', { bold: true });

  // Transport details
  set('B44', 'MRN :');
  set('B45', 'Ref: ');
  set('C45', data.truckReference);
  set('E45', data.outboundNumber);
  set('B46', 'Carnet');
  set('B47', 'Im-A / Ex-A');
  set('B48', 'Sealnr');
  set('C48', data.sealNumber);

  // Footer — bold
  set('B57', data.warehouseCity, { bold: true });
  set('B59', data.warehouseName, { bold: true });
  set('B60', data.warehouseStreet, { bold: true });
  set('B61', data.warehousePostalCity, { bold: true });

  // Column widths (match template)
  ws['!cols'] = [
    { wch: 2 },   // A
    { wch: 22 },  // B
    { wch: 8.43 },// C (default)
    { wch: 16 },  // D
    { wch: 6 },   // E
    { wch: 8.43 },// F (default)
    { wch: 17 },  // G
    { wch: 19 },  // H
  ];

  // Set sheet range
  ws['!ref'] = 'A1:I61';

  XLSX.utils.book_append_sheet(wb, ws, 'CMR');
  return wb;
}

export function downloadCmrWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename);
}

// Render the same worksheet used for XLSX downloads as a printable A4 page.
function renderCmrWorksheet(wb: XLSX.WorkBook): HTMLElement {
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws?.['!ref']) throw new Error('CMR workbook is empty');

  const range = XLSX.utils.decode_range(ws['!ref']);
  const root = document.createElement('div');
  const style = document.createElement('style');
  style.textContent = `
    .cmr-print { width: 190mm; font: 8pt Arial, sans-serif; color: #000; }
    .cmr-print table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .cmr-print td { height: 4.3mm; padding: 0 0.7mm; white-space: nowrap; vertical-align: middle; }
  `;
  root.appendChild(style);

  const page = document.createElement('div');
  page.className = 'cmr-print';
  const table = document.createElement('table');
  const cols = document.createElement('colgroup');
  const widths = Array.from({ length: range.e.c - range.s.c + 1 }, (_, i) =>
    ws['!cols']?.[range.s.c + i]?.wch ?? 8.43,
  );
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  widths.forEach(width => {
    const col = document.createElement('col');
    col.style.width = `${(width / totalWidth) * 100}%`;
    cols.appendChild(col);
  });
  table.appendChild(cols);

  const body = document.createElement('tbody');
  for (let row = range.s.r; row <= range.e.r; row++) {
    const tr = document.createElement('tr');
    for (let column = range.s.c; column <= range.e.c; column++) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: column })];
      const td = document.createElement('td');
      if (cell?.v != null) td.textContent = String(cell.v);
      if (cell?.s?.font?.bold) td.style.fontWeight = 'bold';
      if (cell?.s?.alignment?.horizontal === 'right') td.style.textAlign = 'right';
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  table.appendChild(body);
  page.appendChild(table);
  root.appendChild(page);
  return root;
}

export async function printCmrViaPrintNode(
  wb: XLSX.WorkBook,
  printerId: string,
  printerKey: string,
  title: string,
  copies: number = 4,
): Promise<{ success: boolean; jobId?: number; error?: string }> {
  try {
    const pdfBase64 = await htmlToPdfBase64(renderCmrWorksheet(wb), 'a4', 10);

    const printJob = {
      printerId: parseInt(printerId),
      title,
      contentType: 'pdf_base64',
      content: pdfBase64,
      source: 'SCANWMS-CMR',
      options: { copies },
    };

    const response = await fetch('https://api.printnode.com/printjobs', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(printerKey + ':')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(printJob),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`PrintNode error: ${error}`);
    }

    const jobId = await response.json();
    return { success: true, jobId };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
