import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useWarehouseAuth } from '@/hooks/use-warehouse-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/StatusBadge';
import { Link } from 'react-router-dom';
import { Package, ScanBarcode, ArrowUpFromLine, Layers } from 'lucide-react';

export default function WarehouseDashboard() {
  const { data: auth } = useWarehouseAuth();
  const warehouseId = auth?.warehouseId;
  const today = new Date().toISOString().split('T')[0];

  const { data: shipments = [] } = useQuery({
    queryKey: ['warehouse-shipments', warehouseId],
    queryFn: async () => {
      if (!warehouseId) return [];
      const { data } = await supabase
        .from('shipments')
        .select('*, customers(name, short_name)')
        .eq('warehouse_id', warehouseId)
        .in('status', ['Awaiting NOA', 'Partial NOA', 'NOA Complete', 'In Transit', 'In Stock'])
        .order('created_at', { ascending: false });
      return data ?? [];
    },
    enabled: !!warehouseId,
  });

  const { data: scannedToday = 0 } = useQuery({
    queryKey: ['warehouse-scanned-today', warehouseId, today],
    queryFn: async () => {
      if (!warehouseId) return 0;
      const { count } = await supabase
        .from('outerboxes')
        .select('*', { count: 'exact', head: true })
        .gte('scanned_in_at', `${today}T00:00:00`)
        .lte('scanned_in_at', `${today}T23:59:59`);
      return count ?? 0;
    },
    enabled: !!warehouseId,
  });

  const { data: palletsToday = 0 } = useQuery({
    queryKey: ['warehouse-pallets-today', today],
    queryFn: async () => {
      const { count } = await supabase
        .from('pallets')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', `${today}T00:00:00`)
        .lte('created_at', `${today}T23:59:59`);
      return count ?? 0;
    },
    enabled: !!warehouseId,
  });

  const { data: outboundsToday = 0 } = useQuery({
    queryKey: ['warehouse-outbounds-today', today],
    queryFn: async () => {
      const { count } = await supabase
        .from('outbounds')
        .select('*', { count: 'exact', head: true })
        .eq('pickup_date', today);
      return count ?? 0;
    },
    enabled: !!warehouseId,
  });

  const expectedToday = shipments.filter((s: any) => s.eta === today).length;

  const stats = [
    { label: 'Expected Today', value: expectedToday, icon: Package, color: 'text-[hsl(var(--status-noa-complete))]' },
    { label: 'Scanned In Today', value: scannedToday, icon: ScanBarcode, color: 'text-[hsl(var(--status-delivered))]' },
    { label: 'Pallets Created Today', value: palletsToday, icon: Layers, color: 'text-[hsl(var(--status-instock))]' },
    { label: 'Outbound Today', value: outboundsToday, icon: ArrowUpFromLine, color: 'text-[hsl(var(--status-outbound))]' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Warehouse Dashboard</h1>
        <div className="flex gap-2">
          <Button asChild>
            <Link to="/warehouse/inbound"><ScanBarcode className="mr-2 h-4 w-4" />Start Scanning</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/warehouse/outbound"><ArrowUpFromLine className="mr-2 h-4 w-4" />Create Outbound</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => (
          <Card key={s.label}>
            <CardContent className="p-6 flex items-center gap-4">
              <div className={`p-3 rounded-xl bg-muted ${s.color}`}>
                <s.icon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{s.label}</p>
                <p className="text-2xl font-bold">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Active Shipments</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>MAWB</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Colli</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>ETA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shipments.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No active shipments</TableCell></TableRow>
              ) : shipments.map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono font-medium">{s.mawb}</TableCell>
                  <TableCell>{(s.customers as any)?.name ?? '—'}</TableCell>
                  <TableCell>{s.colli_expected ?? '—'}</TableCell>
                  <TableCell><StatusBadge status={s.status} /></TableCell>
                  <TableCell>{s.eta ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
