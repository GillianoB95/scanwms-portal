import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useHubs } from '@/hooks/use-hubs';
import { useToast } from '@/hooks/use-toast';
import { Printer, Loader2 } from 'lucide-react';
import { printPalletLabel, generatePalletNumber } from '@/lib/printnode';

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

  const createAndPrint = useMutation({
    mutationFn: async () => {
      const shipment = shipments.find((s: any) => s.id === selectedShipment);
      if (!shipment) throw new Error('Shipment not found');

      const palletNumber = generatePalletNumber(selectedShipment);
      const subklant = (shipment.customers as any)?.short_name || (shipment.customers as any)?.name || '—';
      const colli = parseInt(colliCount);
      const weightKg = parseFloat(weight);

      // Insert pallet into DB
      const { error } = await supabase.from('pallets').insert({
        shipment_id: selectedShipment,
        pallet_number: palletNumber,
        hub_code: selectedHub,
        colli_count: colli,
        weight_kg: weightKg,
      });
      if (error) throw error;

      // Send to PrintNode
      const printResult = await printPalletLabel({
        palletId: palletNumber,
        subklant,
        mawb: (shipment as any).mawb || '',
        colli,
        weight: weightKg,
        hub: selectedHub,
      });

      return { palletNumber, subklant, colli, weight: weightKg, hub: selectedHub, printResult };
    },
    onSuccess: ({ palletNumber, subklant, colli, weight: w, hub, printResult }) => {
      setGeneratedLabel({ palletNumber, subklant, colli, weight: w, hub });
      qc.invalidateQueries({ queryKey: ['label-shipments'] });

      if (printResult.success) {
        toast({ title: 'Pallet created & sent to printer', description: `${palletNumber} (Job #${printResult.jobId})` });
      } else {
        toast({ title: 'Pallet created but print failed', description: printResult.error, variant: 'destructive' });
      }
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
    createAndPrint.mutate();
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
            <Button onClick={handleGenerate} disabled={createAndPrint.isPending} className="w-full">
              {createAndPrint.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Printer className="h-4 w-4 mr-2" />}
              Generate & Print
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Label Preview</CardTitle>
          </CardHeader>
          <CardContent>
            {generatedLabel ? (
              <div className="border-2 border-foreground p-4 font-mono max-w-sm mx-auto">
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
