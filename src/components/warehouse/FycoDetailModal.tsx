import { useState } from 'react';
import { Loader2, MapPin, CheckCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { format } from 'date-fns';
import { toast } from 'sonner';

const statusConfig: Record<string, { label: string; className: string }> = {
  under_inspection: { label: 'Under Inspection', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  scanned: { label: 'Scanned', className: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  checked: { label: 'Checked', className: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
  documents_requested: { label: 'Docs Requested', className: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
  additional_action: { label: 'Action Required', className: 'bg-orange-500/15 text-orange-600 border-orange-500/30' },
  released: { label: 'Released', className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  delivered: { label: 'Delivered', className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
};

function getDisplayStatus(insp: any) {
  if (insp.released_at) return statusConfig.released;
  if (insp.additional_action_required) return statusConfig.additional_action;
  if (insp.documents_requested) return statusConfig.documents_requested;
  if (insp.checked_at) return statusConfig.checked;
  if (insp.scan_time) return statusConfig.scanned;
  return statusConfig.under_inspection;
}

export function WarehouseFycoDetailModal({ shipment, open, onOpenChange }: { shipment: any; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [editingLocation, setEditingLocation] = useState<string | null>(null);
  const [locationValue, setLocationValue] = useState('');

  const { data: inspections = [], isLoading } = useQuery({
    queryKey: ['warehouse-fyco-detail', shipment?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('inspections')
        .select('*')
        .eq('shipment_id', shipment.id)
        .order('created_at', { ascending: true });
      return data ?? [];
    },
    enabled: !!shipment?.id && open,
  });

  // Fetch outerbox_barcode from manifest_parcels
  const { data: manifestParcels = [] } = useQuery({
    queryKey: ['warehouse-fyco-manifest', shipment?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('manifest_parcels')
        .select('parcel_barcode, outerbox_barcode')
        .eq('shipment_id', shipment.id);
      return data ?? [];
    },
    enabled: !!shipment?.id && open,
  });

  const boxMap = new Map<string, string>();
  for (const mp of manifestParcels) {
    if (mp.parcel_barcode) boxMap.set(mp.parcel_barcode.toUpperCase(), mp.outerbox_barcode ?? '—');
  }

  const updateLocation = useMutation({
    mutationFn: async ({ id, location }: { id: string; location: string }) => {
      const { error } = await supabase.from('inspections').update({ location }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouse-fyco-detail'] });
      setEditingLocation(null);
      toast.success('Location updated');
    },
    onError: () => toast.error('Failed to update location'),
  });

  const toggleChecked = useMutation({
    mutationFn: async ({ id, checked }: { id: string; checked: boolean }) => {
      const update = checked
        ? { checked_at: new Date().toISOString(), checked_by: user?.email ?? null }
        : { checked_at: null, checked_by: null };
      const { error } = await supabase.from('inspections').update(update).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouse-fyco-detail'] });
      toast.success('Checked status updated');
    },
    onError: () => toast.error('Failed to update'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Fyco Parcels — {shipment?.mawb}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : inspections.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No inspections found.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Parcel</TableHead>
                <TableHead>Box Barcode</TableHead>
                <TableHead>Scan Time</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Checked</TableHead>
                <TableHead>Docs Requested</TableHead>
                <TableHead>Action Required</TableHead>
                <TableHead>Released</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inspections.map((insp: any, idx: number) => {
                const statusCfg = getDisplayStatus(insp);
                const boxBarcode = boxMap.get(insp.parcel_barcode?.toUpperCase()) ?? '—';
                return (
                  <TableRow key={insp.id}>
                    <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell className="font-mono text-sm">{insp.parcel_barcode ?? insp.barcode}</TableCell>
                    <TableCell className="font-mono text-sm">{boxBarcode}</TableCell>
                    <TableCell className="text-sm">
                      {insp.scan_time ? (
                        format(new Date(insp.scan_time), 'dd/MM/yy HH:mm')
                      ) : (
                        <span className="text-muted-foreground italic">Not scanned yet</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingLocation === insp.id ? (
                        <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); updateLocation.mutate({ id: insp.id, location: locationValue }); }}>
                          <Input value={locationValue} onChange={e => setLocationValue(e.target.value)} className="h-7 w-24 text-xs" autoFocus />
                          <Button type="submit" size="sm" variant="ghost" className="h-7 px-2" disabled={updateLocation.isPending}>
                            <CheckCircle className="h-3 w-3" />
                          </Button>
                        </form>
                      ) : (
                        <button
                          className="flex items-center gap-1 text-sm hover:text-accent-foreground transition-colors"
                          onClick={() => { setEditingLocation(insp.id); setLocationValue(insp.location ?? ''); }}
                        >
                          <MapPin className="h-3 w-3 text-muted-foreground" />
                          {insp.location || <span className="text-muted-foreground italic">Set</span>}
                        </button>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant={insp.checked_at ? 'default' : 'outline'}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => toggleChecked.mutate({ id: insp.id, checked: !insp.checked_at })}
                        disabled={toggleChecked.isPending}
                      >
                        {insp.checked_at ? '✓ Checked' : 'Mark'}
                      </Button>
                    </TableCell>
                    {/* Staff-only fields: read-only badges */}
                    <TableCell>
                      {insp.documents_requested ? (
                        <Badge className="bg-blue-500/15 text-blue-600 border-blue-500/30">Yes</Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {insp.additional_action_required ? (
                        <Badge className="bg-orange-500/15 text-orange-600 border-orange-500/30">Yes</Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {insp.released_at ? (
                        <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">Released</Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={statusCfg.className}>{statusCfg.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
