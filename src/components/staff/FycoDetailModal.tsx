import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';

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

export function FycoDetailModal({ shipment, open, onOpenChange }: { shipment: any; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: inspections = [], isLoading } = useShipmentInspectionDetails(shipment?.id);

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
                  <TableHead>Barcode</TableHead>
                  <TableHead>Date / Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inspections.map((insp: any, idx: number) => (
                  <TableRow key={insp.id}>
                    <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell className="font-mono text-sm">{insp.barcode}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {insp.created_at ? format(new Date(insp.created_at), 'dd/MM/yyyy HH:mm') : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
