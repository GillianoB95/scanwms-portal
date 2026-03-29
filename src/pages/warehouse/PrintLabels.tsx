import { useState, useMemo } from 'react';
import Barcode from 'react-barcode';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useHubs } from '@/hooks/use-hubs';
import { useToast } from '@/hooks/use-toast';
import { Printer, Loader2 } from 'lucide-react';
import { printPalletLabel, generatePalletLabelHtml, type PalletLabelData } from '@/lib/printnode';

export default function PrintLabels() {
  const { customer } = useAuth();
  const warehouseId = customer?.warehouse_id;
  const { data: hubs = [] } = useHubs();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedShipment, setSelectedShipment] = useState('');
  const [selectedHub, setSelectedHub] = useState('');
  const [colliCount, setColliCount] = useState('');
  const [weight, setWeight] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<PalletLabelData | null>(null);
  const [pendingPalletNumber, setPendingPalletNumber] = useState('');
  const [printing, setPrinting] = useState(false);

  // Fetch warehouse details (code, printnode config)
  const { data: warehouse } = useQuery({
    queryKey: ['warehouse-detail', warehouseId],
    queryFn: async () => {
      if (!warehouseId) return null;
      const { data } = await supabase
        .from('warehouses')
        .select('id, code, name, printnode_id, printnode_key, printnode_name')
        .eq('id', warehouseId)
        .single();
      return data;
    },
    enabled: !!warehouseId,
  });

  const { data: shipments = [] } = useQuery({
    queryKey: ['label-shipments', warehouseId],
    queryFn: async () => {
      if (!warehouseId) return [];
      const { data } = await supabase
        .from('shipments')
        .select('id, mawb, customers(name, short_name)')
        .eq('warehouse_id', warehouseId)
        .eq('status', 'In Stock');
      return data ?? [];
    },
    enabled: !!warehouseId,
  });

  // Fetch pallets for selected shipment
  const { data: existingPallets = [] } = useQuery({
    queryKey: ['shipment-pallets', selectedShipment],
    queryFn: async () => {
      if (!selectedShipment) return [];
      const { data } = await supabase
        .from('pallets')
        .select('*')
        .eq('shipment_id', selectedShipment)
        .order('created_at', { ascending: false });
      return data ?? [];
    },
    enabled: !!selectedShipment,
  });

  const selectedShipmentData = useMemo(
    () => shipments.find((s: any) => s.id === selectedShipment),
    [shipments, selectedShipment]
  );

  const handleGenerate = async () => {
    if (!selectedShipment || !selectedHub || !colliCount || !weight) {
      toast({ title: 'Fill all fields', variant: 'destructive' });
      return;
    }
    if (!warehouse?.code) {
      toast({ title: 'Warehouse code not configured', variant: 'destructive' });
      return;
    }

    try {
      // Call RPC to get next pallet number
      const { data: rawPalletNumber, error: rpcError } = await supabase.rpc('generate_pallet_number', {
        p_warehouse_code: warehouse.code,
      });
      if (rpcError) throw rpcError;
      if (!rawPalletNumber) throw new Error('No pallet number returned');
      const palletNumber = rawPalletNumber.replace(/^[A-Z]+/, 'PLT');

      const shipment = selectedShipmentData;
      const subklant = (shipment?.customers as any)?.short_name || (shipment?.customers as any)?.name || '—';
      const colli = parseInt(colliCount);
      const weightKg = parseFloat(weight);

      // Insert pallet into DB
      const { error: insertError } = await supabase.from('pallets').insert({
        shipment_id: selectedShipment,
        pallet_number: palletNumber,
        warehouse_code: warehouse.code,
        pieces: colli,
        weight: weightKg,
        status: 'Palletized',
        hub_code: selectedHub,
      });
      if (insertError) throw insertError;

      const labelData: PalletLabelData = {
        palletId: palletNumber,
        subklant,
        mawb: (shipment as any)?.mawb || '',
        colli,
        weight: weightKg,
        hub: selectedHub,
        printedAt: new Date(),
      };

      setPendingPalletNumber(palletNumber);
      setPreviewData(labelData);
      setPreviewOpen(true);

      qc.invalidateQueries({ queryKey: ['shipment-pallets', selectedShipment] });

      toast({ title: 'Pallet created', description: palletNumber });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handlePrint = async () => {
    if (!previewData || !warehouse?.printnode_key || !warehouse?.printnode_id) {
      toast({ title: 'PrintNode not configured for this warehouse', variant: 'destructive' });
      return;
    }
    setPrinting(true);
    try {
      const result = await printPalletLabel(previewData, warehouse.printnode_key, warehouse.printnode_id);
      if (result.success) {
        toast({ title: 'Sent to printer', description: `${pendingPalletNumber} (Job #${result.jobId})` });
        setPreviewOpen(false);
      } else {
        toast({ title: 'Print failed', description: result.error, variant: 'destructive' });
      }
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Print Labels</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-lg">Create Pallet Label</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Shipment</Label>
              <Select value={selectedShipment} onValueChange={setSelectedShipment}>
                <SelectTrigger><SelectValue placeholder="Select shipment" /></SelectTrigger>
                <SelectContent>
                  {shipments.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.mawb} — {(s.customers as any)?.short_name || (s.customers as any)?.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Hub</Label>
              <Select value={selectedHub} onValueChange={setSelectedHub}>
                <SelectTrigger><SelectValue placeholder="Select hub" /></SelectTrigger>
                <SelectContent>
                  {hubs.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Colli on Pallet</Label>
                <Input type="number" value={colliCount} onChange={e => setColliCount(e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-2">
                <Label>Weight (kg)</Label>
                <Input type="number" step="0.1" value={weight} onChange={e => setWeight(e.target.value)} placeholder="0.0" />
              </div>
            </div>
            <Button onClick={handleGenerate} className="w-full">
              <Printer className="h-4 w-4 mr-2" />
              Generate & Print
            </Button>
          </CardContent>
        </Card>

        {/* Existing pallets for selected shipment */}
        <Card>
          <CardHeader><CardTitle className="text-lg">Pallets for Shipment</CardTitle></CardHeader>
          <CardContent>
            {!selectedShipment ? (
              <p className="text-muted-foreground text-sm">Select a shipment to see pallets</p>
            ) : existingPallets.length === 0 ? (
              <p className="text-muted-foreground text-sm">No pallets created yet</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pallet #</TableHead>
                    <TableHead>Hub</TableHead>
                    <TableHead>Pieces</TableHead>
                    <TableHead>Weight</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {existingPallets.map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono font-medium">{p.pallet_number}</TableCell>
                      <TableCell>{p.hub_code || '—'}</TableCell>
                      <TableCell>{p.pieces ?? p.colli_count ?? '—'}</TableCell>
                      <TableCell>{p.weight ?? p.weight_kg ? `${p.weight ?? p.weight_kg} kg` : '—'}</TableCell>
                      <TableCell>{p.status || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Print preview modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Label Preview</DialogTitle>
          </DialogHeader>
          {previewData && (
            <div className="border-2 border-foreground p-4 font-mono mx-auto" style={{ width: '100%', maxWidth: '380px' }}>
              <div className="text-center text-xl font-bold border-2 border-foreground p-2 mb-2">
                {previewData.subklant}
              </div>
              <div className="text-center text-lg font-bold mb-1">
                {previewData.palletId}
              </div>
              <div className="text-center text-xs mb-2">
                {(previewData.printedAt || new Date()).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })}{' '}
                {(previewData.printedAt || new Date()).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="flex justify-center p-2 my-2 border-2 border-foreground">
                <Barcode value={previewData.palletId} format="CODE128" width={1.5} height={50} displayValue={false} margin={0} />
              </div>
              <div className="text-center text-sm font-bold my-1">
                MAWB: {previewData.mawb}
              </div>
              <div className="text-center text-sm font-bold border-2 border-foreground p-2 my-1">
                {previewData.colli} CTN | {previewData.weight.toFixed(2)} KG
              </div>
              <div className="text-center text-xl font-bold mt-2 border-[3px] border-foreground p-2">
                {previewData.hub}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Close</Button>
            <Button onClick={handlePrint} disabled={printing}>
              {printing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Printer className="h-4 w-4 mr-2" />}
              Send to Printer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
