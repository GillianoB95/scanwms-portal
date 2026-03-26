import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useWarehouseAuth } from '@/hooks/use-warehouse-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Link, useNavigate } from 'react-router-dom';
import { Package, ScanBarcode, ArrowUpFromLine, Truck, PackageCheck, Search as SearchIcon, Calendar } from 'lucide-react';
import { WarehouseFycoDetailModal } from '@/components/warehouse/FycoDetailModal';
import { startOfDay, startOfWeek, startOfMonth, endOfDay, format } from 'date-fns';

function getDateRange(period: string): { from: string; to: string } {
  const now = new Date();
  const end = endOfDay(now).toISOString();
  if (period === 'week') return { from: startOfWeek(now, { weekStartsOn: 1 }).toISOString(), to: end };
  if (period === 'month') return { from: startOfMonth(now).toISOString(), to: end };
  return { from: startOfDay(now).toISOString(), to: end };
}

export default function WarehouseDashboard() {
  const { data: auth } = useWarehouseAuth();
  const navigate = useNavigate();
  const warehouseId = auth?.warehouseId;
  const [timePeriod, setTimePeriod] = useState('today');
  const { from: rangeFrom, to: rangeTo } = getDateRange(timePeriod);
  const today = format(new Date(), 'yyyy-MM-dd');

  // Resolve warehouse UUID to code for shipment queries
  const { data: warehouseCode } = useQuery({
    queryKey: ['warehouse-code', warehouseId],
    queryFn: async () => {
      const { data } = await supabase
        .from('warehouses')
        .select('code')
        .eq('id', warehouseId!)
        .single();
      return data?.code ?? null;
    },
    enabled: !!warehouseId,
  });

  // Expected Today: NOA Complete or Partial NOA with eta = today, not yet unloaded
  const { data: expectedData } = useQuery({
    queryKey: ['warehouse-expected-today', warehouseCode, today],
    queryFn: async () => {
      const query = supabase
        .from('shipments')
        .select('id, colli_expected, chargeable_weight')
        .in('status', ['NOA Complete', 'Partial NOA'])
        .is('unloaded_at', null)
        .gte('eta', `${today}T00:00:00`)
        .lte('eta', `${today}T23:59:59`);
      if (warehouseCode) query.eq('warehouse_id', warehouseCode);
      const { data } = await query;
      const items = data ?? [];
      return {
        count: items.length,
        totalColli: items.reduce((s, r: any) => s + (r.colli_expected ?? 0), 0),
        totalWeight: items.reduce((s, r: any) => s + (r.chargeable_weight ?? 0), 0),
      };
    },
    enabled: !!auth,
  });

  // Shipments Unloaded Today: shipments with unloaded_at today
  const { data: unloadedData } = useQuery({
    queryKey: ['warehouse-unloaded', warehouseCode, rangeFrom, rangeTo],
    queryFn: async () => {
      const query = supabase
        .from('shipments')
        .select('id, colli_expected, chargeable_weight')
        .gte('unloaded_at', rangeFrom)
        .lte('unloaded_at', rangeTo);
      if (warehouseCode) query.eq('warehouse_id', warehouseCode);
      const { data } = await query;
      const items = data ?? [];
      let totalNoaColli = 0;
      if (items.length > 0) {
        const shipmentIds = items.map((s: any) => s.id);
        const { data: noas } = await supabase
          .from('noas')
          .select('colli, shipment_id')
          .in('shipment_id', shipmentIds);
        totalNoaColli = (noas ?? []).reduce((s: number, n: any) => s + (n.colli ?? 0), 0);
      }
      return {
        shipments: items.length,
        boxes: totalNoaColli,
        weight: items.reduce((s, r: any) => s + (r.chargeable_weight ?? 0), 0),
      };
    },
    enabled: !!auth,
  });

  // Scanned In (time-filtered)
  const { data: scannedData } = useQuery({
    queryKey: ['warehouse-scanned', warehouseId, rangeFrom, rangeTo],
    queryFn: async () => {
      const { data } = await supabase
        .from('outerboxes')
        .select('id, shipment_id, weight')
        .gte('scanned_in_at', rangeFrom)
        .lte('scanned_in_at', rangeTo);
      const items = data ?? [];
      const uniqueShipmentIds = new Set(items.map((b: any) => b.shipment_id));
      const totalKg = items.reduce((s: number, b: any) => s + (parseFloat(b.weight) || 0), 0);
      return { count: items.length, shipments: uniqueShipmentIds.size, totalKg };
    },
    enabled: !!auth,
  });

  // Outbound Prepared (real-time, no time filter)
  const { data: preparedData } = useQuery({
    queryKey: ['warehouse-prepared', warehouseId],
    queryFn: async () => {
      const query = supabase.from('outbounds').select('id').eq('status', 'prepared');
      if (warehouseId) query.eq('warehouse_id', warehouseId);
      const { data } = await query;
      const ids = (data ?? []).map((o: any) => o.id);
      let colli = 0, weight = 0;
      if (ids.length > 0) {
        const { data: pallets } = await supabase.from('pallets').select('pieces, weight').in('outbound_id', ids);
        for (const p of (pallets ?? [])) { colli += p.pieces || 0; weight += parseFloat(p.weight) || 0; }
      }
      return { trucks: ids.length, colli, weight };
    },
    enabled: !!auth,
  });

  // Outbound Departed (time-filtered)
  const { data: departedData } = useQuery({
    queryKey: ['warehouse-departed', warehouseId, rangeFrom, rangeTo],
    queryFn: async () => {
      const query = supabase.from('outbounds').select('id, pickup_date').eq('status', 'departed')
        .gte('pickup_date', rangeFrom.split('T')[0])
        .lte('pickup_date', rangeTo.split('T')[0]);
      if (warehouseId) query.eq('warehouse_id', warehouseId);
      const { data } = await query;
      const ids = (data ?? []).map((o: any) => o.id);
      let colli = 0, weight = 0;
      if (ids.length > 0) {
        const { data: pallets } = await supabase.from('pallets').select('pieces, weight').in('outbound_id', ids);
        for (const p of (pallets ?? [])) { colli += p.pieces || 0; weight += parseFloat(p.weight) || 0; }
      }
      return { trucks: ids.length, colli, weight };
    },
    enabled: !!auth,
  });



  // All shipments assigned to this warehouse (broader fetch for filtering)
  // Database may store 'Created' or 'Awaiting NOA' — fetch both
  const allDbStatuses = ['Created', 'Awaiting NOA', 'Partial NOA', 'NOA Complete', 'In Transit', 'In Stock', 'Outbound'];
  const allStatuses = ['Awaiting NOA', 'Partial NOA', 'NOA Complete', 'In Transit', 'In Stock', 'Outbound'];

  const { data: shipments = [] } = useQuery({
    queryKey: ['warehouse-shipments', warehouseCode],
    queryFn: async () => {
      const query = supabase
        .from('shipments')
        .select('*')
        .in('status', allDbStatuses)
        .order('created_at', { ascending: false });
      if (warehouseCode) query.eq('warehouse_id', warehouseCode);
      const { data } = await query;
      const items = (data ?? []).map((s: any) => ({
        ...s,
        status: s.status === 'Created' ? 'Awaiting NOA' : s.status,
      }));

      // Lookup customer/subklant names via security definer RPC
      const customerIds = [...new Set(items.map((s: any) => s.customer_id).filter(Boolean))];
      const subklantIds = [...new Set(items.map((s: any) => s.subklant_id).filter(Boolean))];
      try {
        const { data: lookup } = await supabase.rpc('lookup_customer_names', {
          customer_ids: customerIds,
          subklant_ids: subklantIds,
        });
        if (lookup) {
          const customers = lookup.customers || {};
          const subklanten = lookup.subklanten || {};
          return items.map((s: any) => ({
            ...s,
            customer_name: customers[s.customer_id]?.name ?? null,
            customer_short: customers[s.customer_id]?.short_name ?? null,
            subklant_name: subklanten[s.subklant_id]?.name ?? null,
          }));
        }
      } catch (e) {
        console.warn('lookup_customer_names not available');
      }
      return items;
    },
    enabled: !!auth,
  });

  // Fetch inspection counts per shipment for Fyco badge
  const shipmentIds = useMemo(() => shipments.map((s: any) => s.id), [shipments]);
  const { data: fycoCounts = {} } = useQuery({
    queryKey: ['warehouse-fyco-counts', shipmentIds],
    queryFn: async () => {
      if (shipmentIds.length === 0) return {};
      const { data } = await supabase
        .from('inspections')
        .select('shipment_id')
        .in('shipment_id', shipmentIds);
      const counts: Record<string, number> = {};
      for (const row of (data ?? [])) {
        counts[row.shipment_id] = (counts[row.shipment_id] || 0) + 1;
      }
      return counts;
    },
    enabled: shipmentIds.length > 0,
  });

  const [statusFilter, setStatusFilter] = useState<string[]>(['In Transit', 'In Stock']);

  const filteredShipments = useMemo(() => {
    if (statusFilter.length === 0) return shipments;
    return shipments.filter((s: any) => statusFilter.includes(s.status));
  }, [shipments, statusFilter]);

  const toggleStatus = (status: string) => {
    setStatusFilter(prev =>
      prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
    );
  };

  const preparedTrucks = typeof preparedData === 'object' ? preparedData?.trucks ?? 0 : 0;
  const preparedColli = typeof preparedData === 'object' ? preparedData?.colli ?? 0 : 0;
  const preparedWeight = typeof preparedData === 'object' ? preparedData?.weight ?? 0 : 0;
  const departedTrucks = typeof departedData === 'object' ? departedData?.trucks ?? 0 : 0;
  const departedColli = typeof departedData === 'object' ? departedData?.colli ?? 0 : 0;
  const departedWeight = typeof departedData === 'object' ? departedData?.weight ?? 0 : 0;

  const periodLabel = timePeriod === 'today' ? 'Today' : timePeriod === 'week' ? 'This Week' : 'This Month';

  const stats = [
    {
      label: 'Expected Today',
      value: `${expectedData?.count ?? 0} shipments`,
      sub: `${expectedData?.totalColli ?? 0} colli · ${(expectedData?.totalWeight ?? 0).toFixed(0)} kg`,
      icon: Package,
      color: 'text-[hsl(var(--status-noa-complete))]',
    },
    {
      label: `Unloaded ${periodLabel}`,
      value: `${unloadedData?.shipments ?? 0} shipments`,
      sub: `${unloadedData?.boxes ?? 0} colli · ${(unloadedData?.weight ?? 0).toFixed(0)} kg`,
      icon: PackageCheck,
      color: 'text-[hsl(var(--status-intransit))]',
    },
    {
      label: `Scanned ${periodLabel}`,
      value: `${scannedData?.count ?? 0} boxes`,
      sub: `${scannedData?.shipments ?? 0} shipments · ${(scannedData?.totalKg ?? 0).toFixed(2)} kg`,
      icon: ScanBarcode,
      color: 'text-[hsl(var(--status-delivered))]',
    },
    {
      label: 'Outbound Prepared',
      value: `${preparedTrucks} ${preparedTrucks === 1 ? 'truck' : 'trucks'}`,
      sub: `${preparedColli} colli · ${preparedWeight.toFixed(0)} kg`,
      icon: ArrowUpFromLine,
      color: 'text-[hsl(var(--status-prepared))]',
    },
    {
      label: `Departed ${periodLabel}`,
      value: `${departedTrucks} ${departedTrucks === 1 ? 'truck' : 'trucks'}`,
      sub: `${departedColli} colli · ${departedWeight.toFixed(0)} kg`,
      icon: Truck,
      color: 'text-[hsl(var(--status-departed))]',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Warehouse Dashboard</h1>
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            {(['today', 'week', 'month'] as const).map(p => (
              <button
                key={p}
                onClick={() => setTimePeriod(p)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  timePeriod === p
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : 'This Month'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link to="/warehouse/inbound"><ScanBarcode className="mr-2 h-4 w-4" />Start Scanning</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/warehouse/outbound"><ArrowUpFromLine className="mr-2 h-4 w-4" />Create Outbound</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {stats.map(s => (
          <Card key={s.label}>
            <CardContent className="p-6 flex items-center gap-4">
              <div className={`p-3 rounded-xl bg-muted ${s.color}`}>
                <s.icon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{s.label}</p>
                <p className="text-2xl font-bold">{s.value}</p>
                {s.sub && <p className="text-xs text-muted-foreground">{s.sub}</p>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-lg">Shipments</CardTitle>
          <div className="flex flex-wrap gap-1.5">
            {allStatuses.map(status => (
              <button
                key={status}
                onClick={() => toggleStatus(status)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  statusFilter.includes(status)
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
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
              {filteredShipments.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No shipments found</TableCell></TableRow>
              ) : filteredShipments.map((s: any) => (
                <WarehouseShipmentRow key={s.id} shipment={s} fycoCount={(fycoCounts as Record<string, number>)[s.id] || 0} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function WarehouseShipmentRow({ shipment, fycoCount }: { shipment: any; fycoCount: number }) {
  const [fycoOpen, setFycoOpen] = useState(false);

  return (
    <>
      <TableRow>
        <TableCell className="font-mono font-medium">
          {shipment.mawb}
          {fycoCount > 0 && (
            <Badge
              className="ml-2 cursor-pointer text-[10px] px-1.5 py-0 bg-red-600 hover:bg-red-700 text-white border-transparent"
              onClick={(e) => { e.stopPropagation(); setFycoOpen(true); }}
            >
              <SearchIcon className="h-3 w-3 mr-1" />
              FYCO ({fycoCount})
            </Badge>
          )}
        </TableCell>
        <TableCell>{shipment.customer_name ?? '—'}</TableCell>
        <TableCell>{shipment.colli_expected ?? '—'}</TableCell>
        <TableCell><StatusBadge status={shipment.status} /></TableCell>
        <TableCell>{shipment.eta ?? '—'}</TableCell>
      </TableRow>
      {fycoOpen && <WarehouseFycoDetailModal shipment={shipment} open={fycoOpen} onOpenChange={v => { if (!v) setFycoOpen(false); }} />}
    </>
  );
}
