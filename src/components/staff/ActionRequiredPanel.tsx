import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAlarmSettings } from '@/hooks/use-alarm-settings';
import { getFycoAlarm, getShipmentAlarms, DEFAULT_ALARM_SETTINGS, type FycoAlarm, type ShipmentAlarm } from '@/lib/alarm-utils';
import { Bell, X, ExternalLink } from 'lucide-react';
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
        .select('id, mawb, status, eta, noa_received_at, unloaded_at, customers(name)')
        .not('status', 'eq', 'Outbound');
      if (error) throw error;

      const alarms: ShipmentAlarmRow[] = [];
      for (const s of data ?? []) {
        const sAlarms = getShipmentAlarms({
          id: s.id,
          mawb: s.mawb,
          status: s.status,
          eta: s.eta,
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

  return { fycoAlarms, shipmentAlarms, settings };
}

export function ActionRequiredPanel() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'fyco' | 'shipments'>('all');
  const navigate = useNavigate();
  const { fycoAlarms, shipmentAlarms } = useAlarmData();

  const totalCount = fycoAlarms.length + shipmentAlarms.length;

  const filteredFyco = filter === 'shipments' ? [] : fycoAlarms;
  const filteredShipments = filter === 'fyco' ? [] : shipmentAlarms;

  

  return (
    <>
      {/* Fixed bell button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-destructive text-destructive-foreground shadow-lg flex items-center justify-center hover:bg-destructive/90 transition-colors"
      >
        <Bell className="h-6 w-6" />
        <span className="absolute -top-1 -right-1 h-6 min-w-6 px-1 rounded-full bg-foreground text-background text-xs font-bold flex items-center justify-center">
          {totalCount}
        </span>
      </button>

      {/* Panel overlay */}
      {open && (
        <div className="fixed inset-0 z-50" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-foreground/20" />
          <div
            className="absolute bottom-0 right-0 w-full max-w-md h-[70vh] bg-card border-t border-l rounded-tl-xl shadow-2xl flex flex-col animate-in slide-in-from-bottom duration-300"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
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

            {/* Filters */}
            <div className="flex gap-2 px-5 py-3 border-b">
              {(['all', 'fyco', 'shipments'] as const).map(f => (
                <Button
                  key={f}
                  variant={filter === f ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilter(f)}
                  className="text-xs capitalize"
                >
                  {f === 'all' ? 'All' : f === 'fyco' ? 'Fyco' : 'Shipments'}
                </Button>
              ))}
            </div>

            {/* Content */}
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
                        <div
                          key={a.id}
                          className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">
                              {a.mawb} · <span className="font-mono text-xs">{a.barcode.length > 16 ? a.barcode.slice(0, 16) + '…' : a.barcode}</span>
                            </p>
                            <p className="text-xs text-muted-foreground">{a.alarm.description}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="shrink-0 text-xs gap-1"
                            onClick={() => { navigate('/staff/fyco'); setOpen(false); }}
                          >
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
                        <div
                          key={`${a.id}-${i}`}
                          className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">
                              {a.mawb} · {a.customer_name || '—'}
                            </p>
                            <p className="text-xs text-muted-foreground">{a.alarm.description}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="shrink-0 text-xs gap-1"
                            onClick={() => { navigate(`/staff/shipments/${a.id}`); setOpen(false); }}
                          >
                            <ExternalLink className="h-3 w-3" /> View
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {filteredFyco.length === 0 && filteredShipments.length === 0 && (
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
