import { useState, useMemo } from 'react';
import { format, differenceInDays } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useWarehouseAuth } from '@/hooks/use-warehouse-auth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, PackageSearch, AlertTriangle, Clock } from 'lucide-react';

function getDaysAgoLabel(date: string) {
  const days = differenceInDays(new Date(), new Date(date));
  if (days === 0) return { text: 'today', color: 'text-emerald-600' };
  if (days === 1) return { text: '1 day ago', color: 'text-emerald-600' };
  if (days <= 3) return { text: `${days} days ago`, color: 'text-amber-500' };
  return { text: `${days} days ago`, color: 'text-destructive' };
}

export default function StockOverview() {
  const { data: auth } = useWarehouseAuth();
  const warehouseId = auth?.warehouseId;
  const [hubFilter, setHubFilter] = useState<string>('all');

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

  // Fetch In Stock shipments with subklant name, colli, and noa info
  const { data: shipments = [] } = useQuery({
    queryKey: ['stock-overview-shipments', warehouseCode],
    queryFn: async () => {
      if (!warehouseCode) return [];
      const { data } = await supabase
        .from('shipments')
        .select('id, mawb, unloaded_at, unloaded_colli, colli_expected, subklant_id, subklanten(name)')
        .eq('warehouse_id', warehouseCode)
        .in('status', ['In Stock', 'Partially Unloaded'])
        .order('mawb', { ascending: true });
      return data ?? [];
    },
    enabled: !!warehouseCode,
  });

  const shipmentIds = shipments.map((s: any) => s.id);

  // Fetch status history to check for Partial NOA
  const { data: statusHistory = [] } = useQuery({
    queryKey: ['stock-overview-history', shipmentIds],
    queryFn: async () => {
      if (shipmentIds.length === 0) return [];
      const { data } = await supabase
        .from('shipment_status_history')
        .select('shipment_id, new_status')
        .in('shipment_id', shipmentIds)
        .eq('new_status', 'Partial NOA');
      return data ?? [];
    },
    enabled: shipmentIds.length > 0,
  });

  // Fetch NOA colli for partial-NOA shipments
  const partialNoaIds = useMemo(() => {
    const set = new Set<string>();
    for (const h of statusHistory) set.add((h as any).shipment_id);
    return set;
  }, [statusHistory]);

  const { data: noaData = [] } = useQuery({
    queryKey: ['stock-overview-noas', shipmentIds],
    queryFn: async () => {
      if (shipmentIds.length === 0) return [];
      const { data } = await supabase
        .from('noas')
        .select('shipment_id, colli')
        .in('shipment_id', shipmentIds);
      return data ?? [];
    },
    enabled: shipmentIds.length > 0,
  });

  const noaColliMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of noaData) {
      const sid = (n as any).shipment_id;
      map.set(sid, (map.get(sid) ?? 0) + ((n as any).colli ?? 0));
    }
    return map;
  }, [noaData]);

  // Fetch outerboxes (scanned counts)
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

  // Fetch manifest_parcels for totals per hub
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

  // Build hub groups per shipment
  const shipmentHubData = useMemo(() => {
    const map = new Map<string, Map<string, { total: number; scanned: number }>>();

    // Totals from manifest_parcels (distinct outerbox_barcode per hub)
    const distinctKeys = new Set<string>();
    for (const mp of manifestParcels) {
      const hub = (mp as any).hub || 'Unknown';
      const sid = (mp as any).shipment_id;
      const barcode = (mp as any).outerbox_barcode;
      if (!map.has(sid)) map.set(sid, new Map());
      const hubMap = map.get(sid)!;
      if (!hubMap.has(hub)) hubMap.set(hub, { total: 0, scanned: 0 });
      const key = `${sid}|${hub}|${barcode}`;
      if (!distinctKeys.has(key)) {
        distinctKeys.add(key);
        hubMap.get(hub)!.total++;
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

  const filteredShipments = shipments;

  const allHubs = useMemo(() => {
    const hubs = new Set<string>();
    shipmentHubData.forEach((hubMap) => {
      hubMap.forEach((_, hub) => hubs.add(hub));
    });
    return Array.from(hubs).sort();
  }, [shipmentHubData]);

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
                  .sort(([, a], [, b]) => {
                    const pctA = a.total > 0 ? a.scanned / a.total : 0;
                    const pctB = b.total > 0 ? b.scanned / b.total : 0;
                    return pctA - pctB;
                  })
              : [];

            const subklantName = s.subklanten?.name;
            const unloadedColli = s.unloaded_colli ?? 0;
            const colliExpected = s.colli_expected ?? 0;
            const colliPct = colliExpected > 0 ? Math.round((unloadedColli / colliExpected) * 100) : 0;
            const daysInfo = s.unloaded_at ? getDaysAgoLabel(s.unloaded_at) : null;
            const isPartialNoa = partialNoaIds.has(s.id);
            const noaColli = noaColliMap.get(s.id) ?? 0;

            return (
              <Card key={s.id}>
                <CardContent className="pt-5 pb-4 space-y-4">
                  {/* Header */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-lg">{s.mawb}</span>
                        {subklantName && (
                          <Badge variant="secondary" className="text-xs">{subklantName}</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        {s.unloaded_at && (
                          <>
                            <span className="text-muted-foreground">
                              {format(new Date(s.unloaded_at), 'dd/MM/yyyy')}
                            </span>
                            {daysInfo && (
                              <span className={`font-medium ${daysInfo.color}`}>
                                · {daysInfo.text}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Colli progress */}
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">Colli:</span>
                        <span className="font-mono font-medium">{unloadedColli} / {colliExpected}</span>
                      </div>
                      <div className="flex-1 max-w-xs">
                        <Progress value={colliPct} className="h-2" />
                      </div>
                      {isPartialNoa && (
                        <div className="flex items-center gap-1.5 text-sm">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                          <span className="text-muted-foreground">NOA:</span>
                          <span className="font-mono font-medium text-amber-600">{noaColli} / {colliExpected}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Hub rows */}
                  <div className="border-t pt-3 space-y-2">
                    {hubs.map(([hub, counts]) => {
                      const pct = counts.total > 0 ? Math.round((counts.scanned / counts.total) * 100) : 0;
                      const complete = pct === 100 && counts.total > 0;
                      const notStarted = counts.scanned === 0;

                      // Color coding
                      let rowBg = '';
                      let textColor = 'text-muted-foreground';
                      if (complete) {
                        rowBg = 'bg-emerald-500/10';
                        textColor = 'text-emerald-700';
                      } else if (!notStarted) {
                        rowBg = 'bg-amber-500/10';
                        textColor = 'text-amber-700';
                      }

                      return (
                        <div key={hub} className={`flex items-center gap-4 rounded-md px-3 py-2 ${rowBg}`}>
                          <span className={`w-20 text-sm font-medium truncate ${complete ? 'text-emerald-700' : notStarted ? 'text-muted-foreground' : 'text-amber-700'}`} title={hub}>
                            {hub}
                          </span>
                          <span className={`w-20 text-sm ${textColor}`}>{counts.total} boxes</span>
                          <div className="flex-1">
                            <Progress
                              value={pct}
                              className={`h-2.5 ${complete ? '[&>div]:bg-emerald-500' : notStarted ? '[&>div]:bg-muted-foreground/30' : '[&>div]:bg-amber-500'}`}
                            />
                          </div>
                          <span className={`w-16 text-sm text-right font-mono ${complete ? 'text-emerald-700' : notStarted ? 'text-muted-foreground' : 'text-amber-700'}`}>
                            {counts.scanned}/{counts.total}
                          </span>
                          {complete && (
                            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Done
                            </Badge>
                          )}
                          {!complete && !notStarted && (
                            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 gap-1">
                              <Clock className="h-3 w-3" />
                              {pct}%
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
