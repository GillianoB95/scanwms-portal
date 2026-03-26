import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useWarehouseAuth } from '@/hooks/use-warehouse-auth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, PackageSearch } from 'lucide-react';

export default function StockOverview() {
  const { data: auth } = useWarehouseAuth();
  const warehouseId = auth?.warehouseId;
  const [hubFilter, setHubFilter] = useState<string>('all');

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

  // Fetch In Stock shipments
  const { data: shipments = [] } = useQuery({
    queryKey: ['stock-overview-shipments', warehouseCode],
    queryFn: async () => {
      if (!warehouseCode) return [];
      const { data } = await supabase
        .from('shipments')
        .select('id, mawb, unloaded_at')
        .eq('warehouse_id', warehouseCode)
        .eq('status', 'In Stock')
        .order('mawb', { ascending: true });
      return data ?? [];
    },
    enabled: !!warehouseCode,
  });

  const shipmentIds = shipments.map((s: any) => s.id);

  // Fetch all non-deleted outerboxes for these shipments (scanned counts)
  const { data: outerboxes = [] } = useQuery({
    queryKey: ['stock-overview-boxes', shipmentIds],
    queryFn: async () => {
      if (shipmentIds.length === 0) return [];
      const { data } = await supabase
        .from('outerboxes')
        .select('id, shipment_id, hub, status')
        .in('shipment_id', shipmentIds)
        .neq('status', 'deleted');
      return data ?? [];
    },
    enabled: shipmentIds.length > 0,
  });

  // Fetch manifest_parcels for totals per hub (distinct outerbox_barcode)
  const { data: manifestParcels = [] } = useQuery({
    queryKey: ['stock-overview-manifest', shipmentIds],
    queryFn: async () => {
      if (shipmentIds.length === 0) return [];
      const { data } = await supabase
        .from('manifest_parcels')
        .select('shipment_id, hub, outerbox_barcode')
        .in('shipment_id', shipmentIds)
        .not('outerbox_barcode', 'is', null)
        .neq('outerbox_barcode', '');
      return data ?? [];
    },
    enabled: shipmentIds.length > 0,
  });

  // Build hub groups per shipment: totals from manifest_parcels, scanned from outerboxes
  const shipmentHubData = useMemo(() => {
    const map = new Map<string, Map<string, { total: number; scanned: number }>>();

    // Totals: count distinct outerbox_barcode per shipment+hub from manifest_parcels
    for (const mp of manifestParcels) {
      const hub = (mp as any).hub || 'Unknown';
      const sid = (mp as any).shipment_id;
      if (!map.has(sid)) map.set(sid, new Map());
      const hubMap = map.get(sid)!;
      if (!hubMap.has(hub)) hubMap.set(hub, { total: 0, scanned: 0 });
    }
    // Count distinct outerbox_barcode per shipment+hub
    const distinctKeys = new Set<string>();
    for (const mp of manifestParcels) {
      const hub = (mp as any).hub || 'Unknown';
      const sid = (mp as any).shipment_id;
      const barcode = (mp as any).outerbox_barcode;
      const key = `${sid}|${hub}|${barcode}`;
      if (!distinctKeys.has(key)) {
        distinctKeys.add(key);
        map.get(sid)!.get(hub)!.total++;
      }
    }

    // Scanned counts from outerboxes
    for (const box of outerboxes) {
      const hub = (box as any).hub || 'Unknown';
      if (!map.has(box.shipment_id)) map.set(box.shipment_id, new Map());
      const hubMap = map.get(box.shipment_id)!;
      if (!hubMap.has(hub)) hubMap.set(hub, { total: 0, scanned: 0 });
      if (box.status === 'scanned_in' || box.status === 'palletized') {
        hubMap.get(hub)!.scanned++;
      }
    }

    return map;
  }, [outerboxes, manifestParcels]);

  // Show all shipments with status In Stock — no outerbox filtering
  const filteredShipments = shipments;

  // Collect all hub codes for filter dropdown
  const allHubs = useMemo(() => {
    const hubs = new Set<string>();
    shipmentHubData.forEach((hubMap) => {
      hubMap.forEach((_, hub) => hubs.add(hub));
    });
    return Array.from(hubs).sort();
  }, [shipmentHubData]);

  // Apply hub filter
  const displayShipments = useMemo(() => {
    if (hubFilter === 'all') return filteredShipments;
    return filteredShipments.filter((s: any) => {
      const hubMap = shipmentHubData.get(s.id);
      return hubMap?.has(hubFilter);
    });
  }, [filteredShipments, hubFilter, shipmentHubData]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Stock Overview</h1>
        <Select value={hubFilter} onValueChange={setHubFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by hub" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All hubs</SelectItem>
            {allHubs.map((hub) => (
              <SelectItem key={hub} value={hub}>{hub}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {displayShipments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <PackageSearch className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No shipments currently in stock</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {displayShipments.map((s: any) => {
            const hubMap = shipmentHubData.get(s.id);
            const hubs = hubMap
              ? Array.from(hubMap.entries())
                  .filter(([hub]) => hubFilter === 'all' || hub === hubFilter)
                  .sort(([a], [b]) => a.localeCompare(b))
              : [];

            return (
              <Card key={s.id}>
                <CardContent className="pt-5 pb-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-lg">{s.mawb}</span>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      Unloaded: {s.unloaded_at ? format(new Date(s.unloaded_at), 'dd/MM/yyyy') : '—'}
                    </span>
                  </div>

                  <div className="border-t pt-3 space-y-3">
                    {hubs.map(([hub, counts]) => {
                      const pct = counts.total > 0 ? Math.round((counts.scanned / counts.total) * 100) : 0;
                      const complete = counts.scanned === counts.total && counts.total > 0;

                      return (
                        <div key={hub} className="flex items-center gap-4">
                          <span className="w-24 text-sm font-medium truncate" title={hub}>{hub}</span>
                          <span className="w-24 text-sm text-muted-foreground">{counts.total} boxes</span>
                          <div className="flex-1">
                            <Progress
                              value={pct}
                              className="h-3"
                            />
                          </div>
                          <span className="w-16 text-sm text-right font-mono">
                            {counts.scanned}/{counts.total}
                          </span>
                          {complete && (
                            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Done
                            </Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
