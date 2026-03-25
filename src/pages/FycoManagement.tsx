import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useLocation } from 'react-router-dom';
import { Loader2, ShieldCheck, Clock, Search, Mail, Send, AlertTriangle } from 'lucide-react';
import { useAlarmSettings } from '@/hooks/use-alarm-settings';
import { getFycoAlarm, DEFAULT_ALARM_SETTINGS, type FycoAlarm } from '@/lib/alarm-utils';
import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';

interface FycoRow {
  id: string;
  barcode: string;
  created_at: string;
  shipment_id: string;
  mawb: string;
  hub_code: string | null;
  warehouse: string | null;
  warehouse_name: string | null;
  subklant: string | null;
  customer_id: string | null;
  location: string | null;
  scan_time: string | null;
  checked_at: string | null;
  checked_by: string | null;
  documents_requested: boolean;
  documents_requested_at: string | null;
  documents_requested_by: string | null;
  additional_action_required: boolean;
  additional_action_at: string | null;
  additional_action_by: string | null;
  released_at: string | null;
  released_by: string | null;
  customs_remarks: string | null;
  customs_cleared_at: string | null;
  sla_deadline: string | null;
  email_sent_at: string | null;
  email_sent_by: string | null;
  // derived
  outbound_status: string | null;
}

function getStatusBadge(row: FycoRow) {
  if (row.outbound_status === 'departed') return { label: 'Delivered', emoji: '✅', variant: 'default' as const, color: 'bg-emerald-600' };
  if (row.outbound_status === 'prepared') return { label: 'Prepared', emoji: '✅', variant: 'default' as const, color: 'bg-emerald-500' };
  if (row.released_at) return { label: 'Released', emoji: '🟢', variant: 'default' as const, color: 'bg-green-500' };
  if (row.additional_action_required) return { label: 'Action Required', emoji: '🟠', variant: 'default' as const, color: 'bg-orange-500' };
  if (row.documents_requested) return { label: 'Docs Requested', emoji: '🔵', variant: 'default' as const, color: 'bg-blue-500' };
  if (row.scan_time && !row.checked_at) return { label: 'Pending Check', emoji: '🟡', variant: 'secondary' as const, color: 'bg-yellow-500' };
  if (!row.scan_time) return { label: 'Not Scanned', emoji: '🔴', variant: 'destructive' as const, color: 'bg-red-500' };
  return { label: 'Checked', emoji: '🟡', variant: 'secondary' as const, color: '' };
}

function getStatusFilter(row: FycoRow): string {
  if (row.outbound_status === 'departed') return 'delivered';
  if (row.outbound_status === 'prepared') return 'delivered';
  if (row.released_at) return 'released';
  return 'pending';
}

function computeSlaDeadline(customsClearedAt: string | null): string | null {
  if (!customsClearedAt) return null;
  const cleared = new Date(customsClearedAt);
  const hours = cleared.getHours();
  if (hours < 12) {
    // Same day 23:59
    return new Date(cleared.getFullYear(), cleared.getMonth(), cleared.getDate(), 23, 59, 59).toISOString();
  } else {
    // Next day 23:59
    const next = new Date(cleared.getFullYear(), cleared.getMonth(), cleared.getDate() + 1, 23, 59, 59);
    return next.toISOString();
  }
}

function isSlaWarning(row: FycoRow): boolean {
  if (!row.scan_time || row.checked_at) return false;
  if (!row.sla_deadline) return false;
  return new Date() > new Date(row.sla_deadline);
}

