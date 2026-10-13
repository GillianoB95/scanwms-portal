import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Package, Clock, ShieldCheck, Timer, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/* ─── Types ─── */
type DateRange = '7d' | '30d' | 'all';

interface DoorlooptijdRow {
  shipment_id: string;
  mawb: string | null;
  status: string | null;
  ground_handler_code: string | null;
  colli_expected: number | null;
  parcels: number | null;
  is_uld: boolean | null;
  is_deellading: boolean | null;
  eta: string | null;
  noa_at: string | null;
  t1_created_at: string | null;
  t1_mrn: string | null;
  unloaded_at: string | null;
  customs_cleared_at: string | null;
  first_scan_at: string | null;
  last_scan_at: string | null;
  first_outbound_at: string | null;
  hours_noa_to_warehouse: number | null;
  hours_noa_to_scan: number | null;
  sla_status: string | null;
}

interface GroundHandlerRow {
  ground_handler_code: string;
  total_shipments: number;
  avg_colli: number | null;
  uld_count: number;
  deellading_count: number;
  avg_hours_noa_to_warehouse: number | null;
}

interface TriggerSummaryRow {
  trigger_key: string;
  total_fired: number;
  open_fires: number;
  resolved: number;
  false_alarms: number;
  first_fired: string | null;
  last_fired: string | null;
}

interface T1TimingRow {
  shipment_id: string;
  mawb: string | null;
  ground_handler_code: string | null;
  t1_mrn: string | null;
  t1_created_by: string | null;
  t1_created_at: string | null;
  noa_at: string | null;
  ttl_requested_at: string | null;
  ttl_approved_at: string | null;
  nallian_uploaded_at: string | null;
  hours_noa_to_t1: number | null;
  hours_ttl_wait: number | null;
}

