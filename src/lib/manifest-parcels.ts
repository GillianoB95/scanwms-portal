import { supabase } from '@/lib/supabase';

/**
 * Check if a parcel barcode exists in the manifest_parcels table for a given shipment.
 */
export async function checkParcelInManifest(shipmentId: string, parcelBarcode: string): Promise<boolean> {
  const { count } = await supabase
    .from('manifest_parcels')
    .select('id', { count: 'exact', head: true })
    .eq('shipment_id', shipmentId)
    .ilike('parcel_barcode', parcelBarcode);
  return (count ?? 0) > 0;
}

/**
 * Check multiple parcel barcodes against manifest_parcels for a given shipment.
 * Returns the set of barcodes that were NOT found.
 */
export async function findInvalidParcels(shipmentId: string, barcodes: string[]): Promise<string[]> {
  const { data } = await supabase
    .from('manifest_parcels')
    .select('parcel_barcode')
    .eq('shipment_id', shipmentId)
    .in('parcel_barcode', barcodes);

  const found = new Set((data ?? []).map((r: any) => r.parcel_barcode?.toUpperCase()));
  return barcodes.filter(b => !found.has(b.toUpperCase()));
}
