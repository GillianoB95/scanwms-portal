import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useWarehouseAuth } from '@/hooks/use-warehouse-auth';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useHubs } from '@/hooks/use-hubs';
import { useToast } from '@/hooks/use-toast';
import { ScanBarcode, CheckCircle2, Search, Printer, Loader2, AlertTriangle } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { printPalletLabel, type PalletLabelData } from '@/lib/printnode';

export default function InboundScanning() {
  const { data: auth } = useWarehouseAuth();
  const { customer } = useAuth();
  const warehouseId = auth?.warehouseId;
  const [mawbInput, setMawbInput] = useState('');
  const [shipment, setShipment] = useState<any>(null);
  const [shipmentError, setShipmentError] = useState('');
  const [barcode, setBarcode] = useState('');
  const [searching, setSearching] = useState(false);
  const [scanningBlocked, setScanningBlocked] = useState<string | null>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  // Print label state
  const [labelOpen, setLabelOpen] = useState(false);
  const [labelHub, setLabelHub] = useState('');
  const [labelColli, setLabelColli] = useState('');
  const [labelWeight, setLabelWeight] = useState('');
  const [previewData, setPreviewData] = useState<PalletLabelData | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [pendingPalletNumber, setPendingPalletNumber] = useState('');
  const { data: hubs = [] } = useHubs();

  // Warehouse details for PrintNode
  const { data: warehouse } = useQuery({
    queryKey: ['warehouse-detail', customer?.warehouse_id],
    queryFn: async () => {
      if (!customer?.warehouse_id) return null;
      const { data } = await supabase
        .from('warehouses')
        .select('id, code, name, printnode_id, printnode_key, printnode_name')
        .eq('id', customer.warehouse_id)
        .single();
      return data;
    },
    enabled: !!customer?.warehouse_id,
  });

  const handleMawbSearch = async () => {
    if (!mawbInput.trim()) return;
    setSearching(true);
    setShipmentError('');
    setShipment(null);
    try {
      const { data, error } = await supabase
        .from('shipments')
        .select('id, mawb, colli_expected, status, customers(name, short_name)')
        .eq('mawb', mawbInput.trim())
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        setShipmentError('No shipment found for this MAWB');
      } else {
        setShipment(data);
      }
    } catch (err: any) {
      setShipmentError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const { data: scannedBoxes = [] } = useQuery({
    queryKey: ['scanned-boxes', shipment?.id],
    queryFn: async () => {
      if (!shipment?.id) return [];
      const { data } = await supabase
        .from('outerboxes')
        .select('id, barcode, scanned_in_at')
        .eq('shipment_id', shipment.id)
        .eq('status', 'scanned_in')
        .order('scanned_in_at', { ascending: false });
      return data ?? [];
    },
    enabled: !!shipment?.id,
  });

  // Pallets for this shipment
  const { data: existingPallets = [] } = useQuery({
    queryKey: ['shipment-pallets', shipment?.id],
    queryFn: async () => {
      if (!shipment?.id) return [];
      const { data } = await supabase
        .from('pallets')
        .select('*')
        .eq('shipment_id', shipment.id)
        .order('created_at', { ascending: false });
      return data ?? [];
    },
    enabled: !!shipment?.id,
  });

  const scanMutation = useMutation({
    mutationFn: async (code: string) => {
      // Check for active inbound block
      const { data: blocks } = await supabase
        .from('shipment_blocks')
        .select('reason')
        .eq('shipment_id', shipment.id)
        .eq('block_type', 'inbound')
        .is('removed_at', null);
      if (blocks && blocks.length > 0) {
        throw new Error(`Inbound blocked: ${blocks[0].reason || 'No reason provided'}`);
      }

      const { error } = await supabase.from('outerboxes').insert({
        shipment_id: shipment.id,
        barcode: code,
        status: 'scanned_in',
        scanned_in_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scanned-boxes', shipment?.id] });
      toast({ title: 'Box scanned', description: barcode });
      setBarcode('');
      barcodeRef.current?.focus();
    },
    onError: (err: any) => {
      toast({ title: 'Scan failed', description: err.message, variant: 'destructive' });
    },
  });

  const unloadMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('shipments')
        .update({ status: 'In Stock', unloaded_at: new Date().toISOString() })
        .eq('id', shipment.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Shipment marked as unloaded and In Stock' });
      setShipment(null);
      setMawbInput('');
    },
  });

  const handleScan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcode.trim() || !shipment) return;
    scanMutation.mutate(barcode.trim());
  };

  const handleMawbKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleMawbSearch();
    }
  };

  useEffect(() => {
    if (shipment) barcodeRef.current?.focus();
  }, [shipment]);

  const totalExpected = shipment?.colli_expected ?? 0;
  const totalScanned = scannedBoxes.length;
  const subklant = shipment?.customers?.short_name || shipment?.customers?.name || '—';

  // Print Label logic
  const handleGenerateLabel = async () => {
    if (!labelHub || !labelColli || !labelWeight) {
      toast({ title: 'Fill all label fields', variant: 'destructive' });
      return;
    }
    if (!warehouse?.code) {
      toast({ title: 'Warehouse code not configured', variant: 'destructive' });
      return;
    }
    try {
      const { data: palletNumber, error: rpcError } = await supabase.rpc('generate_pallet_number', {
        p_warehouse_code: warehouse.code,
      });
      if (rpcError) throw rpcError;
      if (!palletNumber) throw new Error('No pallet number returned');

      const colli = parseInt(labelColli);
      const weightKg = parseFloat(labelWeight);

      const { error: insertError } = await supabase.from('pallets').insert({
        shipment_id: shipment.id,
        pallet_number: palletNumber,
        warehouse_code: warehouse.code,
        pieces: colli,
        weight: weightKg,
        status: 'Palletized',
        hub_code: labelHub,
      });
      if (insertError) throw insertError;

      const labelData: PalletLabelData = {
        palletId: palletNumber,
        subklant,
        mawb: shipment.mawb || '',
        colli,
        weight: weightKg,
        hub: labelHub,
        printedAt: new Date(),
      };

      setPendingPalletNumber(palletNumber);
      setPreviewData(labelData);
      setLabelOpen(false);
      setPreviewOpen(true);

      qc.invalidateQueries({ queryKey: ['shipment-pallets', shipment.id] });
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
      <h1 className="text-2xl font-bold">Inbound Scanning</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Find Shipment by MAWB</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 max-w-md">
            <Input
              value={mawbInput}
              onChange={e => setMawbInput(e.target.value)}
              onKeyDown={handleMawbKeyDown}
              placeholder="Enter MAWB number (e.g. 607-50842772)"
              className="font-mono"
            />
            <Button onClick={handleMawbSearch} disabled={searching}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
          {shipmentError && (
            <p className="text-sm text-destructive mt-2">{shipmentError}</p>
          )}
          {shipment && (
            <div className="mt-4 p-3 rounded-lg bg-muted text-sm space-y-1">
              <p><span className="font-medium">MAWB:</span> <span className="font-mono">{shipment.mawb}</span></p>
              <p><span className="font-medium">Customer:</span> {shipment.customers?.name ?? '—'} ({subklant})</p>
              <p><span className="font-medium">Colli Expected:</span> {shipment.colli_expected ?? '—'}</p>
              <p><span className="font-medium">Status:</span> {shipment.status}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {shipment && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-6">
                <form onSubmit={handleScan} className="space-y-4">
                  <label className="text-sm font-medium">Scan Barcode</label>
                  <div className="flex gap-2">
                    <Input
                      ref={barcodeRef}
                      value={barcode}
                      onChange={e => setBarcode(e.target.value)}
                      placeholder="Scan or type barcode..."
                      className="text-lg h-14 font-mono"
                      autoFocus
                    />
                    <Button type="submit" size="lg" className="h-14" disabled={scanMutation.isPending}>
                      <ScanBarcode className="h-5 w-5" />
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6 flex flex-col items-center justify-center">
                <p className="text-sm text-muted-foreground mb-1">Scanning Progress</p>
                <p className="text-4xl font-bold">
                  <span className={totalScanned >= totalExpected && totalExpected > 0 ? 'text-[hsl(var(--status-delivered))]' : ''}>{totalScanned}</span>
                  <span className="text-muted-foreground text-2xl"> / {totalExpected}</span>
                </p>
                <div className="w-full bg-muted rounded-full h-3 mt-4">
                  <div
                    className="bg-accent h-3 rounded-full transition-all"
                    style={{ width: `${totalExpected > 0 ? Math.min((totalScanned / totalExpected) * 100, 100) : 0}%` }}
                  />
                </div>
                <div className="flex gap-2 mt-4">
                  <Button
                    variant="outline"
                    onClick={() => unloadMutation.mutate()}
                    disabled={unloadMutation.isPending}
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Mark as Unloaded
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setLabelOpen(true)}
                  >
                    <Printer className="mr-2 h-4 w-4" />
                    Print Label
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Existing pallets for this shipment */}
          {existingPallets.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Pallets for this Shipment</CardTitle>
              </CardHeader>
              <CardContent>
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
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Last Scanned ({Math.min(scannedBoxes.length, 10)})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Barcode</TableHead>
                    <TableHead>Scanned At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scannedBoxes.slice(0, 10).map((box: any, i: number) => (
                    <TableRow key={box.id}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell className="font-mono">{box.barcode}</TableCell>
                      <TableCell>{new Date(box.scanned_in_at).toLocaleTimeString()}</TableCell>
                    </TableRow>
                  ))}
                  {scannedBoxes.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">No boxes scanned yet</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {/* Print Label Modal */}
      <Dialog open={labelOpen} onOpenChange={setLabelOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Pallet Label</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Hub</Label>
              <Select value={labelHub} onValueChange={setLabelHub}>
                <SelectTrigger><SelectValue placeholder="Select hub" /></SelectTrigger>
                <SelectContent>
                  {hubs.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Colli on Pallet</Label>
                <Input type="number" value={labelColli} onChange={e => setLabelColli(e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-2">
                <Label>Weight (kg)</Label>
                <Input type="number" step="0.1" value={labelWeight} onChange={e => setLabelWeight(e.target.value)} placeholder="0.0" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLabelOpen(false)}>Cancel</Button>
            <Button onClick={handleGenerateLabel}>
              <Printer className="h-4 w-4 mr-2" />Generate & Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Print Preview Modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Label Preview</DialogTitle></DialogHeader>
          {previewData && (
            <div className="border-2 border-foreground p-4 font-mono mx-auto" style={{ width: '100%', maxWidth: '380px' }}>
              <div className="text-center text-xl font-bold border-2 p-2 mb-2" style={{ color: '#dc2626', borderColor: '#dc2626' }}>
                {previewData.subklant}
              </div>
              <div className="text-center text-lg font-bold mb-1" style={{ color: '#ca8a04' }}>
                {previewData.palletId}
              </div>
              <div className="text-center text-xs mb-2" style={{ color: '#ea580c' }}>
                {(previewData.printedAt || new Date()).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })}{' '}
                {(previewData.printedAt || new Date()).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="text-center p-2 my-2 border-2" style={{ borderColor: '#2563eb' }}>
                <div className="text-4xl tracking-widest" style={{ fontFamily: "'Libre Barcode 128', monospace" }}>
                  {previewData.palletId}
                </div>
                <div className="text-xs">{previewData.palletId}</div>
              </div>
              <div className="text-center text-sm font-bold my-1" style={{ color: '#92400e' }}>
                MAWB: {previewData.mawb}
              </div>
              <div className="text-center text-sm font-bold text-white p-2 my-1" style={{ backgroundColor: '#15803d' }}>
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
