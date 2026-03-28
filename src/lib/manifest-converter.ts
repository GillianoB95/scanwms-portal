/**
 * Client-side manifest converter — transforms manifest to customs format.
 * Splits rows by quantity: qty=5 → 5 rows each with qty=1.
 * Weight per unit = total weight / qty
 * Price per unit = total value / qty
 * First pass: one row per parcel in original order
 * Second pass: extra rows for qty > 1 appended at end
 */
import * as XLSX from 'xlsx';

function findCol(headers: string[], ...candidates: string[]): number {
  for (const c of candidates) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(c.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

export function convertManifestToCustoms(
  header: any[],
  rows: any[][],
): { convertedHeader: any[]; convertedRows: any[][] } {
  const headers = header.map((h: any) => String(h).trim());

  const weightCol = headers.findIndex(h =>
    /^total\s*weight$/i.test(h.trim()) || h.toLowerCase() === 'totalweight' || h.toLowerCase() === 'total_weight'
  );
  const productWeightCol = headers.findIndex(h =>
    /^product\s*weight$/i.test(h.trim()) || h.toLowerCase() === 'productweight' || h.toLowerCase() === 'product_weight'
  );
  const unitPriceCol = findCol(headers, 'unit price', 'unitprice', 'unit_price');
  const qtyCol = findCol(headers, 'quantity', 'qty');
  const totalValueCol = headers.findIndex(h =>
    /^total\s*value$/i.test(h.trim()) || h.toLowerCase() === 'totalvalue' || h.toLowerCase() === 'total_value'
  );
  const netWeightCol = findCol(headers, 'net weight', 'netweight', 'net_weight');

  const firstPass: any[][] = [];
  const secondPass: any[][] = [];

  for (const row of rows) {
    if (!row || row.every((c: any) => c === '' || c == null)) continue;

    const qty = qtyCol >= 0 ? (parseInt(String(row[qtyCol])) || 1) : 1;
    const totalWeight = weightCol >= 0 ? (parseFloat(String(row[weightCol])) || 0) : 0;
    const totalValue = totalValueCol >= 0 ? (parseFloat(String(row[totalValueCol])) || 0) : 0;

    const weightPerUnit = qty > 0 ? Math.round((totalWeight / qty) * 1000) / 1000 : totalWeight;
    const pricePerUnit = qty > 0 ? Math.round((totalValue / qty) * 100) / 100 : totalValue;

    // Build the base row with qty=1 and per-unit values
    const baseRow = [...row];
    if (qtyCol >= 0) baseRow[qtyCol] = 1;
    if (weightCol >= 0) baseRow[weightCol] = weightPerUnit;
    if (productWeightCol >= 0) baseRow[productWeightCol] = weightPerUnit;
    if (unitPriceCol >= 0) baseRow[unitPriceCol] = pricePerUnit;
    if (totalValueCol >= 0) baseRow[totalValueCol] = pricePerUnit; // qty=1, so total = unit
    if (netWeightCol >= 0) baseRow[netWeightCol] = weightPerUnit;

    // First pass: one row per parcel
    firstPass.push(baseRow);

    // Second pass: extra rows for qty > 1
    for (let i = 1; i < qty; i++) {
      secondPass.push([...baseRow]);
    }
  }

  return {
    convertedHeader: header,
    convertedRows: [...firstPass, ...secondPass],
  };
}

export function convertedRowsToXlsx(header: any[], rows: any[][]): Blob {
  const wb = XLSX.utils.book_new();
  const data = [header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(data);

  // Auto-size columns (approximate)
  const colWidths = header.map((_: any, i: number) => {
    let max = String(header[i] || '').length;
    for (const row of rows.slice(0, 50)) {
      const cellLen = String(row[i] || '').length;
      if (cellLen > max) max = cellLen;
    }
    return { wch: Math.min(max + 2, 30) };
  });
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, 'Customs Format');
  const xlsxBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([xlsxBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
