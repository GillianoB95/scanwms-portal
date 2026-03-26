import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Download, CheckCircle2, Circle, Truck, Loader2, Shield, AlertTriangle, Search as SearchIcon, ChevronDown, ChevronRight, Package } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useShipment, useStatusHistory, useNoas, useOutbounds, useOuterboxes, useClearances, useInspections } from '@/hooks/use-shipment-data';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { StatusBadge } from '@/components/StatusBadge';
import { getStatusClass } from '@/lib/mock-data';
import { useState } from 'react';

const statusOrder = ['Created', 'Awaiting NOA', 'Partial NOA', 'NOA Complete', 'In Transit', 'In Stock', 'Outbound'];

function getMilestoneStatus(shipment: any, history: any[], noaEntries: any[], outerboxes: any[], outboundData: any[]) {
  const results: { key: string; label: string; reached: boolean; date?: string; sub?: { label: string; date?: string }[] }[] = [];

  // Created
  results.push({ key: 'created', label: 'Shipment Created', reached: true, date: shipment.created_at });

  // NOA entries
  const totalNoaColli = noaEntries.reduce((sum: number, n: any) => sum + (n.colli || 0), 0);
  const noaComplete = noaEntries.length > 0 && totalNoaColli >= (shipment.colli_expected || 0);

  if (noaEntries.length === 0) {
    results.push({ key: 'noa', label: 'NOA Received', reached: false });
  } else if (noaEntries.length === 1 && noaComplete) {
    // Single NOA that covers all expected colli → NOA Complete
    const noa = noaEntries[0];
    results.push({
      key: 'noa_complete',
      label: 'NOA Complete',
      reached: true,
      date: noa?.received_at || noa?.created_at,
    });
  } else {
    // Multiple NOAs (or single partial)
    let runningTotal = 0;
    for (let i = 0; i < noaEntries.length; i++) {
      const n = noaEntries[i];
      runningTotal += n.colli || 0;
      const isLast = runningTotal >= (shipment.colli_expected || 0);
      results.push({
        key: `noa_${i}`,
        label: isLast ? 'NOA Complete' : `Partial NOA #${i + 1}`,
        reached: true,
        date: n.received_at || n.created_at,
        sub: [{ label: `${n.colli} colli`, date: n.received_at || n.created_at }],
      });
    }
  }

  // If not complete yet, add a pending "NOA Complete" step
  if (!noaComplete && noaEntries.length > 0) {
    results.push({ key: 'noa_complete', label: 'NOA Complete', reached: false });
  }

  // Unloaded
  const isUnloaded = !!shipment.unloaded_at;
  results.push({ key: 'unloaded', label: 'Unloaded at Warehouse', reached: isUnloaded, date: shipment.unloaded_at });

  // Scanning in progress
  const hasScanned = outerboxes.some((b: any) => ['scanned_in', 'palletized', 'scanned_out'].includes(b.status));
  results.push({ key: 'scanning', label: 'Scanning in Progress', reached: hasScanned });

  // Outbound prepared
  const hasOutbound = outboundData.length > 0;
  results.push({ key: 'outbound', label: 'Outbound Prepared', reached: hasOutbound });

  // Departed
  const hasDeparted = shipment.status === 'Outbound';
  results.push({ key: 'departed', label: 'Departed', reached: hasDeparted });

  return results;
}