function useFycoData() {
  return useQuery({
    queryKey: ['fyco-management'],
    queryFn: async () => {
      const { data: inspections, error } = await supabase
        .from('inspections')
        .select(`
          id,
          barcode,
          parcel_barcode,
          shipment_id,
          status,
          location,
          scan_time,
          checked_at,
          checked_by,
          documents_requested,
          documents_requested_at,
          documents_requested_by,
          additional_action_required,
          additional_action_at,
          additional_action_by,
          released_at,
          released_by,
          customs_remarks,
          created_at,
          email_sent_at,
          email_sent_by,
          shipments (
            mawb,
            warehouse_id,
            customer_id,
            customs_cleared_at,
            subklanten ( name ),
            customers ( name ),
            warehouses ( name, code )
          )
        `)
        .order('scan_time', { ascending: false, nullsFirst: false });

      if (error) {
        console.error('Fyco inspections query error:', error);
        throw error;
      }
      if (!inspections || inspections.length === 0) return [];

      const barcodes = inspections.map(i => i.barcode ?? i.parcel_barcode).filter(Boolean);
      let outboundStatusMap = new Map<string, string>();
      if (barcodes.length > 0) {
        const { data: boxes } = await supabase
          .from('outerboxes')
          .select('barcode, pallet_id')
          .in('barcode', barcodes);
        const palletIds = [...new Set((boxes ?? []).filter(b => b.pallet_id).map(b => b.pallet_id))];
        if (palletIds.length > 0) {
          const { data: pallets } = await supabase
            .from('pallets')
            .select('id, outbound_id, outbounds(status)')
            .in('id', palletIds);
          const palletStatusMap = new Map((pallets ?? []).map(p => [p.id, (p as any).outbounds?.status]));
          for (const box of (boxes ?? [])) {
            if (box.pallet_id && palletStatusMap.has(box.pallet_id)) {
              outboundStatusMap.set(box.barcode, palletStatusMap.get(box.pallet_id)!);
            }
          }
        }
      }

      return inspections.map(insp => {
        const ship = (insp as any).shipments;
        const bc = insp.barcode ?? insp.parcel_barcode ?? '—';
        return {
          id: insp.id,
          barcode: bc,
          created_at: insp.created_at ?? '',
          shipment_id: insp.shipment_id,
          mawb: ship?.mawb ?? '—',
          hub_code: null,
          warehouse: ship?.warehouse_id ?? null,
          warehouse_name: ship?.warehouses?.name ?? ship?.warehouses?.code ?? null,
          subklant: ship?.subklanten?.name ?? null,
          customer_id: ship?.customer_id ?? null,
          location: insp.location,
          scan_time: insp.scan_time,
          checked_at: insp.checked_at,
          checked_by: insp.checked_by,
          documents_requested: insp.documents_requested ?? false,
          documents_requested_at: insp.documents_requested_at,
          documents_requested_by: insp.documents_requested_by,
          additional_action_required: insp.additional_action_required ?? false,
          additional_action_at: insp.additional_action_at,
          additional_action_by: insp.additional_action_by,
          released_at: insp.released_at,
          released_by: insp.released_by,
          customs_remarks: insp.customs_remarks,
          customs_cleared_at: ship?.customs_cleared_at ?? null,
          sla_deadline: computeSlaDeadline(ship?.customs_cleared_at ?? null),
          email_sent_at: (insp as any).email_sent_at ?? null,
          email_sent_by: (insp as any).email_sent_by ?? null,
          outbound_status: outboundStatusMap.get(bc) ?? null,
        } as FycoRow;
      });
    },
  });
}

/* ─── Send to Customs helpers ─── */
function fillTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

