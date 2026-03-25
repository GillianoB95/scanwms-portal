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

  // Helper to set cell value
  const set = (ref: string, val: string | number) => {
    ws[ref] = { t: typeof val === 'number' ? 'n' : 's', v: val };
  };

  // Sender (warehouse)
  set('B1', data.warehouseName);
  set('B2', data.warehouseStreet);
  set('B3', data.warehousePostalCity);
  set('B4', data.warehouseCountry);

  // Receiver (hub address)
  set('B7', data.hubName);
  set('B8', `${data.hubStreet} ${data.hubHouseNumber}`.trim());
  set('B9', `${data.hubPostalCode} ${data.hubCity}`.trim());
  set('B10', data.hubCountry);

  // Place of delivery
  set('B13', data.hubCity);
  set('D13', data.hubCountry);

  // Place/date of loading
  set('B18', `${data.warehouseCity}, ${data.warehouseCountry}`);
  set('H18', `Loading ref: ${data.truckReference}`);

  // Cargo lines (MAWB rows starting at row 26, max row 39)
  let totalColli = 0;
  let totalWeight = 0;
  const maxRow = 39;
  data.lines.forEach((line, i) => {
    const row = 26 + i;
    if (row > maxRow) return;
    set(cellRef('B', row), line.mawb);
    set(cellRef('D', row), `${line.colli} colli`);
    set(cellRef('G', row), line.weightKg);
    set(cellRef('H', row), 'KG');
    totalColli += line.colli;
    totalWeight += line.weightKg;
  });

  // Totals
  set('B41', 'Totaal\t');
  set('D41', `${totalColli} colli`);
  set('G41', totalWeight);
  set('H41', 'KG');

  // Transport details
  set('B44', 'MRN :');
  set('B45', 'Ref: ');
  set('C45', data.truckReference);
  set('E45', data.outboundNumber);
  set('B46', 'Carnet');
  set('B47', 'Im-A / Ex-A');
  set('B48', 'Sealnr');
  set('C48', data.sealNumber);

  // Footer
  set('B57', data.warehouseCity);
  set('B59', data.warehouseName);
  set('B60', data.warehouseStreet);
  set('B61', data.warehousePostalCity);

  // Set sheet range to cover all used cells
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
