import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Download, CheckCircle2, Circle, MessageSquare, Truck } from 'lucide-react';
import { shipments, statusOrder, getStatusHistory, getOuterboxes, getNoaEntries, getOutboundGroups, getNotes } from '@/lib/mock-data';
import { StatusBadge } from '@/components/StatusBadge';

export default function ShipmentDetail() {
  const { id } = useParams<{ id: string }>();
  const shipment = shipments.find(s => s.id === id);

  if (!shipment) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <p className="text-muted-foreground mb-4">Shipment not found</p>
        <Link to="/shipments" className="text-accent hover:underline text-sm">← Back to shipments</Link>
      </div>
    );
  }

  const history = getStatusHistory(shipment.id);
  const outerboxes = getOuterboxes(shipment.id);
  const noaEntries = getNoaEntries(shipment.id);
  const outboundGroups = getOutboundGroups(shipment.id);
  const notes = getNotes(shipment.id);

  const currentIdx = statusOrder.indexOf(shipment.status);

  const scannedIn = outerboxes.filter(b => b.status === 'scanned_in' || b.status === 'in_stock' || b.status === 'scanned_out').length;
  const inStock = outerboxes.filter(b => b.status === 'in_stock').length;
  const scannedOut = outerboxes.filter(b => b.status === 'scanned_out').length;
  const notScanned = outerboxes.filter(b => b.status === 'expected').length;

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
          <div><span className="text-muted-foreground block text-xs mb-0.5">Subklant</span>{shipment.subklant}</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Warehouse</span>{shipment.warehouse}</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Transport</span>{shipment.transportType}</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Created</span>{shipment.createdAt}</div>
          <div><span className="text-muted-foreground block text-xs mb-0.5">Weight</span>{shipment.chargeableWeight.toLocaleString()} kg</div>
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
            const historyEntry = history.find(h => h.status === status);
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
                      {historyEntry.changedAt} · {historyEntry.changedBy}
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
                {noaEntries.map(n => (
                  <tr key={n.id} className="border-b">
                    <td className="px-5 py-3 font-medium">NOA {n.noaNumber}</td>
                    <td className="px-5 py-3 text-muted-foreground">{n.receivedAt}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{n.colli}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{n.weight.toLocaleString()} kg</td>
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
                    {noaEntries.reduce((sum, n) => sum + n.colli, 0)} / {shipment.colliExpected}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {noaEntries.reduce((sum, n) => sum + n.weight, 0).toLocaleString()} kg
                  </td>
                  <td className="px-5 py-3" colSpan={2}>
                    {noaEntries.reduce((sum, n) => sum + n.colli, 0) >= shipment.colliExpected ? (
                      <span className="status-badge status-delivered">✅ Complete</span>
                    ) : (
                      <span className="status-badge status-intransit">⚠ Partial ({shipment.colliExpected - noaEntries.reduce((sum, n) => sum + n.colli, 0)} missing)</span>
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
      {outboundGroups.length > 0 && (
        <div className="bg-card rounded-xl border animate-fade-in" style={{ animationDelay: '400ms' }}>
          <div className="px-5 py-4 border-b"><h2 className="font-semibold">Outbound</h2></div>
          <div className="divide-y">
            {outboundGroups.map(group => (
              <div key={group.hubCode} className="px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{group.hubCode}</span>
                    <span className="text-muted-foreground text-xs">({group.hub})</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>Expected: <strong className="text-foreground tabular-nums">{group.totalExpected}</strong></span>
                    <span>Picked up: <strong className="text-foreground tabular-nums">{group.totalPickedUp}</strong></span>
                    {group.stillInStock > 0 && (
                      <span className="text-[hsl(var(--status-intransit))]">In stock: <strong className="tabular-nums">{group.stillInStock}</strong></span>
                    )}
                  </div>
                </div>
                <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mb-3">
                  <div
                    className="bg-[hsl(var(--status-delivered))] h-full rounded-full transition-all"
                    style={{ width: `${(group.totalPickedUp / group.totalExpected) * 100}%` }}
                  />
                </div>
                <div className="space-y-3">
                  {group.pickups.map((pickup, pi) => (
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
                        {pickup.pallets.map(pallet => (
                          <div key={pallet.id} className="flex items-center justify-between text-sm py-1.5 px-3 bg-background rounded-md">
                            <div className="flex items-center gap-4">
                              <span className="font-mono font-medium">{pallet.palletNumber}</span>
                              <span className="tabular-nums text-muted-foreground">{pallet.pieces} pcs</span>
                              <span className="tabular-nums text-muted-foreground">{pallet.weight.toLocaleString()} kg</span>
                            </div>
                            <StatusBadge status={pallet.status as any} />
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

      {/* Section 6 — Notes */}
      {notes.length > 0 && (
        <div className="bg-card rounded-xl border p-5 animate-fade-in" style={{ animationDelay: '480ms' }}>
          <h2 className="font-semibold mb-4 flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Notes</h2>
          <div className="space-y-3">
            {notes.map(n => (
              <div key={n.id} className="text-sm">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-medium">{n.author}</span>
                  <span className="text-muted-foreground text-xs">{n.createdAt}</span>
                </div>
                <p className="text-muted-foreground">{n.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}