function SendToCustomsModal({ open, onOpenChange, parcels, isStaff: _isStaff, userEmail, onSent }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  parcels: FycoRow[];
  isStaff: boolean;
  userEmail: string;
  onSent: () => void;
}) {
  const { data: template } = useQuery({
    queryKey: ['customs-inspection-template'],
    queryFn: async () => {
      const { data } = await supabase.from('email_templates').select('*').eq('template_type', 'customs_inspection').maybeSingle();
      return data;
    },
  });

  if (!parcels.length) return null;

  const mawb = parcels[0].mawb;
  const warehouseName = parcels[0].warehouse_name || '—';
  const slaDeadline = parcels[0].sla_deadline ? format(new Date(parcels[0].sla_deadline), 'dd/MM/yy HH:mm') : '—';
  const parcelList = parcels.map(p => p.barcode).join('\n');

  const vars: Record<string, string> = {
    mawb,
    warehouse_name: warehouseName,
    sla_deadline: slaDeadline,
    parcel_list: parcelList,
    parcel_barcode: parcels.length === 1 ? parcels[0].barcode : parcelList,
  };

  const subjectStr = fillTemplate(template?.subject || 'Customs Inspection — {{mawb}}', vars);
  const bodyStr = fillTemplate(template?.body || 'Parcels:\n{{parcel_list}}', vars);
  const recipients = template?.recipients || '';

  const handleConfirm = async () => {
    // Open mailto
    const mailto = `mailto:${encodeURIComponent(recipients)}?subject=${encodeURIComponent(subjectStr)}&body=${encodeURIComponent(bodyStr)}`;
    window.open(mailto, '_blank');

    // Mark inspections as email sent
    const ids = parcels.map(p => p.id);
    const { error } = await supabase.from('inspections').update({
      email_sent_at: new Date().toISOString(),
      email_sent_by: userEmail,
    }).in('id', ids);
    if (error) {
      toast.error('Failed to mark as sent');
    } else {
      toast.success(`Email prepared for ${ids.length} parcel(s)`);
      onSent();
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Send to Customs — {mawb}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">To</Label>
            <p className="text-sm font-mono bg-muted rounded px-3 py-2">{recipients || '(no recipients set)'}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Subject</Label>
            <p className="text-sm font-medium bg-muted rounded px-3 py-2">{subjectStr}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Body</Label>
            <pre className="text-sm bg-muted rounded px-3 py-2 whitespace-pre-wrap font-sans max-h-64 overflow-auto">{bodyStr}</pre>
          </div>
          <p className="text-xs text-muted-foreground">{parcels.length} parcel(s) will be marked as email sent.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm}>
            <Mail className="h-4 w-4 mr-2" />
            Open in Mail Client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function FycoManagement() {
  const { data: rows = [], isLoading } = useFycoData();
  const { data: alarmSettings = DEFAULT_ALARM_SETTINGS } = useAlarmSettings();
  const { user } = useAuth();
  const location = useLocation();
  const qc = useQueryClient();
  const isStaff = location.pathname.startsWith('/staff');
  const userEmail = user?.email ?? 'unknown';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [alarmFilter, setAlarmFilter] = useState<'all' | 'alarms' | '1' | '2' | '3' | '4'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingLocation, setEditingLocation] = useState<{ id: string; value: string } | null>(null);
  const [editingRemarks, setEditingRemarks] = useState<{ id: string; value: string } | null>(null);
  const [sendModalParcels, setSendModalParcels] = useState<FycoRow[]>([]);
  const [sendModalOpen, setSendModalOpen] = useState(false);

  // Compute alarms per row
  const rowAlarms = useMemo(() => {
    const map = new Map<string, FycoAlarm | null>();
    for (const r of rows) {
      map.set(r.id, getFycoAlarm(r, alarmSettings));
    }
    return map;
  }, [rows, alarmSettings]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (statusFilter !== 'all' && getStatusFilter(r) !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!r.mawb.toLowerCase().includes(q) && !r.barcode.toLowerCase().includes(q)) return false;
      }
      // Alarm filter
      if (alarmFilter !== 'all') {
        const alarm = rowAlarms.get(r.id);
        if (alarmFilter === 'alarms') {
          if (!alarm) return false;
        } else {
          const stage = parseInt(alarmFilter);
          if (!alarm || alarm.stage !== stage) return false;
        }
      }
      return true;
    });
  }, [rows, search, statusFilter, alarmFilter, rowAlarms]);

  // Group filtered rows by MAWB for per-MAWB send button
  const mawbGrouped = useMemo(() => {
    const map = new Map<string, FycoRow[]>();
    for (const r of filtered) {
      if (!map.has(r.mawb)) map.set(r.mawb, []);
      map.get(r.mawb)!.push(r);
    }
    return map;
  }, [filtered]);

  const handleSendToCustoms = async (parcels: FycoRow[]) => {
    if (!parcels.length) return;
    // Look up customer's grouping preference
    const customerId = parcels[0].customer_id;
    let grouping = 'per_shipment';
    if (customerId) {
      const { data: cust } = await supabase.from('customers').select('customs_email_grouping').eq('id', customerId).maybeSingle();
      if (cust?.customs_email_grouping) grouping = cust.customs_email_grouping;
    }

    if (grouping === 'per_parcel') {
      // Open modal per parcel — for simplicity, send first one, user can repeat
      // Actually show all parcels individually grouped
      for (const p of parcels) {
        setSendModalParcels([p]);
        setSendModalOpen(true);
        return; // Show first, user will repeat for others
      }
    } else {
      setSendModalParcels(parcels);
      setSendModalOpen(true);
    }
  };

  const handleBulkSendToCustoms = async () => {
    const selectedRows = filtered.filter(r => selected.has(r.id));
    if (selectedRows.length === 0) return;
    // Group by MAWB
    const byMawb = new Map<string, FycoRow[]>();
    for (const r of selectedRows) {
      if (!byMawb.has(r.mawb)) byMawb.set(r.mawb, []);
      byMawb.get(r.mawb)!.push(r);
    }
    // Send for first MAWB group (user can repeat for others)
    const first = [...byMawb.values()][0];
    await handleSendToCustoms(first);
  };

  const allSelected = filtered.length > 0 && filtered.every(r => selected.has(r.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(r => r.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Mutations
  const updateMutation = useMutation({
    mutationFn: async ({ ids, updates }: { ids: string[]; updates: Record<string, any> }) => {
      const { error } = await supabase.from('inspections').update(updates).in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fyco-management'] });
      setSelected(new Set());
    },
  });

  const handleBulkChecked = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    try {
      await updateMutation.mutateAsync({
        ids,
        updates: { checked_at: new Date().toISOString(), checked_by: userEmail },
      });
      toast.success(`${ids.length} parcel(s) marked as checked`);
    } catch { toast.error('Failed to update'); }
  };

  const handleBulkReleased = async () => {
    if (!isStaff) return;
    const ids = [...selected];
    if (ids.length === 0) return;
    try {
      await updateMutation.mutateAsync({
        ids,
        updates: { released_at: new Date().toISOString(), released_by: userEmail },
      });
      toast.success(`${ids.length} parcel(s) marked as released`);
    } catch { toast.error('Failed to update'); }
  };

  const handleToggleField = async (id: string, field: string, currentValue: boolean) => {
    // Only staff can toggle additional_action_required
    if (field === 'additional_action_required' && !isStaff) return;

    const updates: Record<string, any> = { [field]: !currentValue };
    if (field === 'documents_requested') {
      if (!currentValue) {
        updates.documents_requested_at = new Date().toISOString();
        updates.documents_requested_by = userEmail;
      } else {
        updates.documents_requested_at = null;
        updates.documents_requested_by = null;
      }
    }
    if (field === 'additional_action_required') {
      if (!currentValue) {
        updates.additional_action_at = new Date().toISOString();
        updates.additional_action_by = userEmail;
      } else {
        updates.additional_action_at = null;
        updates.additional_action_by = null;
      }
    }
    try {
      const { error } = await supabase.from('inspections').update(updates).eq('id', id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['fyco-management'] });
    } catch (e) {
      console.error('Failed to update field:', field, e);
      toast.error('Failed to update');
    }
  };

  const handleSaveLocation = async (id: string, value: string) => {
    try {
      const { error } = await supabase.from('inspections').update({ location: value || null }).eq('id', id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['fyco-management'] });
      setEditingLocation(null);
    } catch (e) {
      console.error('Failed to update location:', e);
      toast.error('Failed to update location');
    }
  };

  const handleSaveRemarks = async (id: string, value: string) => {
    try {
      await updateMutation.mutateAsync({ ids: [id], updates: { customs_remarks: value || null } });
      setEditingRemarks(null);
    } catch { toast.error('Failed to update remarks'); }
  };

  const handleToggleChecked = async (id: string, currentCheckedAt: string | null) => {
    const updates: Record<string, any> = currentCheckedAt
      ? { checked_at: null, checked_by: null }
      : { checked_at: new Date().toISOString(), checked_by: userEmail };
    try {
      await updateMutation.mutateAsync({ ids: [id], updates });
    } catch { toast.error('Failed to update'); }
  };

  const handleToggleReleased = async (id: string, currentReleasedAt: string | null) => {
    if (!isStaff) return;
    const updates: Record<string, any> = currentReleasedAt
      ? { released_at: null, released_by: null }
      : { released_at: new Date().toISOString(), released_by: userEmail };
    try {
      await updateMutation.mutateAsync({ ids: [id], updates });
    } catch { toast.error('Failed to update'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fyco Management</h1>
          <p className="text-sm text-muted-foreground">Customs inspection parcels overview</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search MAWB or parcel..."
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="released">Released</SelectItem>
            <SelectItem value="delivered">Prepared / Delivered</SelectItem>
          </SelectContent>
        </Select>

        {/* Alarm filter */}
        <Select value={alarmFilter} onValueChange={v => setAlarmFilter(v as any)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Alarms</SelectItem>
            <SelectItem value="alarms">🔴 Alarms Only</SelectItem>
            <SelectItem value="1">Stage 1: No check</SelectItem>
            <SelectItem value="2">Stage 2: No action</SelectItem>
            <SelectItem value="3">Stage 3: Docs no release</SelectItem>
            <SelectItem value="4">Stage 4: Action no release</SelectItem>
          </SelectContent>
        </Select>

        {selected.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm text-muted-foreground">{selected.size} selected</span>
            <Button size="sm" variant="outline" onClick={handleBulkChecked} disabled={updateMutation.isPending}>
              Mark Checked
            </Button>
            {isStaff && (
              <Button size="sm" variant="outline" onClick={handleBulkReleased} disabled={updateMutation.isPending}>
                Mark Released
              </Button>
            )}
            {isStaff && (
              <Button size="sm" onClick={handleBulkSendToCustoms}>
                <Send className="h-3.5 w-3.5 mr-1" />
                Send to Customs
              </Button>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          No inspection parcels found.
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                </TableHead>
                <TableHead className="w-8">⚠️</TableHead>
                <TableHead>MAWB</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Parcel</TableHead>
                <TableHead>Sub Client</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Scan Time</TableHead>
                <TableHead>SLA Deadline</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Checked</TableHead>
                <TableHead>Docs Req.</TableHead>
                <TableHead>Action Req.</TableHead>
                {isStaff && <TableHead>Remarks</TableHead>}
                <TableHead>Released</TableHead>
                <TableHead>Prepared</TableHead>
                <TableHead>Delivered</TableHead>
                <TableHead className="w-10">✉️</TableHead>
                {isStaff && <TableHead className="w-10"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(row => {
                const status = getStatusBadge(row);
                const slaWarn = isSlaWarning(row);
                return (
                  <TableRow key={row.id} className={slaWarn ? 'border-l-4 border-l-destructive' : ''}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(row.id)}
                        onCheckedChange={() => toggleOne(row.id)}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-sm font-medium">{row.mawb}</TableCell>
                    <TableCell>{row.warehouse ?? '—'}</TableCell>
                    <TableCell className="font-mono text-sm">{row.barcode}</TableCell>
                    <TableCell>{row.subklant ?? '—'}</TableCell>

                    {/* Location - editable */}
                    <TableCell>
                      {editingLocation?.id === row.id ? (
                        <Input
                          autoFocus
                          className="h-7 w-24 text-xs"
                          value={editingLocation.value}
                          onChange={e => setEditingLocation({ ...editingLocation, value: e.target.value })}
                          onBlur={() => handleSaveLocation(row.id, editingLocation.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveLocation(row.id, editingLocation.value); if (e.key === 'Escape') setEditingLocation(null); }}
                        />
                      ) : (
                        <button
                          className="text-sm hover:underline text-left min-w-[60px]"
                          onClick={() => setEditingLocation({ id: row.id, value: row.location ?? '' })}
                        >
                          {row.location || '—'}
                        </button>
                      )}
                    </TableCell>

                    {/* Scan Time */}
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {slaWarn && <Clock className="h-3.5 w-3.5 text-destructive inline mr-1" />}
                      {row.scan_time ? format(new Date(row.scan_time), 'dd/MM/yy HH:mm') : '—'}
                    </TableCell>

                    {/* SLA Deadline */}
                    <TableCell className="text-sm whitespace-nowrap">
                      {slaWarn && <span className="mr-1">⏰</span>}
                      {row.sla_deadline ? (
                        <span className={slaWarn ? 'text-destructive font-medium' : 'text-muted-foreground'}>
                          {format(new Date(row.sla_deadline), 'dd/MM/yy HH:mm')}
                        </span>
                      ) : '—'}
                    </TableCell>

                    {/* Status badge */}
                    <TableCell>
                      <Badge variant={status.variant} className="text-xs whitespace-nowrap">
                        {status.emoji} {status.label}
                      </Badge>
                    </TableCell>

                    {/* Checked */}
                    <TableCell>
                      <Checkbox
                        checked={!!row.checked_at}
                        onCheckedChange={() => handleToggleChecked(row.id, row.checked_at)}
                      />
                    </TableCell>

                    {/* Documents Requested - staff only toggle */}
                    <TableCell>
                      {isStaff ? (
                        <Checkbox
                          checked={row.documents_requested}
                          onCheckedChange={() => handleToggleField(row.id, 'documents_requested', row.documents_requested)}
                        />
                      ) : (
                        <Badge variant={row.documents_requested ? 'default' : 'secondary'} className="text-xs">
                          {row.documents_requested ? 'Yes' : 'No'}
                        </Badge>
                      )}
                    </TableCell>

                    {/* Additional Action Required - staff only toggle */}
                    <TableCell>
                      {isStaff ? (
                        <Checkbox
                          checked={row.additional_action_required}
                          onCheckedChange={() => handleToggleField(row.id, 'additional_action_required', row.additional_action_required)}
                        />
                      ) : (
                        <Badge variant={row.additional_action_required ? 'default' : 'secondary'} className="text-xs">
                          {row.additional_action_required ? 'Yes' : 'No'}
                        </Badge>
                      )}
                    </TableCell>

                    {/* Customs Remarks - staff only */}
                    {isStaff && (
                      <TableCell>
                        {editingRemarks?.id === row.id ? (
                          <Input
                            autoFocus
                            className="h-7 w-32 text-xs"
                            value={editingRemarks.value}
                            onChange={e => setEditingRemarks({ ...editingRemarks, value: e.target.value })}
                            onBlur={() => handleSaveRemarks(row.id, editingRemarks.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleSaveRemarks(row.id, editingRemarks.value); if (e.key === 'Escape') setEditingRemarks(null); }}
                          />
                        ) : (
                          <button
                            className="text-sm hover:underline text-left min-w-[60px] max-w-[120px] truncate"
                            onClick={() => setEditingRemarks({ id: row.id, value: row.customs_remarks ?? '' })}
                            title={row.customs_remarks ?? ''}
                          >
                            {row.customs_remarks || '—'}
                          </button>
                        )}
                      </TableCell>
                    )}

                    {/* Released */}
                    <TableCell>
                      {isStaff ? (
                        <Checkbox
                          checked={!!row.released_at}
                          onCheckedChange={() => handleToggleReleased(row.id, row.released_at)}
                        />
                      ) : (
                        <Badge variant={row.released_at ? 'default' : 'secondary'} className="text-xs">
                          {row.released_at ? 'Yes' : 'No'}
                        </Badge>
                      )}
                    </TableCell>

                    {/* Prepared */}
                    <TableCell>
                      <Badge variant={row.outbound_status === 'prepared' || row.outbound_status === 'departed' ? 'default' : 'secondary'} className="text-xs">
                        {row.outbound_status === 'prepared' || row.outbound_status === 'departed' ? 'Yes' : 'No'}
                      </Badge>
                    </TableCell>

                    {/* Delivered */}
                    <TableCell>
                      <Badge variant={row.outbound_status === 'departed' ? 'default' : 'secondary'} className="text-xs">
                        {row.outbound_status === 'departed' ? 'Yes' : 'No'}
                      </Badge>
                    </TableCell>

                    {/* Email Sent indicator */}
                    <TableCell>
                      {row.email_sent_at ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Sent {format(new Date(row.email_sent_at), 'dd/MM/yy HH:mm')}</p>
                              {row.email_sent_by && <p className="text-xs">{row.email_sent_by}</p>}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : '—'}
                    </TableCell>

                    {/* Send to Customs - staff only */}
                    {isStaff && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Send to Customs"
                          onClick={() => handleSendToCustoms(mawbGrouped.get(row.mawb) ?? [row])}
                        >
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Send to Customs Modal */}
      {sendModalOpen && (
        <SendToCustomsModal
          open={sendModalOpen}
          onOpenChange={setSendModalOpen}
          parcels={sendModalParcels}
          isStaff={isStaff}
          userEmail={userEmail}
          onSent={() => qc.invalidateQueries({ queryKey: ['fyco-management'] })}
        />
      )}
    </div>
  );
}
