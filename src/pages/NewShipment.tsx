import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, ArrowLeft, ArrowRight, Plane, Truck, AlertTriangle, XCircle, CheckCircle2 } from 'lucide-react';
import { subklanten } from '@/lib/mock-data';

type Step = 1 | 2;

export default function NewShipment() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [mawb, setMawb] = useState('');
  const [subklantId, setSubklantId] = useState('');
  const [awbFile, setAwbFile] = useState<File | null>(null);
  const [manifestFile, setManifestFile] = useState<File | null>(null);

  const formatMawb = useCallback((val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 3) return digits;
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }, []);

  const canProceed = mawb.replace(/\D/g, '').length === 11 && subklantId && awbFile && manifestFile;

  // Mock extracted data for step 2
  const extractedData = {
    mawb: mawb,
    colli: 24,
    grossWeight: 1680,
    chargeableWeight: 1920,
    warehouse: 'AMS-01',
    manifestParcels: 168,
    manifestWeight: 1580,
  };

  const warnings = [
    { message: 'Manifest total weight (1,580 kg) differs from AWB chargeable weight (1,920 kg)' },
  ];

  const errors: { message: string }[] = [];

  return (
    <div className="space-y-6">
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

      {step === 1 && (
        <div className="bg-card rounded-xl border p-6 space-y-5 animate-fade-in">
          {/* Transport type */}
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

          {/* MAWB */}
          <div>
            <label className="block text-sm font-medium mb-1.5">MAWB Number</label>
            <input
              value={mawb}
              onChange={e => setMawb(formatMawb(e.target.value))}
              placeholder="XXX-XXXXXXXX"
              className="w-full h-10 px-3 rounded-lg border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Subklant */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Subklant</label>
            <select
              value={subklantId}
              onChange={e => setSubklantId(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select subklant...</option>
              {subklanten.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* Uploads side by side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UploadZone
              label="Air Waybill (PDF)"
              accept=".pdf"
              file={awbFile}
              onFile={setAwbFile}
            />
            <UploadZone
              label="Manifest (XLS/XLSX)"
              accept=".xls,.xlsx"
              file={manifestFile}
              onFile={setManifestFile}
            />
          </div>

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

      {step === 2 && (
        <div className="space-y-5 animate-fade-in">
          <div className="bg-card rounded-xl border p-6 space-y-4">
            <h2 className="font-semibold">Extracted from Air Waybill</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div><span className="text-muted-foreground text-xs block">MAWB</span><span className="font-mono font-medium">{extractedData.mawb}</span></div>
              <div><span className="text-muted-foreground text-xs block">Colli</span><span className="font-bold tabular-nums">{extractedData.colli}</span></div>
              <div><span className="text-muted-foreground text-xs block">Chargeable Weight</span><span className="font-bold tabular-nums">{extractedData.chargeableWeight.toLocaleString()} kg</span></div>
              <div>
                <span className="text-muted-foreground text-xs block">Warehouse</span>
                <span className="status-badge status-arrived">{extractedData.warehouse}</span>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-xl border p-6">
            <h2 className="font-semibold mb-3">Manifest Summary</h2>
            <div className="flex gap-6 text-sm">
              <div><span className="text-muted-foreground text-xs block">Total Parcels</span><span className="font-bold tabular-nums">{extractedData.manifestParcels}</span></div>
              <div><span className="text-muted-foreground text-xs block">Total Weight</span><span className="font-bold tabular-nums">{extractedData.manifestWeight.toLocaleString()} kg</span></div>
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="rounded-xl border border-[hsl(var(--status-noa))/0.3] bg-[hsl(var(--status-noa))/0.05] p-4 space-y-2">
              {warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-[hsl(var(--status-noa))] shrink-0 mt-0.5" />
                  <span>{w.message}</span>
                </div>
              ))}
            </div>
          )}

          {errors.length > 0 && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-2">
              {errors.map((e, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <span>{e.message}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <button
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-2 px-5 h-10 rounded-lg border text-sm font-medium hover:bg-muted active:scale-[0.98] transition-all"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <button
              disabled={errors.length > 0}
              onClick={() => navigate('/shipments')}
              className="inline-flex items-center gap-2 px-5 h-10 rounded-lg bg-accent text-accent-foreground text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98] transition-all"
            >
              <CheckCircle2 className="h-4 w-4" /> Create Shipment
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
            <span className="font-medium">{file.name}</span>
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
