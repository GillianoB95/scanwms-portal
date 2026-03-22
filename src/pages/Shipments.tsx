import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight, Loader2, Lock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useShipments, useAllClearances, useAllInspections } from '@/hooks/use-shipment-data';
import { StatusBadge } from '@/components/StatusBadge';

type Tab = 'active' | 'archive';
type SubFilter = 'all' | 'awaiting-noa' | 'partial-noa' | 'noa-complete' | 'in-transit' | 'in-stock' | 'outbound';

const PER_PAGE = 25;

function waitingTime(dateStr: string): string {
  const now = new Date();
  const then = new Date(dateStr);
  const h = Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60));
  if (h < 1) return '<1h';
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

const subFilterConfig: { key: SubFilter; label: string; match: (s: any) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'awaiting-noa', label: 'Awaiting NOA', match: s => s.status === 'Created' || s.status === 'Awaiting NOA' },
  { key: 'partial-noa', label: 'Partial NOA', match: s => s.status === 'Partial NOA' },
  { key: 'noa-complete', label: 'NOA Complete', match: s => s.status === 'NOA Complete' },
  { key: 'in-transit', label: 'In Transit', match: s => s.status === 'In Transit' },
  { key: 'in-stock', label: 'In Stock', match: s => s.status === 'In Stock' },
  { key: 'outbound', label: 'Outbound', match: s => s.status === 'Outbound' },
];

export default function Shipments() {
  const { data: shipments = [], isLoading } = useShipments();
  const { data: allClearances = [] } = useAllClearances();
  const { data: allInspections = [] } = useAllInspections();
  const [tab, setTab] = useState<Tab>('active');
  const [search, setSearch] = useState('');
  const [subFilter, setSubFilter] = useState<SubFilter>('all');
  const [page, setPage] = useState(1);

  // Build lookup maps
  const clearanceMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of allClearances) {
      // Take the "best" status per shipment
      const current = map[c.shipment_id];
      if (c.status === 'cleared' || (!current && c.status)) {
        map[c.shipment_id] = c.status;
      }
    }
    return map;
  }, [allClearances]);

  const inspectionMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const i of allInspections) {
      if (i.status === 'under_inspection' || i.status === 'removed') {
        map[i.shipment_id] = true;
      }
    }
    return map;
  }, [allInspections]);

  const activeShipments = useMemo(() => shipments.filter((s: any) => s.status !== 'Outbound'), [shipments]);
  const archiveShipments = useMemo(() => shipments.filter((s: any) => s.status === 'Outbound'), [shipments]);

  const filtered = useMemo(() => {
    const base = tab === 'active' ? activeShipments : archiveShipments;
    let result = [...base];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter((s: any) => s.mawb.includes(q) || s.subklanten?.name?.toLowerCase().includes(q));
    }

    if (tab === 'active' && subFilter !== 'all') {
      const cfg = subFilterConfig.find(f => f.key === subFilter);
      if (cfg) result = result.filter(cfg.match);
    }

    return result.sort(
      (a: any, b: any) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
    );
  }, [tab, search, subFilter, activeShipments, archiveShipments]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const handleTabChange = (t: Tab) => {
    setTab(t);
    setPage(1);
    setSubFilter('all');
    setSearch('');
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Shipments</h1>
        <p className="text-muted-foreground text-sm mt-1">View and manage all shipments</p>
      </div>

      <div className="relative max-w-md animate-fade-in">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          placeholder="Search by MAWB number..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="w-full h-10 pl-9 pr-3 rounded-lg border bg-card text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="flex items-center gap-1 border-b animate-fade-in" style={{ animationDelay: '60ms' }}>
        <button
          onClick={() => handleTabChange('active')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === 'active' ? 'border-accent text-accent' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          Active
          <span className="ml-1.5 text-xs bg-muted px-1.5 py-0.5 rounded-full tabular-nums">{activeShipments.length}</span>
        </button>
        <button
          onClick={() => handleTabChange('archive')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === 'archive' ? 'border-accent text-accent' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          Completed
          <span className="ml-1.5 text-xs bg-muted px-1.5 py-0.5 rounded-full tabular-nums">{archiveShipments.length}</span>
        </button>
      </div>

      {tab === 'active' && (
        <div className="flex flex-wrap gap-1.5 animate-fade-in" style={{ animationDelay: '120ms' }}>
          {subFilterConfig.map(f => {
            const count = f.key === 'all' ? activeShipments.length : activeShipments.filter(f.match).length;
            return (
              <button
                key={f.key}
                onClick={() => { setSubFilter(f.key); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${subFilter === f.key ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
              >
                {f.label}
                <span className="ml-1 opacity-70 tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="bg-card rounded-xl border animate-fade-in" style={{ animationDelay: '180ms' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left px-5 py-3 font-medium">MAWB</th>
                <th className="text-left px-5 py-3 font-medium hidden sm:table-cell">Subklant</th>
                <th className="text-right px-5 py-3 font-medium hidden md:table-cell">Pieces</th>
                <th className="text-right px-5 py-3 font-medium hidden md:table-cell">Parcels</th>
                <th className="text-right px-5 py-3 font-medium hidden lg:table-cell">Weight</th>
                <th className="text-left px-5 py-3 font-medium hidden lg:table-cell">Warehouse</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium hidden xl:table-cell">{tab === 'active' ? 'Waiting' : 'Date'}</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((s: any) => {
                const clrStatus = clearanceMap[s.id];
                const hasOpenInspection = inspectionMap[s.id];
                return (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                    <td className="px-5 py-3">
                      <Link to={`/shipments/${s.id}`} className="font-mono font-medium text-accent hover:underline">{s.mawb}</Link>
                    </td>
                    <td className="px-5 py-3 hidden sm:table-cell">{s.subklanten?.name || '—'}</td>
                    <td className="px-5 py-3 text-right tabular-nums hidden md:table-cell">{s.colli_expected}</td>
                    <td className="px-5 py-3 text-right tabular-nums hidden md:table-cell">{s.parcels}</td>
                    <td className="px-5 py-3 text-right tabular-nums hidden lg:table-cell">{Number(s.chargeable_weight).toLocaleString()} kg</td>
                    <td className="px-5 py-3 hidden lg:table-cell">{s.warehouse_id}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <StatusBadge status={s.status} />
                        {clrStatus === 'cleared' ? (
                          <span title="Customs cleared"><CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--status-delivered))]" /></span>
                        ) : (
                          <span title="Not cleared"><Lock className="h-3.5 w-3.5 text-muted-foreground" /></span>
                        )}
                        {hasOpenInspection && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[hsl(var(--status-needs-action)/0.15)] text-[hsl(var(--status-needs-action))]">
                            <AlertTriangle className="h-3 w-3" /> Inspection
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 hidden xl:table-cell text-muted-foreground tabular-nums">
                      {tab === 'active' ? waitingTime(s.updated_at) : new Date(s.created_at).toLocaleDateString('en-GB')}
                    </td>
                  </tr>
                );
              })}
              {paginated.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-12 text-center text-muted-foreground">No shipments found</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t text-sm text-muted-foreground">
            <span>Page {page} of {totalPages} · {filtered.length} shipments</span>
            <div className="flex gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="h-8 w-8 flex items-center justify-center rounded-md border hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                className="h-8 w-8 flex items-center justify-center rounded-md border hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
