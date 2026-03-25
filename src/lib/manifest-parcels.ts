import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';

/**
 * Fetch all parcel barcodes from the manifest file for a given shipment.
 * Returns a Set of uppercase parcel barcodes.
 */
export async function fetchManifestParcelBarcodes(shipmentId: string): Promise<Set<string>> {
  const parcelSet = new Set<string>();

  const { data: files } = await supabase
    .from('shipment_files')
    .select('storage_path')
    .eq('shipment_id', shipmentId)
    .eq('file_type', 'manifest_cleaned')
    .order('uploaded_at', { ascending: false })
    .limit(1);

  if (!files || files.length === 0) return parcelSet;

  const { data: blob, error } = await supabase.storage
    .from('shipment-files')
    .download(files[0].storage_path);

  if (error || !blob) return parcelSet;

  try {
    const arrayBuffer = await blob.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (rows.length < 2) return parcelSet;

    const header = rows[0].map((h: any) => String(h).trim().toLowerCase());
    const pIdx = header.findIndex(h => h.includes('parcelbarcode') || h.includes('parcel') || h === 'barcode');
    if (pIdx < 0) return parcelSet;

    for (let i = 1; i < rows.length; i++) {
      const parcelBarcode = String(rows[i][pIdx] || '').trim();
      if (parcelBarcode) {
        parcelSet.add(parcelBarcode.toUpperCase());
      }
    }
  } catch {
    // parsing failed — return empty set
  }

  return parcelSet;
}
