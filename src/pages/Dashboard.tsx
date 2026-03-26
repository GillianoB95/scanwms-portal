import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Clock, Package, Truck, Warehouse, Loader2, CircleDot, CheckCircle2 } from 'lucide-react';
import { useShipments } from '@/hooks/use-shipment-data';
import { StatusBadge } from '@/components/StatusBadge';

type StatusFilter = 'all' | 'needs-action' | 'awaiting-noa' | 'partial-noa' | 'noa-complete' | 'in-transit' | 'in-stock' | 'outbound';

function hoursAgo(dateStr: string): number {
  const now = new Date();
  const then = new Date(dateStr);
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60));
}

function waitingTime(dateStr: string): string {
  const h = hoursAgo(dateStr);
  if (h < 1) return '<1h';
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export default function Dashboard() {
  const { data: shipments = [], isLoading } = useShipments();
  const [activeFilter, setActiveFilter] = useState<StatusFilter>('all');

  const needsAction = shipments.filter((s: any) => s.status === 'Needs Action');
  const awaitingNoa = shipments.filter((s: any) => s.status === 'Awaiting NOA');
  const partialNoa = shipments.filter((s: any) => s.status === 'Partial NOA');
  const noaComplete = shipments.filter((s: any) => s.status === 'NOA Complete');
  const inTransit = shipments.filter((s: any) => s.status === 'In Transit');
  const inStock = shipments.filter((s: any) => s.status === 'In Stock');
  const outbound = shipments.filter((s: any) => s.status === 'Outbound');

  const statusRows: { key: StatusFilter; label: string; count: number; dot: string; icon: React.ElementType }[] = [
    { key: 'needs-action', label: 'Needs Action', count: needsAction.length, dot: 'bg-[hsl(var(--status-needs-action))]', icon: AlertTriangle },
    { key: 'awaiting-noa', label: 'Awaiting NOA', count: awaitingNoa.length, dot: 'bg-[hsl(var(--status-awaiting-noa))]', icon: Clock },
    { key: 'partial-noa', label: 'Partial NOA', count: partialNoa.length, dot: 'bg-[hsl(var(--status-partial-noa))]', icon: CircleDot },
    { key: 'noa-complete', label: 'NOA Complete', count: noaComplete.length, dot: 'bg-[hsl(var(--status-noa-complete))]', icon: CheckCircle2 },
    { key: 'in-transit', label: 'In Transit', count: inTransit.length, dot: 'bg-[hsl(var(--status-intransit))]', icon: Truck },
    { key: 'in-stock', label: 'In Stock', count: inStock.length, dot: 'bg-[hsl(var(--status-instock))]', icon: Warehouse },
    { key: 'outbound', label: 'Outbound', count: outbound.length, dot: 'bg-[hsl(var(--status-outbound))]', icon: Package },
  ];

  const tableShipments = useMemo(() => {
    const filterMap: Record<StatusFilter, any[]> = {
      'all': shipments.filter((s: any) => s.status !== 'Outbound'),
      'needs-action': needsAction,
      'awaiting-noa': awaitingNoa,
      'partial-noa': partialNoa,
      'noa-complete': noaComplete,
      'in-transit': inTransit,
      'in-stock': inStock,
      'outbound': outbound,
    };
    return [...filterMap[activeFilter]].sort(
      (a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
    );
  }, [activeFilter, shipments]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-balance">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Today's overview — {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>

      <div className="bg-card rounded-xl border divide-y animate-fade-in">
        {statusRows.map((row, i) => (
          <button
            key={row.key}
            onClick={() => setActiveFilter(activeFilter === row.key ? 'all' : row.key)}
            className={`w-full flex items-center gap-3 px-5 py-3.5 text-sm transition-colors hover:bg-muted/50 active:scale-[0.995] ${activeFilter === row.key ? 'bg-muted/70' : ''}`}
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${row.dot} shrink-0`} />
            <row.icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="font-medium flex-1 text-left">{row.label}</span>
            <span className="text-xl font-bold tabular-nums">{row.count}</span>
          </button>
        ))}
      </div>

      <div className="bg-card rounded-xl border animate-fade-in" style={{ animationDelay: '420ms' }}>
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold">
            {activeFilter === 'all' ? 'Active Shipments' : statusRows.find(r => r.key === activeFilter)?.label}
            <span className="text-muted-foreground font-normal ml-2 text-sm">({tableShipments.length})</span>
          </h2>
          {activeFilter !== 'all' && (
            <button onClick={() => setActiveFilter('all')} className="text-xs text-accent hover:underline">Show all</button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left px-5 py-3 font-medium">MAWB</th>
                <th className="text-right px-5 py-3 font-medium hidden md:table-cell">Pieces</th>
                
                <th className="text-right px-5 py-3 font-medium hidden md:table-cell">Weight</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium hidden lg:table-cell">Waiting</th>
              </tr>
            </thead>
            <tbody>
              {tableShipments.map((s: any) => {
                const isNeedsAction = s.status === 'Needs Action';
                return (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                    <td className="px-5 py-3">
                      <Link to={`/shipments/${s.id}`} className="font-mono font-medium text-accent hover:underline">{s.mawb}</Link>
                      {isNeedsAction && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[hsl(var(--status-needs-action)/0.15)] text-[hsl(var(--status-needs-action))]">
                          <AlertTriangle className="h-3 w-3" /> Action needed
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums hidden md:table-cell">{s.colli_expected}</td>
                    
                    <td className="px-5 py-3 text-right tabular-nums hidden md:table-cell">{Number(s.chargeable_weight).toLocaleString()} kg</td>
                    <td className="px-5 py-3"><StatusBadge status={s.status} /></td>
                    <td className="px-5 py-3 hidden lg:table-cell text-muted-foreground tabular-nums">{waitingTime(s.updated_at)}</td>
                  </tr>
                );
              })}
              {tableShipments.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-muted-foreground">No shipments in this category</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
