import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search, Loader2, Eye, Pencil, Upload, PackageCheck, CalendarIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/StatusBadge';
import { Progress } from '@/components/ui/progress';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useAllShipments, useUpdateShipment } from '@/hooks/use-staff-data';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const ALL_STATUSES = ['Awaiting NOA', 'Partial NOA', 'NOA Complete', 'In Transit', 'In Stock', 'Outbound', 'Needs Action'];

export default function InboundShipment() {
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

  const handleMarkUnloaded = (shipment: any) => {
    updateShipment.mutate(
      { id: shipment.id, unloaded_at: new Date().toISOString(), status: 'In Stock' },
      { onSuccess: () => toast.success(`${shipment.mawb} marked as unloaded`) }
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

                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-sm">{s.mawb}</TableCell>
                    <TableCell className="font-medium">{s.customers?.name || '—'}</TableCell>
                    <TableCell>{s.warehouse_id || '—'}</TableCell>
                    <TableCell className="text-right">{colliExpected}</TableCell>
                    <TableCell className="text-right">
                      <span className={cn(colliReceived >= colliExpected && colliExpected > 0 ? 'text-green-500' : colliReceived > 0 ? 'text-amber-500' : 'text-muted-foreground')}>
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
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Upload NOA">
                          <Upload className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Mark as Unloaded"
                          onClick={() => handleMarkUnloaded(s)}
                          disabled={!!s.unloaded_at}
                        >
                          <PackageCheck className={cn("h-3.5 w-3.5", s.unloaded_at && "text-green-500")} />
                        </Button>
                        <Link to={`/shipments/${s.id}`}>
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="View Detail">
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit">
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
    </div>
  );
}
