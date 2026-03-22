import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { shipments, type ShipmentStatus } from '@/lib/mock-data';
import { StatusBadge } from '@/components/StatusBadge';

type Tab = 'active' | 'archive';
type SubFilter = 'all' | 'awaiting-noa' | 'noa-received' | 'in-stock' | 'in-transit';

const PER_PAGE = 25;

function waitingTime(dateStr: string): string {
  const now = new Date('2025-03-22T23:59:00');
  const then = new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T'));
  const h = Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60));
  if (h < 1) return '<1h';
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

const subFilterConfig: { key: SubFilter; label: string; match: (s: typeof shipments[0]) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'awaiting-noa', label: 'Awaiting NOA', match: s => s.status === 'Created' },
  { key: 'noa-received', label: 'NOA Received', match: s => s.status === 'NOA Received' || s.status === 'Arrived' },
  { key: 'in-stock', label: 'In Stock', match: s => s.status === 'In Stock' },
  { key: 'in-transit', label: 'In Transit', match: s => s.status === 'In Transit' },
];

export default function Shipments() {
  const [tab, setTab] = useState<Tab>('active');
  const [search, setSearch] = useState('');
  const [subFilter, setSubFilter] = useState<SubFilter>('all');
  const [page, setPage] = useState(1);

  const activeShipments = useMemo(() => shipments.filter(s => s.status !== 'Delivered'), []);
  const archiveShipments = useMemo(() => shipments.filter(s => s.status === 'Delivered'), []);

  const filtered = useMemo(() => {
    const base = tab === 'active' ? activeShipments : archiveShipments;
    let result = base;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(s => s.mawb.includes(q) || s.subklant.toLowerCase().includes(q));
    }

    if (tab === 'active' && subFilter !== 'all') {
      const cfg = subFilterConfig.find(f => f.key === subFilter);
      if (cfg) result = result.filter(cfg.match);
    }

    // Sort: longest waiting first
    return [...result].sort(
      (a, b) => new Date(a.lastStatusUpdate).getTime() - new Date(b.lastStatusUpdate).getTime()
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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Shipments</h1>
        <p className="text-muted-foreground text-sm mt-1">View and manage all shipments</p>
      </div>

      {/* Search bar */}
      <div className="relative max-w-md animate-fade-in">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          placeholder="Search by MAWB number..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="w-full h-10 pl-9 pr-3 rounded-lg border bg-card text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Tabs */}
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
          Archive
          <span className="ml-1.5 text-xs bg-muted px-1.5 py-0.5 rounded-full tabular-nums">{archiveShipments.length}</span>
        </button>
      </div>

      {/* Sub-filters (Active tab only) */}
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

      {/* Table */}
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
              {paginated.map(s => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                  <td className="px-5 py-3">
                    <Link to={`/shipments/${s.id}`} className="font-mono font-medium text-accent hover:underline">{s.mawb}</Link>
                  </td>
                  <td className="px-5 py-3 hidden sm:table-cell">{s.subklant}</td>
                  <td className="px-5 py-3 text-right tabular-nums hidden md:table-cell">{s.pieces}</td>
                  <td className="px-5 py-3 text-right tabular-nums hidden md:table-cell">{s.parcels}</td>
                  <td className="px-5 py-3 text-right tabular-nums hidden lg:table-cell">{s.chargeableWeight.toLocaleString()} kg</td>
                  <td className="px-5 py-3 hidden lg:table-cell">{s.warehouse}</td>
                  <td className="px-5 py-3"><StatusBadge status={s.status} /></td>
                  <td className="px-5 py-3 hidden xl:table-cell text-muted-foreground tabular-nums">
                    {tab === 'active' ? waitingTime(s.lastStatusUpdate) : s.createdAt}
                  </td>
                </tr>
              ))}
              {paginated.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-12 text-center text-muted-foreground">No shipments found</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
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