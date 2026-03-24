import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useWarehouseAuth } from '@/hooks/use-warehouse-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useHubs } from '@/hooks/use-hubs';
import { useToast } from '@/hooks/use-toast';
import { Plus, ScanBarcode, Truck, AlertTriangle } from 'lucide-react';

export default function WarehouseOutbound() {
  const { data: auth } = useWarehouseAuth();
  const warehouseId = auth?.warehouseId;
  const { data: hubs = [] } = useHubs();
  const { toast } = useToast();
  const qc = useQueryClient();
  const palletRef = useRef<HTMLInputElement>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [hub, setHub] = useState('');
  const [truckRef, setTruckRef] = useState('');
  const [pickupDate, setPickupDate] = useState('');
  const [activeOutbound, setActiveOutbound] = useState<string | null>(null);
  const [palletBarcode, setPalletBarcode] = useState('');

  const { data: outbounds = [] } = useQuery({
    queryKey: ['warehouse-outbounds', warehouseId],
    queryFn: async () => {
      const { data } = await supabase
        .from('outbounds')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      return data ?? [];
    },
    enabled: !!warehouseId,
  });

  const { data: pallets = [] } = useQuery({
    queryKey: ['outbound-pallets', activeOutbound],
    queryFn: async () => {
      if (!activeOutbound) return [];
      const { data } = await supabase
        .from('pallets')
        .select('*, shipments(mawb, customs_cleared, customers(short_name))')
        .eq('outbound_id', activeOutbound);
      return data ?? [];
    },
    enabled: !!activeOutbound,
  });

  const createOutbound = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from('outbounds').insert({
        hub_code: hub,
        truck_reference: truckRef,
        pickup_date: pickupDate,
        status: 'preparing',
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setShowCreate(false);
      setActiveOutbound(data.id);
      setHub(''); setTruckRef(''); setPickupDate('');
      qc.invalidateQueries({ queryKey: ['warehouse-outbounds'] });
      toast({ title: 'Outbound created' });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const addPallet = useMutation({
    mutationFn: async (code: string) => {
      // Find pallet
      const { data: pallet, error: findErr } = await supabase
        .from('pallets')
        .select('id, shipment_id, shipments(customs_cleared)')
        .eq('pallet_number', code)
        .maybeSingle();
      if (findErr || !pallet) throw new Error('Pallet not found');

      // Check for active outbound block
      const { data: blocks } = await supabase
        .from('shipment_blocks')
        .select('reason')
        .eq('shipment_id', pallet.shipment_id)
        .eq('block_type', 'outbound')
        .is('removed_at', null);
      if (blocks && blocks.length > 0) {
        throw new Error(`Outbound blocked: ${blocks[0].reason || 'No reason provided'}`);
      }

      // Validate customs cleared
      if (!(pallet.shipments as any)?.customs_cleared) {
        throw new Error('Shipment not customs cleared — cannot add to outbound');
      }

      // Check open inspections
      const { count } = await supabase
        .from('inspections')
        .select('*', { count: 'exact', head: true })
        .eq('shipment_id', pallet.shipment_id)
        .eq('status', 'Under Inspection');
      if (count && count > 0) {
        throw new Error('Shipment has open inspections — cannot add to outbound');
      }

      const { error } = await supabase
        .from('pallets')
        .update({ outbound_id: activeOutbound })
        .eq('id', pallet.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outbound-pallets', activeOutbound] });
      toast({ title: 'Pallet added to outbound' });
      setPalletBarcode('');
      palletRef.current?.focus();
    },
    onError: (err: any) => toast({ title: 'Cannot add pallet', description: err.message, variant: 'destructive' }),
  });

  const confirmOutbound = useMutation({
    mutationFn: async () => {
      if (!activeOutbound) return;
      const { error } = await supabase
        .from('outbounds')
        .update({ status: 'picked_up' })
        .eq('id', activeOutbound);
      if (error) throw error;

      // Mark all boxes in pallets as scanned_out
      const palletIds = pallets.map((p: any) => p.id);
      if (palletIds.length > 0) {
        const shipmentIds = [...new Set(pallets.map((p: any) => p.shipment_id))];
        for (const sid of shipmentIds) {
          await supabase
            .from('outerboxes')
            .update({ status: 'scanned_out' })
            .eq('shipment_id', sid)
            .eq('status', 'scanned_in');
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouse-outbounds'] });
      toast({ title: 'Outbound confirmed as picked up' });
      setActiveOutbound(null);
    },
  });

  const handlePalletScan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!palletBarcode.trim() || !activeOutbound) return;
    addPallet.mutate(palletBarcode.trim());
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Outbound</h1>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />New Outbound
        </Button>
      </div>

      {activeOutbound && (
        <Card className="border-accent">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Truck className="h-5 w-5 text-accent" />
              Active Outbound
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handlePalletScan} className="flex gap-2 max-w-md">
              <Input
                ref={palletRef}
                value={palletBarcode}
                onChange={e => setPalletBarcode(e.target.value)}
                placeholder="Scan pallet number..."
                className="font-mono"
                autoFocus
              />
              <Button type="submit" disabled={addPallet.isPending}>
                <ScanBarcode className="h-4 w-4" />
              </Button>
            </form>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pallet</TableHead>
                  <TableHead>Subklant</TableHead>
                  <TableHead>Hub</TableHead>
                  <TableHead className="text-right">Colli</TableHead>
                  <TableHead className="text-right">Weight</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pallets.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Scan pallets to add</TableCell></TableRow>
                ) : pallets.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono font-medium">{p.pallet_number}</TableCell>
                    <TableCell>{(p.shipments as any)?.customers?.short_name ?? '—'}</TableCell>
                    <TableCell>{p.hub_code}</TableCell>
                    <TableCell className="text-right">{p.colli_count}</TableCell>
                    <TableCell className="text-right">{p.weight_kg} kg</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex justify-end">
              <Button onClick={() => confirmOutbound.mutate()} disabled={pallets.length === 0 || confirmOutbound.isPending}>
                Confirm Outbound — Mark as Picked Up
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-lg">Recent Outbounds</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hub</TableHead>
                <TableHead>Truck Ref</TableHead>
                <TableHead>Pickup Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outbounds.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No outbounds yet</TableCell></TableRow>
              ) : outbounds.map((o: any) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.hub_code}</TableCell>
                  <TableCell>{o.truck_reference ?? '—'}</TableCell>
                  <TableCell>{o.pickup_date ?? '—'}</TableCell>
                  <TableCell className="capitalize">{o.status?.replace('_', ' ')}</TableCell>
                  <TableCell>
                    {o.status === 'preparing' && (
                      <Button size="sm" variant="ghost" onClick={() => setActiveOutbound(o.id)}>
                        Continue
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Outbound</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Hub</Label>
              <Select value={hub} onValueChange={setHub}>
                <SelectTrigger><SelectValue placeholder="Select hub" /></SelectTrigger>
                <SelectContent>
                  {hubs.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Truck Reference</Label>
              <Input value={truckRef} onChange={e => setTruckRef(e.target.value)} placeholder="e.g. TR-2026-001" />
            </div>
            <div className="space-y-2">
              <Label>License Plate</Label>
              <Input value={licensePlate} onChange={e => setLicensePlate(e.target.value)} placeholder="e.g. AB-123-CD" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Pickup Date</Label>
                <Input type="date" value={pickupDate} onChange={e => setPickupDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Pickup Time</Label>
                <Input type="time" value={pickupTime} onChange={e => setPickupTime(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createOutbound.mutate()} disabled={!hub || !pickupDate || createOutbound.isPending}>
              Create Outbound
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
