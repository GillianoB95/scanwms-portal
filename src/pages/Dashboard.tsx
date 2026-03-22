import { Link } from 'react-router-dom';
import { Package, Clock, Truck, CheckCircle2 } from 'lucide-react';
import { shipments } from '@/lib/mock-data';
import { StatusBadge } from '@/components/StatusBadge';

const stats = [
  { label: 'Total Shipments', value: shipments.length, icon: Package, color: 'text-accent' },
  { label: 'Pending', value: shipments.filter(s => ['Created', 'NOA Received'].includes(s.status)).length, icon: Clock, color: 'text-[hsl(var(--status-noa))]' },
  { label: 'In Transit', value: shipments.filter(s => s.status === 'In Transit').length, icon: Truck, color: 'text-[hsl(var(--status-intransit))]' },
  { label: 'Delivered', value: shipments.filter(s => s.status === 'Delivered').length, icon: CheckCircle2, color: 'text-[hsl(var(--status-delivered))]' },
];

export default function Dashboard() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-balance">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Overview of your shipments</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className="bg-card rounded-xl border p-5 animate-fade-in"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{s.label}</span>
              <s.icon className={`h-4.5 w-4.5 ${s.color}`} />
            </div>
            <p className="text-3xl font-bold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-card rounded-xl border animate-fade-in" style={{ animationDelay: '320ms' }}>
        <div className="px-5 py-4 border-b">
          <h2 className="font-semibold">Recent Shipments</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left px-5 py-3 font-medium">MAWB</th>
                <th className="text-left px-5 py-3 font-medium hidden sm:table-cell">Subklant</th>
                <th className="text-right px-5 py-3 font-medium hidden md:table-cell">Pieces</th>
                <th className="text-right px-5 py-3 font-medium hidden md:table-cell">Parcels</th>
                <th className="text-right px-5 py-3 font-medium hidden md:table-cell">Weight</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium hidden lg:table-cell">Date</th>
              </tr>
            </thead>
            <tbody>
              {shipments.slice(0, 5).map(s => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                  <td className="px-5 py-3">
                    <Link to={`/shipments/${s.id}`} className="font-mono font-medium text-accent hover:underline">{s.mawb}</Link>
                  </td>
                  <td className="px-5 py-3 hidden sm:table-cell">{s.subklant}</td>
                  <td className="px-5 py-3 text-right tabular-nums hidden md:table-cell">{s.pieces}</td>
                  <td className="px-5 py-3 text-right tabular-nums hidden md:table-cell">{s.parcels}</td>
                  <td className="px-5 py-3 text-right tabular-nums hidden md:table-cell">{s.chargeableWeight.toLocaleString()} kg</td>
                  <td className="px-5 py-3"><StatusBadge status={s.status} /></td>
                  <td className="px-5 py-3 hidden lg:table-cell text-muted-foreground">{s.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
