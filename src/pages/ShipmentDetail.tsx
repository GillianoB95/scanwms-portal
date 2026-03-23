import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Download, CheckCircle2, Circle, Truck, Loader2, Shield, AlertTriangle } from 'lucide-react';
import { useShipment, useStatusHistory, useNoas, useOutbounds, useOuterboxes, useClearances, useInspections } from '@/hooks/use-shipment-data';
import { StatusBadge } from '@/components/StatusBadge';
import { getStatusClass } from '@/lib/mock-data';

const statusOrder = ['Created', 'Awaiting NOA', 'Partial NOA', 'NOA Complete', 'In Transit', 'In Stock', 'Outbound'];

function ClearanceSection({ shipmentId, colliExpected }: { shipmentId: string; colliExpected: number }) {
  const { data: clearances = [], isLoading } = useClearances(shipmentId);

  if (isLoading) return null;

  const totalCleared = clearances.reduce((sum: number, c: any) => sum + (c.colli_cleared || 0), 0);
  const latestStatus = clearances.length > 0
    ? (totalCleared >= colliExpected ? 'cleared' : totalCleared > 0 ? 'partial' : 'pending')
    : 'pending';

  const statusLabel: Record<string, string> = {
    pending: 'Pending',
    partial: 'Partially Cleared',
    cleared: 'Fully Cleared',
  };

  const pending = colliExpected - totalCleared;

  return (
    <div className="bg-card rounded-xl border p-5 animate-fade-in" style={{ animationDelay: '280ms' }}>
      <div className="flex items-center gap-2 mb-4">
        <Shield className="h-4.5 w-4.5 text-muted-foreground" />
        <h2 className="font-semibold">Customs Clearance</h2>
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        <span className={`status-badge ${getStatusClass(latestStatus)}`}>
          {statusLabel[latestStatus]}
        </span>
        <span className="text-sm tabular-nums">
          <strong>{totalCleared}</strong> / {colliExpected} colli cleared
        </span>
      </div>
      {latestStatus === 'partial' && pending > 0 && (
        <p className="text-sm text-muted-foreground mt-3">
          ⚠ {pending} colli still pending clearance
        </p>
      )}
      {clearances.length > 0 && (
        <div className="mt-4 space-y-2">
          {clearances.map((c: any) => (
            <div key={c.id} className="flex items-center justify-between text-sm py-2 px-3 bg-muted/40 rounded-lg">
              <div>
                <span className="tabular-nums font-medium">{c.colli_cleared} colli</span>
                {c.cleared_by && <span className="text-muted-foreground ml-2">by {c.cleared_by}</span>}
              </div>
              {c.cleared_at && (
                <span className="text-muted-foreground text-xs">{new Date(c.cleared_at).toLocaleString('en-GB')}</span>
              )}
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

  const inspectionStatusLabel: Record<string, string> = {
    under_inspection: 'Under Inspection',
    removed: 'Removed from Box',
    released: 'Released',
  };

  return (
    <div className="bg-card rounded-xl border animate-fade-in" style={{ animationDelay: '340ms' }}>
      <div className="px-5 py-4 border-b flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Customs Inspections</h2>
      </div>
      {inspections.length === 0 ? (
        <div className="px-5 py-6 text-center">
          <span className="status-badge status-cleared">No inspections</span>
        </div>
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
                  <td className="px-5 py-3 font-mono font-medium">{insp.parcel_barcode}</td>
                  <td className="px-5 py-3">
                    <span className={`status-badge ${getStatusClass(insp.status)}`}>
                      {inspectionStatusLabel[insp.status] || insp.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {insp.confirmed_at
                      ? new Date(insp.confirmed_at).toLocaleString('en-GB')
                      : new Date(insp.created_at).toLocaleString('en-GB')}
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

  const currentIdx = statusOrder.indexOf(shipment.status);
  const subklantName = (shipment as any).subklanten?.name || '—';

  const scannedIn = outerboxes.filter((b: any) => ['scanned_in', 'in_stock', 'scanned_out'].includes(b.status)).length;
  const inStock = outerboxes.filter((b: any) => b.status === 'in_stock').length;
  const scannedOut = outerboxes.filter((b: any) => b.status === 'scanned_out').length;
  const notScanned = outerboxes.filter((b: any) => b.status === 'expected').length;

  const hubGroups = outboundData.reduce((acc: any, ob: any) => {
    const hubCode = ob.hubs?.code || 'Unknown';
    const hubName = ob.hubs?.name || hubCode;
    if (!acc[hubCode]) {
      acc[hubCode] = { hubCode, hubName, pickups: [], totalPieces: 0 };
    }
    const pallets = ob.pallets || [];
    const pieces = pallets.reduce((s: number, p: any) => s + (p.pieces || 0), 0);
    acc[hubCode].totalPieces += pieces;
    acc[hubCode].pickups.push({
      date: ob.pickup_date,
      truckReference: ob.truck_reference,
      pallets,
      totalPieces: pieces,
    });
    return acc;
  }, {});

  return (
    <div className="space-y-6 max-w-4xl">
      <Link to="/shipments" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to shipments
      </Link>

      <div className="flex items-center gap-3 animate-fade-in">
        <h1 className="text-2xl font-bold font-mono">{shipment.mawb}</h1>
        <StatusBadge status={shipment.status} />
      </div>

      {/* Shipment Info */}
      <div className="bg-card rounded-xl border p-5 animate-fade-in" style={{ animationDelay: '80ms' }}>
        <h2 className="font-semibold mb-4">Shipment Info</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <div><span className="text-muted-foreground block text-xs mb-0.5">MAWB</span><span className="font-mono font-medium">{shipment.mawb}</span></div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Transport</span>{shipment.transport_type}</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Created</span>{new Date(shipment.created_at).toLocaleDateString('en-GB')}</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Weight</span>{Number(shipment.chargeable_weight).toLocaleString()} kg</div>
        </div>
        <div className="flex gap-2 mt-4 pt-4 border-t">
          {['Air Waybill', 'Original Manifest', 'Cleaned Manifest'].map(f => (
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
                    : <Circle className="h-5 w-5 text-border shrink-0" />
                  }
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
                        <button className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                          <Download className="h-3.5 w-3.5" /> Download
                        </button>
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

      {/* Customs Clearance */}
      <ClearanceSection shipmentId={shipment.id} colliExpected={shipment.colli_expected || 0} />

      {/* Customs Inspections */}
      <InspectionsSection shipmentId={shipment.id} />

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
                          <span className="font-medium">{new Date(pickup.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                          <span className="text-muted-foreground">—</span>
                          <span className="font-mono text-muted-foreground">{pickup.truckReference}</span>
                          <span className="text-muted-foreground">—</span>
                          <span className="tabular-nums">{pickup.totalPieces} pieces</span>
                        </div>
                        <div className="space-y-1">
                          {pickup.pallets.map((pallet: any) => (
                            <div key={pallet.id} className="flex items-center justify-between text-sm py-1.5 px-3 bg-background rounded-md">
                              <div className="flex items-center gap-4">
                                <span className="font-mono font-medium">{pallet.pallet_number}</span>
                                <span className="tabular-nums text-muted-foreground">{pallet.pieces} pcs</span>
                                <span className="tabular-nums text-muted-foreground">{Number(pallet.weight).toLocaleString()} kg</span>
                              </div>
                              <StatusBadge status={pallet.status} />
                            </div>
                          ))}
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
