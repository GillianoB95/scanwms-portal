import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useWarehouseAuth } from '@/hooks/use-warehouse-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useHubs } from '@/hooks/use-hubs';
import { useToast } from '@/hooks/use-toast';
import { Printer } from 'lucide-react';

function generatePalletNumber() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PLT-${ts}-${rand}`;
}

export default function PrintLabels() {
  const { data: auth } = useWarehouseAuth();
  const warehouseId = auth?.warehouseId;
  const { data: hubs = [] } = useHubs();
  const { toast } = useToast();
  const qc = useQueryClient();
  const printRef = useRef<HTMLDivElement>(null);

  const [selectedShipment, setSelectedShipment] = useState('');
  const [selectedHub, setSelectedHub] = useState('');
  const [colliCount, setColliCount] = useState('');
  const [weight, setWeight] = useState('');
  const [generatedLabel, setGeneratedLabel] = useState<any>(null);

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

  const createPallet = useMutation({
    mutationFn: async () => {
      const palletNumber = generatePalletNumber();
      const shipment = shipments.find((s: any) => s.id === selectedShipment);
      const { error } = await supabase.from('pallets').insert({
        shipment_id: selectedShipment,
        pallet_number: palletNumber,
        hub_code: selectedHub,
        colli_count: parseInt(colliCount),
        weight_kg: parseFloat(weight),
      });
      if (error) throw error;
      return {
        palletNumber,
        subklant: (shipment?.customers as any)?.short_name || (shipment?.customers as any)?.name || '—',
        colli: parseInt(colliCount),
        weight: parseFloat(weight),
        hub: selectedHub,
      };
    },
    onSuccess: (label) => {
      setGeneratedLabel(label);
      qc.invalidateQueries({ queryKey: ['label-shipments'] });
      toast({ title: 'Pallet created', description: label.palletNumber });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const handleGenerate = () => {
    if (!selectedShipment || !selectedHub || !colliCount || !weight) {
      toast({ title: 'Fill all fields', variant: 'destructive' });
      return;
    }
    createPallet.mutate();
  };

  const handlePrint = () => {
    if (!printRef.current) return;
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (!printWindow) return;
    printWindow.document.write(`
      <html><head><title>Pallet Label</title>
      <style>
        body { font-family: monospace; padding: 16px; margin: 0; }
        .label { border: 2px solid #000; padding: 16px; width: 350px; }
        .row { display: flex; justify-content: space-between; margin: 8px 0; }
        .title { font-size: 18px; font-weight: bold; text-align: center; margin-bottom: 12px; }
        .barcode { text-align: center; font-size: 24px; letter-spacing: 4px; margin: 16px 0; padding: 12px; border: 1px dashed #666; }
        .field-label { font-size: 11px; color: #666; }
        .field-value { font-size: 14px; font-weight: bold; }
      </style></head><body>
      ${printRef.current.innerHTML}
      <script>window.print(); window.close();</script>
      </body></html>
    `);
    printWindow.document.close();
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
            <Button onClick={handleGenerate} disabled={createPallet.isPending} className="w-full">
              Generate Pallet Label
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center justify-between">
              Label Preview
              {generatedLabel && (
                <Button size="sm" variant="outline" onClick={handlePrint}>
                  <Printer className="mr-2 h-4 w-4" />Print
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {generatedLabel ? (
              <div ref={printRef}>
                <div className="label border-2 border-foreground p-4 font-mono max-w-sm mx-auto">
                  <div className="text-center text-lg font-bold mb-3">SCANWMS PALLET</div>
                  <div className="text-center text-2xl tracking-widest border border-dashed border-muted-foreground p-3 my-4 font-bold">
                    {generatedLabel.palletNumber}
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Subklant:</span>
                      <span className="font-bold">{generatedLabel.subklant}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Hub:</span>
                      <span className="font-bold">{generatedLabel.hub}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Colli:</span>
                      <span className="font-bold">{generatedLabel.colli}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Weight:</span>
                      <span className="font-bold">{generatedLabel.weight} kg</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-48 text-muted-foreground">
                Generate a label to see preview
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
