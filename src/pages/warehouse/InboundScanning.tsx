import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useWarehouseAuth } from '@/hooks/use-warehouse-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { ScanBarcode, CheckCircle2 } from 'lucide-react';

export default function InboundScanning() {
  const { data: auth } = useWarehouseAuth();
  const warehouseId = auth?.warehouseId;
  const [selectedShipment, setSelectedShipment] = useState('');
  const [barcode, setBarcode] = useState('');
  const barcodeRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: shipments = [] } = useQuery({
    queryKey: ['warehouse-active-shipments', warehouseId],
    queryFn: async () => {
      if (!warehouseId) return [];
      const { data } = await supabase
        .from('shipments')
        .select('id, mawb, colli_expected, status, customers(name)')
        .eq('warehouse_id', warehouseId)
        .in('status', ['NOA Complete', 'In Transit', 'Partial NOA'])
        .order('created_at', { ascending: false });
      return data ?? [];
    },
    enabled: !!warehouseId,
  });

  const { data: scannedBoxes = [] } = useQuery({
    queryKey: ['scanned-boxes', selectedShipment],
    queryFn: async () => {
      if (!selectedShipment) return [];
      const { data } = await supabase
        .from('outerboxes')
        .select('id, barcode, scanned_in_at')
        .eq('shipment_id', selectedShipment)
        .eq('status', 'scanned_in')
        .order('scanned_in_at', { ascending: false });
      return data ?? [];
    },
    enabled: !!selectedShipment,
  });

  const scanMutation = useMutation({
    mutationFn: async (code: string) => {
      const { error } = await supabase.from('outerboxes').insert({
        shipment_id: selectedShipment,
        barcode: code,
        status: 'scanned_in',
        scanned_in_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scanned-boxes', selectedShipment] });
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
        .eq('id', selectedShipment);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouse-active-shipments'] });
      toast({ title: 'Shipment marked as unloaded and In Stock' });
      setSelectedShipment('');
    },
  });

  const handleScan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcode.trim() || !selectedShipment) return;
    scanMutation.mutate(barcode.trim());
  };

  useEffect(() => {
    if (selectedShipment) barcodeRef.current?.focus();
  }, [selectedShipment]);

  const currentShipment = shipments.find((s: any) => s.id === selectedShipment);
  const totalExpected = currentShipment?.colli_expected ?? 0;
  const totalScanned = scannedBoxes.length;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Inbound Scanning</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Select Shipment</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedShipment} onValueChange={setSelectedShipment}>
            <SelectTrigger className="max-w-md">
              <SelectValue placeholder="Select a shipment (MAWB)" />
            </SelectTrigger>
            <SelectContent>
              {shipments.map((s: any) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.mawb} — {(s.customers as any)?.name ?? 'Unknown'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedShipment && (
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
                  <span className={totalScanned >= totalExpected ? 'text-[hsl(var(--status-delivered))]' : ''}>{totalScanned}</span>
                  <span className="text-muted-foreground text-2xl"> / {totalExpected}</span>
                </p>
                <div className="w-full bg-muted rounded-full h-3 mt-4">
                  <div
                    className="bg-accent h-3 rounded-full transition-all"
                    style={{ width: `${totalExpected > 0 ? Math.min((totalScanned / totalExpected) * 100, 100) : 0}%` }}
                  />
                </div>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => unloadMutation.mutate()}
                  disabled={unloadMutation.isPending}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Mark as Unloaded
                </Button>
              </CardContent>
            </Card>
          </div>

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
    </div>
  );
}
