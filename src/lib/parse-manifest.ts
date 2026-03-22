/**
 * Client-side manifest XLS/XLSX parser.
 * Reads the spreadsheet and returns structured row data + validation results.
 */
import * as XLSX from 'xlsx';

export interface ManifestRow {
  rowNum: number;
  receiver: string;
  address: string;
  value: number;
  weight: number;
  hub: string;
  box: string;
  waybill: string;
}

export interface ManifestSummary {
  totalParcels: number;
  totalWeight: number;
  rows: ManifestRow[];
}

export interface ManifestValidation {
  errors: { message: string }[];
  warnings: { message: string }[];
}

function findCol(headers: string[], ...candidates: string[]): number {
  for (const c of candidates) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(c.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

export async function parseManifest(file: File): Promise<ManifestSummary> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const json: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (json.length < 2) {
    return { totalParcels: 0, totalWeight: 0, rows: [] };
  }

  const headers = json[0].map((h: any) => String(h).trim());
  const receiverCol = findCol(headers, 'receiver', 'ontvanger', 'consignee', 'naam', 'name');
  const addressCol = findCol(headers, 'address', 'adres', 'street');
  const valueCol = findCol(headers, 'value', 'waarde', 'amount', 'bedrag');
  const weightCol = findCol(headers, 'weight', 'gewicht', 'kg', 'mass');
  const hubCol = findCol(headers, 'hub', 'depot', 'sorteer');
  const boxCol = findCol(headers, 'box', 'doos', 'collo', 'outerbox', 'outer');
  const waybillCol = findCol(headers, 'waybill', 'awb', 'vrachtbrief', 'tracking');

  const rows: ManifestRow[] = [];
  let totalWeight = 0;

  for (let i = 1; i < json.length; i++) {
    const row = json[i];
    if (!row || row.every((cell: any) => cell === '' || cell === null || cell === undefined)) continue;

    const weight = weightCol >= 0 ? parseFloat(String(row[weightCol])) || 0 : 0;
    totalWeight += weight;

    rows.push({
      rowNum: i + 1,
      receiver: receiverCol >= 0 ? String(row[receiverCol]).trim() : '',
      address: addressCol >= 0 ? String(row[addressCol]).trim() : '',
      value: valueCol >= 0 ? parseFloat(String(row[valueCol])) || 0 : 0,
      weight,
      hub: hubCol >= 0 ? String(row[hubCol]).trim() : '',
      box: boxCol >= 0 ? String(row[boxCol]).trim() : '',
      waybill: waybillCol >= 0 ? String(row[waybillCol]).trim() : '',
    });
  }

  return { totalParcels: rows.length, totalWeight, rows };
}

export function validateManifest(summary: ManifestSummary, mawb: string): ManifestValidation {
  const errors: { message: string }[] = [];
  const warnings: { message: string }[] = [];

  // 1. MAWB format check: XXX-XXXXXXXX (11 digits)
  const mawbDigits = mawb.replace(/\D/g, '');
  if (mawbDigits.length !== 11) {
    errors.push({ message: `MAWB must be 11 digits (XXX-XXXXXXXX). Got ${mawbDigits.length} digits.` });
  }

  // 2. Receiver+address value cap: no combination > €150
  const receiverTotals = new Map<string, number>();
  for (const row of summary.rows) {
    if (!row.receiver && !row.address) continue;
    const key = `${row.receiver.toLowerCase()}|${row.address.toLowerCase()}`;
    receiverTotals.set(key, (receiverTotals.get(key) || 0) + row.value);
  }
  for (const [key, total] of receiverTotals) {
    if (total > 150) {
      const [receiver, address] = key.split('|');
      errors.push({
        message: `Receiver "${receiver}" at "${address}" has total value €${total.toFixed(2)} (exceeds €150 limit)`,
      });
    }
  }

  // 3. Same box must have same hub
  const boxHubs = new Map<string, Set<string>>();
  for (const row of summary.rows) {
    if (!row.box) continue;
    if (!boxHubs.has(row.box)) boxHubs.set(row.box, new Set());
    if (row.hub) boxHubs.get(row.box)!.add(row.hub);
  }
  for (const [box, hubs] of boxHubs) {
    if (hubs.size > 1) {
      errors.push({
        message: `Box "${box}" contains mixed hubs: ${[...hubs].join(', ')}. All items in a box must go to the same hub.`,
      });
    }
  }

  return { errors, warnings };
}
