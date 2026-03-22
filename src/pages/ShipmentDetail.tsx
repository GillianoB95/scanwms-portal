import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Download, FileText, CheckCircle2, Circle, MessageSquare } from 'lucide-react';
import { shipments, statusOrder, getStatusHistory, getOuterboxes, getPallets, getNotes, type ShipmentStatus } from '@/lib/mock-data';
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
  const pallets = getPallets(shipment.id);
  const notes = getNotes(shipment.id);

  const currentIdx = statusOrder.indexOf(shipment.status);

  const scannedIn = outerboxes.filter(b => b.status === 'scanned_in' || b.status === 'in_stock' || b.status === 'scanned_out').length;
  const inStock = outerboxes.filter(b => b.status === 'in_stock').length;
  const scannedOut = outerboxes.filter(b => b.status === 'scanned_out').length;
  const notScanned = outerboxes.filter(b => b.status === 'expected').length;

  const noaMatch = shipment.colliNoa !== null ? shipment.colliExpected === shipment.colliNoa : null;

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

      {/* Section 3 — NOA */}
      {shipment.colliNoa !== null && (
        <div className="bg-card rounded-xl border p-5 animate-fade-in" style={{ animationDelay: '240ms' }}>
          <h2 className="font-semibold mb-4">NOA Comparison</h2>
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-muted-foreground text-xs block">Expected</span>
              <span className="text-lg font-bold tabular-nums">{shipment.colliExpected}</span>
            </div>
            <div>
              <span className="text-muted-foreground text-xs block">NOA</span>
              <span className="text-lg font-bold tabular-nums">{shipment.colliNoa}</span>
            </div>
            <div className={`status-badge ${noaMatch ? 'status-delivered' : 'status-intransit'}`}>
              {noaMatch ? 'Match ✓' : `Difference: ${shipment.colliExpected - (shipment.colliNoa ?? 0)}`}
            </div>
          </div>
          <button className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline mt-3">
            <Download className="h-3.5 w-3.5" /> Download NOA
          </button>
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

      {/* Section 5 — Outbound */}
      {pallets.length > 0 && (
        <div className="bg-card rounded-xl border animate-fade-in" style={{ animationDelay: '400ms' }}>
          <div className="px-5 py-4 border-b"><h2 className="font-semibold">Outbound</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left px-5 py-3 font-medium">Pallet</th>
                  <th className="text-left px-5 py-3 font-medium">Hub</th>
                  <th className="text-left px-5 py-3 font-medium hidden sm:table-cell">Truck</th>
                  <th className="text-right px-5 py-3 font-medium">Pieces</th>
                  <th className="text-right px-5 py-3 font-medium hidden sm:table-cell">Weight</th>
                  <th className="text-left px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {pallets.map(p => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-5 py-3 font-mono">{p.palletNumber}</td>
                    <td className="px-5 py-3">{p.hub}</td>
                    <td className="px-5 py-3 hidden sm:table-cell font-mono text-muted-foreground">{p.truckReference}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{p.pieces}</td>
                    <td className="px-5 py-3 text-right tabular-nums hidden sm:table-cell">{p.weight} kg</td>
                    <td className="px-5 py-3"><StatusBadge status={p.status as any} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
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
