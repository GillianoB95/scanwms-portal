import { Loader2, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';
import { toast } from 'sonner';

function useShipmentInspectionDetails(shipmentId: string | undefined) {
  return useQuery({
    queryKey: ['inspection-details', shipmentId],
    queryFn: async () => {
      if (!shipmentId) return [];
      const { data, error } = await supabase
        .from('inspections')
        .select('*')
        .eq('shipment_id', shipmentId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!shipmentId,
  });
}

function useDeleteInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inspectionId: string) => {
      const { error } = await supabase.from('inspections').delete().eq('id', inspectionId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inspection-details'] });
      qc.invalidateQueries({ queryKey: ['all-inspections'] });
      qc.invalidateQueries({ queryKey: ['staff-all-shipments'] });
    },
  });
}

async function resetShipmentCustomsStatus(shipmentId: string) {
  const { error } = await supabase
    .from('shipments')
    .update({
      customs_cleared: false,
      clearance_status: 'pending',
      customs_cleared_at: null,
      customs_cleared_by: null,
    })
    .eq('id', shipmentId);
  if (error) throw error;
}

function useDeleteAllInspections() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (shipmentId: string) => {
      const { error } = await supabase.from('inspections').delete().eq('shipment_id', shipmentId);
      if (error) throw error;
      await resetShipmentCustomsStatus(shipmentId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inspection-details'] });
      qc.invalidateQueries({ queryKey: ['all-inspections'] });
      qc.invalidateQueries({ queryKey: ['staff-all-shipments'] });
    },
  });
}

export function FycoDetailModal({ shipment, open, onOpenChange }: { shipment: any; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: inspections = [], isLoading } = useShipmentInspectionDetails(shipment?.id);
  const deleteOne = useDeleteInspection();
  const deleteAll = useDeleteAllInspections();

  const handleDeleteOne = async (id: string) => {
    try {
      await deleteOne.mutateAsync(id);
      // Check if any inspections remain; if not, reset shipment status
      const { count } = await supabase
        .from('inspections')
        .select('id', { count: 'exact', head: true })
        .eq('shipment_id', shipment.id);
      if (count === 0) {
        await resetShipmentCustomsStatus(shipment.id);
      }
      toast.success('Parcel removed');
    } catch {
      toast.error('Failed to remove parcel');
    }
  };

  const handleDeleteAll = async () => {
    if (!shipment?.id) return;
    try {
      await deleteAll.mutateAsync(shipment.id);
      toast.success('All parcels removed');
    } catch {
      toast.error('Failed to remove parcels');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Inspections (Fyco) — {shipment?.mawb}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : inspections.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No inspections found.</p>
        ) : (
          <div className="max-h-[400px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Parcel</TableHead>
                  <TableHead>Date / Time</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inspections.map((insp: any, idx: number) => (
                  <TableRow key={insp.id}>
                    <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell className="font-mono text-sm">{insp.barcode ?? insp.parcel_barcode}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {insp.created_at ? format(new Date(insp.created_at), 'dd/MM/yyyy HH:mm') : '—'}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => handleDeleteOne(insp.id)}
                        disabled={deleteOne.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {inspections.length > 0 && (
          <DialogFooter>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteAll}
              disabled={deleteAll.isPending}
            >
              {deleteAll.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Remove All ({inspections.length})
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
