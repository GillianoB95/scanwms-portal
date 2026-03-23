import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search, Filter, Loader2, Eye, Pencil, CheckCircle, Ban, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/StatusBadge';
import { useAllShipments, useUpdateShipment, useDeleteShipment } from '@/hooks/use-staff-data';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { CalendarIcon } from 'lucide-react';
import { toast } from 'sonner';

const ALL_STATUSES = ['Awaiting NOA', 'Partial NOA', 'NOA Complete', 'In Transit', 'In Stock', 'Outbound', 'Needs Action'];

export default function MawbOverview() {
  const { data: shipments = [], isLoading } = useAllShipments();
  const updateShipment = useUpdateShipment();

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

  const handleToggleCleared = (shipment: any) => {
    updateShipment.mutate({
      id: shipment.id,
      customs_cleared: !shipment.customs_cleared,
    });
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
        <h1 className="text-2xl font-bold">MAWB Overview</h1>
        <p className="text-muted-foreground text-sm mt-1">All shipments across all customers</p>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-xl border p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search MAWB..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={customerFilter} onValueChange={setCustomerFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Customer" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Customers</SelectItem>
              {customers.map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Warehouse" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Warehouses</SelectItem>
              {warehouses.map(w => (
                <SelectItem key={w} value={w}>{w}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {ALL_STATUSES.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setSearch(''); setCustomerFilter('all'); setWarehouseFilter('all'); setStatusFilter('all'); setDateFrom(undefined); setDateTo(undefined); }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* Results count */}
      <p className="text-sm text-muted-foreground">{filtered.length} shipment{filtered.length !== 1 ? 's' : ''}</p>

      {/* Table */}
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
                <ShipmentRow key={s.id} shipment={s} onToggleCleared={handleToggleCleared} />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ShipmentRow({ shipment, onToggleCleared }: { shipment: any; onToggleCleared: (s: any) => void }) {
  const updateShipment = useUpdateShipment();
  const deleteShipment = useDeleteShipment();
  const [etaOpen, setEtaOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const etaDate = shipment.eta ? new Date(shipment.eta) : undefined;

  const handleEtaChange = (date: Date | undefined) => {
    if (date) {
      updateShipment.mutate({ id: shipment.id, eta: format(date, 'yyyy-MM-dd') });
    }
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
        <TableCell><StatusBadge status={shipment.status} /></TableCell>
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
            </PopoverContent>
          </Popover>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {shipment.noa_date ? format(new Date(shipment.noa_date), 'dd/MM/yy') : '—'}
        </TableCell>
        <TableCell>
          <Switch
            checked={!!shipment.customs_cleared}
            onCheckedChange={() => onToggleCleared(shipment)}
            className="scale-90"
          />
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {shipment.unloaded_date ? format(new Date(shipment.unloaded_date), 'dd/MM/yy') : '—'}
        </TableCell>
        <TableCell>
          <div className="flex items-center justify-end gap-1">
            <Link to={`/shipments/${shipment.id}`}>
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Detail">
                <Eye className="h-3.5 w-3.5" />
              </Button>
            </Link>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-accent hover:text-accent/80"
              title="CC YES"
              onClick={() => onToggleCleared(shipment)}
            >
              <CheckCircle className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title="Block">
              <Ban className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title="Delete" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </TableCell>
      </TableRow>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete shipment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete shipment <span className="font-mono font-semibold">{shipment.mawb}</span> and all related records (NOAs, pallets, outerboxes). This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
