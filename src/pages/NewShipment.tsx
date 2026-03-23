import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, ArrowLeft, ArrowRight, Plane, Truck, AlertTriangle, XCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useSubklanten } from '@/hooks/use-shipment-data';
import { useHubs } from '@/hooks/use-hubs';

const MANIFEST_CLEANER_URL = 'https://scanwms-manifest-cleaner.onrender.com';

type Step = 1 | 2;

interface AwbServerData {
  mawb: string | null;
  pieces: number | null;
  gross_weight: number | null;
  chargeable_weight: number | null;
}

interface ManifestResult {
  totalParcels: number;
  totalWeight: number;
  errors: string[];
  warnings: string[];
  cleanedBlob: Blob | null;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export default function NewShipment() {
  const navigate = useNavigate();
  const { user, customer } = useAuth();
  const { data: subklanten = [] } = useSubklanten();
  const { data: activeHubCodes = [] } = useHubs();

  const [step, setStep] = useState<Step>(1);
  const [mawb, setMawb] = useState('');
  const [subklantId, setSubklantId] = useState('');
  const [awbFile, setAwbFile] = useState<File | null>(null);
  const [manifestFile, setManifestFile] = useState<File | null>(null);

  const [awbExtracting, setAwbExtracting] = useState(false);
  const [awbData, setAwbData] = useState<AwbServerData | null>(null);
  const [awbError, setAwbError] = useState<string | null>(null);
  const [awbManualMode, setAwbManualMode] = useState(false);
  const [manualColli, setManualColli] = useState('');
  const [manualGrossWeight, setManualGrossWeight] = useState('');
  const [manualChargeableWeight, setManualChargeableWeight] = useState('');

  const [manifestProcessing, setManifestProcessing] = useState(false);
  const [manifestResult, setManifestResult] = useState<ManifestResult | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);

  const [duplicateMawb, setDuplicateMawb] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Auto-set subklantId for sub-accounts
  const isSubAccount = !!customer?.parent_customer_id;
  useEffect(() => {
    if (isSubAccount && subklanten.length > 0 && !subklantId) {
      // Find the subklant entry matching this sub-account's name
      const match = subklanten.find((s: any) =>
        s.name?.toLowerCase() === customer?.name?.toLowerCase()
      );
      if (match) {
        setSubklantId(match.id);
      } else if (subklanten.length === 1) {
        setSubklantId(subklanten[0].id);
      }
    }
  }, [isSubAccount, subklanten, customer?.name, subklantId]);

