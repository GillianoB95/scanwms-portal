import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useWarehouseAuth } from '@/hooks/use-warehouse-auth';
import { useAlarmSettings } from '@/hooks/use-alarm-settings';
import { DEFAULT_ALARM_SETTINGS } from '@/lib/alarm-utils';
import { computeNoaKpis, kpiStatusColor, formatHoursRemaining, formatHoursOverdue } from '@/lib/kpi-utils';
import { Bell, X, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNavigate } from 'react-router-dom';

interface WarehouseKpiAlarm {
  shipment_id: string;
  mawb: string;
  noa_number: number;
  colli: number;
  status: string;
  hours_remaining: number | null;
  deadline: Date | null;
  hubs: string[];
}

export function WarehouseAlarmPanel() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { data: auth } = useWarehouseAuth();
  const { data: settings = DEFAULT_ALARM_SETTINGS } = useAlarmSettings();

  const warehouseId = auth?.warehouseId;

  const { data: alarms = [] } = useQuery({
    queryKey: ['warehouse-kpi-alarms', warehouseId, settings],
    queryFn: async () => {
      if (!warehouseId) return [];

      const { data: shipments } = await supabase
        .from('shipments')
        .select('id, mawb, customer_id')
        .eq('warehouse_id', warehouseId)
        .in('status', ['In Stock', 'Partially Unloaded']);
      if (!shipments?.length) return [];

      const shipmentIds = shipments.map(s => s.id);
      const customerIds = [...new Set(shipments.map(s => (s as any).customer_id).filter(Boolean))];

      const [noasRes, customersRes, boxesRes] = await Promise.all([
        supabase.from('noas').select('shipment_id, noa_number, colli, received_at').in('shipment_id', shipmentIds),
        supabase.from('customers').select('id, kpi_palletized_hours').in('id', customerIds),
        supabase.from('outerboxes').select('shipment_id, hub, status').in('shipment_id', shipmentIds).neq('status', 'deleted'),
      ]);

      const customerKpiMap = new Map<string, number>();
      for (const c of customersRes.data ?? []) customerKpiMap.set((c as any).id, (c as any).kpi_palletized_hours ?? 48);

      const noasByShipment = new Map<string, any[]>();
      for (const n of noasRes.data ?? []) {
        const sid = (n as any).shipment_id;
        if (!noasByShipment.has(sid)) noasByShipment.set(sid, []);
        noasByShipment.get(sid)!.push(n);
      }

      const palletizedMap = new Map<string, number>();
      const hubsByShipment = new Map<string, Set<string>>();
      for (const b of boxesRes.data ?? []) {
        if (b.status === 'palletized' || b.status === 'scanned_out') {
          palletizedMap.set(b.shipment_id, (palletizedMap.get(b.shipment_id) ?? 0) + 1);
        }
        if ((b as any).hub) {
          if (!hubsByShipment.has(b.shipment_id)) hubsByShipment.set(b.shipment_id, new Set());
          hubsByShipment.get(b.shipment_id)!.add((b as any).hub);
        }
      }

      const result: WarehouseKpiAlarm[] = [];
      for (const s of shipments) {
        const noas = (noasByShipment.get(s.id) ?? []).map((n: any) => ({
          noa_number: n.noa_number, colli: n.colli ?? 0, received_at: n.received_at,
        }));
        const kpiHours = customerKpiMap.get((s as any).customer_id) ?? 48;
        const palletized = palletizedMap.get(s.id) ?? 0;
        const hubs = Array.from(hubsByShipment.get(s.id) ?? []);

        const noaKpis = computeNoaKpis(noas, palletized, kpiHours, settings.noa_kpi_warning_hours);
        for (const kpi of noaKpis) {
          if (kpi.status === 'warning' || kpi.status === 'overdue') {
            result.push({
              shipment_id: s.id, mawb: s.mawb,
              noa_number: kpi.noa_number, colli: kpi.colli,
              status: kpi.status, hours_remaining: kpi.hours_remaining, deadline: kpi.deadline,
              hubs,
            });
          }
        }
      }
      return result;
    },
    enabled: !!warehouseCode,
    refetchInterval: 60_000,
  });

  if (alarms.length === 0) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-destructive text-destructive-foreground shadow-lg flex items-center justify-center hover:bg-destructive/90 transition-colors"
      >
        <Bell className="h-6 w-6" />
        <span className="absolute -top-1 -right-1 h-6 min-w-6 px-1 rounded-full bg-foreground text-background text-xs font-bold flex items-center justify-center">
          {alarms.length}
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-foreground/20" />
          <div
            className="absolute bottom-0 right-0 w-full max-w-md h-[60vh] bg-card border-t border-l rounded-tl-xl shadow-2xl flex flex-col animate-in slide-in-from-bottom duration-300"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div className="flex items-center gap-2">
                <span className="text-lg">⚠️</span>
                <h2 className="font-semibold text-lg">Urgently Palletize</h2>
                <Badge variant="destructive" className="text-xs">{alarms.length}</Badge>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <ScrollArea className="flex-1">
              <div className="px-5 py-3 space-y-1">
                {alarms.map((a, i) => (
                  <div
                    key={`${a.shipment_id}-${a.noa_number}-${i}`}
                    className={`px-3 py-2.5 rounded-lg transition-colors ${a.status === 'overdue' ? 'bg-destructive/10' : 'bg-amber-500/10'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{a.mawb}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.hubs.length > 0 ? a.hubs.join(' · ') : '—'}
                        </p>
                        <p className={`text-xs font-medium ${a.status === 'overdue' ? 'text-destructive' : 'text-amber-600'}`}>
                          {a.status === 'overdue' && a.deadline ? formatHoursOverdue(a.deadline) : formatHoursRemaining(a.hours_remaining)}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" className="shrink-0 text-xs gap-1" onClick={() => { navigate('/warehouse/stock'); setOpen(false); }}>
                        <ExternalLink className="h-3 w-3" /> Stock
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>
      )}
    </>
  );
}
