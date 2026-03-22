import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { shipments, type ShipmentStatus, statusOrder } from '@/lib/mock-data';
import { StatusBadge } from '@/components/StatusBadge';

export default function Shipments() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ShipmentStatus | ''>('');

  const filtered = useMemo(() => {
    return shipments.filter(s => {
      const matchSearch = !search || s.mawb.includes(search) || s.subklant.toLowerCase().includes(search.toLowerCase());
      const matchStatus = !statusFilter || s.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [search, statusFilter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Shipments</h1>
        <p className="text-muted-foreground text-sm mt-1">View and manage all shipments</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 animate-fade-in">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            placeholder="Search MAWB or subklant..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-10 pl-9 pr-3 rounded-lg border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as ShipmentStatus | '')}
          className="h-10 px-3 rounded-lg border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All statuses</option>
          {statusOrder.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="bg-card rounded-xl border animate-fade-in" style={{ animationDelay: '100ms' }}>
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
                <th className="text-left px-5 py-3 font-medium hidden xl:table-cell">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors cursor-pointer">
                  <td className="px-5 py-3">
                    <Link to={`/shipments/${s.id}`} className="font-mono font-medium text-accent hover:underline">{s.mawb}</Link>
                  </td>
                  <td className="px-5 py-3 hidden sm:table-cell">{s.subklant}</td>
                  <td className="px-5 py-3 text-right tabular-nums hidden md:table-cell">{s.pieces}</td>
                  <td className="px-5 py-3 text-right tabular-nums hidden md:table-cell">{s.parcels}</td>
                  <td className="px-5 py-3 text-right tabular-nums hidden lg:table-cell">{s.chargeableWeight.toLocaleString()} kg</td>
                  <td className="px-5 py-3 hidden lg:table-cell">{s.warehouse}</td>
                  <td className="px-5 py-3"><StatusBadge status={s.status} /></td>
                  <td className="px-5 py-3 hidden xl:table-cell text-muted-foreground">{s.createdAt}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-12 text-center text-muted-foreground">No shipments found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