  const formatMawb = useCallback((val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 3) return digits;
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }, []);

  // AWB extraction: Railway endpoint only, 15s timeout, fallback to manual
  useEffect(() => {
    if (!awbFile) { setAwbData(null); setAwbError(null); setAwbManualMode(false); return; }
    let cancelled = false;
    setAwbExtracting(true);
    setAwbError(null);
    setAwbData(null);
    setAwbManualMode(false);

    const formData = new FormData();
    formData.append('file', awbFile);

    fetchWithTimeout(
      'https://humble-charisma-production-9829.up.railway.app/extract-awb',
      { method: 'POST', body: formData },
      15000
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        return data as AwbServerData;
      })
      .then((result) => {
        if (cancelled) return;
        setAwbData(result);
        if (result.mawb && !mawb) setMawb(result.mawb);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('AWB extraction failed:', err);
        setAwbManualMode(true);
        setAwbError('Could not extract AWB data. Please enter the values manually.');
      })
      .finally(() => { if (!cancelled) setAwbExtracting(false); });

    return () => { cancelled = true; };
  }, [awbFile]);



  // Manifest processing via Railway manifest cleaner
  useEffect(() => {
    if (!manifestFile) { setManifestResult(null); setManifestError(null); return; }
    let cancelled = false;
    setManifestProcessing(true);
    setManifestError(null);
    setManifestResult(null);

    const formData = new FormData();
    formData.append('manifest', manifestFile);

    fetch(`${MANIFEST_CLEANER_URL}/process`, { method: 'POST', body: formData })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 422) {
          const data = await res.json();
          setManifestResult({
            totalParcels: 0, totalWeight: 0,
            errors: data.errors || [],
            warnings: data.warnings || [],
            cleanedBlob: null,
          });
          return;
        }
        if (!res.ok) throw new Error(`Manifest cleaner error: ${res.status}`);
        const blob = await res.blob();
        setManifestResult({
          totalParcels: 0, totalWeight: 0,
          errors: [], warnings: [],
          cleanedBlob: blob,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setManifestError('Could not process manifest. Please check the format and try again.');
      })
      .finally(() => { if (!cancelled) setManifestProcessing(false); });

    return () => { cancelled = true; };
  }, [manifestFile]);

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

  const colli = awbManualMode ? (parseInt(manualColli) || 0) : (awbData?.pieces ?? 0);
  const grossWeight = awbManualMode ? (parseFloat(manualGrossWeight) || 0) : (awbData?.gross_weight ?? 0);
  const chargeableWeight = awbManualMode ? (parseFloat(manualChargeableWeight) || 0) : (awbData?.chargeable_weight ?? 0);
  const awbExtracted = awbManualMode || (!!awbData && !awbExtracting && !awbError);
  const manifestReady = !!manifestResult?.cleanedBlob && !manifestProcessing;
  const hasBlockingErrors = (manifestResult?.errors?.length ?? 0) > 0;

  const canProceed =
    mawb.replace(/\D/g, '').length === 11 &&
    subklantId &&
    awbFile &&
    manifestFile &&
    awbExtracted &&
    manifestReady &&
    !duplicateMawb &&
    !hasBlockingErrors;

  const handleCreate = async () => {
    if (!customer || !user?.email || !manifestResult?.cleanedBlob) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const { data: existing } = await supabase.from('shipments').select('id, mawb')
        .eq('customer_id', customer.id).eq('mawb', mawb).maybeSingle();
      if (existing) { setSubmitError(`A shipment with MAWB ${mawb} already exists.`); setSubmitting(false); return; }

      const effectiveWeight = Math.max(grossWeight, chargeableWeight);

      const { data: shipment, error: shipErr } = await supabase.from('shipments').insert({
        customer_id: customer.id,
        subklant_id: subklantId || null,
        mawb,
        transport_type: 'AIR',
        colli_expected: colli,
        chargeable_weight: effectiveWeight,
        warehouse_id: customer.warehouse_id || 'DSC',
        status: 'Awaiting NOA',
        parcels: manifestResult?.totalParcels || 0,
      }).select('id').single();

      if (shipErr) throw new Error(`Failed to create shipment: ${shipErr.message}`);
      const shipmentId = shipment.id;

      await supabase.from('shipment_status_history').insert({
        shipment_id: shipmentId, status: 'Awaiting NOA',
        changed_by: user.email, notes: 'Shipment created via portal',
      });

      const uploadFile = async (file: File | Blob, fileType: string, filename: string) => {
        const storagePath = `shipments/${shipmentId}/${fileType}-${filename}`;
        const { error: uploadErr } = await supabase.storage.from('shipment-files').upload(storagePath, file, { upsert: true });
        if (uploadErr) { console.warn(`File upload failed (${fileType}):`, uploadErr.message); return; }
        await supabase.from('shipment_files').insert({ shipment_id: shipmentId, file_type: fileType, storage_path: storagePath });
      };

      if (awbFile) await uploadFile(awbFile, 'air_waybill', awbFile.name);
      if (manifestFile) await uploadFile(manifestFile, 'manifest_original', manifestFile.name);
      if (manifestResult.cleanedBlob) await uploadFile(manifestResult.cleanedBlob, 'manifest_cleaned', manifestFile?.name?.replace('.xlsx', '_CLEANED.xlsx') || 'manifest_cleaned.xlsx');

      navigate(`/shipments/${shipmentId}`);
    } catch (err: any) {
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

          {!isSubAccount && (
            <div>
              <label className="block text-sm font-medium mb-1.5">Sub Client</label>
              <select value={subklantId} onChange={e => setSubklantId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="">Select sub client...</option>
                {subklanten.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UploadZone label="Air Waybill (PDF)" accept=".pdf" file={awbFile} onFile={setAwbFile} />
            <UploadZone label="Manifest (XLS/XLSX)" accept=".xls,.xlsx" file={manifestFile} onFile={setManifestFile} />
          </div>

          {awbExtracting && <div className="flex items-center gap-2 text-sm text-muted-foreground animate-fade-in"><Loader2 className="h-4 w-4 animate-spin" /> Extracting AWB data...</div>}
          {awbError && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2 animate-fade-in flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 shrink-0" />{awbError}</div>}
          
          {/* Extracted AWB data (read-only) */}
          {awbData && !awbExtracting && !awbManualMode && (
            <div className="bg-muted/40 rounded-lg p-4 space-y-3 animate-fade-in">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Extracted from AWB (read-only)</p>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-xs text-muted-foreground block mb-1">Colli</label><div className="w-full h-9 px-2.5 rounded-md border bg-muted text-sm tabular-nums font-mono flex items-center">{awbData.pieces ?? '—'}</div></div>
                <div><label className="text-xs text-muted-foreground block mb-1">Gross Weight (kg)</label><div className="w-full h-9 px-2.5 rounded-md border bg-muted text-sm tabular-nums font-mono flex items-center">{awbData.gross_weight?.toLocaleString() ?? '—'}</div></div>
                <div><label className="text-xs text-muted-foreground block mb-1">Chargeable Weight (kg)</label><div className="w-full h-9 px-2.5 rounded-md border bg-muted text-sm tabular-nums font-mono flex items-center">{awbData.chargeable_weight?.toLocaleString() ?? '—'}</div></div>
              </div>
            </div>
          )}

          {/* Manual AWB input (fallback) */}
          {awbManualMode && awbFile && (
            <div className="bg-muted/40 rounded-lg p-4 space-y-3 animate-fade-in">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Enter AWB data manually</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Colli</label>
                  <input type="number" value={manualColli} onChange={e => setManualColli(e.target.value)} placeholder="0"
                    className="w-full h-9 px-2.5 rounded-md border bg-background text-sm tabular-nums font-mono focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Gross Weight (kg)</label>
                  <input type="number" step="0.1" value={manualGrossWeight} onChange={e => setManualGrossWeight(e.target.value)} placeholder="0"
                    className="w-full h-9 px-2.5 rounded-md border bg-background text-sm tabular-nums font-mono focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Chargeable Weight (kg)</label>
                  <input type="number" step="0.1" value={manualChargeableWeight} onChange={e => setManualChargeableWeight(e.target.value)} placeholder="0"
                    className="w-full h-9 px-2.5 rounded-md border bg-background text-sm tabular-nums font-mono focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
              </div>
            </div>
          )}

          {manifestProcessing && <div className="flex items-center gap-2 text-sm text-muted-foreground animate-fade-in"><Loader2 className="h-4 w-4 animate-spin" /> Processing manifest via cleaner...</div>}
          {manifestError && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2 animate-fade-in flex items-center gap-1.5"><XCircle className="h-4 w-4 shrink-0" />{manifestError}</div>}
          
          {manifestResult && !manifestProcessing && manifestResult.errors.length > 0 && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-2 animate-fade-in">
              <p className="text-sm font-semibold text-destructive flex items-center gap-1.5"><XCircle className="h-4 w-4" /> Manifest validation errors</p>
              {manifestResult.errors.slice(0,5).map((e, i) => <div key={i} className="text-xs text-destructive">{e}</div>)}
            </div>
          )}
          {manifestResult && !manifestProcessing && manifestResult.warnings.length > 0 && (
            <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4 animate-fade-in">
              <p className="text-sm font-semibold text-yellow-600 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> {manifestResult.warnings.length} auto-fixes applied</p>
            </div>
          )}
          {manifestResult?.cleanedBlob && !manifestProcessing && (
            <div className="bg-green-500/10 rounded-lg p-3 animate-fade-in flex items-center gap-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" /> Manifest cleaned and ready
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
              <div><span className="text-muted-foreground text-xs block">Warehouse</span><span className="font-medium">{customer?.warehouse_id || 'DSC'}</span></div>
              <div><span className="text-muted-foreground text-xs block">Sub Client</span><span className="font-medium">{subklanten.find((s: any) => s.id === subklantId)?.name || '—'}</span></div>
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
