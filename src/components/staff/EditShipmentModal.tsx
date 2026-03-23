import { useState } from 'react';
import { Loader2, CalendarIcon, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useUpdateShipment } from '@/hooks/use-staff-data';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const ALL_STATUSES = ['Awaiting NOA', 'Partial NOA', 'NOA Complete', 'In Transit', 'Partially Unloaded', 'In Stock', 'Outbound', 'Needs Action'];

export function EditShipmentModal({ shipment, open, onOpenChange }: { shipment: any; open: boolean; onOpenChange: (v: boolean) => void }) {
  const updateShipment = useUpdateShipment();
  const [colli, setColli] = useState(String(shipment?.colli_expected ?? 0));
  const [eta, setEta] = useState<Date | undefined>(shipment?.eta ? new Date(shipment.eta) : undefined);
  const [status, setStatus] = useState(shipment?.status ?? '');
  const [notes, setNotes] = useState(shipment?.notes ?? '');
  const [grossWeight, setGrossWeight] = useState(String(shipment?.gross_weight ?? ''));
  const [chargeableWeight, setChargeableWeight] = useState(String(shipment?.chargeable_weight ?? ''));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateShipment.mutateAsync({
        id: shipment.id,
        colli_expected: parseInt(colli) || 0,
        eta: eta ? format(eta, 'yyyy-MM-dd') : null,
        status,
        notes: notes || null,
        gross_weight: grossWeight ? parseFloat(grossWeight) : null,
        chargeable_weight: chargeableWeight ? parseFloat(chargeableWeight) : null,
      });
      toast.success('Shipment updated');
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Shipment — {shipment?.mawb}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Customer</Label>
            <Input value={shipment?.customers?.name || '—'} disabled className="bg-muted" />
          </div>
          <div className="space-y-2">
            <Label>Units (Colli)</Label>
            <Input type="number" value={colli} onChange={e => setColli(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>ETA</Label>
            <div className="flex gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("flex-1 justify-start text-left font-normal", !eta && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {eta ? format(eta, 'dd/MM/yyyy') : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={eta} onSelect={setEta} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
              {eta && (
                <Button variant="ghost" size="icon" onClick={() => setEta(undefined)} title="Clear ETA">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ALL_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Gross Weight (kg)</Label>
              <Input type="number" step="0.01" value={grossWeight} onChange={e => setGrossWeight(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <Label>Chargeable Weight (kg)</Label>
              <Input type="number" step="0.01" value={chargeableWeight} onChange={e => setChargeableWeight(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Internal notes..." rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
