import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, ArrowLeft, ArrowRight, Plane, Truck, AlertTriangle, XCircle, CheckCircle2, Loader2, Mail } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useSubklanten } from '@/hooks/use-shipment-data';
import { useHubs } from '@/hooks/use-hubs';
import { parseAwbPdf, type AwbParsedData } from '@/lib/parse-awb';
import { validateManifestForCustoms } from '@/lib/manifest-validator';
import { convertManifestToCustoms, convertedRowsToXlsx } from '@/lib/manifest-converter';

import * as XLSX from 'xlsx';
import { Progress } from '@/components/ui/progress';

type Step = 1 | 2;

interface ManifestResult {
  totalParcels: number;
  totalWeight: number;
  errors: string[];
  warnings: string[];
  parsedRows: ManifestParsedRow[];
  rawHeader?: any[];
  rawRows?: any[][];
}

interface ManifestParsedRow {
  parcel_barcode: string;
  outerbox_barcode: string | null;
  order_number: string | null;
  waybill: string | null;
  receiver_name: string | null;
  total_weight: number | null;
  product_weight: number | null;
  quantity: number | null;
  destination_country: string | null;
}

export default function NewShipment() {
  const navigate = useNavigate();
  const { user, customer, role } = useAuth();
  const isStaffUser = role === 'staff' || role === 'admin';
  const { data: subklanten = [] } = useSubklanten();
  const { data: activeHubCodes = [] } = useHubs();

  // For parent accounts: fetch child customers (sub clients)
  const isParentAccount = !isStaffUser && !!customer && !customer.parent_id;
  const [childCustomers, setChildCustomers] = useState<any[]>([]);
  const [selectedChildId, setSelectedChildId] = useState('');

  useEffect(() => {
    if (!customer?.id) return;
    // Fetch child customers for any non-staff user without a parent_id
    console.log('[NewShipment] Checking for child customers', { customerId: customer.id, parentId: customer.parent_id, isParentAccount });
    if (!isParentAccount) return;
    supabase
      .from('customers')
      .select('id, name, warehouse_id')
      .eq('parent_id', customer.id)
      .order('name')
      .then(({ data, error }) => {
        console.log('[NewShipment] Child customers result', { data, error });
        setChildCustomers(data || []);
      });
  }, [isParentAccount, customer?.id]);

  const [step, setStep] = useState<Step>(1);
  const [mawb, setMawb] = useState('');
  const [subklantId, setSubklantId] = useState('');
  const [awbFile, setAwbFile] = useState<File | null>(null);
  const [manifestFile, setManifestFile] = useState<File | null>(null);

  const [awbExtracting, setAwbExtracting] = useState(false);
  const [awbData, setAwbData] = useState<AwbParsedData | null>(null);
  const [awbError, setAwbError] = useState<string | null>(null);
  const [awbManualMode, setAwbManualMode] = useState(false);
  const [manualColli, setManualColli] = useState('');
  const [manualGrossWeight, setManualGrossWeight] = useState('');
  const [manualChargeableWeight, setManualChargeableWeight] = useState('');

  const [manifestProcessing, setManifestProcessing] = useState(false);
  const [manifestResult, setManifestResult] = useState<ManifestResult | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [manifestProgress, setManifestProgress] = useState<string | null>(null);

  const [duplicateMawb, setDuplicateMawb] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Auto-set subklantId for customer users (non-staff)
  const isSubAccount = !!customer?.parent_id;
  useEffect(() => {
    if (isStaffUser) return;
    if (subklanten.length > 0 && !subklantId) {
      if (isSubAccount) {
        const match = subklanten.find((s: any) =>
          s.name?.toLowerCase() === customer?.name?.toLowerCase()
        );
        if (match) setSubklantId(match.id);
        else if (subklanten.length === 1) setSubklantId(subklanten[0].id);
      } else {
        if (subklanten.length === 1) setSubklantId(subklanten[0].id);
      }
    }
  }, [isStaffUser, isSubAccount, subklanten, customer?.name, subklantId]);

  const formatMawb = useCallback((val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 3) return digits;
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }, []);

  // AWB extraction
  useEffect(() => {
    if (!awbFile) { setAwbData(null); setAwbError(null); setAwbManualMode(false); return; }
    let cancelled = false;
    setAwbExtracting(true);
    setAwbError(null);
    setAwbData(null);
    setAwbManualMode(false);

    parseAwbPdf(awbFile)
      .then((parsed) => {
        if (cancelled) return;
        setAwbData(parsed);
        if (parsed.mawb && !mawb) setMawb(parsed.mawb);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('AWB extraction failed:', err);
        setAwbManualMode(true);
        setAwbError('Could not extract AWB data automatically.');
      })
      .finally(() => { if (!cancelled) setAwbExtracting(false); });

    return () => { cancelled = true; };
  }, [awbFile]);

  // Client-side manifest parsing with validation
  useEffect(() => {
    if (!manifestFile) { setManifestResult(null); setManifestError(null); return; }
    let cancelled = false;
    setManifestProcessing(true);
    setManifestError(null);
    setManifestResult(null);

    (async () => {
      try {
        const arrayBuffer = await manifestFile.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        if (rows.length < 2) {
          if (!cancelled) setManifestResult({ totalParcels: 0, totalWeight: 0, errors: ['Manifest file is empty or has no data rows.'], warnings: [], parsedRows: [] });
          return;
        }

        const rawHeader = rows[0];
        const rawDataRows = rows.slice(1).filter(r => r && !r.every((c: any) => c === '' || c == null));
        const header = rawHeader.map((h: any) => String(h).trim().toLowerCase());

        // Run customs validation if we have a MAWB
        const currentMawb = mawb || '';
        const validation = validateManifestForCustoms(rawHeader, rawDataRows, currentMawb);

        const colIdx = (candidates: string[]) => header.findIndex(h => candidates.some(c => h.includes(c)));
        const orderCol = colIdx(['ordernumber', 'order']);
        const parcelCol = colIdx(['parcelbarcode', 'parcel']);
        const boxCol = colIdx(['boxbagbarcode', 'boxbag']);
        const waybillCol = colIdx(['waybill']);
        const receiverCol = colIdx(['namereceiver', 'receiver', 'name']);
        const totalWeightCol = header.findIndex(h => h === 'total weight' || h === 'totalweight' || h === 'total_weight' || h === 'weight' || h === 'gewicht');
        const productWeightCol = header.findIndex(h => h === 'product weight' || h === 'productweight' || h === 'product_weight');
        const quantityCol = colIdx(['quantity', 'qty']);
        const destCountryCol = colIdx(['destination country', 'destinationcountry', 'country']);

        if (parcelCol < 0) {
          if (!cancelled) setManifestResult({ totalParcels: 0, totalWeight: 0, errors: ['Could not find a "ParcelBarcode" or "Parcel" column in the manifest.'], warnings: [], parsedRows: [] });
          return;
        }

        // Use validated/fixed rows
        const dataRows = validation.fixedRows.length > 0 ? validation.fixedRows : rawDataRows;

        const parsedRows: ManifestParsedRow[] = [];
        let lastHub = '';
        for (let i = 0; i < dataRows.length; i++) {
          const r = dataRows[i];
          if (!r || r.every((c: any) => c === '' || c == null)) continue;
          const parcelBarcode = String(r[parcelCol] || '').trim();
          if (!parcelBarcode) continue;
          const boxBarcode = boxCol >= 0 ? String(r[boxCol] || '').trim() : '';
          const waybill = waybillCol >= 0 ? String(r[waybillCol] || '').trim() : '';
          if (waybill) lastHub = waybill;
          parsedRows.push({
            parcel_barcode: parcelBarcode,
            outerbox_barcode: boxBarcode || null,
            order_number: orderCol >= 0 ? String(r[orderCol] || '').trim() || null : null,
            waybill: waybill || lastHub || null,
            receiver_name: receiverCol >= 0 ? String(r[receiverCol] || '').trim() || null : null,
            total_weight: totalWeightCol >= 0 ? parseFloat(String(r[totalWeightCol] || '').replace(',', '.')) || null : null,
            product_weight: productWeightCol >= 0 ? parseFloat(String(r[productWeightCol] || '').replace(',', '.')) || null : null,
            quantity: quantityCol >= 0 ? parseInt(String(r[quantityCol] || '')) || null : null,
            destination_country: destCountryCol >= 0 ? String(r[destCountryCol] || '').trim() || null : null,
          });
        }

        if (!cancelled) {
          setManifestResult({
            totalParcels: parsedRows.length,
            totalWeight: parsedRows.reduce((sum, r) => sum + (r.total_weight || 0), 0),
            errors: validation.errors,
            warnings: validation.warnings,
            parsedRows,
            rawHeader,
            rawRows: dataRows,
          });
        }
      } catch (err: any) {
        if (!cancelled) setManifestError('Could not parse manifest. Please check the file format.');
      } finally {
        if (!cancelled) setManifestProcessing(false);
      }
    })();

    return () => { cancelled = true; };
  }, [manifestFile, mawb]);

  // Duplicate MAWB check
  useEffect(() => {
    const digits = mawb.replace(/\D/g, '');
    if (digits.length !== 11 || !customer?.id) { setDuplicateMawb(null); return; }
    let cancelled = false;
    supabase.from('shipments').select('id, mawb')
      .eq('customer_id', customer.id).eq('mawb', mawb).maybeSingle()
      .then(({ data }) => { if (cancelled) return; setDuplicateMawb(data ? `A shipment with MAWB ${mawb} already exists.` : null); });
    return () => { cancelled = true; };
  }, [mawb, customer?.id]);

  // Auto-populate manual fields when extraction succeeds
  useEffect(() => {
    if (awbData) {
      if (awbData.pieces != null) setManualColli(String(awbData.pieces));
      if (awbData.gross_weight != null) setManualGrossWeight(String(awbData.gross_weight));
      if (awbData.chargeable_weight != null) setManualChargeableWeight(String(awbData.chargeable_weight));
    }
    if (!awbData && awbManualMode) {
      setManualColli('0');
      setManualGrossWeight('0');
      setManualChargeableWeight('0');
    }
    if (!awbData && !awbManualMode) {
      setManualColli('');
      setManualGrossWeight('');
      setManualChargeableWeight('');
    }
  }, [awbData, awbManualMode]);

  const colli = manualColli !== '' ? (parseInt(manualColli) || 0) : 0;
  const grossWeight = manualGrossWeight !== '' ? (parseFloat(manualGrossWeight) || 0) : 0;
  const chargeableWeight = manualChargeableWeight !== '' ? (parseFloat(manualChargeableWeight) || 0) : 0;
  const manifestReady = (manifestResult?.parsedRows?.length ?? 0) > 0 && !manifestProcessing;
  const hasBlockingErrors = (manifestResult?.errors?.length ?? 0) > 0;

  const canProceed =
    mawb.replace(/\D/g, '').length === 11 &&
    awbFile &&
    manifestFile &&
    (!!subklantId || (!isStaffUser && subklanten.length === 0) || isParentAccount) &&
    (!isParentAccount || childCustomers.length === 0 || !!selectedChildId) &&
    manualColli !== '' && manualGrossWeight !== '' && manualChargeableWeight !== '' &&
    manifestReady &&
    !duplicateMawb &&
    !hasBlockingErrors;

  const handleCreate = async () => {
    if (!customer || !user?.email || !manifestResult?.parsedRows?.length) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const { data: existing } = await supabase.from('shipments').select('id, mawb')
        .eq('customer_id', customer.id).eq('mawb', mawb).maybeSingle();
      if (existing) { setSubmitError(`A shipment with MAWB ${mawb} already exists.`); setSubmitting(false); return; }

      const effectiveCustomerId = (isParentAccount && selectedChildId) ? selectedChildId : customer.id;
      const effectiveSubklantId = (isParentAccount && selectedChildId) ? selectedChildId : (subklantId || null);
      const effectiveWeight = Math.max(grossWeight, chargeableWeight);
      const selectedChild = (isParentAccount && selectedChildId)
        ? childCustomers.find((c: any) => c.id === selectedChildId)
        : null;
      const effectiveWarehouseId = selectedChild?.warehouse_id || customer.warehouse_id || null;

      const { data: shipment, error: shipErr } = await supabase.from('shipments').insert({
        customer_id: effectiveCustomerId,
        subklant_id: effectiveSubklantId,
        mawb,
        transport_type: 'AIR',
        colli_expected: colli,
        gross_weight: grossWeight,
        chargeable_weight: effectiveWeight,
        warehouse_id: effectiveWarehouseId,
        status: 'Awaiting NOA',
        parcels: manifestResult?.totalParcels || 0,
      }).select('id').single();

      if (shipErr) throw new Error(`Failed to create shipment: ${shipErr.message}`);
      const shipmentId = shipment.id;

      const { error: statusHistoryErr } = await supabase.from('shipment_status_history').insert({
        shipment_id: shipmentId, status: 'Awaiting NOA',
        changed_by: user.email, notes: 'Shipment created via portal',
      });
      if (statusHistoryErr) {
        console.error('[NewShipment] Failed to insert shipment status history', statusHistoryErr);
      }

      const uploadFile = async (file: File | Blob, fileType: string, filename: string) => {
        const storagePath = `shipments/${shipmentId}/${fileType}-${filename}`;
        const { error: uploadErr } = await supabase.storage.from('shipment-files').upload(storagePath, file, { upsert: true });
        if (uploadErr) {
          console.error(`[NewShipment] File upload failed (${fileType})`, uploadErr);
          return null;
        }

        const { error: insertErr } = await supabase
          .from('shipment_files')
          .insert({ shipment_id: shipmentId, file_type: fileType, storage_path: storagePath });
        if (insertErr) {
          console.error(`[NewShipment] shipment_files insert failed (${fileType})`, insertErr);
        }

        return storagePath;
      };

      try {
        if (awbFile) await uploadFile(awbFile, 'awb', awbFile.name);
      } catch (awbUploadErr) {
        console.error('[NewShipment] AWB upload step failed', awbUploadErr);
      }

      try {
        if (manifestFile) await uploadFile(manifestFile, 'manifest_original', manifestFile.name);
      } catch (manifestUploadErr) {
        console.error('[NewShipment] Original manifest upload step failed', manifestUploadErr);
      }

      try {
        const parcelRows = manifestResult.parsedRows;
        const { error: deleteErr } = await supabase.from('manifest_parcels').delete().eq('shipment_id', shipmentId);
        if (deleteErr) {
          console.error('[NewShipment] Failed to clear existing manifest_parcels', deleteErr);
        }

        const batchSize = 50;
        for (let i = 0; i < parcelRows.length; i += batchSize) {
          const batch = parcelRows.slice(i, i + batchSize).map(r => ({ shipment_id: shipmentId, ...r }));
          setManifestProgress(`Processing ${Math.min(i + batchSize, parcelRows.length)}/${parcelRows.length}...`);
          const { error: insertErr } = await supabase.from('manifest_parcels').insert(batch);
          if (insertErr) {
            console.error('[NewShipment] manifest_parcels batch insert failed', {
              startIndex: i,
              endIndex: Math.min(i + batchSize, parcelRows.length),
              error: insertErr,
            });
          }
        }
      } catch (manifestInsertErr) {
        console.error('[NewShipment] Manifest population step failed', manifestInsertErr);
      }

      if (manifestResult.rawHeader && manifestResult.rawRows) {
        setManifestProgress('Converting manifest to customs format...');
        try {
          const { convertedHeader, convertedRows } = convertManifestToCustoms(
            manifestResult.rawHeader,
            manifestResult.rawRows,
          );
          const convertedBlob = convertedRowsToXlsx(convertedHeader, convertedRows);
          const convertedFilename = `${mawb.replace(/\D/g, '')}_customs_converted.xlsx`;
          const convertedPath = await uploadFile(convertedBlob, 'manifest_converted', convertedFilename);

          if (convertedPath) {
            setManifestProgress('Sending converted manifest to customs...');
            try {
              await sendConvertedManifestEmail(shipmentId, effectiveCustomerId, mawb, convertedPath, user.email, effectiveWarehouseId);
            } catch (emailErr) {
              console.error('[NewShipment] Converted manifest email step failed', emailErr);
            }
          }
        } catch (convErr) {
          console.error('[NewShipment] Manifest conversion step failed', convErr);
        }
      }

      setManifestProgress(null);
      navigate(`/shipments/${shipmentId}`);
    } catch (err: any) {
      console.error('[NewShipment] Shipment creation failed', err);
      setSubmitError(err.message || 'Unknown error');
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">New Shipment</h1>
        <p className="text-muted-foreground text-sm mt-1">Create a new shipment in 2 steps</p>
      </div>

      <div className="flex items-center gap-3 animate-fade-in">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${step >= 1 ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}`}>
          <span className="h-5 w-5 rounded-full bg-accent-foreground/20 flex items-center justify-center text-xs">1</span>
          Details
        </div>
        <div className="w-8 h-px bg-border" />
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${step >= 2 ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}`}>
          <span className="h-5 w-5 rounded-full bg-accent-foreground/20 flex items-center justify-center text-xs">2</span>
          Review
        </div>
      </div>

      {step === 1 && (
        <div className="bg-card rounded-xl border p-6 space-y-5 animate-fade-in">
          <div>
            <label className="block text-sm font-medium mb-2">Transport Type</label>
            <div className="flex gap-2">
              <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-accent-foreground text-sm font-medium">
                <Plane className="h-4 w-4" /> AIR
              </button>
              <button disabled className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-muted text-muted-foreground text-sm font-medium opacity-60 cursor-not-allowed">
                <Truck className="h-4 w-4" /> TRUCK
                <span className="text-xs bg-muted-foreground/20 px-1.5 py-0.5 rounded">coming soon</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">MAWB Number</label>
            <input value={mawb} onChange={e => setMawb(formatMawb(e.target.value))} placeholder="XXX-XXXXXXXX"
              className="w-full h-10 px-3 rounded-lg border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring" />
            {duplicateMawb && (
              <div className="mt-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2 flex items-center gap-1.5">
                <XCircle className="h-4 w-4 shrink-0" /> {duplicateMawb}
              </div>
            )}
          </div>

          {isStaffUser && (
            <div>
              <label className="block text-sm font-medium mb-1.5">Sub Client</label>
              <select value={subklantId} onChange={e => setSubklantId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="">Select sub client...</option>
                {subklanten.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}

          {isParentAccount && childCustomers.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1.5">Sub Client</label>
              <select value={selectedChildId} onChange={e => setSelectedChildId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="">Select sub client...</option>
                {childCustomers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UploadZone label="Air Waybill (PDF)" accept=".pdf" file={awbFile} onFile={setAwbFile} />
            <UploadZone label="Manifest (XLS/XLSX)" accept=".xls,.xlsx" file={manifestFile} onFile={setManifestFile} />
          </div>

          {awbExtracting && <div className="flex items-center gap-2 text-sm text-muted-foreground animate-fade-in"><Loader2 className="h-4 w-4 animate-spin" /> Extracting AWB data...</div>}
          {awbError && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2 animate-fade-in flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 shrink-0" />{awbError}</div>}
          
          {awbFile && (
            <div className="bg-muted/40 rounded-lg p-4 space-y-3 animate-fade-in">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {awbData ? 'Extracted from AWB' : 'AWB Data — enter manually'}
                </p>
                {awbExtracting && <div className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Extracting...</div>}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Colli (pieces)</label>
                  <input type="number" min="0" value={manualColli} onChange={e => { if (!awbData?.pieces) setManualColli(e.target.value); }} readOnly={!!awbData?.pieces} placeholder="0"
                    className={`w-full h-9 px-2.5 rounded-md border text-sm tabular-nums font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring ${awbData?.pieces ? 'bg-muted/50 cursor-not-allowed' : 'bg-background'}`} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Gross Weight (kg)</label>
                  <input type="number" min="0" step="0.01" value={manualGrossWeight} onChange={e => { if (!awbData?.gross_weight) setManualGrossWeight(e.target.value); }} readOnly={!!awbData?.gross_weight} placeholder="0"
                    className={`w-full h-9 px-2.5 rounded-md border text-sm tabular-nums font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring ${awbData?.gross_weight ? 'bg-muted/50 cursor-not-allowed' : 'bg-background'}`} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Chargeable Weight (kg)</label>
                  <input type="number" min="0" step="0.01" value={manualChargeableWeight} onChange={e => { if (!awbData?.chargeable_weight) setManualChargeableWeight(e.target.value); }} readOnly={!!awbData?.chargeable_weight} placeholder="0"
                    className={`w-full h-9 px-2.5 rounded-md border text-sm tabular-nums font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring ${awbData?.chargeable_weight ? 'bg-muted/50 cursor-not-allowed' : 'bg-background'}`} />
                </div>
              </div>
            </div>
          )}

          {manifestProcessing && <div className="flex items-center gap-2 text-sm text-muted-foreground animate-fade-in"><Loader2 className="h-4 w-4 animate-spin" /> Parsing manifest...</div>}
          {manifestError && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2 animate-fade-in flex items-center gap-1.5"><XCircle className="h-4 w-4 shrink-0" />{manifestError}</div>}
          
          {manifestResult && !manifestProcessing && manifestResult.errors.length > 0 && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-2 animate-fade-in max-h-60 overflow-y-auto">
              <p className="text-sm font-semibold text-destructive flex items-center gap-1.5"><XCircle className="h-4 w-4" /> Manifest validation errors ({manifestResult.errors.length})</p>
              {manifestResult.errors.slice(0, 20).map((e, i) => <div key={i} className="text-xs text-destructive font-mono">{e}</div>)}
              {manifestResult.errors.length > 20 && <div className="text-xs text-destructive">...and {manifestResult.errors.length - 20} more errors</div>}
            </div>
          )}
          {/* Auto-fix warnings are applied silently — not shown to customers */}
          {manifestResult && !manifestProcessing && manifestResult.parsedRows.length > 0 && manifestResult.errors.length === 0 && (
            <div className="bg-emerald-500/10 rounded-lg p-3 animate-fade-in flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> ✅ Manifest ready
            </div>
          )}
          {manifestProgress && (
            <div className="space-y-2 animate-fade-in">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{manifestProgress}</div>
              <Progress value={(() => { const m = manifestProgress.match(/(\d+)\/(\d+)/); return m ? (parseInt(m[1]) / parseInt(m[2])) * 100 : 0; })()} className="h-2" />
            </div>
          )}

          {!canProceed && (awbFile || manifestFile || mawb) && (
            <div className="text-xs text-muted-foreground space-y-0.5">
              {mawb.replace(/\D/g, '').length !== 11 && <div className="text-destructive">• MAWB number incomplete</div>}
              {!subklantId && isStaffUser && <div className="text-destructive">• Sub Client not selected</div>}
              {isParentAccount && childCustomers.length > 0 && !selectedChildId && <div className="text-destructive">• Sub Client not selected</div>}
              {!awbFile && <div className="text-destructive">• Air Waybill not uploaded</div>}
              {!manifestFile && <div className="text-destructive">• Manifest not uploaded</div>}
              {(manualColli === '' || manualGrossWeight === '' || manualChargeableWeight === '') && awbFile && <div className="text-destructive">• Weight/colli fields incomplete</div>}
              {manifestFile && !manifestReady && !manifestProcessing && <div className="text-destructive">• Manifest not ready</div>}
              {!!duplicateMawb && <div className="text-destructive">• Duplicate MAWB</div>}
              {hasBlockingErrors && <div className="text-destructive">• Manifest has validation errors</div>}
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button disabled={!canProceed} onClick={() => setStep(2)}
              className="inline-flex items-center gap-2 px-5 h-10 rounded-lg bg-accent text-accent-foreground text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98] transition-all">
              Next <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5 animate-fade-in">
          <div className="bg-card rounded-xl border p-6 space-y-4">
            <h2 className="font-semibold">Shipment Summary</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div><span className="text-muted-foreground text-xs block">MAWB</span><span className="font-mono font-medium">{mawb}</span></div>
              <div><span className="text-muted-foreground text-xs block">Colli</span><span className="font-bold tabular-nums">{colli || '—'}</span></div>
              <div><span className="text-muted-foreground text-xs block">Chargeable Weight</span><span className="font-bold tabular-nums">{chargeableWeight ? `${chargeableWeight.toLocaleString()} kg` : '—'}</span></div>
            </div>
          </div>

          {submitError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive flex items-center gap-1.5">
              <XCircle className="h-4 w-4 shrink-0" /> {submitError}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <button onClick={() => setStep(1)} disabled={submitting}
              className="inline-flex items-center gap-2 px-5 h-10 rounded-lg border text-sm font-medium hover:bg-muted active:scale-[0.98] transition-all disabled:opacity-50">
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <button disabled={submitting} onClick={handleCreate}
              className="inline-flex items-center gap-2 px-5 h-10 rounded-lg bg-accent text-accent-foreground text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98] transition-all">
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</> : <><CheckCircle2 className="h-4 w-4" /> Create Shipment</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

async function sendConvertedManifestEmail(
  shipmentId: string,
  customerId: string,
  mawb: string,
  convertedStoragePath: string,
  userEmail: string,
  resolvedWarehouseId: string | null,
) {
  // If warehouseId not passed, fetch from shipment record
  let warehouseId = resolvedWarehouseId;
  if (!warehouseId) {
    console.log('[SendEmail] Step 0: warehouseId is null, fetching from shipment', shipmentId);
    const { data: shipmentData } = await supabase
      .from('shipments')
      .select('warehouse_id')
      .eq('id', shipmentId)
      .single();
    warehouseId = shipmentData?.warehouse_id || null;
    console.log('[SendEmail] Step 0 result: warehouse_id from shipment =', warehouseId);
  }

  console.log('[SendEmail] Step 1: Fetching email account by warehouse_id', warehouseId);
  let emailAccount: { id: string; from_email: string; from_name: string | null; resend_api_key: string } | null = null;

  if (warehouseId) {
    const { data: warehouseAccounts, error: warehouseAccountError } = await supabase
      .from('email_accounts')
      .select('id, from_email, from_name, resend_api_key')
      .eq('warehouse_id', warehouseId)
      .eq('is_default', true)
      .limit(1);

    if (warehouseAccountError) {
      console.error('[SendEmail] BLOCKED: Failed to fetch warehouse email account', warehouseAccountError);
      return;
    }

    const warehouseAccount = warehouseAccounts?.[0];
    if (warehouseAccount?.resend_api_key) {
      emailAccount = warehouseAccount;
    }
  }

  console.log('[SendEmail] Step 1 result:', { emailAccount: emailAccount ? { id: emailAccount.id, from_email: emailAccount.from_email, hasKey: !!emailAccount.resend_api_key, keyPrefix: emailAccount.resend_api_key?.substring(0, 10) } : null });

  if (!emailAccount?.resend_api_key) {
    console.error('[SendEmail] BLOCKED: No default email account with Resend API key found for warehouse', { warehouseId });
    return;
  }

  console.log('[SendEmail] Step 2: Fetching converted_manifest template');
  const { data: templates, error: templateError } = await supabase
    .from('email_templates')
    .select('subject, body, recipients')
    .eq('template_type', 'converted_manifest')
    .limit(1);

  const template = templates?.[0] || null;
  console.log('[SendEmail] Step 2 result:', { template: template ? { subject: template.subject, recipients: template.recipients, hasBody: !!template.body } : null, error: templateError });

  if (templateError) {
    console.error('[SendEmail] BLOCKED: Failed to load converted_manifest template', templateError);
    return;
  }

  const account = emailAccount;

  const recipients = template?.recipients;
  if (!recipients || (Array.isArray(recipients) && recipients.length === 0)) {
    console.error('[SendEmail] BLOCKED: No recipients configured for converted_manifest template');
    return;
  }
  console.log('[SendEmail] Step 3: Recipients:', recipients);

  console.log('[SendEmail] Step 4: Creating signed URL for', convertedStoragePath);
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from('shipment-files')
    .createSignedUrl(convertedStoragePath, 3600);
  if (signedUrlError) {
    console.error('[SendEmail] BLOCKED: Failed to generate signed URL', signedUrlError);
    return;
  }

  if (!signedUrlData?.signedUrl) {
    console.error('[SendEmail] BLOCKED: Signed URL missing', { convertedStoragePath });
    return;
  }
  console.log('[SendEmail] Step 4 result: Signed URL obtained');

  const subject = (template?.subject || 'Converted manifest ({{mawb}})')
    .replace(/\{\{mawb\}\}/g, mawb);
  const body = (template?.body || 'Dear customs team,\n\nPlease find attached the converted manifest for shipment {{mawb}}.\n\nKind regards')
    .replace(/\{\{mawb\}\}/g, mawb);

  const htmlBody = body.split('\n').map(line => `<p>${line || '&nbsp;'}</p>`).join('');

  console.log('[SendEmail] Step 5: Invoking send-email edge function', { accountId: account.id, to: recipients, subject });
  const { data: invokeData, error } = await supabase.functions.invoke('send-email', {
    body: {
      email_account_id: account.id,
      to: recipients,
      subject,
      html: htmlBody,
      attachments: [{
        filename: `${mawb.replace(/\D/g, '')}_customs_converted.xlsx`,
        path: signedUrlData.signedUrl,
      }],
    },
  });

  console.log('[SendEmail] Step 5 result:', { invokeData, error });

  if (error) {
    console.error('[SendEmail] Send email error', error);
    return;
  }
  console.log('[SendEmail] ✅ Email sent successfully');

  // Update shipment_files record with email sent info
  await supabase
    .from('shipment_files')
    .update({ email_sent_at: new Date().toISOString(), email_sent_by: userEmail })
    .eq('shipment_id', shipmentId)
    .eq('file_type', 'manifest_converted');
}

function UploadZone({ label, accept, file, onFile }: { label: string; accept: string; file: File | null; onFile: (f: File | null) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      <label className="flex flex-col items-center justify-center h-24 rounded-lg border-2 border-dashed cursor-pointer hover:border-accent hover:bg-accent/5 transition-colors">
        {file ? (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="font-medium truncate max-w-[140px]">{file.name}</span>
            <button onClick={(e) => { e.preventDefault(); onFile(null); }} className="text-muted-foreground hover:text-destructive text-xs ml-2">(remove)</button>
          </div>
        ) : (
          <>
            <Upload className="h-5 w-5 text-muted-foreground mb-1" />
            <span className="text-sm text-muted-foreground">Click to upload</span>
          </>
        )}
        {!file && <input type="file" accept={accept} className="hidden" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />}
      </label>
    </div>
  );
}
