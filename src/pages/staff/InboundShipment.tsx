import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search, Loader2, Eye, Pencil, Upload, PackageCheck, CalendarIcon, Undo2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/StatusBadge';
import { Progress } from '@/components/ui/progress';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAllShipments, useUpdateShipment } from '@/hooks/use-staff-data';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const ALL_STATUSES = ['Awaiting NOA', 'Partial NOA', 'NOA Complete', 'In Transit', 'Partially Unloaded', 'In Stock', 'Outbound', 'Needs Action'];

function useCreateNoa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (noa: { shipment_id: string; colli: number; weight: number; source: string; file_path?: string; received_at: string }) => {
      const { data, error } = await supabase.from('noas').insert(noa).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-all-shipments'] });
    },
  });
}

/* ─── NOA Upload Modal ─── */
function NoaUploadModal({ shipment, open, onOpenChange }: { shipment: any; open: boolean; onOpenChange: (v: boolean) => void }) {
  const createNoa = useCreateNoa();
  const updateShipment = useUpdateShipment();
  const [colli, setColli] = useState('');
  const [weight, setWeight] = useState('');
  const [source, setSource] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 16));
  const [uploading, setUploading] = useState(false);

  const handleSave = async () => {
    if (!colli || !weight) return;
    setUploading(true);

    try {
      let filePath: string | undefined;

      if (file) {
        const ext = file.name.split('.').pop();
        const path = `noas/${shipment.id}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from('documents').upload(path, file);
        if (uploadError) throw uploadError;
        filePath = path;
      }

      await createNoa.mutateAsync({
        shipment_id: shipment.id,
        colli: parseInt(colli),
        weight: parseFloat(weight),
        source: source || 'Unknown',
        file_path: filePath,
        received_at: new Date(receivedAt).toISOString(),
      });

      const { data: allNoas } = await supabase
        .from('noas')
        .select('colli')
        .eq('shipment_id', shipment.id);

      const totalReceived = (allNoas ?? []).reduce((sum: number, n: any) => sum + (n.colli ?? 0), 0);
      const expected = shipment.colli_expected ?? shipment.parcels ?? 0;

      let newStatus = shipment.status;
      if (expected > 0 && totalReceived >= expected) {
        newStatus = 'NOA Complete';
      } else if (totalReceived > 0) {
        newStatus = 'Partial NOA';
      }

      await updateShipment.mutateAsync({
        id: shipment.id,
        colli_received: totalReceived,
        status: newStatus,
        noa_date: new Date().toISOString().split('T')[0],
      });

      toast.success(`NOA uploaded — ${totalReceived}/${expected} colli received`);
      onOpenChange(false);
      setColli(''); setWeight(''); setSource(''); setFile(null);
      setReceivedAt(new Date().toISOString().slice(0, 16));
    } catch (err: any) {
      toast.error(err.message || 'Failed to upload NOA');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload NOA — {shipment?.mawb}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="noa-colli">Colli Count *</Label>
              <Input id="noa-colli" type="number" placeholder="0" value={colli} onChange={e => setColli(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="noa-weight">Weight (kg) *</Label>
              <Input id="noa-weight" type="number" step="0.01" placeholder="0.00" value={weight} onChange={e => setWeight(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="noa-received-at">NOA Received At</Label>
            <Input id="noa-received-at" type="datetime-local" value={receivedAt} onChange={e => setReceivedAt(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="noa-source">Source / Airline</Label>
            <Input id="noa-source" placeholder="e.g. KLM, Emirates" value={source} onChange={e => setSource(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="noa-file">PDF Document (optional)</Label>
            <Input id="noa-file" type="file" accept=".pdf" onChange={e => setFile(e.target.files?.[0] || null)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!colli || !weight || uploading}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save NOA
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Unload Modal ─── */
function UnloadModal({ shipment, open, onOpenChange }: { shipment: any; open: boolean; onOpenChange: (v: boolean) => void }) {
  const updateShipment = useUpdateShipment();
  const expected = shipment?.colli_expected ?? shipment?.parcels ?? 0;
  const alreadyUnloaded = shipment?.unloaded_colli ?? 0;
  const remaining = Math.max(0, expected - alreadyUnloaded);

  const [colliCount, setColliCount] = useState(String(remaining));
  const [unloadedAt, setUnloadedAt] = useState(new Date().toISOString().slice(0, 16));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const count = parseInt(colliCount);
    if (!count || count <= 0) return;
    setSaving(true);
    try {
      const totalUnloaded = alreadyUnloaded + count;
      const allDone = expected > 0 && totalUnloaded >= expected;

      await updateShipment.mutateAsync({
        id: shipment.id,
        unloaded_colli: totalUnloaded,
        unloaded_at: new Date(unloadedAt).toISOString(),
        status: allDone ? 'In Stock' : 'Partially Unloaded',
      });

      toast.success(allDone
        ? `${shipment.mawb} fully unloaded (${totalUnloaded}/${expected})`
        : `${shipment.mawb} partially unloaded (${totalUnloaded}/${expected})`
      );
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unload Shipment — {shipment?.mawb}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="text-sm text-muted-foreground">
            Expected: <strong>{expected}</strong> colli · Already unloaded: <strong>{alreadyUnloaded}</strong> · Remaining: <strong>{remaining}</strong>
          </div>
          <div className="space-y-2">
            <Label htmlFor="unload-colli">How many colli are being unloaded?</Label>
            <Input id="unload-colli" type="number" min="1" max={remaining} value={colliCount} onChange={e => setColliCount(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="unload-at">Unloaded At</Label>
            <Input id="unload-at" type="datetime-local" value={unloadedAt} onChange={e => setUnloadedAt(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !colliCount || parseInt(colliCount) <= 0}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Confirm Unload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Edit Shipment Modal ─── */
function EditShipmentModal({ shipment, open, onOpenChange }: { shipment: any; open: boolean; onOpenChange: (v: boolean) => void }) {
  const updateShipment = useUpdateShipment();
  const [eta, setEta] = useState<Date | undefined>(shipment?.eta ? new Date(shipment.eta) : undefined);
  const [notes, setNotes] = useState(shipment?.notes ?? '');
  const [status, setStatus] = useState(shipment?.status ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateShipment.mutateAsync({
        id: shipment.id,
        eta: eta ? format(eta, 'yyyy-MM-dd') : null,
        notes: notes || null,
        status,
      });
      toast.success('Shipment updated');
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Shipment — {shipment?.mawb}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>ETA</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !eta && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {eta ? format(eta, 'dd/MM/yyyy') : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={eta} onSelect={setEta} className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ALL_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Internal notes..." rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Main Page ─── */
export default function InboundShipment() {
  const { data: shipments = [], isLoading } = useAllShipments();
  const updateShipment = useUpdateShipment();

  const [search, setSearch] = useState('');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [noaShipment, setNoaShipment] = useState<any>(null);
  const [unloadShipment, setUnloadShipment] = useState<any>(null);
  const [editShipment, setEditShipment] = useState<any>(null);

  const customers = useMemo(() => {
    const set = new Set(shipments.map((s: any) => s.customers?.name).filter(Boolean));
    return Array.from(set).sort() as string[];
  }, [shipments]);

  const warehouses = useMemo(() => {
    const set = new Set(shipments.map((s: any) => s.warehouse_id).filter(Boolean));
    return Array.from(set).sort() as string[];
  }, [shipments]);

  const filtered = useMemo(() => {
    return shipments.filter((s: any) => {
      if (search && !s.mawb?.toLowerCase().includes(search.toLowerCase())) return false;
      if (customerFilter !== 'all' && s.customers?.name !== customerFilter) return false;
      if (warehouseFilter !== 'all' && s.warehouse_id !== warehouseFilter) return false;
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (dateFrom && new Date(s.created_at) < dateFrom) return false;
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        if (new Date(s.created_at) > to) return false;
      }
      return true;
    });
  }, [shipments, search, customerFilter, warehouseFilter, statusFilter, dateFrom, dateTo]);

  const handleUndoUnload = (shipment: any) => {
    updateShipment.mutate(
      { id: shipment.id, unloaded_at: null, unloaded_colli: 0, status: 'NOA Complete' },
      { onSuccess: () => toast.success(`${shipment.mawb} unload reversed`) }
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Inbound Shipments</h1>
        <p className="text-muted-foreground text-sm mt-1">Track incoming shipments, NOA status, and scanning progress</p>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-xl border p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search MAWB..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={customerFilter} onValueChange={setCustomerFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Customer" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Customers</SelectItem>
              {customers.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Warehouse" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Warehouses</SelectItem>
              {warehouses.map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {ALL_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
          {(search || customerFilter !== 'all' || warehouseFilter !== 'all' || statusFilter !== 'all' || dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setCustomerFilter('all'); setWarehouseFilter('all'); setStatusFilter('all'); setDateFrom(undefined); setDateTo(undefined); }}>
              Clear filters
            </Button>
          )}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{filtered.length} shipment{filtered.length !== 1 ? 's' : ''}</p>

      {/* Table */}
      <div className="bg-card rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>MAWB</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Warehouse</TableHead>
              <TableHead className="text-right">Colli Expected</TableHead>
              <TableHead className="text-right">Colli Received</TableHead>
              <TableHead className="text-right">Weight (kg)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>ETA</TableHead>
              <TableHead>Scanning</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No inbound shipments found</TableCell>
              </TableRow>
            ) : (
              filtered.map((s: any) => {
                const colliExpected = s.colli_expected ?? s.parcels ?? 0;
                const colliReceived = s.colli_received ?? 0;
                const scanned = s.outerboxes_scanned ?? 0;
                const scanTotal = s.outerboxes_total ?? colliExpected;
                const scanPercent = scanTotal > 0 ? Math.round((scanned / scanTotal) * 100) : 0;
                const isUnloaded = !!s.unloaded_at;
                const isPartiallyUnloaded = s.status === 'Partially Unloaded';

                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-sm">{s.mawb}</TableCell>
                    <TableCell className="font-medium">{s.customers?.name || '—'}</TableCell>
                    <TableCell>{s.warehouse_id || '—'}</TableCell>
                    <TableCell className="text-right">{colliExpected}</TableCell>
                    <TableCell className="text-right">
                      <span className={cn(
                        colliReceived >= colliExpected && colliExpected > 0 ? 'text-accent' :
                        colliReceived > 0 ? 'text-primary' : 'text-muted-foreground'
                      )}>
                        {colliReceived}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{s.weight ?? '—'}</TableCell>
                    <TableCell><StatusBadge status={s.status} /></TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.eta ? format(new Date(s.eta), 'dd/MM/yy') : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <Progress value={scanPercent} className="h-2 flex-1" />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{scanned}/{scanTotal}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Upload NOA" onClick={() => setNoaShipment(s)}>
                          <Upload className="h-3.5 w-3.5" />
                        </Button>
                        {isUnloaded || isPartiallyUnloaded ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Undo Unloaded"
                            onClick={() => handleUndoUnload(s)}
                          >
                            <Undo2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Mark as Unloaded"
                            onClick={() => setUnloadShipment(s)}
                          >
                            <PackageCheck className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Link to={`/shipments/${s.id}`}>
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="View Detail">
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => setEditShipment(s)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Modals */}
      {noaShipment && (
        <NoaUploadModal shipment={noaShipment} open={!!noaShipment} onOpenChange={v => { if (!v) setNoaShipment(null); }} />
      )}
      {unloadShipment && (
        <UnloadModal shipment={unloadShipment} open={!!unloadShipment} onOpenChange={v => { if (!v) setUnloadShipment(null); }} />
      )}
      {editShipment && (
        <EditShipmentModal shipment={editShipment} open={!!editShipment} onOpenChange={v => { if (!v) setEditShipment(null); }} />
      )}
    </div>
  );
}
