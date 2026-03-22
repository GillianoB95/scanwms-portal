import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Download, CheckCircle2, Circle, MessageSquare, Truck, Loader2 } from 'lucide-react';
import { useShipment, useStatusHistory, useNoas, useOutbounds, useOuterboxes } from '@/hooks/use-shipment-data';
import { StatusBadge } from '@/components/StatusBadge';

const statusOrder = ['Created', 'NOA Received', 'Arrived', 'In Stock', 'In Transit', 'Delivered'];

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

  // Group outbounds by hub
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

      {/* Section 1 — Info */}
      <div className="bg-card rounded-xl border p-5 animate-fade-in" style={{ animationDelay: '80ms' }}>
        <h2 className="font-semibold mb-4">Shipment Info</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <div><span className="text-muted-foreground block text-xs mb-0.5">MAWB</span><span className="font-mono font-medium">{shipment.mawb}</span></div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Subklant</span>{subklantName}</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Warehouse</span>{shipment.warehouse_id}</div>
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

      {/* Section 2 — Timeline */}
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

      {/* Section 3 — NOA History */}
      {noaEntries.length > 0 && (
        <div className="bg-card rounded-xl border animate-fade-in" style={{ animationDelay: '240ms' }}>
          <div className="px-5 py-4 border-b"><h2 className="font-semibold">NOA History</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left px-5 py-3 font-medium">#</th>
                  <th className="text-left px-5 py-3 font-medium">Date Received</th>
                  <th className="text-right px-5 py-3 font-medium">Colli</th>
                  <th className="text-right px-5 py-3 font-medium">Weight</th>
                  <th className="text-left px-5 py-3 font-medium">Status</th>
                  <th className="text-right px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {noaEntries.map((n: any) => (
                  <tr key={n.id} className="border-b">
                    <td className="px-5 py-3 font-medium">NOA {n.noa_number}</td>
                    <td className="px-5 py-3 text-muted-foreground">{new Date(n.received_at).toLocaleString('en-GB')}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{n.colli}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{Number(n.weight).toLocaleString()} kg</td>
                    <td className="px-5 py-3"><span className="status-badge status-delivered">Received</span></td>
                    <td className="px-5 py-3 text-right">
                      <button className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                        <Download className="h-3.5 w-3.5" /> Download
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="bg-muted/30 font-medium">
                  <td className="px-5 py-3">Total</td>
                  <td className="px-5 py-3"></td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {noaEntries.reduce((sum: number, n: any) => sum + n.colli, 0)} / {shipment.colli_expected}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {noaEntries.reduce((sum: number, n: any) => sum + Number(n.weight), 0).toLocaleString()} kg
                  </td>
                  <td className="px-5 py-3" colSpan={2}>
                    {noaEntries.reduce((sum: number, n: any) => sum + n.colli, 0) >= (shipment.colli_expected || 0) ? (
                      <span className="status-badge status-delivered">✅ Complete</span>
                    ) : (
                      <span className="status-badge status-intransit">⚠ Partial ({(shipment.colli_expected || 0) - noaEntries.reduce((sum: number, n: any) => sum + n.colli, 0)} missing)</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Section 4 — Warehouse Tracking */}
      {outerboxes.length > 0 && (
        <div className="bg-card rounded-xl border p-5 animate-fade-in" style={{ animationDelay: '320ms' }}>
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
            {(scannedIn - inStock - scannedOut) > 0 && <div className="bg-[hsl(var(--status-arrived))] h-full" style={{ width: `${((scannedIn - inStock - scannedOut) / outerboxes.length) * 100}%` }} />}
          </div>
        </div>
      )}

      {/* Section 5 — Outbound (grouped by hub → pickup) */}
      {Object.keys(hubGroups).length > 0 && (
        <div className="bg-card rounded-xl border animate-fade-in" style={{ animationDelay: '400ms' }}>
          <div className="px-5 py-4 border-b"><h2 className="font-semibold">Outbound</h2></div>
          <div className="divide-y">
            {Object.values(hubGroups).map((group: any) => (
              <div key={group.hubCode} className="px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{group.hubCode}</span>
                    <span className="text-muted-foreground text-xs">({group.hubName})</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span>Total: <strong className="text-foreground tabular-nums">{group.totalPieces}</strong> pieces</span>
                  </div>
                </div>
                <div className="space-y-3">
                  {group.pickups.map((pickup: any, pi: number) => (
                    <div key={pi} className="bg-muted/40 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2 text-sm">
                        <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium">{new Date(pickup.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}</span>
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
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
