import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { StatusBadge } from '@/components/StatusBadge';

type Tab = 'active' | 'archive';
type SubFilter = 'all' | 'awaiting-noa' | 'partial-noa' | 'noa-complete' | 'in-transit' | 'in-stock' | 'outbound';

const PER_PAGE = 25;

const subFilterConfig: { key: SubFilter; label: string; match: (s: any) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'awaiting-noa', label: 'Awaiting NOA', match: s => s.status === 'Created' || s.status === 'Awaiting NOA' || s.status === 'awaiting_noa' },
  { key: 'partial-noa', label: 'Partial NOA', match: s => s.status === 'Partial NOA' || s.status === 'partial_noa' },
  { key: 'noa-complete', label: 'NOA Complete', match: s => s.status === 'NOA Complete' || s.status === 'noa_complete' },
  { key: 'in-transit', label: 'In Transit', match: s => s.status === 'In Transit' || s.status === 'in_transit' },
  { key: 'in-stock', label: 'In Stock', match: s => s.status === 'In Stock' || s.status === 'in_stock' },
  { key: 'outbound', label: 'Outbound', match: s => s.status === 'Outbound' || s.status === 'outbound' },
];

export default function Shipments() {
  const [shipments, setShipments] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState('');
  const [tab, setTab] = useState<Tab>('active');
  const [search, setSearch] = useState('');
  const [subFilter, setSubFilter] = useState<SubFilter>('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const fetchShipments = async () => {
      setIsLoading(true);
      setLoadError(null);

      const { data, error } = await supabase
        .from('shipments')
        .select('id, mawb, status, created_at')
        .limit(10);

      console.log('result:', data, error);

      if (error) {
        console.error('Shipments error:', error);
        setLoadError(error.message);
        setShipments([]);
        setIsLoading(false);
        return;
      }

      setShipments(data || []);
      setIsLoading(false);
    };

    fetchShipments().catch((err) => {
      console.error('fetchShipments failed:', err);
      setLoadError(err instanceof Error ? err.message : 'Unknown shipments error');
      setIsLoading(false);
    });
  }, []);

  const testQuery = async () => {
    setTestResult('Loading test query...');
    const { data, error } = await supabase.from('shipments').select('id, mawb, status').limit(5);
    setTestResult(JSON.stringify({ data, error }, null, 2));
  };

  const activeShipments = useMemo(
    () => shipments.filter((s: any) => s.status !== 'Outbound' && s.status !== 'outbound'),
    [shipments]
  );
  const archiveShipments = useMemo(
    () => shipments.filter((s: any) => s.status === 'Outbound' || s.status === 'outbound'),
    [shipments]
  );

  const filtered = useMemo(() => {
    const base = tab === 'active' ? activeShipments : archiveShipments;
    let result = [...base];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter((s: any) => s.mawb.toLowerCase().includes(q));
    }

    if (tab === 'active' && subFilter !== 'all') {
      const cfg = subFilterConfig.find(f => f.key === subFilter);
      if (cfg) result = result.filter(cfg.match);
    }

    return result.sort(
      (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
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
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <button onClick={testQuery} className="px-4 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-semibold hover:opacity-90 active:scale-[0.97] transition-all">Test Query</button>
        {testResult && <pre className="w-full max-w-3xl overflow-auto rounded-lg border bg-card p-4 text-xs text-left">{testResult}</pre>}
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError) {
    return <div className="rounded-xl border bg-card p-6 text-sm text-destructive">Failed to load shipments: {loadError}</div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Shipments</h1>
        <p className="text-muted-foreground text-sm mt-1">Minimal query test: shipments only</p>
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
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((s: any) => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                  <td className="px-5 py-3">
                    <Link to={`/shipments/${s.id}`} className="font-mono font-medium text-accent hover:underline">{s.mawb}</Link>
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-5 py-3 text-muted-foreground tabular-nums">
                    {new Date(s.created_at).toLocaleDateString('en-GB')}
                  </td>
                </tr>
              ))}
              {paginated.length === 0 && (
                <tr><td colSpan={3} className="px-5 py-12 text-center text-muted-foreground">No shipments found</td></tr>
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