/* ─── Hooks ─── */
function useKpiDoorlooptijden() {
  return useQuery({
    queryKey: ['kpi-doorlooptijden'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('kpi_doorlooptijden')
        .select('*')
        .order('noa_at', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as DoorlooptijdRow[];
    },
  });
}

function useKpiPerGroundHandler() {
  return useQuery({
    queryKey: ['kpi-per-ground-handler'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('kpi_per_ground_handler')
        .select('*')
        .order('ground_handler_code');
      if (error) throw error;
      return (data ?? []) as GroundHandlerRow[];
    },
  });
}

function useKpiTriggerSummary() {
  return useQuery({
    queryKey: ['kpi-trigger-summary'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('kpi_trigger_summary')
        .select('*')
        .order('trigger_key');
      if (error) throw error;
      return (data ?? []) as TriggerSummaryRow[];
    },
  });
}

function useKpiT1Timing() {
  return useQuery({
    queryKey: ['kpi-t1-timing'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('kpi_t1_timing')
        .select('*')
        .order('t1_created_at', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as T1TimingRow[];
    },
  });
}

/* ─── Helpers ─── */
function dateRangeStart(range: DateRange): Date | null {
  if (range === 'all') return null;
  const days = range === '7d' ? 7 : 30;
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

function rowDate(row: DoorlooptijdRow): string | null {
  return row.noa_at ?? row.eta ?? row.first_scan_at;
}

function fmtHours(h: number | null): string {
  if (h === null || h === undefined || Number.isNaN(h)) return '—';
  const v = Number(h);
  if (v < 1) return `${Math.round(v * 60)}m`;
  return `${v.toFixed(1)}h`;
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function slaBadge(sla: string | null) {
  switch (sla) {
    case 'Within 24h':
      return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Within 24h</Badge>;
    case 'Within 48h':
      return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Within 48h</Badge>;
    case 'SLA breach':
      return <Badge variant="destructive">SLA breach</Badge>;
    case 'Waiting':
      return <Badge variant="secondary">Waiting</Badge>;
    case 'No NOA':
      return <Badge variant="outline">No NOA</Badge>;
    default:
      return <span className="text-muted-foreground">—</span>;
  }
}

/* ─── Page ─── */
export default function KpiDashboard() {
  const [range, setRange] = useState<DateRange>('30d');

  const doorlooptijdenQ = useKpiDoorlooptijden();
  const groundHandlerQ = useKpiPerGroundHandler();
  const triggerQ = useKpiTriggerSummary();
  const t1Q = useKpiT1Timing();

  const loading =
    doorlooptijdenQ.isLoading ||
    groundHandlerQ.isLoading ||
    triggerQ.isLoading ||
    t1Q.isLoading;

  // Apply date-range filter to per-shipment rows (by noa_at, fallback eta/first_scan).
  const filteredRows = useMemo(() => {
    const rows = doorlooptijdenQ.data ?? [];
    const start = dateRangeStart(range);
    if (!start) return rows;
    const cutoff = start.getTime();
    return rows.filter((r) => {
      const d = rowDate(r);
      if (!d) return false;
      return new Date(d).getTime() >= cutoff;
    });
  }, [doorlooptijdenQ.data, range]);

  // KPI cards computed from filtered rows.
  const kpis = useMemo(() => {
    const total = filteredRows.length;
    const completed = filteredRows.filter((r) => r.hours_noa_to_warehouse !== null);
    const avgHours =
      completed.length > 0
        ? completed.reduce((s, r) => s + Number(r.hours_noa_to_warehouse ?? 0), 0) / completed.length
        : null;

    const slaEligible = filteredRows.filter((r) =>
      ['Within 24h', 'Within 48h', 'SLA breach'].includes(r.sla_status ?? ''),
    );
    const within24 = filteredRows.filter((r) => r.sla_status === 'Within 24h').length;
    const within48 = filteredRows.filter((r) =>
      ['Within 24h', 'Within 48h'].includes(r.sla_status ?? ''),
    ).length;

    const sla24 = slaEligible.length > 0 ? (within24 / slaEligible.length) * 100 : null;
    const sla48 = slaEligible.length > 0 ? (within48 / slaEligible.length) * 100 : null;

    return { total, avgHours, sla24, sla48 };
  }, [filteredRows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            KPI Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Doorlooptijden, SLA compliance, ground handler performance & T1 timing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Date range:</span>
          <Select value={range} onValueChange={(v) => setRange(v as DateRange)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Total Shipments"
          value={loading ? '…' : kpis.total.toLocaleString()}
          icon={<Package className="h-5 w-5 text-primary" />}
          subtitle={range === 'all' ? 'All time' : range === '7d' ? 'Last 7 days' : 'Last 30 days'}
        />
        <KpiCard
          title="Avg Doorlooptijd (NOA → Warehouse)"
          value={loading ? '…' : fmtHours(kpis.avgHours)}
          icon={<Clock className="h-5 w-5 text-primary" />}
          subtitle="Across completed shipments"
        />
        <KpiCard
          title="SLA 24h Compliance"
          value={loading ? '…' : kpis.sla24 === null ? '—' : `${kpis.sla24.toFixed(1)}%`}
          icon={<ShieldCheck className="h-5 w-5 text-primary" />}
          subtitle="Shipments unloaded within 24h"
        />
        <KpiCard
          title="SLA 48h Compliance"
          value={loading ? '…' : kpis.sla48 === null ? '—' : `${kpis.sla48.toFixed(1)}%`}
          icon={<Timer className="h-5 w-5 text-primary" />}
          subtitle="Shipments unloaded within 48h"
        />
      </div>

      {/* Per-shipment KPI table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Per-Shipment Doorlooptijden</CardTitle>
        </CardHeader>
        <CardContent>
          {doorlooptijdenQ.isLoading ? (
            <LoadingRow />
          ) : doorlooptijdenQ.error ? (
            <ErrorRow message={(doorlooptijdenQ.error as Error).message} />
          ) : filteredRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No shipments in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>MAWB</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Ground Handler</TableHead>
                    <TableHead>Colli</TableHead>
                    <TableHead className="text-right">NOA → Warehouse</TableHead>
                    <TableHead>SLA Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((r) => (
                    <TableRow key={r.shipment_id}>
                      <TableCell className="font-mono text-xs">{r.mawb ?? '—'}</TableCell>
                      <TableCell>{r.status ?? '—'}</TableCell>
                      <TableCell>{r.ground_handler_code ?? '—'}</TableCell>
                      <TableCell>{r.colli_expected ?? '—'}</TableCell>
                      <TableCell className="text-right">{fmtHours(r.hours_noa_to_warehouse)}</TableCell>
                      <TableCell>{slaBadge(r.sla_status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Per ground handler summary */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Per Ground Handler</CardTitle>
          </CardHeader>
          <CardContent>
            {groundHandlerQ.isLoading ? (
              <LoadingRow />
            ) : groundHandlerQ.error ? (
              <ErrorRow message={(groundHandlerQ.error as Error).message} />
            ) : (groundHandlerQ.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No data.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Handler</TableHead>
                      <TableHead className="text-right">Shipments</TableHead>
                      <TableHead className="text-right">Avg Colli</TableHead>
                      <TableHead className="text-right">ULD</TableHead>
                      <TableHead className="text-right">Deellading</TableHead>
                      <TableHead className="text-right">Avg NOA→Wh</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groundHandlerQ.data!.map((r) => (
                      <TableRow key={r.ground_handler_code}>
                        <TableCell className="font-medium">{r.ground_handler_code}</TableCell>
                        <TableCell className="text-right">{r.total_shipments}</TableCell>
                        <TableCell className="text-right">
                          {r.avg_colli === null ? '—' : Number(r.avg_colli).toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right">{r.uld_count}</TableCell>
                        <TableCell className="text-right">{r.deellading_count}</TableCell>
                        <TableCell className="text-right">{fmtHours(r.avg_hours_noa_to_warehouse)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Trigger summary */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Trigger Summary</CardTitle>
          </CardHeader>
          <CardContent>
            {triggerQ.isLoading ? (
              <LoadingRow />
            ) : triggerQ.error ? (
              <ErrorRow message={(triggerQ.error as Error).message} />
            ) : (triggerQ.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No triggers fired.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Trigger</TableHead>
                      <TableHead className="text-right">Fired</TableHead>
                      <TableHead className="text-right">Open</TableHead>
                      <TableHead className="text-right">Resolved</TableHead>
                      <TableHead className="text-right">False</TableHead>
                      <TableHead>Last Fired</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {triggerQ.data!.map((r) => (
                      <TableRow key={r.trigger_key}>
                        <TableCell className="font-medium">{r.trigger_key}</TableCell>
                        <TableCell className="text-right">{r.total_fired}</TableCell>
                        <TableCell className="text-right">
                          {r.open_fires > 0 ? (
                            <Badge variant="destructive">{r.open_fires}</Badge>
                          ) : (
                            r.open_fires
                          )}
                        </TableCell>
                        <TableCell className="text-right">{r.resolved}</TableCell>
                        <TableCell className="text-right">{r.false_alarms}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDate(r.last_fired)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* T1 timing */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">T1 Timing</CardTitle>
        </CardHeader>
        <CardContent>
          {t1Q.isLoading ? (
            <LoadingRow />
          ) : t1Q.error ? (
            <ErrorRow message={(t1Q.error as Error).message} />
          ) : (t1Q.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No T1 records.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>MAWB</TableHead>
                    <TableHead>Handler</TableHead>
                    <TableHead>T1 MRN</TableHead>
                    <TableHead>Created By</TableHead>
                    <TableHead>NOA At</TableHead>
                    <TableHead>T1 Created</TableHead>
                    <TableHead className="text-right">NOA → T1</TableHead>
                    <TableHead className="text-right">TTL Wait</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {t1Q.data!.map((r) => (
                    <TableRow key={r.shipment_id}>
                      <TableCell className="font-mono text-xs">{r.mawb ?? '—'}</TableCell>
                      <TableCell>{r.ground_handler_code ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{r.t1_mrn ?? '—'}</TableCell>
                      <TableCell>{r.t1_created_by ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(r.noa_at)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(r.t1_created_at)}</TableCell>
                      <TableCell className="text-right">{fmtHours(r.hours_noa_to_t1)}</TableCell>
                      <TableCell className="text-right">{fmtHours(r.hours_ttl_wait)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Small presentational helpers ─── */
function KpiCard({
  title,
  value,
  icon,
  subtitle,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-8 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return <p className="text-sm text-destructive py-6 text-center">Error: {message}</p>;
}
