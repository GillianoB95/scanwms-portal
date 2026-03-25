import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useLocation } from 'react-router-dom';
import { Loader2, ShieldCheck, Clock, Search } from 'lucide-react';
import { format, differenceInHours } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

interface FycoRow {
  id: string;
  barcode: string;
  created_at: string;
  shipment_id: string;
  mawb: string;
  hub_code: string | null;
  warehouse: string | null;
  subklant: string | null;
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

function isSlaWarning(row: FycoRow): boolean {
  if (!row.scan_time || row.checked_at) return false;
  return differenceInHours(new Date(), new Date(row.scan_time)) >= 24;
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
          shipments (
            mawb,
            warehouse_id,
            subklanten ( name ),
            customers ( name )
          )
        `)
        .order('scan_time', { ascending: false, nullsFirst: false });

      if (error) {
        console.error('Fyco inspections query error:', error);
        throw error;
      }
      if (!inspections || inspections.length === 0) return [];

      const warehouseIds = [...new Set(
        inspections
          .map(insp => (insp as any).shipments?.warehouse_id)
          .filter(Boolean)
      )] as string[];

      let warehouseMap = new Map<string, string>();
      if (warehouseIds.length > 0) {
        const { data: warehouses, error: warehouseError } = await supabase
          .from('warehouses')
          .select('id, name')
          .in('id', warehouseIds);

        if (warehouseError) {
          console.error('Fyco warehouses query error:', warehouseError);
          throw warehouseError;
        }

        warehouseMap = new Map((warehouses ?? []).map(warehouse => [warehouse.id, warehouse.name]));
      }

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
          warehouse: ship?.warehouse_id ? warehouseMap.get(ship.warehouse_id) ?? ship.warehouse_id : null,
          subklant: ship?.subklanten?.name ?? null,
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
          outbound_status: outboundStatusMap.get(bc) ?? null,
        } as FycoRow;
      });
    },
  });
}

export default function FycoManagement() {
  const { data: rows = [], isLoading } = useFycoData();
  const { user } = useAuth();
  const location = useLocation();
  const qc = useQueryClient();
  const isStaff = location.pathname.startsWith('/staff');
  const userEmail = user?.email ?? 'unknown';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingLocation, setEditingLocation] = useState<{ id: string; value: string } | null>(null);
  const [editingRemarks, setEditingRemarks] = useState<{ id: string; value: string } | null>(null);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (statusFilter !== 'all' && getStatusFilter(r) !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!r.mawb.toLowerCase().includes(q) && !r.barcode.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter]);

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
    const updates: Record<string, any> = { [field]: !currentValue };
    if (!currentValue) {
      updates[`${field}_at`] = new Date().toISOString();
      updates[`${field}_by`] = userEmail;
    } else {
      updates[`${field}_at`] = null;
      updates[`${field}_by`] = null;
    }
    // Fix field naming for the _at/_by columns
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
      await updateMutation.mutateAsync({ ids: [id], updates });
    } catch { toast.error('Failed to update'); }
  };

  const handleSaveLocation = async (id: string, value: string) => {
    try {
      await updateMutation.mutateAsync({ ids: [id], updates: { location: value || null } });
      setEditingLocation(null);
    } catch { toast.error('Failed to update location'); }
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
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="released">Released</SelectItem>
            <SelectItem value="delivered">Prepared / Delivered</SelectItem>
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
                <TableHead>MAWB</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Parcel</TableHead>
                <TableHead>Sub Client</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Scan Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Checked</TableHead>
                <TableHead>Docs Req.</TableHead>
                <TableHead>Action Req.</TableHead>
                {isStaff && <TableHead>Remarks</TableHead>}
                <TableHead>Released</TableHead>
                <TableHead>Prepared</TableHead>
                <TableHead>Delivered</TableHead>
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
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