function ClearanceSection({ shipmentId, colliExpected }: { shipmentId: string; colliExpected: number }) {
  const { data: clearances = [], isLoading } = useClearances(shipmentId);
  if (isLoading) return null;
  const totalCleared = clearances.reduce((sum: number, c: any) => sum + (c.colli_cleared || 0), 0);
  const latestStatus = clearances.length > 0
    ? (totalCleared >= colliExpected ? 'cleared' : totalCleared > 0 ? 'partial' : 'pending')
    : 'pending';
  const statusLabel: Record<string, string> = { pending: 'Pending', partial: 'Partially Cleared', cleared: 'Fully Cleared' };
  const pending = colliExpected - totalCleared;

  return (
    <div className="bg-card rounded-xl border p-5 animate-fade-in" style={{ animationDelay: '280ms' }}>
      <div className="flex items-center gap-2 mb-4">
        <Shield className="h-4.5 w-4.5 text-muted-foreground" />
        <h2 className="font-semibold">Customs Clearance</h2>
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        <span className={`status-badge ${getStatusClass(latestStatus)}`}>{statusLabel[latestStatus]}</span>
        <span className="text-sm tabular-nums"><strong>{totalCleared}</strong> / {colliExpected} colli cleared</span>
      </div>
      {latestStatus === 'partial' && pending > 0 && (
        <p className="text-sm text-muted-foreground mt-3">⚠ {pending} colli still pending clearance</p>
      )}
      {clearances.length > 0 && (
        <div className="mt-4 space-y-2">
          {clearances.map((c: any) => (
            <div key={c.id} className="flex items-center justify-between text-sm py-2 px-3 bg-muted/40 rounded-lg">
              <div>
                <span className="tabular-nums font-medium">{c.colli_cleared} colli</span>
                {c.cleared_by && <span className="text-muted-foreground ml-2">by {c.cleared_by}</span>}
              </div>
              {c.cleared_at && <span className="text-muted-foreground text-xs">{new Date(c.cleared_at).toLocaleString('en-GB')}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScanDetailsSection({ shipmentId, outerboxes, colliExpected }: { shipmentId: string; outerboxes: any[]; colliExpected: number }) {
  const [expanded, setExpanded] = useState(false);

  // Fetch all unique outerbox barcodes from manifest_parcels
  const { data: manifestBarcodes = [] } = useQuery({
    queryKey: ['manifest-outerbox-barcodes', shipmentId],
    queryFn: async () => {
      const { data } = await supabase
        .from('manifest_parcels')
        .select('outerbox_barcode')
        .eq('shipment_id', shipmentId)
        .not('outerbox_barcode', 'is', null)
        .neq('outerbox_barcode', '');
      const unique = [...new Set((data || []).map((r: any) => r.outerbox_barcode))].sort();
      return unique as string[];
    },
    enabled: !!shipmentId,
  });

  const scannedBarcodes = outerboxes
    .filter((b: any) => ['scanned_in', 'palletized', 'scanned_out'].includes(b.status))
    .map((b: any) => b.barcode)
    .sort();

  const scannedSet = new Set(scannedBarcodes);
  const notScannedBarcodes = manifestBarcodes.filter(b => !scannedSet.has(b)).sort();
  const scannedCount = scannedBarcodes.length;
  const totalCount = colliExpected || manifestBarcodes.length;

  return (
    <div className="bg-card rounded-xl border animate-fade-in" style={{ animationDelay: '320ms' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-4 flex items-center gap-2 text-sm font-medium hover:bg-muted/30 transition-colors"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <Package className="h-4 w-4 text-muted-foreground" />
        <span>Scan details ({scannedCount}/{totalCount} scanned)</span>
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            {/* Scanned */}
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">✅ Scanned ({scannedBarcodes.length})</h3>
              <div className="space-y-1 max-h-[300px] overflow-y-auto">
                {scannedBarcodes.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No boxes scanned yet</p>
                ) : (
                  scannedBarcodes.map((barcode: string) => (
                    <div key={barcode} className="text-xs font-mono py-1 px-2 bg-accent/10 text-accent rounded">{barcode}</div>
                  ))
                )}
              </div>
            </div>

            {/* Not scanned */}
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">⬜ Not yet scanned ({notScannedBarcodes.length})</h3>
              <div className="space-y-1 max-h-[300px] overflow-y-auto">
                {notScannedBarcodes.length === 0 ? (
                  <p className="text-xs text-muted-foreground">All boxes scanned</p>
                ) : (
                  notScannedBarcodes.map((barcode: string) => (
                    <div key={barcode} className="text-xs font-mono py-1 px-2 bg-muted text-muted-foreground rounded">{barcode}</div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FycoSection({ shipmentId }: { shipmentId: string }) {
  const { data: inspections = [], isLoading } = useInspections(shipmentId);
  if (isLoading || inspections.length === 0) return null;

  const statusLabels: Record<string, string> = {
    under_inspection: 'Under Inspection',
    removed: 'Removed from Box',
    released: 'Released',
    checked: 'Checked',
    scanned: 'Scanned',
  };

  return (
    <div className="bg-card rounded-xl border animate-fade-in" style={{ animationDelay: '340ms' }}>
      <div className="px-5 py-4 border-b flex items-center gap-2">
        <SearchIcon className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Customs Inspections (Fyco)</h2>
        <span className="text-xs bg-muted px-1.5 py-0.5 rounded-full tabular-nums ml-auto">{inspections.length} parcel(s)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="text-left px-5 py-3 font-medium">Parcel Barcode</th>
              <th className="text-left px-5 py-3 font-medium">Status</th>
              <th className="text-left px-5 py-3 font-medium">Location</th>
              <th className="text-left px-5 py-3 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {inspections.map((insp: any) => (
              <tr key={insp.id} className="border-b last:border-0">
                <td className="px-5 py-3 font-mono font-medium">{insp.parcel_barcode}</td>
                <td className="px-5 py-3">
                  <span className={`status-badge ${getStatusClass(insp.status)}`}>
                    {statusLabels[insp.status] || insp.status}
                  </span>
                </td>
                <td className="px-5 py-3 text-muted-foreground">{insp.location || '—'}</td>
                <td className="px-5 py-3 text-muted-foreground">
                  {insp.released_at
                    ? new Date(insp.released_at).toLocaleString('en-GB')
                    : insp.checked_at
                      ? new Date(insp.checked_at).toLocaleString('en-GB')
                      : insp.created_at
                        ? new Date(insp.created_at).toLocaleString('en-GB')
                        : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OutboundSection({ shipmentId }: { shipmentId: string }) {
  const { customer } = useAuth();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const { data: outbounds = [], isLoading } = useQuery({
    queryKey: ['customer-shipment-outbounds', shipmentId],
    queryFn: async () => {
      if (!shipmentId) return [];
      const { data: boxes } = await supabase
        .from('outerboxes')
        .select('pallet_id')
        .eq('shipment_id', shipmentId)
        .not('pallet_id', 'is', null);

      if (!boxes || boxes.length === 0) return [];

      const palletIds = [...new Set(boxes.map(b => b.pallet_id))];
      const { data: pallets } = await supabase
        .from('pallets')
        .select('id, outbound_id, hub')
        .in('id', palletIds)
        .not('outbound_id', 'is', null);

      if (!pallets || pallets.length === 0) return [];

      const outboundIds = [...new Set(pallets.map(p => p.outbound_id))];
      const hubsByOutbound: Record<string, Set<string>> = {};
      for (const p of pallets) {
        if (!hubsByOutbound[p.outbound_id]) hubsByOutbound[p.outbound_id] = new Set();
        if (p.hub) hubsByOutbound[p.outbound_id].add(p.hub);
      }

      const { data: obData } = await supabase
        .from('outbounds')
        .select('id, outbound_number, pickup_date, truck_reference, license_plate, seal_number, status, departed_at, prepared_at')
        .in('id', outboundIds)
        .in('status', ['prepared', 'departed'])
        .order('pickup_date', { ascending: false });

      return (obData || []).map(ob => ({
        ...ob,
        hub: hubsByOutbound[ob.id] ? [...hubsByOutbound[ob.id]].join(', ') : '—',
      }));
    },
    enabled: !!shipmentId,
  });

  const handleDownloadCmr = async (outboundId: string) => {
    if (!customer?.id) return;
    setDownloadingId(outboundId);
    try {
      const customerIds = [customer.id];
      if (!customer.parent_customer_id) {
        const { data: subs } = await supabase.from('customers').select('id').eq('parent_customer_id', customer.id);
        if (subs) customerIds.push(...subs.map(s => s.id));
      }
      const { data: cmrRecords } = await supabase
        .from('cmr_records')
        .select('file_path, file_name')
        .eq('outbound_id', outboundId)
        .in('subclient_id', customerIds);

      if (!cmrRecords || cmrRecords.length === 0) { alert('No CMR file available.'); return; }

      for (const cmr of cmrRecords) {
        const { data: fileData } = await supabase.storage.from('cmr-files').download(cmr.file_path);
        if (!fileData) continue;
        const url = URL.createObjectURL(fileData);
        const a = document.createElement('a');
        a.href = url; a.download = cmr.file_name || 'CMR.pdf';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch { alert('Failed to download CMR.'); }
    finally { setDownloadingId(null); }
  };

  if (isLoading || outbounds.length === 0) return null;

  return (
    <div className="bg-card rounded-xl border animate-fade-in" style={{ animationDelay: '460ms' }}>
      <div className="px-5 py-4 border-b flex items-center gap-2">
        <Truck className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Outbound Shipments</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="text-left px-5 py-3 font-medium">Date</th>
              <th className="text-left px-5 py-3 font-medium">Hub</th>
              <th className="text-left px-5 py-3 font-medium">Truck Ref</th>
              <th className="text-left px-5 py-3 font-medium">License Plate</th>
              <th className="text-left px-5 py-3 font-medium">Seal Nr</th>
              <th className="text-left px-5 py-3 font-medium">Status</th>
              <th className="text-center px-5 py-3 font-medium">CMR</th>
            </tr>
          </thead>
          <tbody>
            {outbounds.map((ob: any) => {
              const displayDate = ob.status === 'departed' && ob.departed_at
                ? new Date(ob.departed_at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                : ob.pickup_date ? new Date(ob.pickup_date).toLocaleDateString('en-GB') : '—';
              return (
                <tr key={ob.id} className="border-b last:border-0">
                  <td className="px-5 py-3 tabular-nums">{displayDate}</td>
                  <td className="px-5 py-3 font-medium">{ob.hub}</td>
                  <td className="px-5 py-3 font-mono">{ob.truck_reference || '—'}</td>
                  <td className="px-5 py-3 font-mono">{ob.license_plate || '—'}</td>
                  <td className="px-5 py-3 font-mono">{ob.seal_number || '—'}</td>
                  <td className="px-5 py-3"><StatusBadge status={ob.status === 'departed' ? 'Departed' : 'Prepared'} /></td>
                  <td className="px-5 py-3 text-center">
                    <button onClick={() => handleDownloadCmr(ob.id)} disabled={downloadingId === ob.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-50 transition-colors">
                      {downloadingId === ob.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} CMR
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NoaHistorySection({ shipmentId, noaEntries, colliExpected }: { shipmentId: string; noaEntries: any[]; colliExpected: number }) {
  // Fetch NOA files
  const { data: noaFiles = [] } = useQuery({
    queryKey: ['noa-files', shipmentId],
    queryFn: async () => {
      const { data } = await supabase
        .from('shipment_files')
        .select('id, storage_path, file_type')
        .eq('shipment_id', shipmentId)
        .eq('file_type', 'noa');
      return data || [];
    },
    enabled: !!shipmentId,
  });

  const handleDownloadNoa = async (storagePath: string, index: number) => {
    try {
      const { data, error } = await supabase.storage.from('shipment-files').download(storagePath);
      if (error || !data) { alert('Failed to download NOA file.'); return; }
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url; a.download = `NOA-${index + 1}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { alert('Failed to download NOA file.'); }
  };

  return (
    <div className="bg-card rounded-xl border animate-fade-in" style={{ animationDelay: '200ms' }}>
      <div className="px-5 py-4 border-b"><h2 className="font-semibold">NOA History</h2></div>
      {noaEntries.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <span className="text-muted-foreground text-sm">No NOA received yet</span>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left px-5 py-3 font-medium">NOA #</th>
                <th className="text-left px-5 py-3 font-medium">Date Received</th>
                <th className="text-right px-5 py-3 font-medium">Colli</th>
                <th className="text-right px-5 py-3 font-medium">Weight (kg)</th>
                <th className="text-right px-5 py-3 font-medium">PDF</th>
              </tr>
            </thead>
            <tbody>
              {noaEntries.map((n: any, idx: number) => {
                // Try to match a NOA file by index
                const noaFile = noaFiles[idx] || null;
                return (
                  <tr key={n.id} className="border-b last:border-0">
                    <td className="px-5 py-3 font-medium">NOA {n.noa_number}</td>
                    <td className="px-5 py-3 text-muted-foreground">{n.received_at ? new Date(n.received_at).toLocaleString('en-GB') : new Date(n.created_at).toLocaleString('en-GB')}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{n.colli}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{Number(n.weight).toLocaleString()}</td>
                    <td className="px-5 py-3 text-right">
                      {noaFile ? (
                        <button onClick={() => handleDownloadNoa(noaFile.storage_path, idx)}
                          className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                          <Download className="h-3.5 w-3.5" /> Download
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-muted/30 font-medium border-t">
                <td className="px-5 py-3">Total</td>
                <td className="px-5 py-3"></td>
                <td className="px-5 py-3 text-right tabular-nums">
                  {noaEntries.reduce((sum: number, n: any) => sum + n.colli, 0)} / {colliExpected ?? '?'}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">
                  {noaEntries.reduce((sum: number, n: any) => sum + Number(n.weight), 0).toLocaleString()} kg
                </td>
                <td className="px-5 py-3"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ShipmentDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: shipment, isLoading } = useShipment(id);
  const { data: history = [] } = useStatusHistory(id);
  const { data: noaEntries = [] } = useNoas(id);
  const { data: outboundData = [] } = useOutbounds(id);
  const { data: outerboxes = [] } = useOuterboxes(id);

  if (isLoading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!shipment) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <p className="text-muted-foreground mb-4">Shipment not found</p>
        <Link to="/shipments" className="text-accent hover:underline text-sm">← Back to shipments</Link>
      </div>
    );
  }

  const milestoneData = getMilestoneStatus(shipment, history, noaEntries, outerboxes, outboundData);

  const scannedIn = outerboxes.filter((b: any) => ['scanned_in', 'in_stock', 'scanned_out'].includes(b.status)).length;
  const inStock = outerboxes.filter((b: any) => b.status === 'in_stock').length;
  const scannedOut = outerboxes.filter((b: any) => b.status === 'scanned_out').length;
  const notScanned = outerboxes.filter((b: any) => b.status === 'expected').length;

  return (
    <div className="space-y-6 max-w-4xl">
      <Link to="/shipments" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to shipments
      </Link>

      <div className="flex items-center gap-3 animate-fade-in">
        <h1 className="text-2xl font-bold font-mono">{shipment.mawb}</h1>
        <StatusBadge status={shipment.status} />
      </div>

      {/* Milestone Timeline */}
      <div className="bg-card rounded-xl border p-5 animate-fade-in" style={{ animationDelay: '80ms' }}>
        <h2 className="font-semibold mb-4">Progress</h2>
        <div className="flex items-center gap-0 overflow-x-auto pb-2">
          {milestoneData.map((m, i) => (
            <div key={m.key} className="flex items-center">
              <div className="flex flex-col items-center min-w-[100px]">
                <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold ${m.reached ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}`}>
                  {m.reached ? <CheckCircle2 className="h-4.5 w-4.5" /> : <Circle className="h-4.5 w-4.5" />}
                </div>
                <span className={`text-[11px] mt-1.5 text-center leading-tight ${m.reached ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{m.label}</span>
                {m.date && <span className="text-[10px] text-muted-foreground tabular-nums">{new Date(m.date).toLocaleDateString('en-GB')}</span>}
                {m.sub && (
                  <div className="mt-1 space-y-0.5">
                    {m.sub.map((s, si) => (
                      <div key={si} className="text-[10px] text-muted-foreground text-center">
                        {s.label}
                        {s.date && <span className="block tabular-nums">{new Date(s.date).toLocaleDateString('en-GB')}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {i < milestoneData.length - 1 && (
                <div className={`h-0.5 w-6 shrink-0 ${m.reached ? 'bg-accent' : 'bg-border'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Shipment Info */}
      <div className="bg-card rounded-xl border p-5 animate-fade-in" style={{ animationDelay: '120ms' }}>
        <h2 className="font-semibold mb-4">Shipment Info</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <div><span className="text-muted-foreground block text-xs mb-0.5">MAWB</span><span className="font-mono font-medium">{shipment.mawb}</span></div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Transport</span>{shipment.transport_type}</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Created</span>{new Date(shipment.created_at).toLocaleDateString('en-GB')}</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Expected Colli</span><span className="tabular-nums">{shipment.colli_expected ?? '—'}</span></div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Weight</span>{Number(shipment.chargeable_weight || 0).toLocaleString()} kg</div>
          {shipment.unloaded_at && (
            <div><span className="text-muted-foreground block text-xs mb-0.5">Unloaded</span>{new Date(shipment.unloaded_at).toLocaleDateString('en-GB')}</div>
          )}
        </div>
        <div className="flex gap-2 mt-4 pt-4 border-t">
          {['Air Waybill', 'Original Manifest'].map(f => (
            <button key={f} className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
              <Download className="h-3.5 w-3.5" /> {f}
            </button>
          ))}
        </div>
      </div>

      {/* NOA History */}
      <NoaHistorySection shipmentId={shipment.id} noaEntries={noaEntries} colliExpected={shipment.colli_expected || 0} />

      {/* Customs Clearance */}
      <ClearanceSection shipmentId={shipment.id} colliExpected={shipment.colli_expected || 0} />

      {/* Scan Details (collapsible) */}
      <ScanDetailsSection shipmentId={shipment.id} outerboxes={outerboxes} colliExpected={shipment.colli_expected || 0} />

      {/* Fyco Inspections */}
      <FycoSection shipmentId={shipment.id} />

      {/* Warehouse Tracking */}
      {outerboxes.length > 0 && (
        <div className="bg-card rounded-xl border p-5 animate-fade-in" style={{ animationDelay: '400ms' }}>
          <h2 className="font-semibold mb-4">Warehouse Tracking</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm mb-4">
            <div className="bg-muted rounded-lg px-3 py-2"><span className="text-muted-foreground text-xs block">Expected</span><span className="font-bold tabular-nums">{outerboxes.length}</span></div>
            <div className="bg-muted rounded-lg px-3 py-2"><span className="text-muted-foreground text-xs block">Scanned In ✅</span><span className="font-bold tabular-nums">{scannedIn}</span></div>
            <div className="bg-muted rounded-lg px-3 py-2"><span className="text-muted-foreground text-xs block">Not Scanned ❌</span><span className="font-bold tabular-nums">{notScanned}</span></div>
            <div className="bg-muted rounded-lg px-3 py-2"><span className="text-muted-foreground text-xs block">In Stock 📦</span><span className="font-bold tabular-nums">{inStock}</span></div>
            <div className="bg-muted rounded-lg px-3 py-2"><span className="text-muted-foreground text-xs block">Scanned Out 🚚</span><span className="font-bold tabular-nums">{scannedOut}</span></div>
          </div>
          <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden flex">
            {scannedOut > 0 && <div className="bg-[hsl(var(--status-delivered))] h-full" style={{ width: `${(scannedOut / outerboxes.length) * 100}%` }} />}
            {inStock > 0 && <div className="bg-[hsl(var(--status-instock))] h-full" style={{ width: `${(inStock / outerboxes.length) * 100}%` }} />}
            {(scannedIn - inStock - scannedOut) > 0 && <div className="bg-[hsl(var(--status-noa-complete))] h-full" style={{ width: `${((scannedIn - inStock - scannedOut) / outerboxes.length) * 100}%` }} />}
          </div>
        </div>
      )}

      {/* Outbound Shipments */}
      <OutboundSection shipmentId={shipment.id} />
    </div>
  );
}
