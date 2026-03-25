import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2, Eye, Pencil, CheckCircle, Ban, Trash2, X as XIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/StatusBadge';
import { useAllShipments, useUpdateShipment, useDeleteShipment, useShipmentBlocks, useCreateBlock, useRemoveBlock, useShipmentInspections, useCreateInspections } from '@/hooks/use-staff-data';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/lib/auth-context';
import { EditShipmentModal } from '@/components/staff/EditShipmentModal';
import { FycoDetailModal } from '@/components/staff/FycoDetailModal';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { CalendarIcon } from 'lucide-react';
import { toast } from 'sonner';

const ALL_STATUSES = ['Awaiting NOA', 'Partial NOA', 'NOA Complete', 'In Transit', 'In Stock', 'Outbound', 'Needs Action'];

/* ─── Block Modal ─── */
function BlockModal({ shipment, open, onOpenChange }: { shipment: any; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user } = useAuth();
  const createBlock = useCreateBlock();
  const [inbound, setInbound] = useState(false);
  const [outbound, setOutbound] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!inbound && !outbound) return;
    setSaving(true);
    try {
      const promises: Promise<void>[] = [];
      if (inbound) promises.push(createBlock.mutateAsync({ shipment_id: shipment.id, block_type: 'inbound', reason, created_by: user?.id }));
      if (outbound) promises.push(createBlock.mutateAsync({ shipment_id: shipment.id, block_type: 'outbound', reason, created_by: user?.id }));
      await Promise.all(promises);
      toast.success('Block(s) applied');
      onOpenChange(false);
      setInbound(false); setOutbound(false); setReason('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create block');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Block Shipment — {shipment?.mawb}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox id="block-inbound" checked={inbound} onCheckedChange={(v) => setInbound(!!v)} />
              <Label htmlFor="block-inbound">Inbound Block</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="block-outbound" checked={outbound} onCheckedChange={(v) => setOutbound(!!v)} />
              <Label htmlFor="block-outbound">Outbound Block</Label>
            </div>
          </div>
          {(inbound || outbound) && (
            <div className="space-y-2">
              <Label>Reason</Label>
              <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for blocking..." rows={3} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={(!inbound && !outbound) || saving} variant="destructive">
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Apply Block
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── CC Yes Modal ─── */
function CcYesModal({ shipment, open, onOpenChange }: { shipment: any; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user } = useAuth();
  const updateShipment = useUpdateShipment();
  const createInspections = useCreateInspections();
  const [hasInspections, setHasInspections] = useState<boolean | null>(null);
  const [barcodes, setBarcodes] = useState('');
  const [saving, setSaving] = useState(false);

  const lineCount = barcodes.split('\n').filter(l => l.trim()).length;

  const handleSave = async () => {
    setSaving(true);
    const now = new Date().toISOString();
    const clearedBy = user?.email ?? 'unknown';
    try {
      if (hasInspections) {
        const lines = barcodes.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) {
          toast.error('Enter at least one barcode');
          setSaving(false);
          return;
        }
        await createInspections.mutateAsync(
          lines.map(barcode => ({ shipment_id: shipment.id, barcode }))
        );
        await updateShipment.mutateAsync({
          id: shipment.id,
          customs_cleared: true,
          clearance_status: 'cleared_with_inspections',
          customs_cleared_at: now,
          customs_cleared_by: clearedBy,
        });
        toast.success(`Cleared with ${lines.length} inspection(s)`);
      } else {
        await updateShipment.mutateAsync({
          id: shipment.id,
          customs_cleared: true,
          clearance_status: 'cleared',
          customs_cleared_at: now,
          customs_cleared_by: clearedBy,
        });
        toast.success('Customs cleared — no inspections');
      }
      onOpenChange(false);
      setHasInspections(null);
      setBarcodes('');
    } catch (err: any) {
      toast.error(err.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Customs Clearance — {shipment?.mawb}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4">
          {hasInspections === null ? (
            <div className="space-y-3">
              <p className="text-sm">Any customs inspections (fycos)?</p>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setHasInspections(false)}>No</Button>
                <Button variant="outline" className="flex-1" onClick={() => setHasInspections(true)}>Yes</Button>
              </div>
            </div>
          ) : hasInspections ? (
            <div className="space-y-2">
              <Label>Parcel Barcodes (one per line)</Label>
              <Textarea value={barcodes} onChange={e => setBarcodes(e.target.value)} placeholder="Paste barcodes here, one per line..." rows={6} className="font-mono text-sm" />
              <p className="text-xs text-muted-foreground">{lineCount} parcel(s)</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Shipment will be marked as cleared with no inspections.</p>
          )}
        </div>
        <DialogFooter>
          {hasInspections !== null && <Button variant="ghost" onClick={() => setHasInspections(null)}>Back</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {hasInspections !== null && (
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Confirm
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Unblock Dialog ─── */
function UnblockDialog({ block, open, onOpenChange }: { block: any; open: boolean; onOpenChange: (v: boolean) => void }) {
  const removeBlock = useRemoveBlock();
  const handleUnblock = () => {
    removeBlock.mutate(block.id, {
      onSuccess: () => { toast.success('Block removed'); onOpenChange(false); },
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {block?.block_type} block?</AlertDialogTitle>
          <AlertDialogDescription>
            {block?.reason && <span>Reason: "{block.reason}". </span>}
            This will remove the block and allow {block?.block_type} operations to resume.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleUnblock}>Remove Block</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ─── Main Page ─── */
export default function MawbOverview() {
  const { data: shipments = [], isLoading } = useAllShipments();
  const { data: blocks = [] } = useShipmentBlocks();
  const { data: inspections = [] } = useShipmentInspections();

  const [search, setSearch] = useState('');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();

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

  const blocksByShipment = useMemo(() => {
    const map = new Map<string, any[]>();
    blocks.forEach((b: any) => {
      if (!map.has(b.shipment_id)) map.set(b.shipment_id, []);
      map.get(b.shipment_id)!.push(b);
    });
    return map;
  }, [blocks]);

  const inspectionsByShipment = useMemo(() => {
    const map = new Map<string, number>();
    inspections.forEach((i: any) => {
      map.set(i.shipment_id, (map.get(i.shipment_id) ?? 0) + 1);
    });
    return map;
  }, [inspections]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">MAWB Overview</h1>
        <p className="text-muted-foreground text-sm mt-1">All shipments across all customers</p>
      </div>

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

      <div className="bg-card rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>MAWB</TableHead>
              <TableHead>Warehouse</TableHead>
              <TableHead className="text-right">Colli</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>ETA</TableHead>
              <TableHead>NOA Date</TableHead>
              <TableHead>CC</TableHead>
              <TableHead>Unloaded</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No shipments found</TableCell>
              </TableRow>
            ) : (
              filtered.map((s: any) => (
                <ShipmentRow
                  key={s.id}
                  shipment={s}
                  blocks={blocksByShipment.get(s.id) ?? []}
                  inspectionCount={inspectionsByShipment.get(s.id) ?? 0}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ShipmentRow({ shipment, blocks, inspectionCount }: { shipment: any; blocks: any[]; inspectionCount: number }) {
  const navigate = useNavigate();
  const updateShipment = useUpdateShipment();
  const deleteShipment = useDeleteShipment();
  const [etaOpen, setEtaOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [ccOpen, setCcOpen] = useState(false);
  const [unblockTarget, setUnblockTarget] = useState<any>(null);
  const [fycoOpen, setFycoOpen] = useState(false);

  const etaDate = shipment.eta ? new Date(shipment.eta) : undefined;
  const inboundBlock = blocks.find((b: any) => b.block_type === 'inbound');
  const outboundBlock = blocks.find((b: any) => b.block_type === 'outbound');
  const hasNotes = !!shipment.notes;

  const handleEtaChange = (date: Date | undefined) => {
    updateShipment.mutate({ id: shipment.id, eta: date ? format(date, 'yyyy-MM-dd') : null });
    setEtaOpen(false);
  };

  const handleClearEta = () => {
    updateShipment.mutate({ id: shipment.id, eta: null });
    setEtaOpen(false);
  };

  const handleDelete = () => {
    deleteShipment.mutate(shipment.id, {
      onSuccess: () => toast.success(`Shipment ${shipment.mawb} deleted`),
      onError: (err) => toast.error(`Delete failed: ${err.message}`),
    });
    setDeleteOpen(false);
  };

  return (
    <>
      <TableRow>
        <TableCell className="font-medium">{shipment.customers?.name || '—'}</TableCell>
        <TableCell className="font-mono text-sm">{shipment.mawb}</TableCell>
        <TableCell>{shipment.warehouse_id || '—'}</TableCell>
        <TableCell className="text-right">{shipment.colli_expected ?? 0}</TableCell>
        <TableCell>
          <div className="flex items-center gap-1 flex-wrap">
            <StatusBadge status={shipment.status} />
            {inboundBlock && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 cursor-pointer" onClick={() => setUnblockTarget(inboundBlock)}>
                Inbound Block
              </Badge>
            )}
            {outboundBlock && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 cursor-pointer" onClick={() => setUnblockTarget(outboundBlock)}>
                Outbound Block
              </Badge>
            )}
            {inspectionCount > 0 && (
              <Badge className="text-[10px] px-1.5 py-0 bg-red-600 hover:bg-red-700 cursor-pointer" onClick={() => setFycoOpen(true)}>
                Fyco {inspectionCount}
              </Badge>
            )}
            {hasNotes && (
              <Badge className="text-[10px] px-1.5 py-0 bg-purple-600 hover:bg-purple-700">Note</Badge>
            )}
          </div>
        </TableCell>
        <TableCell>
          <Popover open={etaOpen} onOpenChange={setEtaOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className={cn("h-8 px-2 text-xs font-normal", !etaDate && "text-muted-foreground")}>
                <CalendarIcon className="mr-1 h-3 w-3" />
                {etaDate ? format(etaDate, 'dd/MM/yy') : 'Set ETA'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={etaDate} onSelect={handleEtaChange} className="p-3 pointer-events-auto" />
              {etaDate && (
                <div className="px-3 pb-3">
                  <Button variant="ghost" size="sm" className="w-full text-destructive" onClick={handleClearEta}>
                    <XIcon className="h-3 w-3 mr-1" /> Clear ETA
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {shipment.noa_date ? format(new Date(shipment.noa_date), 'dd/MM/yy') : '—'}
        </TableCell>
        <TableCell>
          <Switch checked={!!shipment.customs_cleared} onCheckedChange={() => {}} className="scale-90" disabled />
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {shipment.unloaded_date ? format(new Date(shipment.unloaded_date), 'dd/MM/yy') : '—'}
        </TableCell>
        <TableCell>
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" title="View Detail" onClick={() => navigate(`/staff/shipments/${shipment.id}`)}>
              <Eye className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => setEditOpen(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-accent hover:text-accent/80" title="CC YES" onClick={() => setCcOpen(true)}>
              <CheckCircle className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title="Block" onClick={() => setBlockOpen(true)}>
              <Ban className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title="Delete" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </TableCell>
      </TableRow>

      {editOpen && <EditShipmentModal shipment={shipment} open={editOpen} onOpenChange={v => { if (!v) setEditOpen(false); }} />}
      {blockOpen && <BlockModal shipment={shipment} open={blockOpen} onOpenChange={v => { if (!v) setBlockOpen(false); }} />}
      {ccOpen && <CcYesModal shipment={shipment} open={ccOpen} onOpenChange={v => { if (!v) setCcOpen(false); }} />}
      {unblockTarget && <UnblockDialog block={unblockTarget} open={!!unblockTarget} onOpenChange={v => { if (!v) setUnblockTarget(null); }} />}
      {fycoOpen && <FycoDetailModal shipment={shipment} open={fycoOpen} onOpenChange={v => { if (!v) setFycoOpen(false); }} />}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete shipment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete shipment <span className="font-mono font-semibold">{shipment.mawb}</span> and all related records.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
