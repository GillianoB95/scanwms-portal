import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAlarmSettings } from '@/hooks/use-alarm-settings';
import { getFycoAlarm, getShipmentAlarms, DEFAULT_ALARM_SETTINGS, type FycoAlarm, type ShipmentAlarm } from '@/lib/alarm-utils';
import { computeNoaKpis, computeCarrierPickupKpi, kpiStatusEmoji, kpiStatusColor, formatHoursRemaining, formatHoursOverdue, type NoaKpiEntry, type CarrierPickupKpi } from '@/lib/kpi-utils';
import { Bell, X, ExternalLink, Truck, Package } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNavigate } from 'react-router-dom';

interface FycoAlarmRow {
  id: string;
  mawb: string;
  barcode: string;
  alarm: FycoAlarm;
}

interface ShipmentAlarmRow {
  id: string;
  mawb: string;
  customer_name: string | null;
  alarm: ShipmentAlarm;
}

interface KpiAlarmRow {
  shipment_id: string;
  mawb: string;
  type: 'palletizing' | 'carrier_pickup';
  noa_number?: number;
  colli?: number;
  status: string;
  hours_remaining: number | null;
  deadline: Date | null;
}

function useAlarmData() {
  const { data: settings = DEFAULT_ALARM_SETTINGS } = useAlarmSettings();

  const { data: fycoAlarms = [] } = useQuery({
    queryKey: ['alarm-fyco', settings],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inspections')
        .select(`
          id, barcode, parcel_barcode, scan_time, checked_at,
          documents_requested, documents_requested_at,
          additional_action_required, additional_action_at,
          released_at,
          shipments ( mawb )
        `)
        .is('released_at', null);
      if (error) throw error;

      const alarms: FycoAlarmRow[] = [];
      for (const insp of data ?? []) {
        const alarm = getFycoAlarm({
          scan_time: insp.scan_time,
          checked_at: insp.checked_at,
          documents_requested: insp.documents_requested ?? false,
          documents_requested_at: insp.documents_requested_at,
          additional_action_required: insp.additional_action_required ?? false,
          additional_action_at: insp.additional_action_at,
          released_at: insp.released_at,
        }, settings);
        if (alarm) {
          alarms.push({
            id: insp.id,
            mawb: (insp as any).shipments?.mawb ?? '—',
            barcode: insp.barcode ?? insp.parcel_barcode ?? '—',
            alarm,
          });
        }
      }
      return alarms;
    },
    refetchInterval: 60_000,
  });

  const { data: shipmentAlarms = [] } = useQuery({
    queryKey: ['alarm-shipments', settings],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shipments')
        .select('id, mawb, status, eta, created_at, noa_received_at, unloaded_at, customers(name)')
        .not('status', 'eq', 'Outbound');
      if (error) throw error;

      const alarms: ShipmentAlarmRow[] = [];
      for (const s of data ?? []) {
        const sAlarms = getShipmentAlarms({
          id: s.id,
          mawb: s.mawb,
          status: s.status,
          eta: s.eta,
          created_at: (s as any).created_at,
          noa_received_at: (s as any).noa_received_at,
          unloaded_at: (s as any).unloaded_at,
          customer_name: (s as any).customers?.name ?? null,
        }, settings);
        for (const alarm of sAlarms) {
          alarms.push({ id: s.id, mawb: s.mawb, customer_name: (s as any).customers?.name ?? null, alarm });
        }
      }
      return alarms;
    },
    refetchInterval: 60_000,
  });

  // KPI alarms
  const { data: kpiAlarms = [] } = useQuery({
    queryKey: ['alarm-kpis', settings],
    queryFn: async () => {
      // Get in-stock shipments with customer_id
      const { data: shipments } = await supabase
        .from('shipments')
        .select('id, mawb, customer_id, unloaded_at')
        .in('status', ['In Stock', 'Partially Unloaded']);
      if (!shipments?.length) return [];

      const shipmentIds = shipments.map(s => s.id);
      const customerIds = [...new Set(shipments.map(s => (s as any).customer_id).filter(Boolean))];

      const [noasRes, customersRes, boxesRes] = await Promise.all([
        supabase.from('noas').select('shipment_id, noa_number, colli, received_at').in('shipment_id', shipmentIds),
        supabase.from('customers').select('id, kpi_palletized_hours').in('id', customerIds),
        supabase.from('outerboxes').select('shipment_id, status').in('shipment_id', shipmentIds).neq('status', 'deleted'),
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
      for (const b of boxesRes.data ?? []) {
        if (b.status === 'palletized' || b.status === 'scanned_out') {
          palletizedMap.set(b.shipment_id, (palletizedMap.get(b.shipment_id) ?? 0) + 1);
        }
      }

      const alarms: KpiAlarmRow[] = [];
      for (const s of shipments) {
        const noas = (noasByShipment.get(s.id) ?? []).map((n: any) => ({
          noa_number: n.noa_number, colli: n.colli ?? 0, received_at: n.received_at,
        }));
        const kpiHours = customerKpiMap.get((s as any).customer_id) ?? 48;
        const palletized = palletizedMap.get(s.id) ?? 0;

        const noaKpis = computeNoaKpis(noas, palletized, kpiHours, settings.noa_kpi_warning_hours);
        for (const kpi of noaKpis) {
          if (kpi.status === 'warning' || kpi.status === 'overdue') {
            alarms.push({
              shipment_id: s.id, mawb: s.mawb, type: 'palletizing',
              noa_number: kpi.noa_number, colli: kpi.colli,
              status: kpi.status, hours_remaining: kpi.hours_remaining, deadline: kpi.deadline,
            });
          }
        }

        const carrierKpi = computeCarrierPickupKpi(noas, (s as any).unloaded_at, settings.carrier_pickup_hours, settings.carrier_pickup_warning_hours);
        if (carrierKpi.status === 'warning' || carrierKpi.status === 'overdue') {
          alarms.push({
            shipment_id: s.id, mawb: s.mawb, type: 'carrier_pickup',
            status: carrierKpi.status, hours_remaining: carrierKpi.hours_remaining, deadline: carrierKpi.deadline,
          });
        }
      }
      return alarms;
    },
    refetchInterval: 60_000,
  });

  return { fycoAlarms, shipmentAlarms, kpiAlarms, settings };
}

export function ActionRequiredPanel() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'fyco' | 'shipments' | 'kpi'>('all');
  const navigate = useNavigate();
  const { fycoAlarms, shipmentAlarms, kpiAlarms } = useAlarmData();

  const totalCount = fycoAlarms.length + shipmentAlarms.length + kpiAlarms.length;

  const filteredFyco = filter === 'shipments' || filter === 'kpi' ? [] : fycoAlarms;
  const filteredShipments = filter === 'fyco' || filter === 'kpi' ? [] : shipmentAlarms;
  const filteredKpis = filter === 'fyco' || filter === 'shipments' ? [] : kpiAlarms;

  const palletizingKpis = filteredKpis.filter(k => k.type === 'palletizing');
  const carrierKpis = filteredKpis.filter(k => k.type === 'carrier_pickup');

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-destructive text-destructive-foreground shadow-lg flex items-center justify-center hover:bg-destructive/90 transition-colors"
      >
        <Bell className="h-6 w-6" />
        <span className="absolute -top-1 -right-1 h-6 min-w-6 px-1 rounded-full bg-foreground text-background text-xs font-bold flex items-center justify-center">
          {totalCount}
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-foreground/20" />
          <div
            className="absolute bottom-0 right-0 w-full max-w-md h-[70vh] bg-card border-t border-l rounded-tl-xl shadow-2xl flex flex-col animate-in slide-in-from-bottom duration-300"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div className="flex items-center gap-2">
                <span className="text-lg">⚠️</span>
                <h2 className="font-semibold text-lg">Action Required</h2>
                <Badge variant="destructive" className="text-xs">{totalCount}</Badge>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex gap-2 px-5 py-3 border-b flex-wrap">
              {(['all', 'fyco', 'shipments', 'kpi'] as const).map(f => (
                <Button
                  key={f}
                  variant={filter === f ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilter(f)}
                  className="text-xs capitalize"
                >
                  {f === 'all' ? 'All' : f === 'fyco' ? 'Fyco' : f === 'shipments' ? 'Shipments' : 'KPIs'}
                </Button>
              ))}
            </div>

            <ScrollArea className="flex-1">
              <div className="px-5 py-3 space-y-4">
                {/* Fyco alarms */}
                {filteredFyco.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span>🔴</span>
                      <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Fyco Alarms ({filteredFyco.length})
                      </span>
                    </div>
                    <div className="space-y-1">
                      {filteredFyco.map(a => (
                        <div key={a.id} className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">
                              {a.mawb} · <span className="font-mono text-xs">{a.barcode.length > 16 ? a.barcode.slice(0, 16) + '…' : a.barcode}</span>
                            </p>
                            <p className="text-xs text-muted-foreground">{a.alarm.description}</p>
                          </div>
                          <Button variant="ghost" size="sm" className="shrink-0 text-xs gap-1" onClick={() => { navigate('/staff/fyco'); setOpen(false); }}>
                            <ExternalLink className="h-3 w-3" /> View
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Shipment alarms */}
                {filteredShipments.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span>🟠</span>
                      <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Shipment Alarms ({filteredShipments.length})
                      </span>
                    </div>
                    <div className="space-y-1">
                      {filteredShipments.map((a, i) => (
                        <div key={`${a.id}-${i}`} className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{a.mawb} · {a.customer_name || '—'}</p>
                            <p className="text-xs text-muted-foreground">{a.alarm.description}</p>
                          </div>
                          <Button variant="ghost" size="sm" className="shrink-0 text-xs gap-1" onClick={() => { navigate(`/staff/shipments/${a.id}`); setOpen(false); }}>
                            <ExternalLink className="h-3 w-3" /> View
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Palletizing KPI alarms */}
                {palletizingKpis.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span>📦</span>
                      <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Palletizing KPI ({palletizingKpis.length})
                      </span>
                    </div>
                    <div className="space-y-1">
                      {palletizingKpis.map((a, i) => (
                        <div key={`pal-${a.shipment_id}-${i}`} className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg transition-colors ${a.status === 'overdue' ? 'bg-destructive/10' : 'bg-amber-500/10'}`}>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">
                              {a.mawb} · NOA #{a.noa_number} · {a.colli} colli
                            </p>
                            <p className={`text-xs font-medium ${a.status === 'overdue' ? 'text-destructive' : 'text-amber-600'}`}>
                              {a.status === 'overdue' && a.deadline ? formatHoursOverdue(a.deadline) : formatHoursRemaining(a.hours_remaining)}
                            </p>
                          </div>
                          <Button variant="ghost" size="sm" className="shrink-0 text-xs gap-1" onClick={() => { navigate('/staff/shipments'); setOpen(false); }}>
                            <ExternalLink className="h-3 w-3" /> View
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Carrier Pickup alarms */}
                {carrierKpis.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span>🚚</span>
                      <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Carrier Pickup ({carrierKpis.length})
                      </span>
                    </div>
                    <div className="space-y-1">
                      {carrierKpis.map((a, i) => (
                        <div key={`car-${a.shipment_id}-${i}`} className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg transition-colors ${a.status === 'overdue' ? 'bg-destructive/10' : 'bg-amber-500/10'}`}>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{a.mawb} · not yet unloaded</p>
                            <p className={`text-xs font-medium ${a.status === 'overdue' ? 'text-destructive' : 'text-amber-600'}`}>
                              {a.status === 'overdue' && a.deadline ? formatHoursOverdue(a.deadline) : formatHoursRemaining(a.hours_remaining)}
                            </p>
                          </div>
                          <Button variant="ghost" size="sm" className="shrink-0 text-xs gap-1" onClick={() => { navigate(`/staff/shipments/${a.shipment_id}`); setOpen(false); }}>
                            <ExternalLink className="h-3 w-3" /> View
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {filteredFyco.length === 0 && filteredShipments.length === 0 && filteredKpis.length === 0 && (
                  <p className="text-center text-muted-foreground py-8 text-sm">No alarms in this category.</p>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      )}
    </>
  );
}
