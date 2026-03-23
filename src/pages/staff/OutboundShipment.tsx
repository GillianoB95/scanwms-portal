import { useState, useMemo } from 'react';
import { Search, Loader2, Plus, Eye, Truck, CalendarIcon, ChevronDown, ChevronRight, Undo2, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAllHubs } from '@/hooks/use-staff-data';
import { useAuth } from '@/lib/auth-context';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

function useAllOutbounds() {
  return useQuery({
    queryKey: ['staff-all-outbounds'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('outbounds')
        .select('*, hubs(name, code, carrier)')
        .order('pickup_date', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((o: any) => ({
        ...o,
        hub_name: o.hubs?.name ?? '—',
        hub_code: o.hubs?.code ?? '—',
        carrier: o.hubs?.carrier ?? '—',
      }));
    },
  });
}

function useMarkPickedUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('outbounds').update({ status: 'Picked Up' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['staff-all-outbounds'] }); toast.success('Outbound marked as picked up'); },
  });
}

function useUndoPickedUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('outbounds').update({ status: 'Pending' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['staff-all-outbounds'] }); toast.success('Pickup status reverted'); },
  });
}

function useDeleteOutbound() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('outbounds').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['staff-all-outbounds'] }); toast.success('Outbound deleted'); },
  });
}

function useCreateOutbound() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (outbound: { hub_id: string; truck_reference: string; pickup_date: string; pickup_time?: string; outbound_number: string; license_plate?: string }) => {
      const { data, error } = await supabase.from('outbounds').insert(outbound).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['staff-all-outbounds'] }); toast.success('Outbound created'); },
  });
}

function useNextOutboundNumber() {
  return useQuery({
    queryKey: ['next-outbound-number'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('outbounds')
        .select('outbound_number')
        .not('outbound_number', 'is', null)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      let maxNum = 0;
      (data ?? []).forEach((o: any) => {
        const match = o.outbound_number?.match(/^(\d+)$/);
        if (match) maxNum = Math.max(maxNum, parseInt(match[1]));
      });
      return maxNum + 1;
    },
  });
}

