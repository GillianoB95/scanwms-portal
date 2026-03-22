import { useState, useMemo } from 'react';
import { Search, Loader2, Plus, Eye, Truck, CalendarIcon, ChevronDown, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface OutboundRecord {
  id: string;
  hub_id: string;
  hub_name?: string;
  hub_code?: string;
  truck_reference: string;
  pickup_date: string;
  status: string;
  pallets_count: number;
  total_pieces: number;
  created_at: string;
}

function useAllOutbounds() {
  return useQuery({
    queryKey: ['staff-all-outbounds'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('outbounds')
        .select('*, hubs(name, code)')
        .order('pickup_date', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((o: any) => ({
        ...o,
        hub_name: o.hubs?.name ?? '—',
        hub_code: o.hubs?.code ?? '—',
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-all-outbounds'] });
      toast.success('Outbound marked as picked up');
    },
  });
}

export default function OutboundShipment() {
  const { data: outbounds = [], isLoading } = useAllOutbounds();
  const markPickedUp = useMarkPickedUp();

  const [search, setSearch] = useState('');
  const [hubFilter, setHubFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [expandedHubs, setExpandedHubs] = useState<Set<string>>(new Set());

  const hubs = useMemo(() => {
    const set = new Set(outbounds.map((o: any) => o.hub_name).filter(Boolean));
    return Array.from(set).sort() as string[];
  }, [outbounds]);

  const filtered = useMemo(() => {
    return outbounds.filter((o: any) => {
      if (search && !o.truck_reference?.toLowerCase().includes(search.toLowerCase())) return false;
      if (hubFilter !== 'all' && o.hub_name !== hubFilter) return false;
      if (dateFrom && new Date(o.pickup_date) < dateFrom) return false;
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        if (new Date(o.pickup_date) > to) return false;
      }
      return true;
    });
  }, [outbounds, search, hubFilter, dateFrom, dateTo]);

  const grouped = useMemo(() => {
    const map = new Map<string, any[]>();
    filtered.forEach((o: any) => {
      const hub = o.hub_name || 'Unknown Hub';
      if (!map.has(hub)) map.set(hub, []);
      map.get(hub)!.push(o);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const toggleHub = (hub: string) => {
    setExpandedHubs(prev => {
      const next = new Set(prev);
      next.has(hub) ? next.delete(hub) : next.add(hub);
      return next;
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Outbound Shipments</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage outbound pickups grouped by hub</p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Outbound
        </Button>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-xl border p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search truck reference..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
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

      <p className="text-sm text-muted-foreground">{filtered.length} outbound{filtered.length !== 1 ? 's' : ''} across {grouped.length} hub{grouped.length !== 1 ? 's' : ''}</p>

      {/* Grouped by Hub */}
      {grouped.length === 0 ? (
        <div className="bg-card rounded-xl border p-8 text-center text-muted-foreground">No outbound shipments found</div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([hubName, items]) => {
            const expanded = expandedHubs.has(hubName);
            const totalPallets = items.reduce((s: number, o: any) => s + (o.pallets_count ?? 0), 0);
            const totalPieces = items.reduce((s: number, o: any) => s + (o.total_pieces ?? 0), 0);

            return (
              <div key={hubName} className="bg-card rounded-xl border overflow-hidden">
                <button
                  onClick={() => toggleHub(hubName)}
                  className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <span className="font-semibold">{hubName}</span>
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
                        <TableHead>Truck Reference</TableHead>
                        <TableHead>Pickup Date</TableHead>
                        <TableHead className="text-right">Pallets</TableHead>
                        <TableHead className="text-right">Pieces</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((o: any) => (
                        <TableRow key={o.id}>
                          <TableCell className="font-mono text-sm">{o.truck_reference || '—'}</TableCell>
                          <TableCell>{o.pickup_date ? format(new Date(o.pickup_date), 'dd/MM/yy') : '—'}</TableCell>
                          <TableCell className="text-right">{o.pallets_count ?? 0}</TableCell>
                          <TableCell className="text-right">{o.total_pieces ?? 0}</TableCell>
                          <TableCell><StatusBadge status={o.status || 'Pending'} /></TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="View Pallets">
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title="Mark as Picked Up"
                                onClick={() => markPickedUp.mutate(o.id)}
                                disabled={o.status === 'Picked Up'}
                              >
                                <Truck className={cn("h-3.5 w-3.5", o.status === 'Picked Up' && "text-green-500")} />
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
    </div>
  );
}
