import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Download, CheckCircle2, Circle, Truck, Loader2, Shield, AlertTriangle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useStatusHistory, useNoas, useOutbounds, useOuterboxes, useClearances, useInspections } from '@/hooks/use-shipment-data';
import { useAllWarehouses } from '@/hooks/use-staff-data';
import { StatusBadge } from '@/components/StatusBadge';
import { Progress } from '@/components/ui/progress';
import { getStatusClass } from '@/lib/mock-data';

function useStaffShipment(id: string | undefined) {
  return useQuery({
    queryKey: ['staff-shipment', id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('shipments')
        .select('*, subklanten(name), customers(name)')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

function useManifestParcels(shipmentId: string | undefined) {
  return useQuery({
    queryKey: ['manifest-parcels-hubs', shipmentId],
    queryFn: async () => {
      if (!shipmentId) return [];
      const { data, error } = await supabase
        .from('manifest_parcels')
        .select('shipment_id, hub, outerbox_barcode')
        .eq('shipment_id', shipmentId)
        .not('outerbox_barcode', 'is', null)
        .neq('outerbox_barcode', '');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!shipmentId,
  });
}

function usePallets(palletIds: string[]) {
  return useQuery({
    queryKey: ['pallets-detail', palletIds],
    queryFn: async () => {
      if (palletIds.length === 0) return [];
      const { data, error } = await supabase
        .from('pallets')
        .select('id, pallet_number, outbound_id, hub, outbounds(status, pickup_date, truck_reference)')
        .in('id', palletIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: palletIds.length > 0,
  });
}

const statusOrder = ['Created', 'Awaiting NOA', 'Partial NOA', 'NOA Complete', 'In Transit', 'In Stock', 'Outbound'];

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

function InspectionsSection({ shipmentId }: { shipmentId: string }) {
  const { data: inspections = [], isLoading } = useInspections(shipmentId);
  if (isLoading) return null;
  const inspectionStatusLabel: Record<string, string> = { under_inspection: 'Under Inspection', removed: 'Removed from Box', released: 'Released' };

  return (
    <div className="bg-card rounded-xl border animate-fade-in" style={{ animationDelay: '340ms' }}>
      <div className="px-5 py-4 border-b flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Customs Inspections</h2>
      </div>
      {inspections.length === 0 ? (
        <div className="px-5 py-6 text-center"><span className="status-badge status-cleared">No inspections</span></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left px-5 py-3 font-medium">Parcel Barcode</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {inspections.map((insp: any) => (
                <tr key={insp.id} className="border-b last:border-0">
                  <td className="px-5 py-3 font-mono font-medium">{insp.parcel_barcode || insp.barcode}</td>
                  <td className="px-5 py-3">
                    <span className={`status-badge ${getStatusClass(insp.status)}`}>{inspectionStatusLabel[insp.status] || insp.status}</span>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {insp.confirmed_at ? new Date(insp.confirmed_at).toLocaleString('en-GB') : new Date(insp.created_at).toLocaleString('en-GB')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HubScanProgress({ shipmentId, outerboxes }: { shipmentId: string; outerboxes: any[] }) {
  const { data: manifestParcels = [] } = useManifestParcels(shipmentId);

  const hubData = useMemo(() => {
    const map = new Map<string, { total: number; scanned: number }>();
    const distinctKeys = new Set<string>();
    for (const mp of manifestParcels) {
      const hub = (mp as any).hub || 'Unknown';
      const barcode = (mp as any).outerbox_barcode;
      const key = `${hub}|${barcode}`;
      if (!distinctKeys.has(key)) {
        distinctKeys.add(key);
        if (!map.has(hub)) map.set(hub, { total: 0, scanned: 0 });
        map.get(hub)!.total++;
      }
    }
    for (const box of outerboxes) {
      const hub = (box as any).hub || 'Unknown';
      if (!map.has(hub)) map.set(hub, { total: 0, scanned: 0 });
      if (['scanned_in', 'palletized', 'in_stock', 'scanned_out'].includes(box.status)) {
        map.get(hub)!.scanned++;
      }
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [manifestParcels, outerboxes]);

  if (hubData.length === 0) return null;

  return (
    <div className="bg-card rounded-xl border p-5 animate-fade-in" style={{ animationDelay: '360ms' }}>
      <h2 className="font-semibold mb-4">Scan Progress per Hub</h2>
      <div className="space-y-3">
        {hubData.map(([hub, data]) => {
          const pct = data.total > 0 ? Math.round((data.scanned / data.total) * 100) : 0;
          return (
            <div key={hub} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{hub}</span>
                <span className="text-muted-foreground tabular-nums">{data.scanned} / {data.total} ({pct}%)</span>
              </div>
              <Progress value={pct} className="h-2" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function StaffShipmentDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: shipment, isLoading } = useStaffShipment(id);
  const { data: allWarehouses = [] } = useAllWarehouses();
  const { data: history = [] } = useStatusHistory(id);
  const { data: noaEntries = [] } = useNoas(id);
  const { data: outboundData = [] } = useOutbounds(id);
  const { data: outerboxes = [] } = useOuterboxes(id);

  const warehouseMatch = shipment?.warehouse_id
    ? allWarehouses.find((w: any) => w.id === shipment.warehouse_id)
    : null;
  const warehouseDisplay = warehouseMatch ? `${warehouseMatch.code} — ${warehouseMatch.name}` : '—';

  // Pallet data
  const palletIds = useMemo(() => {
    const ids = new Set<string>();
    outerboxes.forEach((b: any) => { if (b.pallet_id) ids.add(b.pallet_id); });
    return Array.from(ids);
  }, [outerboxes]);
  const { data: pallets = [] } = usePallets(palletIds);

  if (isLoading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!shipment) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <p className="text-muted-foreground mb-4">Shipment not found</p>
        <Link to="/staff" className="text-accent hover:underline text-sm">← Back to MAWB Overview</Link>
      </div>
    );
  }

  const currentIdx = statusOrder.indexOf(shipment.status);
  const subklantName = (shipment as any).subklanten?.name || '—';

  const scannedIn = outerboxes.filter((b: any) => ['scanned_in', 'in_stock', 'scanned_out'].includes(b.status)).length;
  const inStock = outerboxes.filter((b: any) => b.status === 'in_stock').length;
  const scannedOut = outerboxes.filter((b: any) => b.status === 'scanned_out').length;
  const notScanned = outerboxes.filter((b: any) => b.status === 'expected').length;

  const hubGroups = outboundData.reduce((acc: any, ob: any) => {
    const hubCode = ob.hubs?.code || 'Unknown';
    const hubName = ob.hubs?.name || hubCode;
    if (!acc[hubCode]) acc[hubCode] = { hubCode, hubName, pickups: [], totalPieces: 0 };
    const obPallets = ob.pallets || [];
    const pieces = obPallets.reduce((s: number, p: any) => s + (p.pieces || 0), 0);
    acc[hubCode].totalPieces += pieces;
    acc[hubCode].pickups.push({ date: ob.pickup_date, truckReference: ob.truck_reference, status: ob.status, pallets: obPallets, totalPieces: pieces });
    return acc;
  }, {});

  return (
    <div className="space-y-6 max-w-4xl">
      <Link to="/staff" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to MAWB Overview
      </Link>

      <div className="flex items-center gap-3 animate-fade-in">
        <h1 className="text-2xl font-bold font-mono">{shipment.mawb}</h1>
        <StatusBadge status={shipment.status} />
      </div>

      {/* Shipment Info */}
      <div className="bg-card rounded-xl border p-5 animate-fade-in" style={{ animationDelay: '80ms' }}>
        <h2 className="font-semibold mb-4">Shipment Info</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div><span className="text-muted-foreground block text-xs mb-0.5">MAWB</span><span className="font-mono font-medium">{shipment.mawb}</span></div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Customer</span>{(shipment as any).customers?.name || '—'}</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Transport</span>{shipment.transport_type}</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Warehouse</span>{warehouseDisplay}</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Created</span>{new Date(shipment.created_at).toLocaleDateString('en-GB')}</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Colli Expected</span><span className="tabular-nums font-medium">{shipment.colli_expected ?? 0}</span></div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Gross Weight</span>{Number(shipment.gross_weight || 0).toLocaleString()} kg</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Chargeable Weight</span>{Number(shipment.chargeable_weight || 0).toLocaleString()} kg</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Sub Client</span>{subklantName}</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">ETA</span>{shipment.eta ? new Date(shipment.eta).toLocaleDateString('en-GB') : '—'}</div>
        </div>
        {shipment.notes && (
          <div className="mt-4 pt-4 border-t">
            <span className="text-muted-foreground text-xs block mb-1">Notes</span>
            <p className="text-sm">{shipment.notes}</p>
          </div>
        )}
        <div className="flex gap-2 mt-4 pt-4 border-t">
          {['Air Waybill', 'Original Manifest'].map(f => (
            <button key={f} className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
              <Download className="h-3.5 w-3.5" /> {f}
            </button>
          ))}
        </div>
      </div>

      {/* Status Timeline */}
      <div className="bg-card rounded-xl border p-5 animate-fade-in" style={{ animationDelay: '160ms' }}>
        <h2 className="font-semibold mb-4">Status Timeline</h2>
        <div className="space-y-0">
          {statusOrder.map((status, i) => {
            const reached = i <= currentIdx;
            const historyEntry = history.find((h: any) => h.status === status);
            return (
              <div key={status} className="flex gap-3">
                <div className="flex flex-col items-center">
                  {reached
                    ? <CheckCircle2 className="h-5 w-5 text-[hsl(var(--status-delivered))] shrink-0" />
                    : <Circle className="h-5 w-5 text-border shrink-0" />}
                  {i < statusOrder.length - 1 && <div className={`w-px flex-1 min-h-[24px] ${reached && i < currentIdx ? 'bg-[hsl(var(--status-delivered))]' : 'bg-border'}`} />}
                </div>
                <div className="pb-4">
                  <p className={`text-sm font-medium ${reached ? 'text-foreground' : 'text-muted-foreground'}`}>{status}</p>
                  {historyEntry && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(historyEntry.changed_at).toLocaleString('en-GB')} · {historyEntry.changed_by}
                      {historyEntry.notes && <span className="block mt-0.5 italic">{historyEntry.notes}</span>}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* NOA History */}
      <div className="bg-card rounded-xl border animate-fade-in" style={{ animationDelay: '240ms' }}>
        <div className="px-5 py-4 border-b"><h2 className="font-semibold">NOA History</h2></div>
        {noaEntries.length === 0 ? (
          <div className="px-5 py-8 text-center"><span className="text-muted-foreground text-sm">No NOA received yet</span></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left px-5 py-3 font-medium">NOA #</th>
                  <th className="text-left px-5 py-3 font-medium">Date Received</th>
                  <th className="text-left px-5 py-3 font-medium">Received At</th>
                  <th className="text-right px-5 py-3 font-medium">Colli</th>
                  <th className="text-right px-5 py-3 font-medium">Weight (kg)</th>
                  <th className="text-left px-5 py-3 font-medium">Source</th>
                  <th className="text-right px-5 py-3 font-medium">Download</th>
                </tr>
              </thead>
              <tbody>
                {noaEntries.map((n: any) => (
                  <tr key={n.id} className="border-b last:border-0">
                    <td className="px-5 py-3 font-medium">NOA {n.noa_number}</td>
                    <td className="px-5 py-3 text-muted-foreground">{new Date(n.created_at).toLocaleString('en-GB')}</td>
                    <td className="px-5 py-3 text-muted-foreground">{n.received_at ? new Date(n.received_at).toLocaleString('en-GB') : '—'}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{n.colli}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{Number(n.weight).toLocaleString()}</td>
                    <td className="px-5 py-3 text-muted-foreground">{n.source || 'Manual'}</td>
                    <td className="px-5 py-3 text-right">
                      {n.file_path ? (
                        <button className="inline-flex items-center gap-1 text-xs text-accent hover:underline"><Download className="h-3.5 w-3.5" /> Download</button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/30 font-medium border-t">
                  <td className="px-5 py-3">Total</td>
                  <td className="px-5 py-3" colSpan={2}></td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {noaEntries.reduce((sum: number, n: any) => sum + n.colli, 0)} / {shipment.colli_expected ?? '?'}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {noaEntries.reduce((sum: number, n: any) => sum + Number(n.weight), 0).toLocaleString()} kg
                  </td>
                  <td className="px-5 py-3" colSpan={2}>
                    {(() => {
                      const totalColli = noaEntries.reduce((sum: number, n: any) => sum + n.colli, 0);
                      const expected = shipment.colli_expected || 0;
                      if (totalColli >= expected && expected > 0) {
                        return <span className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--status-delivered))]">✅ Complete</span>;
                      }
                      return <span className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--status-partial-noa))]">⚠️ Partial ({expected - totalColli} missing)</span>;
                    })()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <ClearanceSection shipmentId={shipment.id} colliExpected={shipment.colli_expected || 0} />
      <InspectionsSection shipmentId={shipment.id} />

      {/* Warehouse Tracking */}
      {outerboxes.length > 0 && (
        <div className="bg-card rounded-xl border p-5 animate-fade-in" style={{ animationDelay: '400ms' }}>
          <h2 className="font-semibold mb-4">Warehouse Tracking</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm mb-4">
            <div className="bg-muted rounded-lg px-3 py-2"><span className="text-muted-foreground text-xs block">Expected</span><span className="font-bold tabular-nums">{shipment.colli_expected ?? outerboxes.length}</span></div>
            <div className="bg-muted rounded-lg px-3 py-2"><span className="text-muted-foreground text-xs block">Scanned In ✅</span><span className="font-bold tabular-nums">{scannedIn}</span></div>
            <div className="bg-muted rounded-lg px-3 py-2"><span className="text-muted-foreground text-xs block">Not Scanned ❌</span><span className="font-bold tabular-nums">{notScanned}</span></div>
            <div className="bg-muted rounded-lg px-3 py-2"><span className="text-muted-foreground text-xs block">In Stock 📦</span><span className="font-bold tabular-nums">{inStock}</span></div>
            <div className="bg-muted rounded-lg px-3 py-2"><span className="text-muted-foreground text-xs block">Scanned Out 🚚</span><span className="font-bold tabular-nums">{scannedOut}</span></div>
          </div>
          <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden flex">
            {scannedOut > 0 && <div className="bg-[hsl(var(--status-delivered))] h-full" style={{ width: `${(scannedOut / (shipment.colli_expected || outerboxes.length)) * 100}%` }} />}
            {inStock > 0 && <div className="bg-[hsl(var(--status-instock))] h-full" style={{ width: `${(inStock / (shipment.colli_expected || outerboxes.length)) * 100}%` }} />}
            {(scannedIn - inStock - scannedOut) > 0 && <div className="bg-[hsl(var(--status-noa-complete))] h-full" style={{ width: `${((scannedIn - inStock - scannedOut) / (shipment.colli_expected || outerboxes.length)) * 100}%` }} />}
          </div>
        </div>
      )}

      {/* Hub Scan Progress */}
      <HubScanProgress shipmentId={shipment.id} outerboxes={outerboxes} />

      {/* Pallet Overview */}
      {pallets.length > 0 && (
        <div className="bg-card rounded-xl border animate-fade-in" style={{ animationDelay: '420ms' }}>
          <div className="px-5 py-4 border-b"><h2 className="font-semibold">Pallet Overview</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left px-5 py-3 font-medium">Pallet #</th>
                  <th className="text-left px-5 py-3 font-medium">Hub</th>
                  <th className="text-left px-5 py-3 font-medium">Boxes</th>
                  <th className="text-left px-5 py-3 font-medium">Outbound Status</th>
                </tr>
              </thead>
              <tbody>
                {pallets.map((p: any) => {
                  const boxCount = outerboxes.filter((b: any) => b.pallet_id === p.id).length;
                  const obStatus = p.outbounds?.status;
                  return (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="px-5 py-3 font-mono font-medium">{p.pallet_number || p.id.slice(0, 8)}</td>
                      <td className="px-5 py-3">{p.hub || '—'}</td>
                      <td className="px-5 py-3 tabular-nums">{boxCount}</td>
                      <td className="px-5 py-3">
                        {obStatus ? <StatusBadge status={obStatus} /> : <span className="text-muted-foreground text-xs">Not assigned</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Outbound */}
      {Object.keys(hubGroups).length > 0 && (
        <div className="bg-card rounded-xl border animate-fade-in" style={{ animationDelay: '480ms' }}>
          <div className="px-5 py-4 border-b"><h2 className="font-semibold">Outbound</h2></div>
          <div className="divide-y">
            {Object.values(hubGroups).map((group: any) => {
              const pickedUp = group.pickups.reduce((s: number, p: any) => s + p.totalPieces, 0);
              const expected = group.totalExpected || pickedUp;
              const stillInStock = expected - pickedUp;
              return (
                <div key={group.hubCode} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{group.hubName}</span>
                      <span className="text-muted-foreground text-xs">({group.hubCode})</span>
                    </div>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span>Expected: <strong className="text-foreground tabular-nums">{expected}</strong></span>
                      <span>Picked up: <strong className="text-foreground tabular-nums">{pickedUp}</strong></span>
                      <span>In stock: <strong className="text-foreground tabular-nums">{Math.max(0, stillInStock)}</strong></span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {group.pickups.map((pickup: any, pi: number) => (
                      <div key={pi} className="bg-muted/40 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2 text-sm">
                          <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-medium">{pickup.date ? new Date(pickup.date).toLocaleDateString('en-GB') : 'No date'}</span>
                          {pickup.truckReference && <span className="text-muted-foreground text-xs">· Truck: {pickup.truckReference}</span>}
                          {pickup.status && <StatusBadge status={pickup.status} />}
                          <span className="text-muted-foreground text-xs ml-auto">{pickup.totalPieces} pcs</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
  const currentIdx = statusOrder.indexOf(shipment.status);
  const subklantName = (shipment as any).subklanten?.name || '—';

  const scannedIn = outerboxes.filter((b: any) => ['scanned_in', 'in_stock', 'scanned_out'].includes(b.status)).length;
  const inStock = outerboxes.filter((b: any) => b.status === 'in_stock').length;
  const scannedOut = outerboxes.filter((b: any) => b.status === 'scanned_out').length;
  const notScanned = outerboxes.filter((b: any) => b.status === 'expected').length;

  const hubGroups = outboundData.reduce((acc: any, ob: any) => {
    const hubCode = ob.hubs?.code || 'Unknown';
    const hubName = ob.hubs?.name || hubCode;
    if (!acc[hubCode]) acc[hubCode] = { hubCode, hubName, pickups: [], totalPieces: 0 };
    const pallets = ob.pallets || [];
    const pieces = pallets.reduce((s: number, p: any) => s + (p.pieces || 0), 0);
    acc[hubCode].totalPieces += pieces;
    acc[hubCode].pickups.push({ date: ob.pickup_date, truckReference: ob.truck_reference, pallets, totalPieces: pieces });
    return acc;
  }, {});

  return (
    <div className="space-y-6 max-w-4xl">
      <Link to="/staff" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to MAWB Overview
      </Link>

      <div className="flex items-center gap-3 animate-fade-in">
        <h1 className="text-2xl font-bold font-mono">{shipment.mawb}</h1>
        <StatusBadge status={shipment.status} />
      </div>

      {/* Shipment Info */}
      <div className="bg-card rounded-xl border p-5 animate-fade-in" style={{ animationDelay: '80ms' }}>
        <h2 className="font-semibold mb-4">Shipment Info</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div><span className="text-muted-foreground block text-xs mb-0.5">MAWB</span><span className="font-mono font-medium">{shipment.mawb}</span></div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Customer</span>{(shipment as any).customers?.name || '—'}</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Transport</span>{shipment.transport_type}</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Warehouse</span>{warehouseDisplay}</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Created</span>{new Date(shipment.created_at).toLocaleDateString('en-GB')}</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Weight</span>{Number(shipment.chargeable_weight || 0).toLocaleString()} kg</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Gross Weight</span>{Number(shipment.gross_weight || 0).toLocaleString()} kg</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Sub Client</span>{subklantName}</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">ETA</span>{shipment.eta ? new Date(shipment.eta).toLocaleDateString('en-GB') : '—'}</div>
        </div>
        {shipment.notes && (
          <div className="mt-4 pt-4 border-t">
            <span className="text-muted-foreground text-xs block mb-1">Notes</span>
            <p className="text-sm">{shipment.notes}</p>
          </div>
        )}
        <div className="flex gap-2 mt-4 pt-4 border-t">
          {['Air Waybill', 'Original Manifest'].map(f => (
            <button key={f} className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
              <Download className="h-3.5 w-3.5" /> {f}
            </button>
          ))}
        </div>
      </div>

      {/* Status Timeline */}
      <div className="bg-card rounded-xl border p-5 animate-fade-in" style={{ animationDelay: '160ms' }}>
        <h2 className="font-semibold mb-4">Status Timeline</h2>
        <div className="space-y-0">
          {statusOrder.map((status, i) => {
            const reached = i <= currentIdx;
            const historyEntry = history.find((h: any) => h.status === status);
            return (
              <div key={status} className="flex gap-3">
                <div className="flex flex-col items-center">
                  {reached
                    ? <CheckCircle2 className="h-5 w-5 text-[hsl(var(--status-delivered))] shrink-0" />
                    : <Circle className="h-5 w-5 text-border shrink-0" />}
                  {i < statusOrder.length - 1 && <div className={`w-px flex-1 min-h-[24px] ${reached && i < currentIdx ? 'bg-[hsl(var(--status-delivered))]' : 'bg-border'}`} />}
                </div>
                <div className="pb-4">
                  <p className={`text-sm font-medium ${reached ? 'text-foreground' : 'text-muted-foreground'}`}>{status}</p>
                  {historyEntry && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(historyEntry.changed_at).toLocaleString('en-GB')} · {historyEntry.changed_by}
                      {historyEntry.notes && <span className="block mt-0.5 italic">{historyEntry.notes}</span>}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* NOA History */}
      <div className="bg-card rounded-xl border animate-fade-in" style={{ animationDelay: '240ms' }}>
        <div className="px-5 py-4 border-b"><h2 className="font-semibold">NOA History</h2></div>
        {noaEntries.length === 0 ? (
          <div className="px-5 py-8 text-center"><span className="text-muted-foreground text-sm">No NOA received yet</span></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left px-5 py-3 font-medium">NOA #</th>
                  <th className="text-left px-5 py-3 font-medium">Date Received</th>
                  <th className="text-left px-5 py-3 font-medium">Received At</th>
                  <th className="text-right px-5 py-3 font-medium">Colli</th>
                  <th className="text-right px-5 py-3 font-medium">Weight (kg)</th>
                  <th className="text-left px-5 py-3 font-medium">Source</th>
                  <th className="text-right px-5 py-3 font-medium">Download</th>
                </tr>
              </thead>
              <tbody>
                {noaEntries.map((n: any) => (
                  <tr key={n.id} className="border-b last:border-0">
                    <td className="px-5 py-3 font-medium">NOA {n.noa_number}</td>
                    <td className="px-5 py-3 text-muted-foreground">{new Date(n.created_at).toLocaleString('en-GB')}</td>
                    <td className="px-5 py-3 text-muted-foreground">{n.received_at ? new Date(n.received_at).toLocaleString('en-GB') : '—'}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{n.colli}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{Number(n.weight).toLocaleString()}</td>
                    <td className="px-5 py-3 text-muted-foreground">{n.source || 'Manual'}</td>
                    <td className="px-5 py-3 text-right">
                      {n.file_path ? (
                        <button className="inline-flex items-center gap-1 text-xs text-accent hover:underline"><Download className="h-3.5 w-3.5" /> Download</button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/30 font-medium border-t">
                  <td className="px-5 py-3">Total</td>
                  <td className="px-5 py-3" colSpan={2}></td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {noaEntries.reduce((sum: number, n: any) => sum + n.colli, 0)} / {shipment.colli_expected ?? '?'}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {noaEntries.reduce((sum: number, n: any) => sum + Number(n.weight), 0).toLocaleString()} kg
                  </td>
                  <td className="px-5 py-3" colSpan={2}>
                    {(() => {
                      const totalColli = noaEntries.reduce((sum: number, n: any) => sum + n.colli, 0);
                      const expected = shipment.colli_expected || 0;
                      if (totalColli >= expected && expected > 0) {
                        return <span className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--status-delivered))]">✅ Complete</span>;
                      }
                      return <span className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--status-partial-noa))]">⚠️ Partial ({expected - totalColli} missing)</span>;
                    })()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <ClearanceSection shipmentId={shipment.id} colliExpected={shipment.colli_expected || 0} />
      <InspectionsSection shipmentId={shipment.id} />

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

      {Object.keys(hubGroups).length > 0 && (
        <div className="bg-card rounded-xl border animate-fade-in" style={{ animationDelay: '480ms' }}>
          <div className="px-5 py-4 border-b"><h2 className="font-semibold">Outbound</h2></div>
          <div className="divide-y">
            {Object.values(hubGroups).map((group: any) => {
              const pickedUp = group.pickups.reduce((s: number, p: any) => s + p.totalPieces, 0);
              const expected = group.totalExpected || pickedUp;
              const stillInStock = expected - pickedUp;
              return (
                <div key={group.hubCode} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{group.hubName}</span>
                      <span className="text-muted-foreground text-xs">({group.hubCode})</span>
                    </div>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span>Expected: <strong className="text-foreground tabular-nums">{expected}</strong></span>
                      <span>Picked up: <strong className="text-foreground tabular-nums">{pickedUp}</strong></span>
                      <span>In stock: <strong className="text-foreground tabular-nums">{Math.max(0, stillInStock)}</strong></span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {group.pickups.map((pickup: any, pi: number) => (
                      <div key={pi} className="bg-muted/40 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2 text-sm">
                          <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-medium">{pickup.date ? new Date(pickup.date).toLocaleDateString('en-GB') : 'No date'}</span>
                          {pickup.truckReference && <span className="text-muted-foreground text-xs">· Truck: {pickup.truckReference}</span>}
                          <span className="text-muted-foreground text-xs ml-auto">{pickup.totalPieces} pcs</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}