/* ─── Add Outbound Modal ─── */
function AddOutboundModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: hubs = [] } = useAllHubs();
  const { data: nextNum = 1 } = useNextOutboundNumber();
  const createOutbound = useCreateOutbound();
  const [hubId, setHubId] = useState('');
  const [truckRef, setTruckRef] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [pickupDate, setPickupDate] = useState<Date | undefined>(new Date());
  const [pickupTime, setPickupTime] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!hubId || !pickupDate) return;
    setSaving(true);
    try {
      await createOutbound.mutateAsync({
        hub_id: hubId,
        truck_reference: truckRef,
        license_plate: licensePlate || undefined,
        pickup_date: format(pickupDate, 'yyyy-MM-dd'),
        pickup_time: pickupTime || undefined,
        outbound_number: String(nextNum),
      });
      onOpenChange(false);
      setHubId(''); setTruckRef(''); setLicensePlate(''); setPickupDate(new Date()); setPickupTime('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create outbound');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Outbound</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Hub *</Label>
            <Select value={hubId} onValueChange={setHubId}>
              <SelectTrigger><SelectValue placeholder="Select hub" /></SelectTrigger>
              <SelectContent>
                {hubs.filter((h: any) => h.active).map((h: any) => (
                  <SelectItem key={h.id} value={h.id}>{h.code} — {h.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Truck Reference</Label>
            <Input value={truckRef} onChange={e => setTruckRef(e.target.value)} placeholder="e.g. TRK-2024-001" />
          </div>
          <div className="space-y-2">
            <Label>Truck License Plate</Label>
            <Input value={licensePlate} onChange={e => setLicensePlate(e.target.value)} placeholder="e.g. AB-123-CD" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Pickup Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !pickupDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {pickupDate ? format(pickupDate, 'dd/MM/yyyy') : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={pickupDate} onSelect={setPickupDate} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>Pickup Time</Label>
              <Input type="time" value={pickupTime} onChange={e => setPickupTime(e.target.value)} />
            </div>
          </div>
          <div className="text-sm text-muted-foreground">Outbound #{nextNum}</div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!hubId || !pickupDate || saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Create Outbound
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Main Page ─── */
export default function OutboundShipment() {
  const { data: outbounds = [], isLoading } = useAllOutbounds();
  const markPickedUp = useMarkPickedUp();
  const undoPickedUp = useUndoPickedUp();
  const deleteOutbound = useDeleteOutbound();

  const [search, setSearch] = useState('');
  const [hubFilter, setHubFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  const hubs = useMemo(() => {
    const set = new Set(outbounds.map((o: any) => o.hub_name).filter(Boolean));
    return Array.from(set).sort() as string[];
  }, [outbounds]);

  const filtered = useMemo(() => {
    return outbounds.filter((o: any) => {
      if (search && !o.truck_reference?.toLowerCase().includes(search.toLowerCase()) && !o.outbound_number?.toLowerCase().includes(search.toLowerCase())) return false;
      if (hubFilter !== 'all' && o.hub_name !== hubFilter) return false;
      if (dateFrom && new Date(o.pickup_date) < dateFrom) return false;
      if (dateTo) {
        const to = new Date(dateTo); to.setHours(23, 59, 59, 999);
        if (new Date(o.pickup_date) > to) return false;
      }
      return true;
    });
  }, [outbounds, search, hubFilter, dateFrom, dateTo]);

  const grouped = useMemo(() => {
    const map = new Map<string, any[]>();
    filtered.forEach((o: any) => {
      const dateKey = o.pickup_date ? format(new Date(o.pickup_date), 'yyyy-MM-dd') : 'No Date';
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey)!.push(o);
    });
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [filtered]);

  const toggleDate = (date: string) => {
    setExpandedDates(prev => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Outbound Shipments</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage outbound pickups grouped by date</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Outbound
        </Button>
      </div>

      <div className="bg-card rounded-xl border p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search truck ref or outbound ID..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={hubFilter} onValueChange={setHubFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Hub" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Hubs</SelectItem>
              {hubs.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
            </SelectContent>
          </Select>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-[140px] justify-start text-left font-normal", !dateFrom && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateFrom ? format(dateFrom, "dd/MM/yy") : "From"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-[140px] justify-start text-left font-normal", !dateTo && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateTo ? format(dateTo, "dd/MM/yy") : "To"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateTo} onSelect={setDateTo} className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
          {(search || hubFilter !== 'all' || dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setHubFilter('all'); setDateFrom(undefined); setDateTo(undefined); }}>
              Clear filters
            </Button>
          )}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{filtered.length} outbound{filtered.length !== 1 ? 's' : ''} across {grouped.length} date{grouped.length !== 1 ? 's' : ''}</p>

      {grouped.length === 0 ? (
        <div className="bg-card rounded-xl border p-8 text-center text-muted-foreground">No outbound shipments found</div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([dateKey, items]) => {
            const expanded = expandedDates.has(dateKey);
            const totalPallets = items.reduce((s: number, o: any) => s + (o.pallets_count ?? 0), 0);
            const totalPieces = items.reduce((s: number, o: any) => s + (o.total_pieces ?? 0), 0);
            const displayDate = dateKey !== 'No Date' ? format(new Date(dateKey), 'EEEE dd/MM/yyyy') : 'No Date';

            return (
              <div key={dateKey} className="bg-card rounded-xl border overflow-hidden">
                <button onClick={() => toggleDate(dateKey)} className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <span className="font-semibold">{displayDate}</span>
                    <Badge variant="secondary">{items.length} outbound{items.length !== 1 ? 's' : ''}</Badge>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>{totalPallets} pallets</span>
                    <span>{totalPieces} pieces</span>
                  </div>
                </button>

                {expanded && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Outbound #</TableHead>
                        <TableHead>Carrier / Hub</TableHead>
                        <TableHead>Truck Reference</TableHead>
                        <TableHead>License Plate</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead className="text-right">Pieces</TableHead>
                        <TableHead className="text-right">Weight</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((o: any) => (
                        <TableRow key={o.id}>
                          <TableCell className="font-mono text-sm text-muted-foreground">
                            {o.outbound_number ? `Outbound #${o.outbound_number}` : '—'}
                          </TableCell>
                          <TableCell>
                            <div>
                              <span className="font-medium">{o.carrier}</span>
                              <span className="text-muted-foreground text-xs ml-2">({o.hub_code})</span>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-sm">{o.truck_reference || '—'}</TableCell>
                          <TableCell className="text-sm">{o.license_plate || '—'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{o.pickup_time || '—'}</TableCell>
                          <TableCell className="text-right">{o.total_pieces ?? 0}</TableCell>
                          <TableCell className="text-right">{o.total_weight ? `${o.total_weight} kg` : '—'}</TableCell>
                          <TableCell><StatusBadge status={o.status || 'Pending'} /></TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="View Pallets">
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              {o.status === 'Picked Up' ? (
                                <Button variant="ghost" size="icon" className="h-8 w-8" title="Undo Picked Up" onClick={() => undoPickedUp.mutate(o.id)}>
                                  <Undo2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              ) : (
                                <Button variant="ghost" size="icon" className="h-8 w-8" title="Mark as Picked Up" onClick={() => markPickedUp.mutate(o.id)}>
                                  <Truck className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title="Delete" onClick={() => setDeleteTarget(o)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AddOutboundModal open={addOpen} onOpenChange={setAddOpen} />

      <AlertDialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete outbound?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete outbound {deleteTarget?.outbound_number ? `#${deleteTarget.outbound_number}` : deleteTarget?.id}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { deleteOutbound.mutate(deleteTarget.id); setDeleteTarget(null); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
