/**
 * Client-side manifest validation for customs compliance.
 * Validates required fields, MAWB match, EU country codes, IOSS format, etc.
 */

const EU_COUNTRIES = new Set([
  'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR','HU',
  'IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK',
]);

const FORBIDDEN_CHARS = /[^\u0000-\u024F\s\d'.,\-\/()#&@+:;!?"°²³€£$%*=~^{}[\]|\\<>]/g;

export interface ManifestValidationResult {
  errors: string[];
  warnings: string[];
  fixedRows: any[][];
}

function findCol(headers: string[], ...candidates: string[]): number {
  for (const c of candidates) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(c.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

function colLetter(idx: number): string {
  let s = '';
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function normalizeIoss(raw: string): { value: string; changed: boolean } {
  if (!raw) return { value: '', changed: false };
  const stripped = raw.replace(/[\s\-._]/g, '').toUpperCase();
  // Already correct: IM + 10 digits
  if (/^IM\d{10}$/.test(stripped)) {
    return stripped !== raw ? { value: stripped, changed: true } : { value: raw, changed: false };
  }
  // Has digits but wrong prefix
  const digits = stripped.replace(/\D/g, '');
  if (digits.length === 10) {
    return { value: `IM${digits}`, changed: true };
  }
  if (digits.length === 12 && stripped.startsWith('IM')) {
    return { value: `IM${digits.slice(0, 10)}`, changed: true };
  }
  return { value: raw, changed: false };
}

function stripForbiddenChars(val: string): { value: string; changed: boolean } {
  const cleaned = val.replace(FORBIDDEN_CHARS, '').replace(/\s{2,}/g, ' ').trim();
  return { value: cleaned, changed: cleaned !== val };
}

export function validateManifestForCustoms(
  header: any[],
  rows: any[][],
  mawb: string,
): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fixedRows = rows.map(r => [...r]);

  const headers = header.map((h: any) => String(h).trim());

  // Find required columns
  const orderCol = findCol(headers, 'ordernumber', 'order');
  const parcelCol = findCol(headers, 'parcelbarcode', 'parcel');
  const boxCol = findCol(headers, 'boxbagbarcode', 'boxbag', 'outer');
  const waybillCol = findCol(headers, 'waybill');
  const nameCol = findCol(headers, 'namereceiver', 'receiver', 'name');
  const addressCol = findCol(headers, 'addressreceiver', 'address');
  const cityCol = findCol(headers, 'cityreceiver', 'city');
  const zipCol = findCol(headers, 'zipcodereceiver', 'zipcode', 'zip');
  const countryCol = findCol(headers, 'countrycodereceiver', 'countrycode', 'country');
  const descCol = findCol(headers, 'productdescription', 'description', 'product');
  const weightCol = headers.findIndex(h => /^total\s*weight$/i.test(h.trim()) || h.toLowerCase() === 'totalweight' || h.toLowerCase() === 'total_weight');
  const qtyCol = findCol(headers, 'quantity', 'qty');
  const totalValueCol = headers.findIndex(h => /^total\s*value$/i.test(h.trim()) || h.toLowerCase() === 'totalvalue' || h.toLowerCase() === 'total_value');
  const skuCol = findCol(headers, 'sku');
  const iossCol = findCol(headers, 'ioss');
  const csorNameCol = findCol(headers, 'csor_name', 'csorname');
  const csorPostcodeCol = findCol(headers, 'csor_postcode', 'csorpostcode');
  const csorCountryCol = findCol(headers, 'csor_country', 'csorcountry');

  // Column presence checks
  const requiredCols: [number, string][] = [
    [parcelCol, 'ParcelBarcode'],
    [boxCol, 'BoxBagbarcode'],
    [waybillCol, 'Waybill'],
    [countryCol, 'Countrycode'],
    [weightCol, 'Total weight'],
    [qtyCol, 'Quantity'],
    [totalValueCol, 'Total value'],
    [skuCol, 'SKU'],
    [iossCol, 'IOSS'],
    [csorNameCol, 'CSOR_NAME'],
    [csorPostcodeCol, 'CSOR_POSTCODE'],
    [csorCountryCol, 'CSOR_COUNTRY'],
  ];

  for (const [idx, name] of requiredCols) {
    if (idx < 0) {
      errors.push(`Missing required column: ${name}`);
    }
  }

  if (errors.length > 0) {
    // Can't validate rows if columns are missing
    return { errors, warnings, fixedRows };
  }

  const mawbDigits = mawb.replace(/\D/g, '');

  for (let i = 0; i < fixedRows.length; i++) {
    const row = fixedRows[i];
    if (!row || row.every((c: any) => c === '' || c == null)) continue;
    const rowNum = i + 2; // 1-based + header row

    // MAWB match: check col A (order number) or first column
    if (orderCol >= 0) {
      const orderVal = String(row[orderCol] || '').replace(/\D/g, '');
      if (orderVal && mawbDigits && orderVal !== mawbDigits) {
        errors.push(`Row ${rowNum}, Column ${colLetter(orderCol)} (OrderNumber): MAWB mismatch — expected ${mawb}, got ${row[orderCol]}`);
      }
    }

    // Required field checks (non-empty)
    const fieldChecks: [number, string][] = [
      [parcelCol, 'ParcelBarcode'],
      [boxCol, 'BoxBagbarcode'],
      [waybillCol, 'Waybill'],
      [countryCol, 'Countrycode'],
      [skuCol, 'SKU'],
      [csorNameCol, 'CSOR_NAME'],
      [csorPostcodeCol, 'CSOR_POSTCODE'],
      [csorCountryCol, 'CSOR_COUNTRY'],
    ];
    for (const [col, name] of fieldChecks) {
      const val = String(row[col] || '').trim();
      if (!val) {
        errors.push(`Row ${rowNum}, Column ${colLetter(col)} (${name}): Required field is empty`);
      }
    }

    // Numeric required fields
    if (weightCol >= 0) {
      const w = parseFloat(String(row[weightCol] || ''));
      if (isNaN(w) || w <= 0) {
        errors.push(`Row ${rowNum}, Column ${colLetter(weightCol)} (Total weight): Must be a positive number`);
      }
    }
    if (qtyCol >= 0) {
      const q = parseInt(String(row[qtyCol] || ''));
      if (isNaN(q) || q < 1) {
        errors.push(`Row ${rowNum}, Column ${colLetter(qtyCol)} (Quantity): Must be at least 1`);
      }
    }
    if (totalValueCol >= 0) {
      const v = parseFloat(String(row[totalValueCol] || ''));
      if (isNaN(v) || v <= 0) {
        errors.push(`Row ${rowNum}, Column ${colLetter(totalValueCol)} (Total value): Must be a positive number`);
      }
    }

    // EU country whitelist
    if (countryCol >= 0) {
      const country = String(row[countryCol] || '').trim().toUpperCase();
      if (country && !EU_COUNTRIES.has(country)) {
        errors.push(`Row ${rowNum}, Column ${colLetter(countryCol)} (Countrycode): "${country}" is not in the EU whitelist`);
      }
    }

    // IOSS validation + auto-fix
    if (iossCol >= 0) {
      const rawIoss = String(row[iossCol] || '').trim();
      if (!rawIoss) {
        errors.push(`Row ${rowNum}, Column ${colLetter(iossCol)} (IOSS): Required field is empty`);
      } else {
        const { value: normalizedIoss, changed } = normalizeIoss(rawIoss);
        if (changed) {
          fixedRows[i][iossCol] = normalizedIoss;
          warnings.push(`Row ${rowNum}, Column ${colLetter(iossCol)} (IOSS): Auto-normalized "${rawIoss}" → "${normalizedIoss}"`);
        }
        if (!/^IM\d{10}$/.test(normalizedIoss)) {
          errors.push(`Row ${rowNum}, Column ${colLetter(iossCol)} (IOSS): Must be "IM" + 10 digits, got "${normalizedIoss}"`);
        }
      }
    }

    // Strip forbidden characters from address fields
    const addressFields: [number, string][] = [
      [nameCol, 'Namereceiver'],
      [addressCol, 'Addressreceiver'],
      [cityCol, 'Cityreceiver'],
    ];
    for (const [col, name] of addressFields) {
      if (col < 0) continue;
      const val = String(row[col] || '');
      const { value: cleaned, changed } = stripForbiddenChars(val);
      if (changed) {
        fixedRows[i][col] = cleaned;
        warnings.push(`Row ${rowNum}, Column ${colLetter(col)} (${name}): Stripped forbidden characters`);
      }
    }
  }

  return { errors, warnings, fixedRows };
}
