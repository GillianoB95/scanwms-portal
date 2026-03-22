import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, ArrowLeft, ArrowRight, Plane, Truck, AlertTriangle, XCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useSubklanten } from '@/hooks/use-shipment-data';
import { extractAwbData, type AwbExtractedData } from '@/lib/extract-awb';
import { parseManifest, validateManifest, type ManifestSummary } from '@/lib/parse-manifest';

type Step = 1 | 2;

export default function NewShipment() {
  const navigate = useNavigate();
  const { user, customer } = useAuth();
  const { data: subklanten = [] } = useSubklanten();

  const [step, setStep] = useState<Step>(1);
  const [mawb, setMawb] = useState('');
  const [subklantId, setSubklantId] = useState('');
  const [awbFile, setAwbFile] = useState<File | null>(null);
  const [manifestFile, setManifestFile] = useState<File | null>(null);

  // Extraction state
  const [awbExtracting, setAwbExtracting] = useState(false);
  const [awbData, setAwbData] = useState<AwbExtractedData | null>(null);
  const [awbError, setAwbError] = useState<string | null>(null);

  const [manifestParsing, setManifestParsing] = useState(false);
  const [manifestSummary, setManifestSummary] = useState<ManifestSummary | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);

  // Editable extracted fields
  const [editColli, setEditColli] = useState('');
  const [editGrossWeight, setEditGrossWeight] = useState('');
  const [editChargeableWeight, setEditChargeableWeight] = useState('');

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const formatMawb = useCallback((val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 3) return digits;
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }, []);

  // Extract AWB data when file is uploaded
  useEffect(() => {
    if (!awbFile) {
      setAwbData(null);
      setAwbError(null);
      return;
    }
    let cancelled = false;
    setAwbExtracting(true);
    setAwbError(null);

    extractAwbData(awbFile)
      .then((data) => {
        if (cancelled) return;
        setAwbData(data);
        if (data.mawb && !mawb) setMawb(data.mawb);
        setEditColli(data.colli != null ? String(data.colli) : '');
        setEditGrossWeight(data.grossWeight != null ? String(data.grossWeight) : '');
        setEditChargeableWeight(data.chargeableWeight != null ? String(data.chargeableWeight) : '');
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('AWB extraction failed:', err);
        setAwbError('Could not extract data from PDF. You can enter values manually.');
      })
      .finally(() => {
        if (!cancelled) setAwbExtracting(false);
      });

    return () => { cancelled = true; };
  }, [awbFile]);

  // Parse manifest when file is uploaded
  useEffect(() => {
    if (!manifestFile) {
      setManifestSummary(null);
      setManifestError(null);
      return;
    }
    let cancelled = false;
    setManifestParsing(true);
    setManifestError(null);

    parseManifest(manifestFile)
      .then((summary) => {
        if (cancelled) return;
        setManifestSummary(summary);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Manifest parse failed:', err);
        setManifestError('Could not parse manifest file. Please check the format.');
      })
      .finally(() => {
        if (!cancelled) setManifestParsing(false);
      });

    return () => { cancelled = true; };
  }, [manifestFile]);

  const colli = parseInt(editColli, 10) || 0;
  const grossWeight = parseFloat(editGrossWeight) || 0;
  const chargeableWeight = parseFloat(editChargeableWeight) || 0;
  const canProceed = mawb.replace(/\D/g, '').length === 11 && subklantId && awbFile && manifestFile;

  // Validation
  const validation = manifestSummary ? validateManifest(manifestSummary, mawb) : { errors: [], warnings: [] };

  // Weight mismatch warning
  const allWarnings = [...validation.warnings];
  if (manifestSummary && chargeableWeight > 0 && manifestSummary.totalWeight > 0) {
    const diff = Math.abs(manifestSummary.totalWeight - chargeableWeight);
    if (diff > chargeableWeight * 0.1) {
      allWarnings.push({
        message: `Manifest total weight (${manifestSummary.totalWeight.toLocaleString()} kg) differs from AWB chargeable weight (${chargeableWeight.toLocaleString()} kg)`,
      });
    }
  }

  const handleCreate = async () => {
    if (!customer || !user?.email) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const effectiveWeight = Math.max(grossWeight, chargeableWeight);

      // 1. Insert shipment
      const { data: shipment, error: shipErr } = await supabase
        .from('shipments')
        .insert({
          customer_id: customer.id,
          subklant_id: subklantId || null,
          mawb,
          transport_type: 'AIR',
          colli_expected: colli,
          chargeable_weight: effectiveWeight,
          warehouse_id: customer.warehouse_id || 'AMS-01',
          status: 'Awaiting NOA',
          parcels: manifestSummary?.totalParcels || 0,
        })
        .select('id')
        .single();

      if (shipErr) throw new Error(`Failed to create shipment: ${shipErr.message}`);
      const shipmentId = shipment.id;

      // 2. Insert status history
      await supabase.from('shipment_status_history').insert({
        shipment_id: shipmentId,
        status: 'Awaiting NOA',
        changed_by: user.email,
        notes: 'Shipment created via portal',
      });

      // 3. Upload files to storage
      const uploadFile = async (file: File, fileType: string) => {
        const storagePath = `shipments/${shipmentId}/${fileType}-${file.name}`;
        const { error: uploadErr } = await supabase.storage
          .from('shipment-files')
          .upload(storagePath, file, { upsert: true });

        if (uploadErr) {
          console.warn(`File upload failed (${fileType}):`, uploadErr.message);
          return;
        }

        await supabase.from('shipment_files').insert({
          shipment_id: shipmentId,
          file_type: fileType,
          storage_path: storagePath,
        });
      };

      if (awbFile) await uploadFile(awbFile, 'air_waybill');
      if (manifestFile) await uploadFile(manifestFile, 'manifest');

      // 4. Redirect to new shipment detail
      navigate(`/shipments/${shipmentId}`);
    } catch (err: any) {
      console.error('Create shipment failed:', err);
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

      {/* Step indicator */}
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

      {/* Step 1: Details */}
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
            <input
              value={mawb}
              onChange={e => setMawb(formatMawb(e.target.value))}
              placeholder="XXX-XXXXXXXX"
              className="w-full h-10 px-3 rounded-lg border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Subklant</label>
            <select
              value={subklantId}
              onChange={e => setSubklantId(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select subklant...</option>
              {subklanten.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UploadZone label="Air Waybill (PDF)" accept=".pdf" file={awbFile} onFile={setAwbFile} />
            <UploadZone label="Manifest (XLS/XLSX)" accept=".xls,.xlsx" file={manifestFile} onFile={setManifestFile} />
          </div>

          {/* AWB extraction status */}
          {awbExtracting && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground animate-fade-in">
              <Loader2 className="h-4 w-4 animate-spin" /> Extracting data from Air Waybill...
            </div>
          )}
          {awbError && (
            <div className="text-sm text-[hsl(var(--status-noa))] bg-[hsl(var(--status-noa))/0.08] rounded-lg px-3 py-2 animate-fade-in">
              <AlertTriangle className="h-4 w-4 inline mr-1.5" />{awbError}
            </div>
          )}
          {awbData && !awbExtracting && (
            <div className="bg-muted/40 rounded-lg p-4 space-y-3 animate-fade-in">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Extracted from AWB (editable)</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Colli (pieces)</label>
                  <input value={editColli} onChange={e => setEditColli(e.target.value)} className="w-full h-9 px-2.5 rounded-md border bg-background text-sm tabular-nums font-mono focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Gross Weight (kg)</label>
                  <input value={editGrossWeight} onChange={e => setEditGrossWeight(e.target.value)} className="w-full h-9 px-2.5 rounded-md border bg-background text-sm tabular-nums font-mono focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Chargeable Weight (kg)</label>
                  <input value={editChargeableWeight} onChange={e => setEditChargeableWeight(e.target.value)} className="w-full h-9 px-2.5 rounded-md border bg-background text-sm tabular-nums font-mono focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
              </div>
            </div>
          )}

          {/* Manifest parsing status */}
          {manifestParsing && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground animate-fade-in">
              <Loader2 className="h-4 w-4 animate-spin" /> Parsing manifest...
            </div>
          )}
          {manifestError && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2 animate-fade-in">
              <XCircle className="h-4 w-4 inline mr-1.5" />{manifestError}
            </div>
          )}
          {manifestSummary && !manifestParsing && (
            <div className="bg-muted/40 rounded-lg p-4 animate-fade-in">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Manifest Preview</p>
              <div className="flex gap-6 text-sm">
                <div><span className="text-muted-foreground text-xs block">Total Parcels</span><span className="font-bold tabular-nums">{manifestSummary.totalParcels}</span></div>
                <div><span className="text-muted-foreground text-xs block">Total Weight</span><span className="font-bold tabular-nums">{manifestSummary.totalWeight.toLocaleString()} kg</span></div>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              disabled={!canProceed}
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-2 px-5 h-10 rounded-lg bg-accent text-accent-foreground text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98] transition-all"
            >
              Next <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Review & Validate */}
      {step === 2 && (
        <div className="space-y-5 animate-fade-in">
          <div className="bg-card rounded-xl border p-6 space-y-4">
            <h2 className="font-semibold">Shipment Summary</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div><span className="text-muted-foreground text-xs block">MAWB</span><span className="font-mono font-medium">{mawb}</span></div>
              <div><span className="text-muted-foreground text-xs block">Colli</span><span className="font-bold tabular-nums">{colli || '—'}</span></div>
              <div><span className="text-muted-foreground text-xs block">Gross Weight</span><span className="font-bold tabular-nums">{grossWeight ? `${grossWeight.toLocaleString()} kg` : '—'}</span></div>
              <div><span className="text-muted-foreground text-xs block">Chargeable Weight</span><span className="font-bold tabular-nums">{chargeableWeight ? `${chargeableWeight.toLocaleString()} kg` : '—'}</span></div>
              <div><span className="text-muted-foreground text-xs block">Warehouse</span><span className="font-medium">{customer?.warehouse_id || 'AMS-01'}</span></div>
              <div><span className="text-muted-foreground text-xs block">Subklant</span><span className="font-medium">{subklanten.find((s: any) => s.id === subklantId)?.name || '—'}</span></div>
            </div>
          </div>

          {manifestSummary && (
            <div className="bg-card rounded-xl border p-6">
              <h2 className="font-semibold mb-3">Manifest Summary</h2>
              <div className="flex gap-6 text-sm">
                <div><span className="text-muted-foreground text-xs block">Total Parcels</span><span className="font-bold tabular-nums">{manifestSummary.totalParcels}</span></div>
                <div><span className="text-muted-foreground text-xs block">Total Weight</span><span className="font-bold tabular-nums">{manifestSummary.totalWeight.toLocaleString()} kg</span></div>
              </div>
            </div>
          )}

          {/* Blocking errors */}
          {validation.errors.length > 0 && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-2">
              <p className="text-sm font-semibold text-destructive flex items-center gap-1.5"><XCircle className="h-4 w-4" /> Blocking Issues</p>
              {validation.errors.map((e, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <span>{e.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Warnings */}
          {allWarnings.length > 0 && (
            <div className="rounded-xl border border-[hsl(var(--status-noa))/0.3] bg-[hsl(var(--status-noa))/0.05] p-4 space-y-2">
              <p className="text-sm font-semibold text-[hsl(var(--status-noa))] flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> Warnings</p>
              {allWarnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-[hsl(var(--status-noa))] shrink-0 mt-0.5" />
                  <span>{w.message}</span>
                </div>
              ))}
            </div>
          )}

          {submitError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {submitError}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <button
              onClick={() => setStep(1)}
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 h-10 rounded-lg border text-sm font-medium hover:bg-muted active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <button
              disabled={validation.errors.length > 0 || submitting}
              onClick={handleCreate}
              className="inline-flex items-center gap-2 px-5 h-10 rounded-lg bg-accent text-accent-foreground text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98] transition-all"
            >
              {submitting ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</>
              ) : (
                <><CheckCircle2 className="h-4 w-4" /> Create Shipment</>
              )}
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
            <CheckCircle2 className="h-4 w-4 text-[hsl(var(--status-delivered))]" />
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
