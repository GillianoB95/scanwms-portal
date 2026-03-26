import { useState } from 'react';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';

const statusConfig: Record<string, { label: string; className: string }> = {
  under_inspection: { label: 'Under Inspection', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  scanned: { label: 'Scanned', className: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  checked: { label: 'Checked', className: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
  documents_requested: { label: 'Docs Requested', className: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
  additional_action: { label: 'Action Required', className: 'bg-orange-500/15 text-orange-600 border-orange-500/30' },
  released: { label: 'Released', className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  delivered: { label: 'Delivered', className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
};

interface Props {
  shipmentId: string;
}

export function FycoParcelsPanel({ shipmentId }: Props) {
  const [open, setOpen] = useState(false);

  const { data: inspections = [] } = useQuery({
    queryKey: ['fyco-parcels-panel', shipmentId],
    queryFn: async () => {
      const { data } = await supabase
        .from('inspections')
        .select('id, parcel_barcode, barcode, status, scan_time')
        .eq('shipment_id', shipmentId);
      return data ?? [];
    },
    enabled: !!shipmentId,
  });

  const { data: manifestParcels = [] } = useQuery({
    queryKey: ['fyco-manifest-parcels', shipmentId],
    queryFn: async () => {
      const { data } = await supabase
        .from('manifest_parcels')
        .select('parcel_barcode, outerbox_barcode, waybill')
        .eq('shipment_id', shipmentId);
      return data ?? [];
    },
    enabled: !!shipmentId,
  });

  if (inspections.length === 0) return null;

  const parcelToBox = new Map<string, { boxBarcode: string; hub: string }>();
  for (const mp of manifestParcels) {
    const key = mp.parcel_barcode?.toUpperCase();
    if (key) {
      parcelToBox.set(key, {
        boxBarcode: mp.outerbox_barcode || '—',
        hub: mp.waybill || '—',
      });
    }
  }

  const getStatus = (status: string) => {
    const cfg = statusConfig[status] || statusConfig.under_inspection;
    return cfg;
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="outline" className="w-full justify-between border-amber-500/30 text-amber-600 hover:bg-amber-500/10">
          <span className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            Fyco parcels ({inspections.length})
          </span>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Card className="mt-2 border-amber-500/20">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Parcel Number</TableHead>
                  <TableHead>Box Number</TableHead>
                  <TableHead>Destination Hub</TableHead>
                  <TableHead>Scan Time</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inspections.map((insp: any) => {
                  const key = insp.parcel_barcode?.toUpperCase();
                  const boxInfo = parcelToBox.get(key);
                  const statusCfg = getStatus(insp.status);
                  return (
                    <TableRow key={insp.id}>
                      <TableCell className="font-mono font-medium">{insp.parcel_barcode}</TableCell>
                      <TableCell className="font-mono">{boxInfo?.boxBarcode ?? '—'}</TableCell>
                      <TableCell>{boxInfo?.hub ?? '—'}</TableCell>
                      <TableCell className="text-sm">
                        {insp.scan_time ? (
                          format(new Date(insp.scan_time), 'dd/MM/yy HH:mm')
                        ) : (
                          <span className="text-muted-foreground italic">Not scanned yet</span>
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
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}
