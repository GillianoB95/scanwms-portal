import * as XLSX from 'xlsx';

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

export async function printCmrViaPrintNode(
  wb: XLSX.WorkBook,
  printerId: string,
  printerKey: string,
  title: string,
  copies: number = 4,
): Promise<{ success: boolean; jobId?: number; error?: string }> {
  try {
    const xlsxData = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });

    const printJob = {
      printerId: parseInt(printerId),
      title,
      contentType: 'raw_base64',
      content: xlsxData,
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
