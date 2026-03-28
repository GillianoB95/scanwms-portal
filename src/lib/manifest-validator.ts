/**
 * Client-side manifest validation for customs compliance.
 * Column-based validation using fixed column indices (A=0, B=1, etc.).
 */

const ALLOWED_COUNTRIES = new Set([
  'NL','AL','BA','SE','HR','RS','GR','FR','PL','UA','LI','RO','AT','DK','MT',
  'ES','LT','BE','MD','BG','LV','SM','MK','SI','IS','BY','CY','LU','ME','PT',
  'FI','IE','AD','EU','VA','MC','CZ','IT','HU','DE','EE','SK',
]);

const BARCODE_FORBIDDEN = /[!@#$%^&*()\\_+{}\[\]\\|?\/><\*\-\+]/g;

export interface ManifestValidationResult {
  errors: string[];
  warnings: string[];
  fixedRows: any[][];
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
  if (/^IM\d{10}$/.test(stripped)) {
    return stripped !== raw ? { value: stripped, changed: true } : { value: raw, changed: false };
  }
  const digits = stripped.replace(/\D/g, '');
  if (digits.length === 10) return { value: `IM${digits}`, changed: true };
  if (digits.length === 12 && stripped.startsWith('IM')) return { value: `IM${digits.slice(0, 10)}`, changed: true };
  return { value: raw, changed: false };
}

/**
 * Validate manifest using fixed column positions:
 * A=0 OrderNumber, B=1 ParcelBarcode, C=2 BoxBagbarcode, D=3 Waybill,
 * L=11 Countrycodereceiver, M=12 Productdescription, N=13 Total weight,
 * R=17 Quantity, T=19 Total value, U=20 SKU, V=21 Hscode,
 * X=23 Shipper IOSS, AH=33 CSOR_NAME, AM=38 CSOR_POSTCODE, AN=39 CSOR_COUNTRY
 */
export function validateManifestForCustoms(
  header: any[],
  rows: any[][],
  mawb: string,
): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fixedRows = rows.map(r => [...r]);

  const COL = {
    ORDER: 0,        // A
    PARCEL: 1,       // B
    BOXBAG: 2,       // C
    WAYBILL: 3,      // D
    COUNTRY: 11,     // L
    DESCRIPTION: 12, // M
    WEIGHT: 13,      // N
    QUANTITY: 17,     // R
    TOTAL_VALUE: 19,  // T
    SKU: 20,          // U
    HSCODE: 21,       // V
    IOSS: 23,         // X
    CSOR_NAME: 33,    // AH
    CSOR_POSTCODE: 38,// AM
    CSOR_COUNTRY: 39, // AN
  };

  const mawbDigits = mawb.replace(/\D/g, '');

  // Track parcel barcodes for duplicate detection
  const seenParcels = new Map<string, number>();

  for (let i = 0; i < fixedRows.length; i++) {
    const row = fixedRows[i];
    if (!row || row.every((c: any) => c === '' || c == null)) continue;
    const rowNum = i + 2; // 1-based + header row

    const val = (col: number) => String(row[col] ?? '').trim();

    // A - OrderNumber: must match MAWB
    if (mawbDigits) {
      const orderVal = val(COL.ORDER).replace(/\D/g, '');
      if (orderVal && orderVal !== mawbDigits) {
        errors.push(`Row ${rowNum}: Wrong manifest: order number ${val(COL.ORDER)} does not match shipment MAWB ${mawb}. Please upload the correct manifest file.`);
      }
    }

    // B - ParcelBarcode: required, no forbidden chars
    const parcel = val(COL.PARCEL);
    if (!parcel) {
      errors.push(`Row ${rowNum}, Column B (ParcelBarcode): Required field is empty`);
    } else if (BARCODE_FORBIDDEN.test(parcel)) {
      errors.push(`Row ${rowNum}, Column B (ParcelBarcode): ParcelBarcode contains forbidden characters — cannot auto-fix barcodes`);
    }

    // Duplicate parcel detection — silently rename
    if (parcel) {
      if (seenParcels.has(parcel)) {
        const newBarcode = `${parcel}_DUP${rowNum}`;
        fixedRows[i][COL.PARCEL] = newBarcode;
        // silent fix, no warning shown to customer
      } else {
        seenParcels.set(parcel, i);
      }
    }

    // C - BoxBagbarcode: required, no forbidden chars
    const box = val(COL.BOXBAG);
    if (!box) {
      errors.push(`Row ${rowNum}, Column C (BoxBagbarcode): Required field is empty`);
    } else if (BARCODE_FORBIDDEN.test(box)) {
      errors.push(`Row ${rowNum}, Column C (BoxBagbarcode): BoxBagbarcode contains forbidden characters — cannot auto-fix barcodes`);
    }

    // D - Waybill: required, no forbidden chars
    const waybill = val(COL.WAYBILL);
    if (!waybill) {
      errors.push(`Row ${rowNum}, Column D (Waybill): Required field is empty`);
    } else if (BARCODE_FORBIDDEN.test(waybill)) {
      errors.push(`Row ${rowNum}, Column D (Waybill): Waybill contains forbidden characters`);
    }

    // L - Countrycodereceiver: must be in allowed list
    const country = val(COL.COUNTRY).toUpperCase();
    if (!country) {
      errors.push(`Row ${rowNum}, Column L (Countrycodereceiver): Required field is empty`);
    } else if (!ALLOWED_COUNTRIES.has(country)) {
      errors.push(`Row ${rowNum}, Column L (Countrycodereceiver): Country code "${country}" is not in the list of allowed EU country codes`);
    }

    // M + V: at least one of description or HS code required
    const desc = val(COL.DESCRIPTION);
    const hscode = val(COL.HSCODE);
    if (!desc && !hscode) {
      errors.push(`Row ${rowNum}: Cannot upload this manifest because row is missing both a product description and an HS code — at least one is required`);
    }

    // N - Total weight: required, numeric
    const weightStr = val(COL.WEIGHT);
    const weight = parseFloat(weightStr.replace(',', '.'));
    if (!weightStr || isNaN(weight) || weight <= 0) {
      errors.push(`Row ${rowNum}, Column N (Total weight): Must be a positive number`);
    }

    // R - Quantity: required, numeric
    const qtyStr = val(COL.QUANTITY);
    const qty = parseInt(qtyStr);
    if (!qtyStr || isNaN(qty) || qty < 1) {
      errors.push(`Row ${rowNum}, Column R (Quantity): Must be at least 1`);
    }

    // T - Total value: required, numeric
    const totalValStr = val(COL.TOTAL_VALUE);
    const totalVal = parseFloat(totalValStr.replace(',', '.'));
    if (!totalValStr || isNaN(totalVal) || totalVal <= 0) {
      errors.push(`Row ${rowNum}, Column T (Total value): Must be a positive number`);
    }

    // U - SKU: required
    if (!val(COL.SKU)) {
      errors.push(`Row ${rowNum}, Column U (SKU): Required field is empty`);
    }

    // X - IOSS: required, IM + 10 digits (auto-normalize silently)
    const rawIoss = val(COL.IOSS);
    if (!rawIoss) {
      errors.push(`Row ${rowNum}, Column X (Shipper IOSS): Required field is empty`);
    } else {
      const { value: normalized, changed } = normalizeIoss(rawIoss);
      if (changed) {
        fixedRows[i][COL.IOSS] = normalized;
        // silent fix
      }
      if (!/^IM\d{10}$/.test(normalized)) {
        errors.push(`Row ${rowNum}, Column X (Shipper IOSS): Must be "IM" + 10 digits, got "${normalized}"`);
      }
    }

    // AH - CSOR_NAME: required
    if (!val(COL.CSOR_NAME)) {
      errors.push(`Row ${rowNum}, Column AH (CSOR_NAME): Required field is empty`);
    }

    // AM - CSOR_POSTCODE: required, min 4 chars
    const postcode = val(COL.CSOR_POSTCODE);
    if (!postcode) {
      errors.push(`Row ${rowNum}, Column AM (CSOR_POSTCODE): Required field is empty`);
    } else if (postcode.length < 4) {
      errors.push(`Row ${rowNum}, Column AM (CSOR_POSTCODE): Must be at least 4 characters`);
    }

    // AN - CSOR_COUNTRY: required
    if (!val(COL.CSOR_COUNTRY)) {
      errors.push(`Row ${rowNum}, Column AN (CSOR_COUNTRY): Required field is empty`);
    }
  }

  return { errors, warnings, fixedRows };
}
